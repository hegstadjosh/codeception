use std::collections::HashMap;
use std::path::PathBuf;

use crate::conversation::{ConversationMessage, MessageKind};

/// Number of new user/assistant messages since last summary that triggers re-summarization.
const MESSAGE_TRIGGER_COUNT: usize = 20;

/// Summary state for a single Claude Code session, built in tiers.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionSummary {
    /// Tier 1: last meaningful assistant message (no LLM needed), truncated.
    pub latest: String,
    /// Tier 2: what the agent is currently working on (LLM-generated).
    pub current_task: String,
    /// Tier 3: high-level session overview (LLM-generated).
    pub overview: String,
    /// File size (bytes) when the summary was last computed.
    pub last_offset: u64,
    /// Total conversation chars at the time of the last LLM summary.
    #[serde(default)]
    pub chars_at_last_summary: u64,
    /// Number of user/assistant messages at the time of the last LLM summary.
    #[serde(default)]
    pub messages_at_last_summary: usize,
}

/// Returns true when enough new user/assistant messages have accumulated since the
/// last summary to warrant re-summarization (~20 new messages).
pub fn should_summarize_by_count(message_count: usize, messages_at_last: usize) -> bool {
    message_count >= messages_at_last + MESSAGE_TRIGGER_COUNT
}

/// Count the number of user and assistant text messages (the ones that matter for summarization).
pub fn count_user_assistant_messages(messages: &[ConversationMessage]) -> usize {
    messages.iter().filter(|m| {
        matches!(m.kind, MessageKind::UserText | MessageKind::AssistantText)
    }).count()
}

/// Path to summary cache in ~/.claude-manager.
fn cache_path() -> Option<PathBuf> {
    Some(crate::paths::app_data_file("recon-summaries.json"))
}

/// Load summaries from disk cache.
pub fn load_summaries() -> HashMap<String, SessionSummary> {
    let path = match cache_path() {
        Some(p) if p.exists() => p,
        _ => return HashMap::new(),
    };
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Save summaries to disk cache.
pub fn save_summaries(summaries: &HashMap<String, SessionSummary>) {
    if let Some(path) = cache_path() {
        if let Ok(json) = serde_json::to_string(summaries) {
            let _ = std::fs::write(&path, json);
        }
    }
}

/// Compute total character count across all messages.
pub fn total_chars(messages: &[ConversationMessage]) -> u64 {
    messages.iter().map(|m| m.text.len() as u64).sum()
}

/// Produce an updated summary for a session.
///
/// `new_messages` should be ONLY the messages generated since the last summary offset,
/// while `all_messages` is the full conversation (used only for Tier 1 latest-text).
///
/// Returns `None` if there are no new messages (file_size == last_offset) or
/// if there are no messages at all.
pub fn summarize_session(
    prev_summary: &Option<SessionSummary>,
    new_messages: &[ConversationMessage],
    all_messages: &[ConversationMessage],
    file_size: u64,
    total_chars_now: u64,
) -> Option<SessionSummary> {
    if all_messages.is_empty() {
        return None;
    }

    // Tier 1: latest assistant text (always computed, no LLM).
    let latest = all_messages
        .iter()
        .rev()
        .find(|m| m.kind == MessageKind::AssistantText)
        .map(|m| truncate(&m.text, 100))
        .unwrap_or_default();

    // If file hasn't changed since last summary, skip LLM work.
    if let Some(prev) = prev_summary {
        if file_size == prev.last_offset && file_size > 0 {
            // Just refresh tier 1 in case the cache is stale, keep tiers 2+3.
            return Some(SessionSummary {
                latest,
                current_task: prev.current_task.clone(),
                overview: prev.overview.clone(),
                last_offset: file_size,
                chars_at_last_summary: prev.chars_at_last_summary,
                messages_at_last_summary: prev.messages_at_last_summary,
            });
        }
    }

    // Tier 2+3: LLM summarization — only pass new messages since last summary.
    // The previous summary text gives the LLM context for older content.
    let llm_messages = if new_messages.is_empty() { all_messages } else { new_messages };
    let (current_task, overview) = match generate_llm_summary(prev_summary, llm_messages) {
        Some((task, ov)) => (task, ov),
        None => {
            // No API key or LLM call failed — return tier 1 only.
            let prev_task = prev_summary
                .as_ref()
                .map(|p| p.current_task.clone())
                .unwrap_or_default();
            let prev_overview = prev_summary
                .as_ref()
                .map(|p| p.overview.clone())
                .unwrap_or_default();
            (prev_task, prev_overview)
        }
    };

    let message_count = count_user_assistant_messages(all_messages);

    Some(SessionSummary {
        latest,
        current_task,
        overview,
        last_offset: file_size,
        chars_at_last_summary: total_chars_now,
        messages_at_last_summary: message_count,
    })
}

/// Call Gemini 3.1 Flash Lite to produce tier 2+3 summaries.
/// Returns `None` if the API key is missing or the call fails.
fn generate_llm_summary(
    prev_summary: &Option<SessionSummary>,
    messages: &[ConversationMessage],
) -> Option<(String, String)> {
    let api_key = crate::config::gemini_api_key()?;

    // Build the prompt from recent messages.
    let prompt = build_prompt(prev_summary, messages);

    // Call the Gemini API.
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={}",
        api_key
    );

    let body = serde_json::json!({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 2000
        }
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let resp_json: serde_json::Value = response.json().ok()?;

    // Parse: candidates[0].content.parts[0].text
    let text = resp_json
        .get("candidates")?
        .get(0)?
        .get("content")?
        .get("parts")?
        .get(0)?
        .get("text")?
        .as_str()?;

    parse_llm_response(text)
}

/// Build the summarization prompt from previous summary + recent messages.
fn build_prompt(
    prev_summary: &Option<SessionSummary>,
    messages: &[ConversationMessage],
) -> String {
    let mut prompt = String::from(
        "You are summarizing a Claude Code AI coding session. Be concise.\n\n",
    );

    if let Some(prev) = prev_summary {
        if !prev.overview.is_empty() {
            prompt.push_str(&format!("Previous summary: {}\n", prev.overview));
        }
        if !prev.current_task.is_empty() {
            prompt.push_str(&format!("Previous task: {}\n", prev.current_task));
        }
        prompt.push('\n');
    }

    prompt.push_str("New messages since last summary:\n");

    for msg in messages {
        let label = match msg.kind {
            MessageKind::UserText => "User",
            MessageKind::AssistantText => "Claude",
            MessageKind::ToolCall => continue,    // skip tool noise
            MessageKind::ToolResult => continue,  // skip tool noise
            MessageKind::Thinking => continue,    // skip thinking blocks
        };
        let text = truncate(&msg.text, 500);
        prompt.push_str(&format!("{}: {}\n", label, text));
    }

    prompt.push_str(
        "\nRespond in exactly this format:\n\
         TASK: [one sentence: what the agent is currently working on right now]\n\
         OVERVIEW:\n\
         Start with one sentence that captures the overall purpose and state of this session. \
         Then use a markdown-formatted summary with bullet points. This is the primary way a human or AI manager \
         will understand what this session is about without reading the full conversation. Be thorough — \
         include key file names, features built, bugs fixed, decisions made, and any blockers.\n\
         Use this format:\n\
         [one sentence overall summary]\n\
         - **What was done**: bullet points of accomplishments\n\
         - **Key decisions**: any notable choices or tradeoffs\n\
         - **Current state**: where things stand now, any blockers\n\
         Use 4-10 bullet points total. Each bullet should be one concise line.\n",
    );

    prompt
}

/// Parse TASK: and OVERVIEW: sections from the LLM response.
/// OVERVIEW: is multi-line (markdown bullets) — capture everything after it.
fn parse_llm_response(text: &str) -> Option<(String, String)> {
    let mut task = String::new();
    let mut overview_lines: Vec<&str> = Vec::new();
    let mut in_overview = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("TASK:") {
            in_overview = false;
            task = rest.trim().to_string();
        } else if let Some(rest) = trimmed.strip_prefix("OVERVIEW:") {
            in_overview = true;
            let first = rest.trim();
            if !first.is_empty() {
                overview_lines.push(first);
            }
        } else if in_overview {
            overview_lines.push(line);
        }
    }

    let overview = overview_lines.join("\n").trim().to_string();

    if task.is_empty() && overview.is_empty() {
        return None;
    }

    Some((task, overview))
}

/// Truncate text to `max` characters, adding "..." if needed.
fn truncate(text: &str, max: usize) -> String {
    let first_line = text.lines().next().unwrap_or(text);
    let char_count = first_line.chars().count();
    if char_count <= max {
        first_line.to_string()
    } else {
        let mut s: String = first_line.chars().take(max).collect();
        s.push_str("...");
        s
    }
}
