use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

/// The kind of a conversation message.
#[derive(Debug, Clone, PartialEq)]
pub enum MessageKind {
    UserText,
    AssistantText,
    ToolCall,
    ToolResult,
    Thinking,
}

/// A single displayable conversation message.
#[derive(Debug, Clone)]
pub struct ConversationMessage {
    pub timestamp: String,
    pub kind: MessageKind,
    pub text: String,
    pub tool_name: Option<String>,
}

/// System content patterns to filter out of user messages.
const SYSTEM_TAG_PREFIXES: &[&str] = &[
    "<teammate-message",
    "<task-notification",
    "<system-reminder",
    "<local-command-stdout",
    "<command-name>",
];

const SYSTEM_JSON_PREFIXES: &[&str] = &[
    "{\"type\":\"idle_notification\"",
    "{\"type\":\"shutdown\"",
    "{\"type\":\"task_assignment\"",
];

/// JSONL message types that are NOT conversation messages — skip them entirely.
const SKIP_TYPES: &[&str] = &[
    "system",
    "progress",
    "queue-operation",
    "file-history-snapshot",
    "custom-title",
    "agent-name",
    "last-prompt",
];

/// Read the last `max` displayable conversation messages from a JSONL file.
/// Reads the ENTIRE file — no tail optimization. Use for full conversation view.
pub fn read_all_conversation_messages(path: &Path, max: usize) -> Vec<ConversationMessage> {
    read_conversation_messages_inner(path, max, false)
}

/// Read only NEW messages appended since `from_offset` bytes.
/// Returns (new_messages, current_file_size).
/// If file hasn't grown, returns empty vec + same size.
pub fn read_new_messages(path: &Path, from_offset: u64) -> (Vec<ConversationMessage>, u64) {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return (vec![], from_offset),
    };

    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file_size <= from_offset {
        return (vec![], file_size);
    }

    let mut reader = BufReader::new(file);
    if from_offset > 0 {
        let _ = reader.seek(SeekFrom::Start(from_offset));
    }

    let mut messages = Vec::new();
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.starts_with('{') || !trimmed.contains("\"type\"") {
            continue;
        }

        let entry: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = match entry.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };

        if SKIP_TYPES.contains(&entry_type) || (entry_type != "user" && entry_type != "assistant") {
            continue;
        }

        // Reuse the same parsing logic — extract messages from this entry
        let timestamp = entry.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").to_string();
        let message = match entry.get("message") {
            Some(m) => m,
            None => continue,
        };
        let role = message.get("role").and_then(|r| r.as_str()).unwrap_or(entry_type);
        let content = match message.get("content") {
            Some(c) => c,
            None => continue,
        };

        parse_content_blocks(content, role, &timestamp, &mut messages);
    }

    (messages, file_size)
}

/// Read the last `max` displayable conversation messages from a JSONL file.
/// For efficiency, only reads the last ~64KB of large files. Use for card previews.
pub fn read_conversation_messages(path: &Path, max: usize) -> Vec<ConversationMessage> {
    read_conversation_messages_inner(path, max, true)
}

fn read_conversation_messages_inner(path: &Path, max: usize, tail_only: bool) -> Vec<ConversationMessage> {
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return vec![],
    };

    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file_size == 0 {
        return vec![];
    }

    let mut reader = BufReader::new(file);

    // For card previews, seek to the last ~64KB. For full conversation, read everything.
    if tail_only {
        const TAIL_SIZE: u64 = 64 * 1024;
        if file_size > TAIL_SIZE {
            let _ = reader.seek(SeekFrom::Start(file_size - TAIL_SIZE));
            // Discard partial first line after seeking
            let mut discard = String::new();
            let _ = reader.read_line(&mut discard);
        }
    }

    let mut messages = Vec::new();
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {}
            Err(_) => break,
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Quick pre-filter: must look like JSON with a "type" field
        if !trimmed.starts_with('{') || !trimmed.contains("\"type\"") {
            continue;
        }

        // Parse the top-level entry
        let entry: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = match entry.get("type").and_then(|t| t.as_str()) {
            Some(t) => t,
            None => continue,
        };

        // Skip non-conversation types
        if SKIP_TYPES.contains(&entry_type) {
            continue;
        }

        // Only process "user" and "assistant" types
        if entry_type != "user" && entry_type != "assistant" {
            continue;
        }

        let timestamp = entry
            .get("timestamp")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();

        let message = match entry.get("message") {
            Some(m) => m,
            None => continue,
        };

        let role = message
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or(entry_type);

        let content = match message.get("content") {
            Some(c) => c,
            None => continue,
        };

        parse_content_blocks(content, role, &timestamp, &mut messages);
    }

    // Return only the last `max` messages
    if messages.len() > max {
        messages.drain(..messages.len() - max);
    }
    messages
}

/// Parse content blocks from a JSONL message entry into ConversationMessages.
fn parse_content_blocks(
    content: &serde_json::Value,
    role: &str,
    timestamp: &str,
    messages: &mut Vec<ConversationMessage>,
) {
    if let Some(text) = content.as_str() {
        if role == "user" {
            let filtered = filter_system_content(text);
            if !filtered.is_empty() {
                messages.push(ConversationMessage {
                    timestamp: timestamp.to_string(),
                    kind: MessageKind::UserText,
                    text: filtered,
                    tool_name: None,
                });
            }
        } else if !text.is_empty() {
            messages.push(ConversationMessage {
                timestamp: timestamp.to_string(),
                kind: MessageKind::AssistantText,
                text: text.to_string(),
                tool_name: None,
            });
        }
    } else if let Some(blocks) = content.as_array() {
        let mut block_messages = Vec::new();
        let mut all_system = true;

        for block in blocks {
            let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
            match block_type {
                "text" => {
                    let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    if role == "user" {
                        let filtered = filter_system_content(text);
                        if !filtered.is_empty() {
                            all_system = false;
                            block_messages.push(ConversationMessage {
                                timestamp: timestamp.to_string(),
                                kind: MessageKind::UserText,
                                text: filtered,
                                tool_name: None,
                            });
                        }
                    } else if !text.is_empty() {
                        all_system = false;
                        block_messages.push(ConversationMessage {
                            timestamp: timestamp.to_string(),
                            kind: MessageKind::AssistantText,
                            text: text.to_string(),
                            tool_name: None,
                        });
                    }
                }
                "thinking" => {
                    let thinking = block.get("thinking").and_then(|t| t.as_str()).unwrap_or("");
                    if !thinking.is_empty() {
                        all_system = false;
                        block_messages.push(ConversationMessage {
                            timestamp: timestamp.to_string(),
                            kind: MessageKind::Thinking,
                            text: truncate_text(thinking, 200),
                            tool_name: None,
                        });
                    }
                }
                "tool_use" => {
                    let name = block.get("name").and_then(|n| n.as_str()).unwrap_or("unknown").to_string();
                    let input_text = summarize_tool_input(block.get("input"), &name);
                    all_system = false;
                    block_messages.push(ConversationMessage {
                        timestamp: timestamp.to_string(),
                        kind: MessageKind::ToolCall,
                        text: input_text,
                        tool_name: Some(name),
                    });
                }
                "tool_result" => {
                    let result_text = match block.get("content") {
                        Some(serde_json::Value::String(s)) => truncate_text(s, 200),
                        Some(serde_json::Value::Array(arr)) => {
                            let parts: Vec<&str> = arr.iter()
                                .filter_map(|b| {
                                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                                        b.get("text").and_then(|t| t.as_str())
                                    } else { None }
                                }).collect();
                            truncate_text(&parts.join("\n"), 200)
                        }
                        _ => "(no output)".to_string(),
                    };
                    all_system = false;
                    block_messages.push(ConversationMessage {
                        timestamp: timestamp.to_string(),
                        kind: MessageKind::ToolResult,
                        text: result_text,
                        tool_name: None,
                    });
                }
                _ => {}
            }
        }

        if !(role == "user" && all_system) {
            messages.extend(block_messages);
        }
    }
}

/// Filter out system tags and patterns from user message text.
/// Returns empty string if the entire text is system content.
fn filter_system_content(text: &str) -> String {
    let trimmed = text.trim();

    // Check if the entire text is a system JSON pattern
    for prefix in SYSTEM_JSON_PREFIXES {
        if trimmed.starts_with(prefix) {
            return String::new();
        }
    }

    // Filter out lines that start with system tags
    let filtered: Vec<&str> = trimmed
        .lines()
        .filter(|line| {
            let lt = line.trim();
            !SYSTEM_TAG_PREFIXES.iter().any(|prefix| lt.starts_with(prefix))
        })
        .collect();

    // If we're inside a system tag block (multiline), do a more aggressive filter.
    // Look for opening tags without closing tags and strip everything between them.
    let result = filtered.join("\n");
    strip_system_tag_blocks(&result)
}

/// Strip multiline system tag blocks like <system-reminder>...</system-reminder>
fn strip_system_tag_blocks(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut remaining = text;

    let system_tags = [
        ("system-reminder"),
        ("teammate-message"),
        ("task-notification"),
        ("local-command-stdout"),
        ("command-name"),
    ];

    loop {
        // Find the nearest opening tag
        let mut nearest: Option<(usize, &str)> = None;
        for tag in &system_tags {
            let open = format!("<{}", tag);
            if let Some(pos) = remaining.find(&open) {
                if nearest.is_none() || pos < nearest.unwrap().0 {
                    nearest = Some((pos, tag));
                }
            }
        }

        match nearest {
            Some((start, tag)) => {
                // Add everything before the tag
                result.push_str(&remaining[..start]);

                // Find the closing tag
                let close = format!("</{}>", tag);
                if let Some(end_pos) = remaining[start..].find(&close) {
                    remaining = &remaining[start + end_pos + close.len()..];
                } else {
                    // No closing tag — strip to end
                    break;
                }
            }
            None => {
                result.push_str(remaining);
                break;
            }
        }
    }

    result.trim().to_string()
}

/// Summarize tool input for display.
fn summarize_tool_input(input: Option<&serde_json::Value>, tool_name: &str) -> String {
    let input = match input {
        Some(v) => v,
        None => return format!("{}()", tool_name),
    };

    match tool_name {
        "Bash" => {
            let cmd = input
                .get("command")
                .and_then(|c| c.as_str())
                .unwrap_or("...");
            truncate_text(cmd, 120)
        }
        "Read" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("...");
            // Show just filename for brevity
            Path::new(path)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string())
        }
        "Write" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("...");
            Path::new(path)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string())
        }
        "Edit" => {
            let path = input
                .get("file_path")
                .and_then(|p| p.as_str())
                .unwrap_or("...");
            Path::new(path)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string())
        }
        "Grep" => {
            let pattern = input
                .get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("...");
            truncate_text(pattern, 80)
        }
        "Glob" => {
            let pattern = input
                .get("pattern")
                .and_then(|p| p.as_str())
                .unwrap_or("...");
            pattern.to_string()
        }
        _ => {
            // For other tools, show a compact JSON summary
            let s = serde_json::to_string(input).unwrap_or_default();
            truncate_text(&s, 100)
        }
    }
}

/// Truncate text to `max_chars` with an ellipsis if needed.
fn truncate_text(text: &str, max_chars: usize) -> String {
    // Take first line only for multi-line content
    let first_line = text.lines().next().unwrap_or(text);
    let char_count = first_line.chars().count();
    if char_count <= max_chars {
        first_line.to_string()
    } else {
        let mut s: String = first_line.chars().take(max_chars).collect();
        s.push_str("...");
        s
    }
}
