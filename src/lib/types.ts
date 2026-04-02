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
  // Backend sends both `model` (raw ID) and `model_display` (human name)
  model: string | null;
  model_display: string;
  // Backend sends `token_display` ("45k / 1M") and `token_ratio` (0.045)
  token_display: string;
  token_ratio: number;
  // Raw token counts for cost estimation
  total_input_tokens: number;
  total_output_tokens: number;
  last_activity: string | null;  // ISO 8601, can be null
  managed: boolean;
  tmux_session: string | null;
  summary: {
    latest: string;
    current_task: string;
    overview: string;
  } | null;
  group_id: string | null;
  messages: ConversationMessage[];  // preview (last 5)
}

/** Room from recon serve — array of {room_id, sessions} */
export interface Room {
  room_id: string;
  sessions: Session[];
}

/** Custom group from recon serve */
export interface Group {
  id: string;
  name: string;
  color: string | null;
  session_ids: string[];
  sort_order: number;
}

/** Dashboard filter modes */
export type FilterMode = "all" | "input" | "working" | "by-project" | "by-group";

/** Settings */
export interface DashboardSettings {
  pollIntervalMs: number;
  notificationSound: boolean;
  notificationBrowser: boolean;
  voiceEnabled: boolean;
  ttsEnabled: boolean;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
  pollIntervalMs: 3000,
  notificationSound: true,
  notificationBrowser: true,
  voiceEnabled: true,
  ttsEnabled: false,
};

/** Manager command response from recon */
export interface ManagerAction {
  type: "send_message" | "kill" | "focus" | "spawn";
  session_id?: string;
  text?: string;
  cwd?: string;
  name?: string;
}

export interface ManagerResponse {
  text: string;
  action: ManagerAction | null;
}
