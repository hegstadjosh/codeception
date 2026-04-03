/// Generate fun random session names like "golden-pony".

const ADJECTIVES: &[&str] = &[
    "golden", "swift", "cosmic", "electric", "lunar",
    "crimson", "jade", "silver", "blazing", "phantom",
    "neon", "arctic", "velvet", "sapphire", "coral",
    "amber", "iron", "misty", "noble", "wild",
    "bright", "quiet", "bold", "lucky", "vivid",
    "frosty", "gentle", "fierce", "dusty", "crystal",
];

const NOUNS: &[&str] = &[
    "pony", "falcon", "tiger", "wolf", "phoenix",
    "dragon", "eagle", "panther", "cobra", "fox",
    "hawk", "raven", "lynx", "otter", "bear",
    "heron", "viper", "badger", "bison", "crane",
    "moose", "gecko", "finch", "coyote", "puma",
    "mantis", "osprey", "jaguar", "marten", "wren",
];

/// Generate a random two-word slug like "golden-pony".
pub fn random_slug() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // Simple hash to pick words — good enough for non-crypto randomness
    let adj_idx = (seed as usize ^ 0xDEAD) % ADJECTIVES.len();
    let noun_idx = ((seed as usize >> 16) ^ 0xBEEF) % NOUNS.len();
    format!("{}-{}", ADJECTIVES[adj_idx], NOUNS[noun_idx])
}

/// Build a tmux session name: "ProjectName-golden-pony"
pub fn session_name(project: &str) -> String {
    let slug = random_slug();
    let clean = project.replace('.', "-").replace(':', "-").replace(' ', "-");
    format!("{}-{}", clean, slug)
}

/// Turn a tmux name like "BK_Monitor-golden-pony" into a display title
/// like "BK_Monitor · golden pony"
pub fn display_title(tmux_name: &str) -> String {
    // Find the slug part — last two hyphenated words (adjective-noun)
    let parts: Vec<&str> = tmux_name.rsplitn(3, '-').collect();
    if parts.len() >= 3 {
        let noun = parts[0];
        let adj = parts[1];
        let project = parts[2];
        format!("{} · {} {}", project, adj, noun)
    } else {
        tmux_name.to_string()
    }
}
