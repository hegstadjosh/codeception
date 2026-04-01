/**
 * Prompt templates for tiered conversation summarization.
 *
 * Kept in a separate file so they're easy to find and tweak
 * without touching the summarizer logic.
 */

export const PROMPTS = {
  /**
   * Tier 1 — Latest Message (~15 words)
   * Called on every new assistant message.
   */
  tier1: (messageText: string) =>
    `You are a concise summarizer. Summarize this Claude Code agent message in one short sentence. Focus on what it did, what it's asking, or what it needs. Be specific and terse.\n\nMessage:\n${messageText}`,

  /**
   * Tier 2 — Current Task (~20 words)
   * Called every 5 new messages or on a new user prompt.
   */
  tier2: (messagesText: string) =>
    `You are a concise summarizer. What task is this coding agent currently working on? Summarize in one sentence. Include the specific feature/file/bug being worked on.\n\nRecent messages:\n${messagesText}`,

  /**
   * Tier 3 — Session Overview (2-3 sentences)
   * Called every 20 new messages or on demand.
   */
  tier3: (promptsText: string, currentTask: string) =>
    `You are a concise summarizer. Summarize everything this coding session has accomplished and is working toward. 2-3 sentences maximum. Include key deliverables and current status.\n\nUser prompts in this session:\n${promptsText}\n\nCurrent task: ${currentTask}`,
};
