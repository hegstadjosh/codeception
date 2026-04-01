// ============================================================
// Claude Manager — Core Types
// ============================================================

/** Status state machine for a Claude Code session */
export type SessionStatus =
  | "active" // PID alive, recent tool/progress activity
  | "waiting" // PID alive, last message from assistant, no tool activity
  | "idle" // PID alive, no recent activity
  | "stale" // PID alive, no activity > 5min
  | "dead" // PID not found in process table
  | "completed"; // JSONL exists but no matching PID

/** Raw session metadata from ~/.claude/sessions/*.json */
export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number; // epoch ms
  kind: string; // "interactive" | "print" etc
  entrypoint: string; // "cli" | "sdk" etc
}

/** A single message from a conversation JSONL file */
export interface ConversationMessage {
  uuid: string;
  parentUuid?: string;
  type: "user" | "assistant" | "progress" | "tool_result";
  message?: {
    role: "user" | "assistant";
    content: MessageContent[];
  };
  timestamp: string; // ISO 8601
  cwd?: string;
  sessionId: string;
  gitBranch?: string;
  slug?: string;
  version?: string;
  entrypoint?: string;
  // Tool-related fields
  toolUseID?: string;
  toolUseResult?: string;
  data?: Record<string, unknown>;
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/** Enriched session object for the dashboard */
export interface Session {
  id: string; // sessionId (UUID)
  pid: number;
  cwd: string;
  projectName: string; // extracted from cwd (last meaningful dir segment)
  gitBranch: string | null;
  slug: string | null;
  displayName: string | null; // user-set name (from -n flag)
  startedAt: number; // epoch ms
  lastActivityAt: number; // epoch ms of last JSONL line
  status: SessionStatus;
  lastMessageRole: "user" | "assistant" | null;
  lastMessageType: string | null;
  jsonlPath: string | null;
  groupId: string | null;
  // Summaries (populated by summarizer)
  summaryLatest: string | null; // Tier 1: latest message
  summaryTask: string | null; // Tier 2: current task
  summaryOverview: string | null; // Tier 3: session overview
  // Stats
  messageCount: number;
  lastUserPrompt: string | null;
}

/** User-defined session group */
export interface SessionGroup {
  id: string;
  name: string;
  summary: string | null; // Tier 4: group summary
  color: string; // hex color
  sortOrder: number;
  sessionIds: string[];
}

/** Tiered summary levels */
export type SummaryTier = 1 | 2 | 3 | 4;

/** Cached summary record */
export interface Summary {
  sessionId: string;
  tier: SummaryTier;
  summary: string;
  generatedAt: number;
  messageCountAt: number;
}

/** Process info from ps aux */
export interface ProcessInfo {
  pid: number;
  cpu: number;
  mem: number;
  tty: string;
  command: string;
  isAlive: boolean;
}

/** WebSocket event types */
export type WSEvent =
  | { type: "session:update"; session: Session }
  | { type: "session:new"; session: Session }
  | { type: "session:end"; id: string }
  | { type: "summary:update"; sessionId: string; tier: SummaryTier; summary: string }
  | { type: "notification"; sessionId: string; notifType: string; message: string };

/** Dashboard filter modes */
export type FilterMode = "all" | "waiting" | "active" | "by-project" | "by-group";

/** Settings */
export interface DashboardSettings {
  llmProvider: "ollama" | "gemini";
  ollamaModel: string;
  ollamaUrl: string;
  geminiApiKey: string | null;
  pollIntervalMs: number;
  notificationSound: boolean;
  notificationBrowser: boolean;
  voiceEnabled: boolean;
  autoGroupByProject: boolean;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  llmProvider: "ollama",
  ollamaModel: "qwen2.5:7b",
  ollamaUrl: "http://localhost:11434",
  geminiApiKey: null,
  pollIntervalMs: 3000,
  notificationSound: true,
  notificationBrowser: true,
  voiceEnabled: false,
  autoGroupByProject: true,
};
