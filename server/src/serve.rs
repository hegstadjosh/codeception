use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};

use crate::config;
use crate::conversation::{self, MessageKind};
use crate::groups::{self, Group};
use crate::history;
use crate::manager;
use crate::names;
use crate::session::{self, Session, SessionStatus};
use crate::summarizer::{self, SessionSummary};
use crate::tmux;

/// Cached conversation: parsed messages + file offset for incremental reads.
struct ConversationCache {
    messages: Vec<conversation::ConversationMessage>,
    file_size: u64,
}

/// Shared state for the HTTP server.
struct ServerState {
    sessions: Vec<Session>,
    summaries: HashMap<String, SessionSummary>,
    prev_sessions: HashMap<String, Session>,
    groups: HashMap<String, Group>,
    conversation_cache: HashMap<String, ConversationCache>,
    summarize_enabled: bool,
    notes: HashMap<String, String>,
    custom_names: HashMap<String, String>,
}

/// App state includes Mutex state + broadcast channel for WebSocket events.
#[derive(Clone)]
struct AppState {
    inner: Arc<Mutex<ServerState>>,
    ws_tx: broadcast::Sender<String>,
    manager_dir: Option<PathBuf>,
}

type SharedState = AppState;

/// Start the HTTP API server.
pub async fn run_server(
    port: u16,
    summarize: bool,
    quiet: bool,
    manager_dir: Option<PathBuf>,
) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(ref dir) = manager_dir {
        std::env::set_var("CLAUDE_MANAGER_MANAGER_DIR", dir);
    }

    // Load cached summaries from disk so they survive restarts
    let cached_summaries = if summarize {
        summarizer::load_summaries()
    } else {
        HashMap::new()
    };
    let cached_groups = groups::load_groups();
    let cached_notes = load_json_map("recon-notes.json");
    let cached_names = load_json_map("recon-names.json");
    let inner = Arc::new(Mutex::new(ServerState {
        sessions: Vec::new(),
        summaries: cached_summaries,
        prev_sessions: HashMap::new(),
        groups: cached_groups,
        conversation_cache: HashMap::new(),
        summarize_enabled: summarize,
        notes: cached_notes,
        custom_names: cached_names,
    }));
    let (ws_tx, _) = broadcast::channel::<String>(64);
    let state = AppState {
        inner: inner.clone(),
        ws_tx: ws_tx.clone(),
        manager_dir: manager_dir.or_else(crate::paths::manager_dir),
    };

    // Initial refresh
    {
        let mut s = inner.lock().unwrap_or_else(|e| e.into_inner());
        refresh_sessions(&mut s);
    }

    // Background polling task
    let bg_state = inner.clone();
    let bg_ws_tx = ws_tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            interval.tick().await;

            // Phase 1: refresh sessions + bell detection (lock held briefly)
            // Collect summarization data if needed, then DROP lock before any I/O.
            let summarize_data = {
                let mut s = bg_state.lock().unwrap_or_else(|e| e.into_inner());

                let old_statuses: HashMap<String, SessionStatus> = s
                    .sessions
                    .iter()
                    .map(|sess| (sess.session_id.clone(), sess.status.clone()))
                    .collect();

                refresh_sessions(&mut s);

                // Bell detection + WebSocket notifications
                let mut status_changed = false;
                if !quiet {
                    for sess in &s.sessions {
                        if sess.status == SessionStatus::Input {
                            if let Some(old) = old_statuses.get(&sess.session_id) {
                                if *old != SessionStatus::Input {
                                    print!("\x07");
                                    break;
                                }
                            }
                        }
                    }
                }

                // Detect any status changes for WebSocket broadcast
                for sess in &s.sessions {
                    let old = old_statuses.get(&sess.session_id);
                    if old.map(|o| o != &sess.status).unwrap_or(true) {
                        status_changed = true;
                        break;
                    }
                }

                // Broadcast session update to WebSocket clients
                if status_changed {
                    let session_count = s.sessions.len();
                    let input_count = s.sessions.iter()
                        .filter(|sess| sess.status == SessionStatus::Input)
                        .count();
                    let event = serde_json::json!({
                        "type": "session:update",
                        "session_count": session_count,
                        "input_count": input_count,
                    });
                    let _ = bg_ws_tx.send(event.to_string());
                }

                // Message-count-based summarization + Working→Idle auto-summarize.
                if s.summarize_enabled {
                    let mut needs_summary: Vec<(String, u64, u64, PathBuf)> = Vec::new();
                    for sess in &s.sessions {
                        let tc = summarizer::total_chars(&sess.messages);
                        let msg_count = summarizer::count_user_assistant_messages(&sess.messages);
                        let msgs_at_last = s.summaries.get(&sess.session_id)
                            .map(|sum| sum.messages_at_last_summary)
                            .unwrap_or(0);

                        // Trigger 1: message count threshold while working/input
                        let count_trigger = matches!(sess.status, SessionStatus::Working | SessionStatus::Input)
                            && summarizer::should_summarize_by_count(msg_count, msgs_at_last);

                        // Trigger 2: Working→Idle transition
                        let idle_trigger = sess.status == SessionStatus::Idle
                            && old_statuses.get(&sess.session_id)
                                .map(|old| *old == SessionStatus::Working)
                                .unwrap_or(false);

                        if count_trigger || idle_trigger {
                            needs_summary.push((
                                sess.session_id.clone(),
                                sess.last_file_size,
                                tc,
                                sess.jsonl_path.clone(),
                            ));
                        }
                    }

                    if !needs_summary.is_empty() {
                        // Gather previous summaries + read new messages for each
                        let mut snapshot: Vec<(String, Vec<conversation::ConversationMessage>, Vec<conversation::ConversationMessage>, u64, u64)> = Vec::new();
                        for (id, file_size, tc, jsonl_path) in &needs_summary {
                            let prev_offset = s.summaries.get(id).map(|sum| sum.last_offset).unwrap_or(0);
                            let (new_msgs, _new_size) = conversation::read_new_messages(jsonl_path, prev_offset);
                            let all_msgs = s.sessions.iter()
                                .find(|sess| sess.session_id == *id)
                                .map(|sess| sess.messages.clone())
                                .unwrap_or_default();
                            snapshot.push((id.clone(), new_msgs, all_msgs, *file_size, *tc));
                        }
                        let prev_summaries: HashMap<String, SessionSummary> = needs_summary
                            .iter()
                            .filter_map(|(id, _, _, _)| {
                                s.summaries.get(id).map(|sum| (id.clone(), sum.clone()))
                            })
                            .collect();
                        Some((snapshot, prev_summaries))
                    } else {
                        None
                    }
                } else {
                    None
                }
            }; // MutexGuard dropped here — before any .await

            // Phase 2: summarize outside the lock (HTTP calls to Gemini)
            if let Some((sessions_snapshot, prev_summaries)) = summarize_data {
                let new_summaries = tokio::task::spawn_blocking(move || {
                    let mut results: Vec<(String, SessionSummary)> = Vec::new();
                    for (id, new_messages, all_messages, file_size, tc) in &sessions_snapshot {
                        let prev = prev_summaries.get(id).cloned();
                        if let Some(updated) =
                            summarizer::summarize_session(&prev, new_messages, all_messages, *file_size, *tc)
                        {
                            results.push((id.clone(), updated));
                        }
                    }
                    results
                })
                .await;

                // Re-acquire lock to store results + persist to disk
                let mut s = bg_state.lock().unwrap_or_else(|e| e.into_inner());
                if let Ok(results) = new_summaries {
                    if !results.is_empty() {
                        for (id, summary) in results {
                            s.summaries.insert(id, summary);
                        }
                        summarizer::save_summaries(&s.summaries);
                    }
                }
            }
        }
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/sessions", get(get_sessions))
        .route("/api/sessions", post(create_session))
        .route("/api/sessions/resumable", get(get_resumable))
        .route("/api/sessions/search", get(search_sessions))
        .route("/api/sessions/{id}/notes", axum::routing::put(set_session_notes))
        .route("/api/sessions/{id}/name", axum::routing::put(set_session_name))
        .route("/api/sessions/{id}/messages", get(get_messages))
        .route("/api/sessions/{id}/message", post(send_message))
        .route("/api/sessions/{id}/summarize", post(summarize_session))
        .route("/api/sessions/{id}/summary", axum::routing::delete(clear_summary))
        .route("/api/sessions/{id}/kill", post(kill_session))
        .route("/api/sessions/{id}/focus", post(focus_session))
        .route("/api/sessions/{id}/resume", post(resume_session))
        .route("/api/groups", get(get_groups))
        .route("/api/groups", post(create_group))
        .route("/api/groups/{id}", axum::routing::patch(update_group))
        .route("/api/groups/{id}", axum::routing::delete(delete_group))
        .route("/api/manager/command", post(manager_command))
        .route("/api/manager/message", post(manager_message))
        .route("/api/manager/messages", get(get_manager_messages))
        .route("/api/manager/status", get(get_manager_status))
        .route("/api/manager/start", post(start_manager))
        .route("/api/config", get(get_config))
        .route("/api/config", post(set_config))
        .route("/api/fs/list", get(list_directory))
        .route("/api/ws", get(ws_upgrade))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    eprintln!("recon serve listening on http://localhost:{port}");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Refresh sessions from tmux/JSONL state and non-tmux sessions.
fn refresh_sessions(state: &mut ServerState) {
    let sessions: Vec<Session> = session::discover_sessions(&state.prev_sessions);

    state.prev_sessions = sessions
        .iter()
        .map(|s| (s.session_id.clone(), s.clone()))
        .collect();

    state.sessions = sessions;
}

// --- Handlers ---

fn session_to_json(s: &Session, summary: Option<&SessionSummary>, group_id: Option<&str>, user_note: Option<&str>, custom_name: Option<&str>) -> serde_json::Value {
    let status_str = match s.status {
        SessionStatus::Working => "working",
        SessionStatus::Input => "input",
        SessionStatus::Idle => "idle",
        SessionStatus::New => "new",
    };

    let last_messages: Vec<serde_json::Value> = s
        .messages
        .iter()
        .rev()
        .take(5)
        .rev()
        .map(|m| message_to_json(m))
        .collect();

    let total_chars = summarizer::total_chars(&s.messages);
    let chars_at_last = summary.map(|sum| sum.chars_at_last_summary).unwrap_or(0);
    let chars_since_summary = total_chars.saturating_sub(chars_at_last);

    // "latest" is always computed live from messages, not from the summary
    let live_latest = s.messages.iter().rev()
        .find(|m| m.kind == MessageKind::AssistantText)
        .map(|m| {
            let text = &m.text;
            if text.chars().count() > 150 {
                let mut s: String = text.chars().take(150).collect();
                s.push_str("...");
                s
            } else {
                text.clone()
            }
        })
        .unwrap_or_default();

    let summary_json = summary.map(|sum| {
        serde_json::json!({
            "latest": live_latest,
            "current_task": sum.current_task,
            "overview": sum.overview,
        })
    }).or_else(|| {
        if !live_latest.is_empty() {
            Some(serde_json::json!({
                "latest": live_latest,
                "current_task": null,
                "overview": null,
            }))
        } else {
            None
        }
    });

    let is_manager = s.tmux_session.as_deref()
        .map(|name| name.starts_with("manager-"))
        .unwrap_or(false);

    let display_name = custom_name.unwrap_or(&s.project_name);

    serde_json::json!({
        "session_id": s.session_id,
        "project_name": s.project_name,
        "display_name": display_name,
        "branch": s.branch,
        "cwd": s.cwd,
        "room_id": s.room_id(),
        "relative_dir": s.relative_dir,
        "status": status_str,
        "model": s.model,
        "model_display": s.model_display(),
        "token_display": s.token_display(),
        "token_ratio": s.token_ratio(),
        "total_input_tokens": s.total_input_tokens,
        "total_output_tokens": s.total_output_tokens,
        "last_activity": s.last_activity,
        "tmux_session": s.tmux_session,
        "pane_target": s.pane_target,
        "managed": s.managed,
        "is_manager": is_manager,
        "group_id": group_id,
        "messages": last_messages,
        "summary": summary_json,
        "chars_since_summary": chars_since_summary,
        "user_note": user_note,
    })
}

fn message_to_json(m: &conversation::ConversationMessage) -> serde_json::Value {
    let kind = match m.kind {
        MessageKind::UserText => "user_text",
        MessageKind::AssistantText => "assistant_text",
        MessageKind::ToolCall => "tool_call",
        MessageKind::ToolResult => "tool_result",
        MessageKind::Thinking => "thinking",
    };
    serde_json::json!({
        "timestamp": m.timestamp,
        "kind": kind,
        "text": m.text,
        "tool_name": m.tool_name,
    })
}

#[derive(serde::Deserialize)]
struct SessionsQuery {
    page: Option<usize>,
    limit: Option<usize>,
    status: Option<String>,
}

async fn get_sessions(
    Query(query): Query<SessionsQuery>,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());

    // Build reverse lookup: session_id → group_id
    let mut session_group_map: HashMap<String, String> = HashMap::new();
    for group in s.groups.values() {
        for sid in &group.session_ids {
            session_group_map.insert(sid.clone(), group.id.clone());
        }
    }

    // Filter by status if provided
    let filtered_sessions: Vec<&Session> = s
        .sessions
        .iter()
        .filter(|sess| {
            if let Some(ref status_filter) = query.status {
                let sess_status = match sess.status {
                    SessionStatus::Working => "working",
                    SessionStatus::Input => "input",
                    SessionStatus::Idle => "idle",
                    SessionStatus::New => "new",
                };
                sess_status == status_filter.as_str()
            } else {
                true
            }
        })
        .collect();

    let total = filtered_sessions.len();
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).max(1).min(200);
    let start = (page - 1) * limit;

    let page_sessions: Vec<&Session> = filtered_sessions
        .iter()
        .skip(start)
        .take(limit)
        .copied()
        .collect();

    let sessions_json: Vec<serde_json::Value> = page_sessions
        .iter()
        .map(|sess| {
            let summary = s.summaries.get(&sess.session_id);
            let gid = session_group_map.get(&sess.session_id).map(|s| s.as_str());
            let note = s.notes.get(&sess.session_id).map(|s| s.as_str());
            let cname = s.custom_names.get(&sess.session_id).map(|s| s.as_str());
            session_to_json(sess, summary, gid, note, cname)
        })
        .collect();

    // Group by room_id (only for sessions on this page)
    let mut rooms: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    for (sess, json) in page_sessions.iter().zip(sessions_json.iter()) {
        rooms
            .entry(sess.room_id())
            .or_default()
            .push(json.clone());
    }
    let rooms_json: Vec<serde_json::Value> = rooms
        .into_iter()
        .map(|(room_id, members)| {
            serde_json::json!({
                "room_id": room_id,
                "sessions": members,
            })
        })
        .collect();

    Json(serde_json::json!({
        "sessions": sessions_json,
        "rooms": rooms_json,
        "total": total,
        "page": page,
        "limit": limit,
    }))
}

#[derive(serde::Deserialize)]
struct MessagesQuery {
    offset: Option<usize>,
    limit: Option<usize>,
}

async fn get_messages(
    Query(query): Query<MessagesQuery>,
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    // Find the JSONL path — try in-memory first, fall back to filesystem scan
    let in_memory_path = {
        let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        s.sessions
            .iter()
            .find(|sess| sess.session_id == id)
            .filter(|sess| !sess.jsonl_path.as_os_str().is_empty())
            .map(|sess| sess.jsonl_path.clone())
    };

    let path = in_memory_path
        .or_else(|| session::find_jsonl_by_session_id(&id))
        .ok_or(StatusCode::NOT_FOUND)?;

    // Check cache — only read new bytes since last request
    let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let cache = s.conversation_cache.entry(id.clone()).or_insert_with(|| {
        // First request for this session — full read
        let messages = conversation::read_all_conversation_messages(&path, usize::MAX);
        let file_size = path.metadata().map(|m| m.len()).unwrap_or(0);
        ConversationCache { messages, file_size }
    });

    // Incremental update — only parse new bytes
    let current_size = path.metadata().map(|m| m.len()).unwrap_or(0);
    if current_size > cache.file_size {
        let (new_msgs, new_size) = conversation::read_new_messages(&path, cache.file_size);
        cache.messages.extend(new_msgs);
        cache.file_size = new_size;
    }

    let total = cache.messages.len();
    let offset = query.offset.unwrap_or(0).min(total);
    let limit = query.limit.unwrap_or(100).max(1).min(1000);

    let json: Vec<serde_json::Value> = cache.messages
        .iter()
        .skip(offset)
        .take(limit)
        .map(message_to_json)
        .collect();

    Ok(Json(serde_json::json!({
        "messages": json,
        "total": total,
        "offset": offset,
        "limit": limit,
    })))
}

#[derive(serde::Deserialize)]
struct CreateSessionBody {
    name: Option<String>,
    cwd: Option<String>,
    manager: Option<bool>,
    flags: Option<String>,
}

async fn create_session(
    State(state): State<SharedState>,
    Json(body): Json<CreateSessionBody>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let claude_path = which_claude();

    // Manager session uses runtime-resolved manager directory.
    let is_manager = body.manager.unwrap_or(false);
    let effective_cwd = if is_manager {
        state.manager_dir.clone()
            .or_else(crate::paths::manager_dir)
            .map(|p| p.canonicalize().unwrap_or(p).to_string_lossy().to_string())
            .unwrap_or_else(|| body.cwd.clone().unwrap_or_else(|| ".".to_string()))
    } else {
        body.cwd.clone().unwrap_or_else(|| ".".to_string())
    };

    // Generate session name
    let final_name = if is_manager {
        let slug = names::random_slug();
        unique_tmux_name(&format!("manager-{}", slug))
    } else {
        let dir_name = std::path::Path::new(&effective_cwd)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "claude".to_string());
        match body.name {
            Some(ref n) if !n.is_empty() => unique_tmux_name(n),
            _ => unique_tmux_name(&names::session_name(&dir_name)),
        }
    };

    // Create detached tmux session with a shell, send claude command into it,
    // then attach. This way if claude fails, the shell stays alive showing the
    // error instead of the session dying with [exited].
    //
    // We build a shell script that Terminal.app executes via `do script`.
    // Using shell_escape on each part, then joining — the outer AppleScript
    // string uses double quotes, inner shell uses single quotes from shell_escape.
    let display = if is_manager {
        format!("Manager · {}", final_name.strip_prefix("manager-").unwrap_or(&final_name).replace('-', " "))
    } else {
        names::display_title(&final_name)
    };
    // Build the full claude command with optional flags
    let full_cmd = match &body.flags {
        Some(f) if !f.trim().is_empty() => format!("{} {}", claude_path, f.trim()),
        _ => claude_path.clone(),
    };

    let script = format!(
        r#"tell application "Terminal"
    activate
    do script "tmux new-session -d -s {name} -c {cwd} && tmux send-keys -t {name} {cmd} Enter && tmux attach -t {name}"
    set custom title of front window to {title}
    set title displays custom title of front window to true
end tell"#,
        name = shell_escape(&final_name),
        cwd = shell_escape(&effective_cwd),
        cmd = shell_escape(&full_cmd),
        title = applescript_string(&display),
    );

    let result = Command::new("osascript")
        .args(["-e", &script])
        .output();

    match result {
        Ok(o) if o.status.success() => Ok(Json(serde_json::json!({
            "session_name": final_name,
            "ok": true,
        }))),
        Ok(o) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": String::from_utf8_lossy(&o.stderr).to_string(),
                "ok": false,
            })),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string(), "ok": false })),
        )),
    }
}

#[derive(serde::Deserialize)]
struct SendMessageBody {
    text: String,
}

async fn send_message(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<SendMessageBody>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let sess_info = {
        let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        s.sessions
            .iter()
            .find(|sess| sess.session_id == id)
            .map(|sess| (sess.pane_target.clone(), sess.managed))
    };

    let (pane_target, managed) = sess_info.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "session not found", "ok": false })),
        )
    })?;

    if !managed || pane_target.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "Cannot send messages to non-tmux sessions. Resume this session via tmux first.",
                "ok": false,
            })),
        ));
    }

    let target = pane_target.unwrap();
    // send-keys interprets the text literally when passed via -l (literal flag).
    // We send the text first, then send Enter separately, to avoid tmux
    // interpreting special key names in user input.
    let text_status = Command::new("tmux")
        .args(["send-keys", "-t", &target, "-l", &body.text])
        .status();

    if !matches!(text_status, Ok(ref s) if s.success()) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to send keys", "ok": false })),
        ));
    }

    let status = Command::new("tmux")
        .args(["send-keys", "-t", &target, "Enter"])
        .status();

    match status {
        Ok(s) if s.success() => Ok(Json(serde_json::json!({ "ok": true }))),
        _ => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "failed to send keys", "ok": false })),
        )),
    }
}

async fn summarize_session(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Check for API key before doing any work
    if config::gemini_api_key().is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Gemini API key not configured. Add it in Settings.", "ok": false })),
        ));
    }

    // Gather data under lock, then drop lock before blocking I/O
    let (jsonl_path, prev_summary, all_messages, file_size) = {
        let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let sess = s.sessions
            .iter()
            .find(|sess| sess.session_id == id)
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({ "error": "session not found", "ok": false })),
                )
            })?;
        (
            sess.jsonl_path.clone(),
            s.summaries.get(&id).cloned(),
            sess.messages.clone(),
            sess.last_file_size,
        )
    };

    // Read messages since last summary offset
    let prev_offset = prev_summary.as_ref().map(|s| s.last_offset).unwrap_or(0);
    let (new_messages, _) = conversation::read_new_messages(&jsonl_path, prev_offset);
    let tc = summarizer::total_chars(&all_messages);

    // Call LLM (blocking HTTP)
    let prev_for_llm = prev_summary.clone();
    let new_msgs_for_llm = new_messages.clone();
    let all_msgs_for_llm = all_messages.clone();
    let result = tokio::task::spawn_blocking(move || {
        summarizer::summarize_session(&prev_for_llm, &new_msgs_for_llm, &all_msgs_for_llm, file_size, tc)
    })
    .await
    .map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "summarization task failed", "ok": false })),
        )
    })?;

    let summary = result.ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "no messages to summarize", "ok": false })),
        )
    })?;

    // Store result under lock + persist
    {
        let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        s.summaries.insert(id.clone(), summary.clone());
        summarizer::save_summaries(&s.summaries);
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "summary": {
            "latest": summary.latest,
            "current_task": summary.current_task,
            "overview": summary.overview,
            "chars_at_last_summary": summary.chars_at_last_summary,
        }
    })))
}

async fn clear_summary(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    s.summaries.remove(&id);
    summarizer::save_summaries(&s.summaries);
    Json(serde_json::json!({ "ok": true }))
}

async fn kill_session(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let sess_info = {
        let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        s.sessions
            .iter()
            .find(|sess| sess.session_id == id)
            .map(|sess| (sess.tmux_session.clone(), sess.managed, sess.pid))
    };

    let (tmux_name, managed, pid) = sess_info.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "session not found", "ok": false })),
        )
    })?;

    // Managed: kill tmux session. Unmanaged: kill by PID.
    if managed {
        if let Some(name) = tmux_name {
            if tmux::kill_session(&name) {
                return Ok(Json(serde_json::json!({ "ok": true, "method": "tmux" })));
            }
        }
    }

    // Kill by PID (works for both managed fallback and unmanaged)
    if let Some(p) = pid {
        let result = Command::new("kill").args([&p.to_string()]).status();
        if let Ok(s) = result {
            if s.success() {
                return Ok(Json(serde_json::json!({ "ok": true, "method": "pid" })));
            }
        }
    }

    Err((
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": "failed to kill session", "ok": false })),
    ))
}

async fn focus_session(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let sess_info = {
        let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        s.sessions
            .iter()
            .find(|sess| sess.session_id == id)
            .map(|sess| (sess.tmux_session.clone(), sess.pane_target.clone(), sess.managed))
    };

    let (tmux_session, pane_target, managed) = sess_info.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "session not found", "ok": false })),
        )
    })?;

    if !managed {
        // Unmanaged — we literally can't find the right window
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": "This session is running in a regular terminal — can't auto-focus. Find it manually, or kill it and use Resume to open it in tmux.",
                "ok": false,
            })),
        ));
    }

    let tmux_name = tmux_session.or_else(|| {
        pane_target.as_ref().map(|t| t.split(':').next().unwrap_or(t).to_string())
    });

    let tmux_name = match tmux_name {
        Some(n) => n,
        None => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "No tmux session name found", "ok": false })),
            ));
        }
    };

    // Check if there's already a terminal client attached to this tmux session
    let has_client = Command::new("tmux")
        .args(["list-clients", "-t", &tmux_name])
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false);

    if has_client {
        // Find the specific Terminal window whose title contains the tmux session name
        let script = format!(
            r#"tell application "Terminal"
    activate
    set found to false
    repeat with w in windows
        if name of w contains {} then
            set index of w to 1
            set found to true
            exit repeat
        end if
    end repeat
end tell"#,
            applescript_string(&tmux_name)
        );
        let result = Command::new("osascript")
            .args(["-e", &script])
            .output();
        match result {
            Ok(o) if o.status.success() => {
                Ok(Json(serde_json::json!({ "ok": true, "method": "activate" })))
            }
            Ok(o) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("osascript failed: {}", String::from_utf8_lossy(&o.stderr)),
                    "ok": false,
                })),
            )),
            Err(e) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string(), "ok": false })),
            )),
        }
    } else {
        // No client attached — open a new Terminal window to attach
        let script = format!(
            r#"tell application "Terminal"
    activate
    do script "tmux attach -t {}"
end tell"#,
            shell_escape(&tmux_name)
        );
        let result = Command::new("osascript")
            .args(["-e", &script])
            .output();
        match result {
            Ok(o) if o.status.success() => {
                Ok(Json(serde_json::json!({ "ok": true, "method": "tmux_attach" })))
            }
            Ok(o) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": format!("Failed to open terminal: {}", String::from_utf8_lossy(&o.stderr)),
                    "ok": false,
                })),
            )),
            Err(e) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string(), "ok": false })),
            )),
        }
    }
}

async fn resume_session(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Check if session is already running — if so, tell the user
    let existing = {
        let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        s.sessions.iter().find(|sess| sess.session_id == id).map(|sess| {
            (sess.managed, sess.pid)
        })
    };

    if let Some((_managed, pid)) = &existing {
        let pid_alive = pid.map(|p| {
            Command::new("kill").args(["-0", &p.to_string()])
                .status().map(|s| s.success()).unwrap_or(false)
        }).unwrap_or(false);

        if pid_alive {
            return Err((
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "error": "Session is still running. Use the focus button instead.",
                    "ok": false,
                })),
            ));
        }
    }

    // Session is dead — actually resume it
    let cwd = session::find_session_cwd(&id).unwrap_or_else(|| ".".to_string());
    let claude_path = which_claude();
    let dir_name = std::path::Path::new(&cwd)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "claude".to_string());
    let tmux_name = unique_tmux_name(&names::session_name(&dir_name));

    // Same pattern as create: detached session + send-keys + attach.
    let resume_cmd = format!("{} --resume {}", claude_path, id);
    let display = names::display_title(&tmux_name);
    let script = format!(
        r#"tell application "Terminal"
    activate
    do script "tmux new-session -d -s {name} -c {cwd} && tmux send-keys -t {name} {cmd} Enter && tmux attach -t {name}"
    set custom title of front window to {title}
    set title displays custom title of front window to true
end tell"#,
        name = shell_escape(&tmux_name),
        cwd = shell_escape(&cwd),
        cmd = shell_escape(&resume_cmd),
        title = applescript_string(&display),
    );

    let result = Command::new("osascript")
        .args(["-e", &script])
        .output();

    match result {
        Ok(o) if o.status.success() => Ok(Json(serde_json::json!({
            "ok": true,
            "method": "tmux",
        }))),
        Ok(o) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": String::from_utf8_lossy(&o.stderr).to_string(),
                "ok": false,
            })),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string(), "ok": false })),
        )),
    }
}

/// Find the claude binary path.
fn which_claude() -> String {
    Command::new("which")
        .arg("claude")
        .output()
        .ok()
        .and_then(|o| {
            let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if p.is_empty() { None } else { Some(p) }
        })
        .unwrap_or_else(|| "claude".to_string())
}

/// Generate a unique tmux session name (appends -2, -3, etc. if taken).
fn unique_tmux_name(base: &str) -> String {
    let existing = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let names: Vec<&str> = existing.lines().collect();

    if !names.contains(&base) {
        return base.to_string();
    }
    for i in 2..100 {
        let candidate = format!("{}-{}", base, i);
        if !names.contains(&candidate.as_str()) {
            return candidate;
        }
    }
    format!("{}-{}", base, std::process::id())
}

/// Escape a string as an AppleScript string literal (double-quoted).
fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// Escape a string for safe use in shell commands.
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

// --- Filesystem browser ---

#[derive(serde::Deserialize)]
struct ListDirQuery {
    path: Option<String>,
}

async fn list_directory(
    axum::extract::Query(query): axum::extract::Query<ListDirQuery>,
) -> impl IntoResponse {
    let raw_path = query.path.unwrap_or_else(|| "~".to_string());

    // Expand ~ to home directory
    let expanded = if raw_path.starts_with("~/") || raw_path == "~" {
        if let Some(home) = dirs::home_dir() {
            if raw_path == "~" {
                home
            } else {
                home.join(&raw_path[2..])
            }
        } else {
            std::path::PathBuf::from(&raw_path)
        }
    } else {
        std::path::PathBuf::from(&raw_path)
    };

    let canonical = match expanded.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            return Json(serde_json::json!({
                "error": format!("Path not found: {}", raw_path),
                "path": raw_path,
                "entries": [],
            }));
        }
    };

    let entries = match std::fs::read_dir(&canonical) {
        Ok(rd) => {
            let mut dirs: Vec<serde_json::Value> = Vec::new();
            let mut files: Vec<serde_json::Value> = Vec::new();
            for entry in rd.flatten() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden files unless they're common project dirs
                if file_name.starts_with('.') && !matches!(file_name.as_str(), ".git" | ".claude") {
                    continue;
                }
                let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                let item = serde_json::json!({
                    "name": file_name,
                    "is_dir": is_dir,
                });
                if is_dir {
                    dirs.push(item);
                } else {
                    files.push(item);
                }
            }
            // Sort: directories first (alphabetically), then files
            dirs.sort_by(|a, b| {
                a["name"].as_str().unwrap_or("").to_lowercase()
                    .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
            });
            files.sort_by(|a, b| {
                a["name"].as_str().unwrap_or("").to_lowercase()
                    .cmp(&b["name"].as_str().unwrap_or("").to_lowercase())
            });
            dirs.extend(files);
            dirs
        }
        Err(e) => {
            return Json(serde_json::json!({
                "error": e.to_string(),
                "path": canonical.display().to_string(),
                "entries": [],
            }));
        }
    };

    // Compute display path (replace home with ~)
    let display_path = if let Some(home) = dirs::home_dir() {
        let canon_str = canonical.display().to_string();
        let home_str = home.display().to_string();
        if canon_str.starts_with(&home_str) {
            format!("~{}", &canon_str[home_str.len()..])
        } else {
            canon_str
        }
    } else {
        canonical.display().to_string()
    };

    // Check for .git dir to indicate this is a repo root
    let is_git_repo = canonical.join(".git").exists();

    Json(serde_json::json!({
        "path": display_path,
        "absolute_path": canonical.display().to_string(),
        "is_git_repo": is_git_repo,
        "entries": entries,
    }))
}

// --- Config handlers ---

async fn get_config() -> impl IntoResponse {
    let cfg = config::load_config();
    let has_gemini_key = cfg.get("gemini_api_key")
        .map(|k| !k.is_empty())
        .unwrap_or(false);
    // Also check env var as fallback
    let has_key = has_gemini_key || std::env::var("GEMINI_API_KEY").ok().filter(|k| !k.is_empty()).is_some();
    Json(serde_json::json!({
        "has_gemini_key": has_key,
    }))
}

#[derive(serde::Deserialize)]
struct SetConfigBody {
    gemini_api_key: Option<String>,
}

async fn set_config(
    Json(body): Json<SetConfigBody>,
) -> impl IntoResponse {
    let mut cfg = config::load_config();
    if let Some(key) = body.gemini_api_key {
        cfg.insert("gemini_api_key".to_string(), key);
    }
    config::save_config(&cfg);
    Json(serde_json::json!({ "ok": true }))
}

// --- WebSocket handler ---

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| ws_handler(socket, state))
}

async fn ws_handler(mut socket: WebSocket, state: AppState) {
    let mut rx = state.ws_tx.subscribe();

    // Send initial snapshot (scope the lock so it's dropped before await)
    let initial_event = {
        let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        let input_count = s.sessions.iter()
            .filter(|sess| sess.status == SessionStatus::Input)
            .count();
        serde_json::json!({
            "type": "session:snapshot",
            "session_count": s.sessions.len(),
            "input_count": input_count,
        }).to_string()
    };
    let _ = socket.send(Message::Text(initial_event.into())).await;

    // Forward broadcast events to this client
    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(text) => {
                        if socket.send(Message::Text(text.into())).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {} // Ignore other messages from client
                }
            }
        }
    }
}

// --- Manager agent handler ---

#[derive(serde::Deserialize)]
struct ManagerCommandBody {
    text: String,
}

/// Legacy endpoint — now relays to the manager tmux session instead of interpreting via Gemini.
async fn manager_command(
    Json(body): Json<ManagerCommandBody>,
) -> impl IntoResponse {
    let tmux_name = match manager::find_manager_session() {
        Some(name) => name,
        None => {
            return Json(serde_json::json!({
                "text": "No manager session is running. Start one first.",
                "action": null,
            }));
        }
    };

    match manager::send_to_manager(&tmux_name, &body.text) {
        Ok(()) => Json(serde_json::json!({
            "text": format!("Sent to manager ({tmux_name})"),
            "action": null,
        })),
        Err(e) => Json(serde_json::json!({
            "text": format!("Failed to send to manager: {e}"),
            "action": null,
        })),
    }
}

/// POST /api/manager/message — send a message to the manager via tmux
async fn manager_message(
    Json(body): Json<ManagerCommandBody>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let tmux_name = manager::find_manager_session().ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "No manager session running", "ok": false })),
        )
    })?;

    manager::send_to_manager(&tmux_name, &body.text).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e, "ok": false })),
        )
    })?;

    Ok(Json(serde_json::json!({ "ok": true, "tmux_session": tmux_name })))
}

/// GET /api/manager/messages?limit=50 — read the manager's JSONL conversation
#[derive(serde::Deserialize)]
struct ManagerMessagesQuery {
    limit: Option<usize>,
}

async fn get_manager_messages(
    Query(query): Query<ManagerMessagesQuery>,
) -> impl IntoResponse {
    let limit = query.limit.unwrap_or(50).max(1).min(1000);
    let messages = manager::read_manager_messages(limit);

    let json: Vec<serde_json::Value> = messages
        .iter()
        .map(message_to_json)
        .collect();

    Json(serde_json::json!({
        "messages": json,
        "total": messages.len(),
    }))
}

/// GET /api/manager/status — check if the manager is alive
async fn get_manager_status() -> impl IntoResponse {
    let tmux_session = manager::find_manager_session();
    let alive = tmux_session.is_some();

    Json(serde_json::json!({
        "alive": alive,
        "tmux_session": tmux_session,
    }))
}

/// POST /api/manager/start — start a new manager session if none exists
async fn start_manager(
    State(state): State<SharedState>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    // Check if one is already running
    if let Some(existing) = manager::find_manager_session() {
        return Ok(Json(serde_json::json!({
            "ok": true,
            "tmux_session": existing,
            "already_running": true,
        })));
    }

    // Use the same Terminal.app + tmux creation logic as create_session with manager=true
    let manager_cwd = state.manager_dir.clone()
        .or_else(crate::paths::manager_dir)
        .map(|p| p.canonicalize().unwrap_or(p).to_string_lossy().to_string())
        .unwrap_or_else(|| ".".to_string());

    let slug = names::random_slug();
    let session_name = unique_tmux_name(&format!("manager-{}", slug));
    let claude_path = which_claude();
    let display = format!("Manager · {}", slug.replace('-', " "));

    let script = format!(
        r#"tell application "Terminal"
    activate
    do script "tmux new-session -d -s {name} -c {cwd} && tmux send-keys -t {name} {cmd} Enter && tmux attach -t {name}"
    set custom title of front window to {title}
    set title displays custom title of front window to true
end tell"#,
        name = shell_escape(&session_name),
        cwd = shell_escape(&manager_cwd),
        cmd = shell_escape(&claude_path),
        title = applescript_string(&display),
    );

    let result = Command::new("osascript")
        .args(["-e", &script])
        .output();

    match result {
        Ok(o) if o.status.success() => Ok(Json(serde_json::json!({
            "ok": true,
            "tmux_session": session_name,
            "already_running": false,
        }))),
        Ok(o) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": format!("Failed to start manager: {}", String::from_utf8_lossy(&o.stderr)),
                "ok": false,
            })),
        )),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string(), "ok": false })),
        )),
    }
}

// --- Groups handlers ---

async fn get_groups(State(state): State<SharedState>) -> impl IntoResponse {
    let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let mut group_list: Vec<&Group> = s.groups.values().collect();
    group_list.sort_by_key(|g| g.sort_order);
    let json: Vec<serde_json::Value> = group_list
        .iter()
        .map(|g| {
            serde_json::json!({
                "id": g.id,
                "name": g.name,
                "color": g.color,
                "session_ids": g.session_ids,
                "sort_order": g.sort_order,
            })
        })
        .collect();
    Json(serde_json::json!({ "groups": json }))
}

#[derive(serde::Deserialize)]
struct CreateGroupBody {
    name: String,
    color: Option<String>,
    session_ids: Option<Vec<String>>,
}

async fn create_group(
    State(state): State<SharedState>,
    Json(body): Json<CreateGroupBody>,
) -> impl IntoResponse {
    let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let id = groups::generate_id();
    let group = Group {
        id: id.clone(),
        name: body.name,
        color: body.color,
        session_ids: body.session_ids.unwrap_or_default(),
        sort_order: s.groups.len() as i32,
    };
    s.groups.insert(id.clone(), group.clone());
    groups::save_groups(&s.groups);
    Json(serde_json::json!({
        "ok": true,
        "group": {
            "id": group.id,
            "name": group.name,
            "color": group.color,
            "session_ids": group.session_ids,
            "sort_order": group.sort_order,
        }
    }))
}

#[derive(serde::Deserialize)]
struct UpdateGroupBody {
    name: Option<String>,
    color: Option<String>,
    session_ids: Option<Vec<String>>,
    sort_order: Option<i32>,
}

async fn update_group(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateGroupBody>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let group = s.groups.get_mut(&id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "group not found" })),
        )
    })?;

    if let Some(name) = body.name {
        group.name = name;
    }
    if let Some(color) = body.color {
        group.color = Some(color);
    }
    if let Some(session_ids) = body.session_ids {
        group.session_ids = session_ids;
    }
    if let Some(sort_order) = body.sort_order {
        group.sort_order = sort_order;
    }

    let updated = group.clone();
    groups::save_groups(&s.groups);
    Ok(Json(serde_json::json!({
        "ok": true,
        "group": {
            "id": updated.id,
            "name": updated.name,
            "color": updated.color,
            "session_ids": updated.session_ids,
            "sort_order": updated.sort_order,
        }
    })))
}

async fn delete_group(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    if s.groups.remove(&id).is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "group not found" })),
        ));
    }
    groups::save_groups(&s.groups);
    Ok(Json(serde_json::json!({ "ok": true })))
}

// --- Search, Notes, Rename ---

#[derive(serde::Deserialize)]
struct SearchQuery {
    q: String,
}

async fn search_sessions(
    Query(query): Query<SearchQuery>,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    let s = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let q = query.q.to_lowercase();

    let mut session_group_map: HashMap<String, String> = HashMap::new();
    for group in s.groups.values() {
        for sid in &group.session_ids {
            session_group_map.insert(sid.clone(), group.id.clone());
        }
    }

    let mut results: Vec<serde_json::Value> = Vec::new();

    for sess in &s.sessions {
        let matched_field = if sess.project_name.to_lowercase().contains(&q) {
            Some("project_name")
        } else if sess.branch.as_deref().unwrap_or("").to_lowercase().contains(&q) {
            Some("branch")
        } else if sess.cwd.to_lowercase().contains(&q) {
            Some("cwd")
        } else if sess.session_id.to_lowercase().starts_with(&q) {
            Some("session_id")
        } else if s.summaries.get(&sess.session_id)
            .map(|sum| sum.current_task.to_lowercase().contains(&q))
            .unwrap_or(false)
        {
            Some("current_task")
        } else if s.summaries.get(&sess.session_id)
            .map(|sum| sum.overview.to_lowercase().contains(&q))
            .unwrap_or(false)
        {
            Some("overview")
        } else if s.custom_names.get(&sess.session_id)
            .map(|name| name.to_lowercase().contains(&q))
            .unwrap_or(false)
        {
            Some("display_name")
        } else {
            None
        };

        if let Some(field) = matched_field {
            let summary = s.summaries.get(&sess.session_id);
            let gid = session_group_map.get(&sess.session_id).map(|s| s.as_str());
            let note = s.notes.get(&sess.session_id).map(|s| s.as_str());
            let cname = s.custom_names.get(&sess.session_id).map(|s| s.as_str());
            let mut json = session_to_json(sess, summary, gid, note, cname);
            json.as_object_mut().unwrap().insert("matched_field".to_string(), serde_json::json!(field));
            results.push(json);
        }
    }

    Json(serde_json::json!({ "sessions": results }))
}

#[derive(serde::Deserialize)]
struct SetNotesBody {
    notes: String,
}

async fn set_session_notes(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<SetNotesBody>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());

    if body.notes.is_empty() {
        s.notes.remove(&id);
    } else {
        s.notes.insert(id.clone(), body.notes);
    }
    save_json_map("recon-notes.json", &s.notes);

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(serde::Deserialize)]
struct SetNameBody {
    name: String,
}

async fn set_session_name(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(body): Json<SetNameBody>,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let mut s = state.inner.lock().unwrap_or_else(|e| e.into_inner());

    if body.name.is_empty() {
        s.custom_names.remove(&id);
    } else {
        s.custom_names.insert(id.clone(), body.name);
    }
    save_json_map("recon-names.json", &s.custom_names);

    Ok(Json(serde_json::json!({ "ok": true })))
}

// --- Persistence helpers ---

fn data_dir() -> PathBuf {
    crate::paths::app_data_dir()
}

fn load_json_map(filename: &str) -> HashMap<String, String> {
    let path = data_dir().join(filename);
    if !path.exists() {
        return HashMap::new();
    }
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_json_map(filename: &str, map: &HashMap<String, String>) {
    let path = data_dir().join(filename);
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = std::fs::write(&path, json);
    }
}

// --- Resumable ---

async fn get_resumable() -> impl IntoResponse {
    let entries = history::find_resumable_sessions();
    let json: Vec<serde_json::Value> = entries
        .iter()
        .map(|e| {
            let project_name = std::path::Path::new(&e.cwd)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| e.cwd.clone());
            serde_json::json!({
                "session_id": e.session_id,
                "cwd": e.cwd,
                "project_name": project_name,
                "branch": e.branch,
                "model": e.model,
                "tokens": e.tokens,
                "last_active": e.last_active,
            })
        })
        .collect();

    Json(serde_json::json!({ "sessions": json }))
}
