// ============================================================
// Codeception — Core Types (backed by recon serve)
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
  is_manager: boolean;
  tmux_session: string | null;
  chars_since_summary: number;
  summary: {
    latest: string;
    current_task: string;
    overview: string;
  } | null;
  group_id: string | null;
  messages: ConversationMessage[];  // preview (last 5)
  display_name?: string;
  user_note?: string;
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

/** Paginated sessions response from recon serve */
export interface PaginatedSessions {
  sessions: Session[];
  rooms: Room[];
  total: number;
  page: number;
  limit: number;
}

/** Paginated messages response from recon serve */
export interface PaginatedMessages {
  messages: ConversationMessage[];
  total: number;
  offset: number;
  limit: number;
}

/** Dashboard filter modes */
export type FilterMode = "all" | "input" | "working" | "by-project" | "by-group" | "history";

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

/** Resumable session from recon serve GET /api/sessions/resumable */
export interface ResumableSession {
  session_id: string;
  cwd: string;
  branch: string | null;
  model: string | null;
  tokens: string | null;
  last_active: string | null;
  project_name?: string;
}

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
