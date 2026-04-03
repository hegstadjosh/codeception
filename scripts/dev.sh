#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT_DIR/server"
PORT="${PORT:-3456}"
MANAGER_DIR="$SERVER_DIR/manager"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

kill_port 3100
kill_port "$PORT"

echo "Building backend..."
cargo build --manifest-path "$SERVER_DIR/Cargo.toml" --release

echo "Starting recon serve on :3100"
"$SERVER_DIR/target/release/recon" serve --quiet --manager-dir "$MANAGER_DIR" &
RECON_PID=$!

echo "Starting Next.js dev server on :$PORT"
cd "$ROOT_DIR"
pnpm run dev:ui -- --port "$PORT" &
NEXT_PID=$!

cleanup() {
  kill -9 "$RECON_PID" 2>/dev/null || true
  kill -9 "$NEXT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if command -v tmux >/dev/null 2>&1 && [[ -d "$MANAGER_DIR" ]]; then
  MANAGER_NAME="manager-dev-$(date +%s)"
  tmux new-session -d -s "$MANAGER_NAME" -c "$MANAGER_DIR" || true
  tmux send-keys -t "$MANAGER_NAME" "claude" Enter || true
  echo "Manager session: $MANAGER_NAME"
fi

echo "Dev mode running: recon :3100 | dashboard :$PORT"
wait

