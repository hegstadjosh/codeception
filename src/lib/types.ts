// ============================================================
// Claude Manager — Core Types (backed by recon serve)
// ============================================================

/** Status state machine from recon */
export type SessionStatus = "working" | "input" | "idle" | "new";

/** A single message from recon */
export interface ConversationMessage {
  timestamp: string;
  kind: "user_text" | "assistant_text" | "tool_call" | "tool_result" | "thinking";
  text: string;
  tool_name: string | null;
}

/** Session object from recon serve GET /api/sessions */
export interface Session {
  session_id: string;
  project_name: string;
  branch: string | null;
  cwd: string;
  room_id: string;
  relative_dir: string | null;
  status: SessionStatus;
  model: string;
  tokens: string;           // "45k / 1M"
  token_ratio: number;
  last_activity: string;    // ISO 8601
  tmux_session: string;
  summary: {
    latest: string;
    current_task: string;
    overview: string;
  } | null;
  messages: ConversationMessage[];  // preview (last 5)
}

/** Rooms mapping from recon serve */
export interface RoomsMap {
  [roomId: string]: string[];
}

/** Dashboard filter modes */
export type FilterMode = "all" | "input" | "working" | "by-project";

/** Settings */
export interface DashboardSettings {
  pollIntervalMs: number;
  notificationSound: boolean;
  notificationBrowser: boolean;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  pollIntervalMs: 3000,
  notificationSound: true,
  notificationBrowser: true,
};
