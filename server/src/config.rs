use std::collections::HashMap;
use std::path::PathBuf;

/// Path to config in ~/.codeception.
fn config_path() -> PathBuf {
    crate::paths::app_data_file("config.json")
}

/// Load config from disk.
pub fn load_config() -> HashMap<String, String> {
    let path = config_path();
    if !path.exists() {
        return HashMap::new();
    }
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

/// Save config to disk.
pub fn save_config(config: &HashMap<String, String>) {
    let path = config_path();
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = std::fs::write(&path, json);
    }
}

/// Get the Gemini API key — checks config file first, then env var as fallback.
pub fn gemini_api_key() -> Option<String> {
    let config = load_config();
    if let Some(key) = config.get("gemini_api_key") {
        if !key.is_empty() {
            return Some(key.clone());
        }
    }
    std::env::var("GEMINI_API_KEY").ok().filter(|k| !k.is_empty())
}
