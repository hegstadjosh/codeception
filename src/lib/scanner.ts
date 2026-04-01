/**
 * Scanner Service
 *
 * Discovers Claude Code sessions by reading ~/.claude/sessions/*.json,
 * cross-referencing with process table, and parsing conversation JSONL files.
 *
 * Design decisions:
 * - Polls every N seconds rather than pure fs.watch (more reliable across macOS edge cases)
 * - Reads JSONL files by seeking to end and reading backward for recent messages
 *   (avoids reading entire multi-MB conversation files on every poll)
 * - Caches file sizes to detect changes without re-reading unchanged files
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import type {
  Session,
  SessionFile,
  SessionStatus,
  ConversationMessage,
  ProcessInfo,
} from "./types";
import { getAllSummaries } from "./db";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

// Cache of last-known file sizes for change detection
const fileSizeCache = new Map<string, number>();
// Cache of last N messages per session
const messageCache = new Map<string, ConversationMessage[]>();

// ---- Process monitoring ----

export function getClaudeProcesses(): Map<number, ProcessInfo> {
  const procs = new Map<number, ProcessInfo>();
  try {
    const output = execSync(
      'ps aux | grep -E "claude\\s" | grep -v grep',
      { encoding: "utf-8", timeout: 5000 }
    );
    for (const line of output.trim().split("\n")) {
      if (!line) continue;
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[1], 10);
      if (isNaN(pid)) continue;
      procs.set(pid, {
        pid,
        cpu: parseFloat(parts[2]) || 0,
        mem: parseFloat(parts[3]) || 0,
        tty: parts[6] || "?",
        command: parts.slice(10).join(" "),
        isAlive: true,
      });
    }
  } catch {
    // grep returns exit code 1 if no matches — that's fine
  }
  return procs;
}

// ---- Session discovery ----

function readSessionFiles(): SessionFile[] {
  const sessions: SessionFile[] = [];
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8");
        const data = JSON.parse(content) as SessionFile;
        if (data.sessionId && data.pid) {
          sessions.push(data);
        }
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Sessions dir might not exist
  }
  return sessions;
}

// ---- JSONL file discovery ----

/**
 * Find the conversation JSONL file for a given session.
 *
 * Claude Code stores conversations at:
 *   ~/.claude/projects/{encoded-project-path}/{session-id}.jsonl
 *
 * The project path is the cwd encoded with dashes replacing slashes.
 * We also check for session dirs with subagents.
 */
function findJsonlPath(sessionId: string, cwd: string): string | null {
  // Encode the cwd into the project directory name format
  // e.g., /Users/josh/Build_2026/BK_Monitor -> -Users-josh-Build_2026-BK_Monitor
  // But Claude Code uses a specific encoding — let's just scan project dirs

  try {
    const projectDirs = fs.readdirSync(PROJECTS_DIR);
    for (const dir of projectDirs) {
      const projectPath = path.join(PROJECTS_DIR, dir);
      if (!fs.statSync(projectPath).isDirectory()) continue;

      // Direct JSONL file
      const jsonlFile = path.join(projectPath, `${sessionId}.jsonl`);
      if (fs.existsSync(jsonlFile)) return jsonlFile;

      // Session directory with subagents
      const sessionDir = path.join(projectPath, sessionId);
      if (fs.existsSync(sessionDir) && fs.statSync(sessionDir).isDirectory()) {
        // Look for main conversation file inside
        const files = fs.readdirSync(sessionDir);
        const mainFile = files.find((f) => f.endsWith(".jsonl") && !f.startsWith("agent-"));
        if (mainFile) return path.join(sessionDir, mainFile);
      }
    }
  } catch {
    // Projects dir might not exist
  }
  return null;
}

// ---- JSONL parsing ----

/**
 * Read the last N messages from a JSONL file.
 * Uses a reverse-read strategy: read last 32KB, parse lines.
 * This avoids reading entire multi-MB files on every poll.
 */
function readRecentMessages(
  jsonlPath: string,
  maxMessages: number = 20
): ConversationMessage[] {
  try {
    const stat = fs.statSync(jsonlPath);
    const prevSize = fileSizeCache.get(jsonlPath);

    // If file hasn't changed, return cached messages
    if (prevSize === stat.size && messageCache.has(jsonlPath)) {
      return messageCache.get(jsonlPath)!;
    }
    fileSizeCache.set(jsonlPath, stat.size);

    // Read last chunk of file (32KB should cover ~20-50 messages)
    const chunkSize = Math.min(stat.size, 32768);
    const buffer = Buffer.alloc(chunkSize);
    const fd = fs.openSync(jsonlPath, "r");
    fs.readSync(fd, buffer, 0, chunkSize, stat.size - chunkSize);
    fs.closeSync(fd);

    const text = buffer.toString("utf-8");
    const lines = text.split("\n").filter((l) => l.trim());

    // Parse from the end, take last maxMessages
    const messages: ConversationMessage[] = [];
    for (let i = lines.length - 1; i >= 0 && messages.length < maxMessages; i--) {
      try {
        const msg = JSON.parse(lines[i]) as ConversationMessage;
        if (msg.type && msg.timestamp) {
          messages.unshift(msg); // maintain chronological order
        }
      } catch {
        // Skip malformed lines (likely partial line from chunk boundary)
      }
    }

    messageCache.set(jsonlPath, messages);
    return messages;
  } catch {
    return [];
  }
}

/** Count total lines (messages) in a JSONL file */
function countMessages(jsonlPath: string): number {
  try {
    // Fast line count via wc -l
    const output = execSync(`wc -l < "${jsonlPath}"`, {
      encoding: "utf-8",
      timeout: 3000,
    });
    return parseInt(output.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

// ---- Status determination ----

function determineStatus(
  isAlive: boolean,
  messages: ConversationMessage[],
  processInfo: ProcessInfo | undefined
): SessionStatus {
  if (!isAlive) {
    return messages.length > 0 ? "completed" : "dead";
  }

  if (messages.length === 0) return "idle";

  const lastMsg = messages[messages.length - 1];
  const lastTime = new Date(lastMsg.timestamp).getTime();
  const elapsed = Date.now() - lastTime;

  // Stale: no activity for 5+ minutes
  if (elapsed > 5 * 60 * 1000) return "stale";

  // Active: recent progress/tool activity
  if (lastMsg.type === "progress" || elapsed < 30000) {
    if (processInfo && processInfo.cpu > 1) return "active";
  }

  // Waiting: last message from assistant (agent is done, needs human input)
  if (lastMsg.type === "assistant" || lastMsg.message?.role === "assistant") {
    return "waiting";
  }

  // Active by default if alive and recent
  if (elapsed < 60000) return "active";

  return "idle";
}

// ---- Extract project name from cwd ----

function extractProjectName(cwd: string): string {
  // Take the last meaningful directory segment
  const parts = cwd.split("/").filter(Boolean);
  // Skip common prefixes
  const skip = ["Users", "home", "josh", "Build_2026", "Build-2026"];
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!skip.includes(parts[i])) return parts[i];
  }
  return parts[parts.length - 1] || "unknown";
}

/** Extract display name from custom-title message */
function getDisplayName(messages: ConversationMessage[]): string | null {
  for (const msg of messages) {
    // custom-title messages have a different shape than conversation messages
    const raw = msg as unknown as { type: string; customTitle?: string };
    if (raw.type === "custom-title" && raw.customTitle) {
      return raw.customTitle;
    }
  }
  return null;
}

/** Extract the last user prompt text from messages */
function getLastUserPrompt(messages: ConversationMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === "user" && msg.message?.content) {
      const content = msg.message.content;
      if (typeof content === "string") {
        if (!content.startsWith("[")) return content.slice(0, 200);
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part.type === "text" && part.text && !part.text.startsWith("[")) {
          return part.text.slice(0, 200);
        }
      }
    }
  }
  return null;
}

// ---- Main scan function ----

export async function scanSessions(): Promise<Session[]> {
  const sessionFiles = readSessionFiles();
  const processes = getClaudeProcesses();
  const sessions: Session[] = [];

  for (const sf of sessionFiles) {
    const isAlive = processes.has(sf.pid);
    const processInfo = processes.get(sf.pid);
    const jsonlPath = findJsonlPath(sf.sessionId, sf.cwd);
    const messages = jsonlPath ? readRecentMessages(jsonlPath) : [];
    const msgCount = jsonlPath ? countMessages(jsonlPath) : 0;

    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;

    // Get cached summaries from DB
    const summaries = await getAllSummaries(sf.sessionId);

    const session: Session = {
      id: sf.sessionId,
      pid: sf.pid,
      cwd: sf.cwd,
      projectName: extractProjectName(sf.cwd),
      gitBranch: lastMsg?.gitBranch ?? null,
      slug: lastMsg?.slug ?? null,
      displayName: getDisplayName(messages),
      startedAt: sf.startedAt,
      lastActivityAt: lastMsg
        ? new Date(lastMsg.timestamp).getTime()
        : sf.startedAt,
      status: determineStatus(isAlive, messages, processInfo),
      lastMessageRole: lastMsg?.message?.role ?? null,
      lastMessageType: lastMsg?.type ?? null,
      jsonlPath,
      groupId: null, // Populated by group lookup
      summaryLatest: summaries[1],
      summaryTask: summaries[2],
      summaryOverview: summaries[3],
      messageCount: msgCount,
      lastUserPrompt: getLastUserPrompt(messages),
    };

    sessions.push(session);
  }

  // Sort: waiting first, then active, then by last activity
  const statusOrder: Record<SessionStatus, number> = {
    waiting: 0,
    active: 1,
    idle: 2,
    stale: 3,
    completed: 4,
    dead: 5,
  };
  sessions.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status];
    if (so !== 0) return so;
    return b.lastActivityAt - a.lastActivityAt;
  });

  return sessions;
}

/** Get full conversation messages for a single session */
export function getSessionMessages(
  sessionId: string,
  cwd: string
): ConversationMessage[] {
  const jsonlPath = findJsonlPath(sessionId, cwd);
  if (!jsonlPath) return [];

  try {
    const content = fs.readFileSync(jsonlPath, "utf-8");
    const messages: ConversationMessage[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as ConversationMessage;
        if (msg.type && msg.timestamp) messages.push(msg);
      } catch {
        // Skip malformed
      }
    }
    return messages;
  } catch {
    return [];
  }
}

/** Extract readable text content from a ConversationMessage */
export function extractMessageText(msg: ConversationMessage): string {
  if (!msg.message?.content) {
    if (msg.data && msg.type === "progress") {
      return `[progress: ${(msg.data as { type?: string }).type ?? "unknown"}]`;
    }
    return "";
  }
  const content = msg.message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (c.type === "text") parts.push(c.text);
    else if (c.type === "tool_use") parts.push(`[tool: ${c.name}]`);
    else if (c.type === "tool_result") {
      const preview = typeof c.content === "string" ? c.content.slice(0, 100) : "";
      parts.push(`[result: ${preview}]`);
    }
  }
  return parts.join("\n");
}
