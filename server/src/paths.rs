use std::path::PathBuf;

const APP_DIR_NAME: &str = ".codeception";
const MANAGER_DIR_ENV: &str = "CODECEPTION_MANAGER_DIR";

/// Runtime data directory for all persisted app state.
pub fn app_data_dir() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join(APP_DIR_NAME);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Path helper for a file under ~/.codeception.
pub fn app_data_file(filename: &str) -> PathBuf {
    app_data_dir().join(filename)
}

/// Resolve the manager instructions directory at runtime.
pub fn manager_dir() -> Option<PathBuf> {
    if let Ok(raw) = std::env::var(MANAGER_DIR_ENV) {
        let from_env = PathBuf::from(raw);
        if from_env.exists() {
            return Some(from_env.canonicalize().unwrap_or(from_env));
        }
    }

    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|pp| pp.to_path_buf()));

    let candidates = [
        exe_dir.as_ref().map(|d| d.join("../server/manager")),
        exe_dir.as_ref().map(|d| d.join("../manager")),
        exe_dir.as_ref().map(|d| d.join("../../manager")),
        exe_dir.as_ref().map(|d| d.join("../../../manager")),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("manager")),
    ];

    candidates
        .into_iter()
        .flatten()
        .find(|p| p.exists())
        .map(|p| p.canonicalize().unwrap_or(p))
}

