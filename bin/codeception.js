#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(os.homedir(), ".codeception");
const PID_FILE = path.join(DATA_DIR, "launcher-pids.json");
const RECON_LOG = path.join(DATA_DIR, "recon.log");
const NEXT_LOG = path.join(DATA_DIR, "next.log");
const RECON_PORT = 3100;

const args = process.argv.slice(2);
const command = args[0] === "stop" ? "stop" : "start";

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function fatal(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function commandExists(cmd) {
  const out = spawnSync("which", [cmd], { stdio: "ignore" });
  return out.status === 0;
}

function parseOptions(argv) {
  const opts = { port: 3456, noOpen: false, noManager: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-open") {
      opts.noOpen = true;
      continue;
    }
    if (arg === "--no-manager") {
      opts.noManager = true;
      continue;
    }
    if (arg === "--port") {
      const val = argv[i + 1];
      if (!val) fatal("Missing value for --port");
      const parsed = Number.parseInt(val, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
        fatal(`Invalid port: ${val}`);
      }
      opts.port = parsed;
      i += 1;
      continue;
    }
  }
  return opts;
}

function killPort(port) {
  const out = spawnSync("lsof", ["-ti", `:${port}`], { encoding: "utf8" });
  if (out.status !== 0 || !out.stdout.trim()) return;
  const pids = [...new Set(out.stdout.trim().split(/\s+/).filter(Boolean))];
  for (const pid of pids) {
    spawnSync("kill", ["-9", pid], { stdio: "ignore" });
  }
}

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writePidFile(payload) {
  fs.writeFileSync(PID_FILE, JSON.stringify(payload, null, 2));
}

function removePidFile() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function openBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const out = spawn(opener, [url], {
    detached: true,
    stdio: "ignore",
  });
  out.unref();
}

function spawnLogged(cmd, cmdArgs, logPath, extraEnv = {}) {
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const child = spawn(cmd, cmdArgs, {
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

function ensurePrerequisites() {
  const [major] = process.versions.node.split(".");
  if (Number.parseInt(major, 10) < 20) {
    fatal(`Node.js 20+ required. You have ${process.versions.node}.`);
  }
  if (!commandExists("tmux")) {
    fatal("tmux is required. Install it: macOS: brew install tmux | Linux: apt install tmux");
  }
  if (!commandExists("claude")) {
    fatal("Claude Code not found. Install it: npm install -g @anthropic-ai/claude-code");
  }
}

function killExistingManagerSessions() {
  const out = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
    encoding: "utf8",
  });
  if (out.status !== 0) return;
  const names = out.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("manager-"));
  for (const name of names) {
    spawnSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
  }
}

function randomManagerName() {
  const adjectives = [
    "golden", "swift", "cosmic", "electric", "lunar", "crimson", "jade", "silver", "blazing",
    "phantom", "neon", "arctic", "velvet", "sapphire", "coral", "amber", "iron", "misty",
    "noble", "wild", "bright", "quiet", "bold", "lucky", "vivid", "frosty", "gentle", "fierce",
    "dusty", "crystal",
  ];
  const nouns = [
    "pony", "falcon", "tiger", "wolf", "phoenix", "dragon", "eagle", "panther", "cobra", "fox",
    "hawk", "raven", "lynx", "otter", "bear", "heron", "viper", "badger", "bison", "crane",
    "moose", "gecko", "finch", "coyote", "puma", "mantis", "osprey", "jaguar", "marten", "wren",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `manager-${adj}-${noun}`;
}

function startManagerSession(managerDir) {
  killExistingManagerSessions();
  const managerName = randomManagerName();
  const created = spawnSync("tmux", ["new-session", "-d", "-s", managerName, "-c", managerDir], {
    stdio: "ignore",
  });
  if (created.status !== 0) {
    return null;
  }
  spawnSync("tmux", ["send-keys", "-t", managerName, "claude", "Enter"], { stdio: "ignore" });
  return managerName;
}

function stop() {
  ensureDataDir();
  const pids = readPidFile();
  if (pids) {
    for (const key of ["reconPid", "nextPid"]) {
      if (pids[key]) {
        spawnSync("kill", ["-9", String(pids[key])], { stdio: "ignore" });
      }
    }
  }
  killPort(RECON_PORT);
  killPort(3456);
  removePidFile();
  console.log("Stopped codeception services.");
}

function start() {
  ensureDataDir();
  ensurePrerequisites();

  const opts = parseOptions(command === "start" ? args : args.slice(1));
  const reconPath = path.join(PACKAGE_ROOT, "bin", "recon");
  const managerDir = path.join(PACKAGE_ROOT, "server", "manager");
  const standaloneServer = path.join(PACKAGE_ROOT, ".next", "standalone", "server.js");

  if (!fs.existsSync(reconPath)) {
    fatal("Missing recon binary. Re-run npm install or npx to trigger postinstall.");
  }
  if (!fs.existsSync(standaloneServer)) {
    fatal("Missing standalone Next build. Run `pnpm build` before starting locally.");
  }

  killPort(RECON_PORT);
  killPort(opts.port);

  const recon = spawnLogged(
    reconPath,
    ["serve", "--port", String(RECON_PORT), "--quiet", "--manager-dir", managerDir],
    RECON_LOG
  );
  const next = spawnLogged("node", [standaloneServer], NEXT_LOG, {
    PORT: String(opts.port),
  });

  let managerName = null;
  if (!opts.noManager && fs.existsSync(managerDir)) {
    managerName = startManagerSession(managerDir);
  }

  writePidFile({
    reconPid: recon.pid,
    nextPid: next.pid,
    webPort: opts.port,
    startedAt: new Date().toISOString(),
  });

  const url = `http://localhost:${opts.port}`;
  if (!opts.noOpen) {
    openBrowser(url);
  }

  console.log(`Codeception running at ${url}`);
  if (managerName) {
    console.log(`Manager session: ${managerName}`);
  }
  console.log("Press Ctrl+C to stop");

  const shutdown = () => {
    for (const pid of [recon.pid, next.pid]) {
      if (pid) spawnSync("kill", ["-9", String(pid)], { stdio: "ignore" });
    }
    removePidFile();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (command === "stop") {
  stop();
} else {
  start();
}
