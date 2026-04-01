# Claude Manager

Local dashboard for monitoring, summarizing, and managing multiple Claude Code sessions.

**Status:** Early prototype. Functional but rough.

## What it does

- **Discovers sessions** from `~/.claude/sessions/*.json` + process table
- **Shows status**: active (CPU-based), waiting, idle, stale, dead, completed
- **Conversation viewer** with timestamps, markdown rendering, 5-way message attribution (You/Claude/Tool/Output/Thinking)
- **Filters**: All / Waiting / Active / By Project
- **Project grouping**: auto-groups sessions by working directory
- **Pinning**: star sessions to keep them at top (localStorage)
- **Browser notifications** + beep when sessions transition to "waiting"
- **Tab badge**: "(2 waiting) Claude Manager"
- **Settings panel**: LLM provider, poll interval, notification toggles
- **Summarizer service** (Ollama integration, not yet wired to auto-run)
- **System message filtering**: teammate messages, system-reminders, task-notifications stripped from conversation view

## What it doesn't do yet

- **Send messages to sessions** — reply UI exists but routing isn't connected
  - Best option: tmux `send-keys` (requires tmux-based workflow)
  - Fallback: `claude --resume {id} --print "msg"` (async, new process)
  - `claude rc` available (Max plan) but serves opposite direction (claude.ai controls local)
- **LLM summarization auto-running** — service exists but isn't called in poll loop
- **Manager agent** — command bar UI exists, no LLM behind it
- **Voice input** — mic button placeholder only
- **Real-time WebSocket** — uses polling (configurable 1-10s)

## Architecture

```
~/.claude/sessions/*.json          Session metadata (PID, cwd, startedAt)
~/.claude/projects/*/*.jsonl       Conversation content (timestamped messages)
process table (ps aux)             CPU for status detection
         |
   Scanner Service (lib/scanner.ts)
         |
   Next.js API (/api/sessions, /api/groups, etc.)
         |
   React dashboard (polling, configurable interval)
         |
   Summarizer (lib/summarizer.ts) → Ollama localhost:11434
```

### Status detection (CPU-primary)

| Signal | Status |
|--------|--------|
| CPU > 2% | active |
| CPU ~0%, last assistant msg is tool_use, < 2min | active (tool running) |
| CPU ~0%, last msg is assistant text, > 3s | waiting |
| No meaningful activity > 5min | stale |
| PID not in process table | dead/completed |

### JSONL message shapes handled

| type | role | content shape | Display as |
|------|------|--------------|------------|
| user | user | string | You (real human text) |
| user | user | [{type:"text"}] | You |
| user | user | [{type:"tool_result"}] | Output |
| assistant | assistant | [{type:"text"}] | Claude (markdown rendered) |
| assistant | assistant | [{type:"tool_use"}] | Tool (name + input preview) |
| assistant | assistant | [{type:"thinking"}] | Think (collapsible) |
| system, progress, queue-operation, file-history-snapshot, custom-title, agent-name, last-prompt | — | — | Filtered out |
| user with `<teammate-message>`, `<system-reminder>`, `<task-notification>` | — | — | Filtered out |

## Stack

- Next.js 16 (App Router, Turbopack)
- shadcn/ui + Tailwind v4 + Geist fonts
- SQLite via @libsql/client (summary cache, groups)
- Ollama for summarization (optional)
- react-markdown + @tailwindcss/typography

## Run

```bash
pnpm install
pnpm dev  # runs on port 3000, or:
npx next dev --port 3456
```

## Key files

```
src/
  lib/
    types.ts                    All TypeScript types + defaults
    scanner.ts                  Session discovery, JSONL parsing, status detection
    db.ts                       SQLite (summaries, groups, settings)
    summarizer.ts               Ollama 3-tier summarization
    summarizer-prompts.ts       Prompt templates
    use-notifications.ts        Browser Notification + beep hook
    use-settings.ts             localStorage settings hook
    use-session-history.ts      Session change tracking
  app/
    page.tsx                    Main dashboard
    api/sessions/               Session CRUD + reply + kill
    api/groups/                 Group CRUD
    api/summarize/              Force re-summarize
  components/dashboard/
    session-card.tsx            Card with summaries, pin, expand
    project-group.tsx           Collapsible project group
    filter-bar.tsx              Filter tabs with counts
    conversation-view.tsx       Message viewer with markdown + attribution
    status-badge.tsx            Color-coded status
    command-bar.tsx             Command input (placeholder)
    settings-panel.tsx          Settings sheet
```

## Known issues

- Status detection is CPU heuristic — less reliable than Recon's tmux capture-pane approach
- `custom-title` only found if within last 32KB of JSONL (reverse-read buffer)
- Typography prose classes may need hard refresh after HMR
- Conversation view may miss edge-case message shapes

## Potential: Recon integration

[gavraz/recon](https://github.com/gavraz/recon) is a Rust TUI with better status detection (reads Claude Code status bar via tmux). Options:
1. `recon json` as data source → better status, our web UI on top
2. Fork Recon, add `recon serve` HTTP API
3. Complementary: Recon TUI for terminal, our dashboard for web + summarization

## Spec

Full spec: `~/OneDrive/Obsidian Vault/Planning/APRIL/Claude Manager - Spec.md`
