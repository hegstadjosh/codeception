use std::collections::HashMap;
use std::path::PathBuf;

/// A user-defined session group.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub session_ids: Vec<String>,
    pub sort_order: i32,
}

/// Path to groups persistence in ~/.codeception.
fn groups_path() -> Option<PathBuf> {
    Some(crate::paths::app_data_file("recon-groups.json"))
}

/// Load groups from disk.
pub fn load_groups() -> HashMap<String, Group> {
    let path = match groups_path() {
        Some(p) if p.exists() => p,
        _ => return HashMap::new(),
    };
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Save groups to disk.
pub fn save_groups(groups: &HashMap<String, Group>) {
    if let Some(path) = groups_path() {
        if let Ok(json) = serde_json::to_string_pretty(groups) {
            let _ = std::fs::write(&path, json);
        }
    }
}

/// Generate a short unique ID for a new group.
pub fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("g{:x}", ts)
}
