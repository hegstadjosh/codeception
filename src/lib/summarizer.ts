/**
 * Summarizer Service
 *
 * Calls a local Ollama instance to generate tiered summaries
 * of Claude Code conversations:
 *
 *   Tier 1 — Latest Message   (every new assistant message)
 *   Tier 2 — Current Task     (every 5 messages)
 *   Tier 3 — Session Overview  (every 20 messages)
 *
 * Summaries are cached in the local SQLite DB and only regenerated
 * when enough new messages have arrived since the last generation.
 *
 * If Ollama is unavailable the service degrades gracefully — it
 * returns nulls and logs errors instead of throwing.
 */

import { getSummary, upsertSummary } from "./db";
import { extractMessageText } from "./scanner";
import { PROMPTS } from "./summarizer-prompts";
import type { ConversationMessage, SummaryTier } from "./types";
import { DEFAULT_SETTINGS } from "./types";

// ---- Ollama client ----

const OLLAMA_URL = DEFAULT_SETTINGS.ollamaUrl; // http://localhost:11434
const DEFAULT_MODEL = DEFAULT_SETTINGS.ollamaModel; // qwen2.5:7b

/**
 * Call Ollama's non-streaming generate endpoint.
 * Returns the trimmed response text, or empty string on failure.
 */
async function callOllama(
  prompt: string,
  model: string = DEFAULT_MODEL
): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.3, num_predict: 100 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as { response?: string };
  return data.response?.trim() ?? "";
}

// ---- Health check ----

/**
 * Returns true if Ollama is running and reachable.
 */
export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---- Helper: message thresholds per tier ----

/** How many new messages must arrive before we regenerate a tier. */
const TIER_THRESHOLDS: Record<SummaryTier, number> = {
  1: 1,
  2: 5,
  3: 20,
  4: 20, // group-level — unused here but keeps the record complete
};

// ---- Text extraction helpers ----

/** Truncate text to roughly `maxChars` characters. */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

/** Get the text of the last assistant message. */
function getLastAssistantText(messages: ConversationMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === "assistant" || msg.message?.role === "assistant") {
      const text = extractMessageText(msg);
      if (text) return truncate(text, 2000); // ~500 tokens
    }
  }
  return null;
}

/** Get text from the last N user+assistant messages. */
function getRecentMessagesText(
  messages: ConversationMessage[],
  count: number
): string {
  const relevant = messages
    .filter((m) => m.type === "user" || m.type === "assistant")
    .slice(-count);

  return relevant
    .map((m) => {
      const role = m.message?.role ?? m.type;
      const text = truncate(extractMessageText(m), 500);
      return `[${role}] ${text}`;
    })
    .join("\n\n");
}

/** Get all user prompt texts from the session. */
function getAllUserPrompts(messages: ConversationMessage[]): string {
  return messages
    .filter((m) => m.type === "user" && m.message?.role === "user")
    .map((m) => truncate(extractMessageText(m), 300))
    .join("\n---\n");
}

// ---- Core: should we regenerate? ----

async function shouldRegenerate(
  sessionId: string,
  tier: SummaryTier,
  currentMessageCount: number,
  force: boolean
): Promise<{ needed: boolean; existing: string | null }> {
  if (force) return { needed: true, existing: null };

  const cached = await getSummary(sessionId, tier);
  if (!cached) return { needed: true, existing: null };

  const delta = currentMessageCount - cached.messageCountAt;
  if (delta >= TIER_THRESHOLDS[tier]) {
    return { needed: true, existing: cached.summary };
  }
  return { needed: false, existing: cached.summary };
}

// ---- Tier generation ----

async function generateTier1(
  sessionId: string,
  messages: ConversationMessage[],
  messageCount: number,
  force: boolean
): Promise<string | null> {
  const { needed, existing } = await shouldRegenerate(sessionId, 1, messageCount, force);
  if (!needed) return existing;

  const lastText = getLastAssistantText(messages);
  if (!lastText) return existing;

  const prompt = PROMPTS.tier1(lastText);
  const summary = await callOllama(prompt);
  if (!summary) return existing;

  await upsertSummary({
    sessionId,
    tier: 1,
    summary,
    generatedAt: Date.now(),
    messageCountAt: messageCount,
  });
  return summary;
}

async function generateTier2(
  sessionId: string,
  messages: ConversationMessage[],
  messageCount: number,
  force: boolean
): Promise<string | null> {
  const { needed, existing } = await shouldRegenerate(sessionId, 2, messageCount, force);
  if (!needed) return existing;

  const messagesText = getRecentMessagesText(messages, 10);
  if (!messagesText) return existing;

  const prompt = PROMPTS.tier2(messagesText);
  const summary = await callOllama(prompt);
  if (!summary) return existing;

  await upsertSummary({
    sessionId,
    tier: 2,
    summary,
    generatedAt: Date.now(),
    messageCountAt: messageCount,
  });
  return summary;
}

async function generateTier3(
  sessionId: string,
  messages: ConversationMessage[],
  messageCount: number,
  force: boolean,
  currentTaskSummary: string | null
): Promise<string | null> {
  const { needed, existing } = await shouldRegenerate(sessionId, 3, messageCount, force);
  if (!needed) return existing;

  const promptsText = getAllUserPrompts(messages);
  if (!promptsText) return existing;

  const currentTask = currentTaskSummary ?? "unknown";
  const prompt = PROMPTS.tier3(promptsText, currentTask);
  const summary = await callOllama(prompt);
  if (!summary) return existing;

  await upsertSummary({
    sessionId,
    tier: 3,
    summary,
    generatedAt: Date.now(),
    messageCountAt: messageCount,
  });
  return summary;
}

// ---- Public API ----

/**
 * Generate (or return cached) tiered summaries for a session.
 *
 * @param sessionId  - The Claude Code session UUID
 * @param messages   - Full list of conversation messages
 * @param messageCount - Total message count in the JSONL (may differ from messages.length if
 *                       the caller only loaded a subset)
 * @param force      - If true, regenerate all tiers regardless of cache
 */
export async function summarizeSession(
  sessionId: string,
  messages: ConversationMessage[],
  messageCount: number,
  force?: boolean
): Promise<{ tier1: string | null; tier2: string | null; tier3: string | null }> {
  const result: { tier1: string | null; tier2: string | null; tier3: string | null } = {
    tier1: null,
    tier2: null,
    tier3: null,
  };

  try {
    // Quick bail-out if Ollama is unreachable (avoids three sequential timeouts)
    const healthy = await checkOllamaHealth();
    if (!healthy) {
      console.warn("[summarizer] Ollama is not reachable — skipping summarization");
      // Still return whatever is cached
      const cached1 = await getSummary(sessionId, 1);
      const cached2 = await getSummary(sessionId, 2);
      const cached3 = await getSummary(sessionId, 3);
      return {
        tier1: cached1?.summary ?? null,
        tier2: cached2?.summary ?? null,
        tier3: cached3?.summary ?? null,
      };
    }

    // Generate tier 1 and tier 2 in parallel (they're independent)
    const [t1, t2] = await Promise.all([
      generateTier1(sessionId, messages, messageCount, !!force).catch((err) => {
        console.error("[summarizer] Tier 1 error:", err);
        return null;
      }),
      generateTier2(sessionId, messages, messageCount, !!force).catch((err) => {
        console.error("[summarizer] Tier 2 error:", err);
        return null;
      }),
    ]);

    result.tier1 = t1;
    result.tier2 = t2;

    // Tier 3 depends on tier 2's output for context
    result.tier3 = await generateTier3(
      sessionId,
      messages,
      messageCount,
      !!force,
      t2
    ).catch((err) => {
      console.error("[summarizer] Tier 3 error:", err);
      return null;
    });
  } catch (err) {
    console.error("[summarizer] Unexpected error:", err);
  }

  return result;
}
