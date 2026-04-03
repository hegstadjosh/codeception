use std::path::PathBuf;
use std::process::Command;

use crate::conversation::{self, ConversationMessage};

/// Find a running manager session by scanning tmux for sessions starting with "manager-".
/// Returns the tmux session name if found.
pub fn find_manager_session() -> Option<String> {
    let output = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find(|line| line.starts_with("manager-"))
        .map(|s| s.to_string())
}

/// Send a message to the manager session via tmux send-keys.
/// Uses -l for literal text, then sends Enter separately.
pub fn send_to_manager(tmux_name: &str, text: &str) -> Result<(), String> {
    let text_status = Command::new("tmux")
        .args(["send-keys", "-t", tmux_name, "-l", text])
        .status()
        .map_err(|e| format!("Failed to send keys: {e}"))?;

    if !text_status.success() {
        return Err("tmux send-keys (text) failed".to_string());
    }

    let enter_status = Command::new("tmux")
        .args(["send-keys", "-t", tmux_name, "Enter"])
        .status()
        .map_err(|e| format!("Failed to send Enter: {e}"))?;

    if !enter_status.success() {
        return Err("tmux send-keys (Enter) failed".to_string());
    }

    Ok(())
}

/// Read recent messages from the manager's JSONL conversation file.
/// Scans ~/.claude/projects/ for a JSONL file associated with the manager session.
pub fn read_manager_messages(limit: usize) -> Vec<ConversationMessage> {
    let jsonl_path = match find_manager_jsonl() {
        Some(p) => p,
        None => return vec![],
    };

    conversation::read_all_conversation_messages(&jsonl_path, limit)
}

/// Check if the manager tmux session exists and has a running process.
pub fn is_manager_alive() -> bool {
    find_manager_session().is_some()
}

/// Find the JSONL file for the manager session.
/// Looks through ~/.claude/projects/ directories for JSONL files,
/// matching based on the manager session's CWD (the manager/ directory).
fn find_manager_jsonl() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let projects_dir = home.join(".claude").join("projects");

    // The manager runs in a dedicated manager/ directory that may be
    // supplied by CLI flag/env var at runtime.
    let manager_dir = crate::paths::manager_dir()?;
    let manager_canonical = manager_dir.canonicalize().ok()?;

    // Claude Code encodes the project path as a directory name under ~/.claude/projects/
    // The encoding replaces / with - and prepends -
    let path_str = manager_canonical.to_string_lossy();
    let encoded = path_str.replace('/', "-");

    let project_dir = projects_dir.join(&encoded);
    if !project_dir.exists() {
        // Fallback: scan all project dirs for ones containing "manager" in the name
        return find_manager_jsonl_fallback(&projects_dir);
    }

    find_latest_jsonl(&project_dir)
}

/// Fallback: scan all project directories for one that looks like it belongs to the manager.
fn find_manager_jsonl_fallback(projects_dir: &std::path::Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(projects_dir).ok()?;

    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains("manager") {
            if let Some(jsonl) = find_latest_jsonl(&entry.path()) {
                let mtime = jsonl.metadata().ok()
                    .and_then(|m| m.modified().ok())
                    .unwrap_or(std::time::UNIX_EPOCH);
                if best.as_ref().map(|(_, t)| mtime > *t).unwrap_or(true) {
                    best = Some((jsonl, mtime));
                }
            }
        }
    }

    best.map(|(p, _)| p)
}

/// Find the most recently modified JSONL file in a project directory.
fn find_latest_jsonl(dir: &std::path::Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            let mtime = path.metadata().ok()
                .and_then(|m| m.modified().ok())
                .unwrap_or(std::time::UNIX_EPOCH);
            if best.as_ref().map(|(_, t)| mtime > *t).unwrap_or(true) {
                best = Some((path, mtime));
            }
        }
    }

    best.map(|(p, _)| p)
}
