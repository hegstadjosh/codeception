"use client";

import { useState, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardAction,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "./status-badge";
import { ConversationView } from "./conversation-view";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, X, EyeOff, Eye, Pencil, StickyNote, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Session } from "@/lib/types";

// Consistent color for a slug string (deterministic hash → hue)
const SLUG_COLORS = [
  "text-emerald-400", "text-sky-400", "text-violet-400", "text-rose-400",
  "text-amber-400", "text-teal-400", "text-indigo-400", "text-pink-400",
  "text-cyan-400", "text-lime-400", "text-fuchsia-400", "text-orange-400",
];

function slugColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = ((hash << 5) - hash + slug.charCodeAt(i)) | 0;
  return SLUG_COLORS[Math.abs(hash) % SLUG_COLORS.length];
}

/** Extract the random slug from a tmux session name like "BK_Monitor-golden-pony" */
function parseSessionSlug(tmuxName: string | null, projectName: string): string | null {
  if (!tmuxName) return null;
  // The slug is the part after the project prefix
  const prefix = projectName.replace(/[.:]/g, "-").replace(/ /g, "-");
  if (tmuxName.startsWith(prefix + "-")) {
    const rest = tmuxName.slice(prefix.length + 1);
    // Should be "adjective-noun" format
    if (rest.includes("-")) return rest.replace(/-/g, " ");
  }
  return null;
}

/** Model-based pricing per million tokens: [input, output] */
const MODEL_PRICING: Record<string, [number, number]> = {
  "Opus 4.6": [3, 15],
  "Sonnet 4.6": [1, 5],
  "Haiku 4.5": [0.25, 1.25],
};

function estimateCost(session: Session): string | null {
  const inputTokens = session.total_input_tokens ?? 0;
  const outputTokens = session.total_output_tokens ?? 0;
  if (inputTokens === 0 && outputTokens === 0) return null;

  // Match model_display against known pricing — default to Opus
  let pricing: [number, number] = [3, 15];
  const display = session.model_display || "";
  for (const [key, rates] of Object.entries(MODEL_PRICING)) {
    if (display.includes(key)) {
      pricing = rates;
      break;
    }
  }

  const cost = (inputTokens * pricing[0] + outputTokens * pricing[1]) / 1_000_000;
  return `$${cost.toFixed(2)}`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (isNaN(diffMs)) return "—";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

type ActionState = "idle" | "loading" | "success" | "error";

interface SessionCardProps {
  session: Session;
  isPinned?: boolean;
  isMinimized?: boolean;
  onTogglePin?: (id: string) => void;
  onToggleMinimize?: (id: string) => void;
  selectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function SessionCard({ session, isPinned = false, isMinimized = false, onTogglePin, onToggleMinimize, selectMode = false, isSelected = false, onToggleSelect }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [killState, setKillState] = useState<ActionState>("idle");
  const [killError, setKillError] = useState("");
  const [openState, setOpenState] = useState<ActionState>("idle");
  const [openError, setOpenError] = useState("");
  const [summarizeState, setSummarizeState] = useState<ActionState>("idle");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(session.display_name || session.project_name);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(session.user_note || "");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const noteInputRef = useRef<HTMLInputElement | null>(null);
  const killTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isManaged = session.managed !== false;
  const isAlive = session.status === "working" || session.status === "input" || session.status === "new" || session.status === "idle";
  const isManager = session.is_manager === true;

  // One smart "Open" button — knows whether to focus, resume, or upgrade
  const handleOpen = useCallback(async () => {
    setOpenState("loading");
    setOpenError("");
    try {
      if (isAlive && isManaged) {
        // Managed + alive — just focus it
        const res = await fetch(`/api/sessions/${session.session_id}/focus`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Focus failed" }));
          throw new Error(data.error || `Focus failed (${res.status})`);
        }
      } else if (isAlive && !isManaged) {
        // Unmanaged + alive — just bring Terminal to front, don't kill anything
        const res = await fetch(`/api/sessions/${session.session_id}/focus`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Focus failed" }));
          throw new Error(data.error || `Focus failed (${res.status})`);
        }
      } else {
        // Dead — resume in tmux
        const res = await fetch(`/api/sessions/${session.session_id}/resume`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Resume failed" }));
          throw new Error(data.error || `Resume failed (${res.status})`);
        }
      }
      setOpenState("success");
      setTimeout(() => setOpenState("idle"), 2000);
    } catch (e) {
      setOpenState("error");
      setOpenError(e instanceof Error ? e.message : "Failed");
    }
  }, [isAlive, isManaged, session.session_id]);

  const handleKill = useCallback(async () => {
    if (!confirmKill) {
      setConfirmKill(true);
      setKillError("");
      killTimerRef.current = setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    if (killTimerRef.current) clearTimeout(killTimerRef.current);
    setKillState("loading");
    setKillError("");
    try {
      const res = await fetch(`/api/sessions/${session.session_id}/kill`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Kill failed" }));
        throw new Error(data.error || `Kill failed (${res.status})`);
      }
      setKillState("idle");
    } catch (e) {
      setKillState("error");
      setKillError(e instanceof Error ? e.message : "Kill failed");
    }
    setConfirmKill(false);
  }, [confirmKill, session.session_id]);

  const [summarizeError, setSummarizeError] = useState("");

  const handleSummarize = useCallback(async () => {
    setSummarizeState("loading");
    setSummarizeError("");
    try {
      const res = await fetch(`/api/sessions/${session.session_id}/summarize`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Summarize failed" }));
        throw new Error(data.error || `Summarize failed (${res.status})`);
      }
      setSummarizeState("success");
      setTimeout(() => setSummarizeState("idle"), 3000);
    } catch (e) {
      setSummarizeState("error");
      setSummarizeError(e instanceof Error ? e.message : "Summarize failed");
      setTimeout(() => { setSummarizeState("idle"); setSummarizeError(""); }, 5000);
    }
  }, [session.session_id]);

  const handleClearSummary = useCallback(async () => {
    try {
      await fetch(`/api/sessions/${session.session_id}/summary`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }, [session.session_id]);

  const handleRenameSave = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== session.project_name && trimmed !== session.display_name) {
      try {
        await fetch(`/api/sessions/${session.session_id}/name`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
      } catch {
        // revert on failure
        setRenameValue(session.display_name || session.project_name);
      }
    }
    setRenaming(false);
  }, [renameValue, session.session_id, session.project_name, session.display_name]);

  const handleNoteSave = useCallback(async () => {
    const trimmed = noteValue.trim();
    try {
      await fetch(`/api/sessions/${session.session_id}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed }),
      });
    } catch {
      setNoteValue(session.user_note || "");
    }
    setEditingNote(false);
  }, [noteValue, session.session_id, session.user_note]);

  const hasSummary = !!(session.summary?.overview || session.summary?.current_task);

  // Estimate summarize cost
  // Gemini 2.5 Flash Lite: $0.075/1M input, $0.30/1M output
  // ~4 chars per token, output ~400 tokens for TASK + OVERVIEW
  function estimateSummarizeCost(fullSession: boolean): string {
    const prevSummaryChars = (session.summary?.overview?.length ?? 0)
      + (session.summary?.current_task?.length ?? 0);
    const chars = fullSession
      ? (session.total_input_tokens + session.total_output_tokens) // rough proxy for total session content
      : session.chars_since_summary + prevSummaryChars;
    if (chars === 0) return "";
    const inputTokens = Math.ceil(chars / 4);
    const outputTokens = 400;
    const cost = (inputTokens * 0.075 + outputTokens * 0.30) / 1_000_000;
    if (cost < 0.001) return "(<$0.001)";
    return `(~$${cost.toFixed(3)})`;
  }

  // Open button label + tooltip — different for managed vs unmanaged
  let openLabel: string;
  let openTooltip: string;
  let openDisabled = false;

  if (openState === "loading") {
    openLabel = "Opening...";
    openTooltip = "";
  } else if (openState === "success") {
    openLabel = "Opened";
    openTooltip = "";
  } else if (!isAlive) {
    openLabel = "Resume";
    openTooltip = "Resume this dead session in a new tmux terminal";
  } else if (isManaged) {
    openLabel = "Open Terminal";
    openTooltip = "Bring up the terminal window for this tmux session";
  } else {
    // Alive but unmanaged — can't auto-focus, so disable the button
    openLabel = "In Terminal";
    openTooltip = "Running in a regular terminal — find it manually. Kill it here and Resume to get full tmux control.";
    openDisabled = true;
  }

  // Minimized: thin row with just name + status dot + restore button
  if (isMinimized) {
    const slug = parseSessionSlug(session.tmux_session, session.project_name);
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-zinc-800/40 bg-zinc-950/40 px-3 py-1.5 cursor-pointer hover:bg-zinc-900/40 transition-colors group"
        onClick={() => onToggleMinimize?.(session.session_id)}
        title="Click to restore"
      >
        <Eye className="size-3 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
        <span className="text-xs font-medium text-zinc-400 truncate">
          {session.project_name}
        </span>
        {slug && (
          <span className={cn("text-[10px] italic", slugColor(slug))}>
            {slug}
          </span>
        )}
        <span className={cn(
          "size-1.5 rounded-full shrink-0",
          session.status === "working" || session.status === "input" ? "bg-emerald-400" : "bg-zinc-600"
        )} />
        <span className="text-[10px] text-zinc-600">{session.status}</span>
      </div>
    );
  }

  return (
    <Card
      size="sm"
      className={cn(
        "transition-colors hover:ring-zinc-700/80",
        // Manager card: distinct violet/purple border
        isManager && "bg-violet-950/20 border border-violet-500/30 hover:ring-violet-500/30",
        // Managed + active (working/input): shimmering green — something is happening
        !isManager && isManaged && isAlive && (session.status === "working" || session.status === "input") && "bg-zinc-900/60 shimmer-live",
        // Managed + quiet (idle/new): solid green border — live but nothing happening
        !isManager && isManaged && isAlive && session.status !== "working" && session.status !== "input" && "bg-zinc-900/60 border border-emerald-500/20",
        // Unmanaged + alive: muted, no shimmer — view-only
        !isManaged && isAlive && "bg-zinc-900/40 ring-zinc-800/60 opacity-90",
        // Dead sessions: most muted
        !isAlive && "bg-zinc-950/60 ring-zinc-800/50 opacity-75",
        expanded && "ring-zinc-600/60",
        isPinned && !isManager && "border-l-2 border-l-amber-500/60"
      )}
    >
      {/* Header row — always clickable to expand/collapse */}
      <CardHeader
        className="pb-0 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Bulk select checkbox — hidden for manager */}
          {selectMode && !isManager && (
            <input
              type="checkbox"
              checked={isSelected}
              className="size-3.5 rounded border-zinc-600 bg-zinc-800 text-violet-500 accent-violet-500 shrink-0 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect?.(session.session_id);
              }}
              readOnly
            />
          )}
          {/* Expand/collapse chevron */}
          {!selectMode && (
            expanded ? (
              <ChevronDown className="size-3.5 text-zinc-500 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 text-zinc-500 shrink-0" />
            )
          )}
          {renaming && !isManager ? (
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameSave();
                if (e.key === "Escape") { setRenameValue(session.display_name || session.project_name); setRenaming(false); }
              }}
              className="bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-sm font-semibold text-zinc-100 outline-none focus:border-violet-500 min-w-0"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <CardTitle
              className={cn(
                "truncate text-sm font-semibold",
                isManager ? "text-violet-300" : "text-zinc-100 hover:text-violet-300 cursor-pointer"
              )}
              onClick={(e) => {
                // Stop click from bubbling to CardHeader so it doesn't toggle expand
                if (!isManager) e.stopPropagation();
              }}
              onDoubleClick={(e) => {
                if (!isManager) {
                  e.stopPropagation();
                  setRenaming(true);
                  setRenameValue(session.display_name || session.project_name);
                }
              }}
              title={!isManager ? "Double-click to rename" : undefined}
            >
              {isManager ? "Manager" : (session.display_name || session.project_name)}
            </CardTitle>
          )}
          {(() => {
            const slug = parseSessionSlug(session.tmux_session, session.project_name);
            return slug ? (
              <span className={cn("text-[11px] font-medium italic", slugColor(slug))}>
                {slug}
              </span>
            ) : null;
          })()}
          {session.relative_dir && (
            <span className="text-[11px] text-zinc-500">{session.relative_dir}</span>
          )}
          <StatusBadge status={session.status} managed={isManaged} />
          {session.branch && (
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
              {session.branch}
            </span>
          )}
        </div>
        <CardAction>
          {/* Manager can't be minimized or pinned */}
          {!isManager && onToggleMinimize && (
            <button
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMinimize(session.session_id);
              }}
              title="Minimize session"
            >
              <EyeOff className="size-3.5" />
            </button>
          )}
          {!isManager && onTogglePin && (
            <button
              className={cn(
                "text-sm leading-none transition-colors",
                isPinned
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(session.session_id);
              }}
              title={isPinned ? "Unpin session" : "Pin session"}
            >
              {isPinned ? "\u2605" : "\u2606"}
            </button>
          )}
          <span className="font-mono text-[11px] text-zinc-500">
            {relativeTime(session.last_activity)}
          </span>
        </CardAction>
      </CardHeader>

      {/* Summary + last message + metadata */}
      <CardContent className="space-y-2 pt-0">
        {/* Current task — pill label */}
        {session.summary?.current_task && (
          <div className="flex items-start gap-2">
            <span className="shrink-0 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-400">
              Task
            </span>
            <span className="text-xs text-zinc-300 leading-snug pt-0.5">{session.summary.current_task}</span>
          </div>
        )}

        {/* Overview — expandable */}
        {session.summary?.overview ? (
          <div className="flex items-start gap-2">
            <button
              className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-300 transition-colors flex items-center gap-0.5"
              onClick={(e) => {
                e.stopPropagation();
                setSummaryExpanded((v) => !v);
              }}
            >
              {summaryExpanded ? (
                <ChevronDown className="size-2.5" />
              ) : (
                <ChevronRight className="size-2.5" />
              )}
              Summary
            </button>
            {summaryExpanded ? (
              <div className="text-xs text-zinc-400 leading-snug pt-0.5 prose prose-invert prose-xs prose-zinc max-w-none [&_ul]:mt-0.5 [&_ul]:mb-0 [&_li]:my-0 [&_strong]:text-zinc-300 [&_p]:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{session.summary.overview}</ReactMarkdown>
              </div>
            ) : (
              <span className="text-xs text-zinc-400 leading-snug pt-0.5 line-clamp-1">
                {session.summary.overview.split('\n')[0]?.replace(/^[-*]\s*/, '').replace(/\*\*/g, '')}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded bg-zinc-800/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Summary
            </span>
            <span className="text-[11px] text-zinc-600 italic">No summary yet</span>
          </div>
        )}

        {/* Last message — looks like a collapsed chat bubble */}
        <div
          className="rounded-md border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 cursor-pointer hover:border-zinc-700/60 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          title="Click to expand conversation"
        >
          {session.summary?.latest ? (
            <p className="text-xs text-zinc-300 truncate">
              <span className="text-violet-400/70 font-medium">Claude: </span>
              {session.summary.latest}
            </p>
          ) : (
            <p className="text-xs text-zinc-600 italic">No messages yet</p>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-3 pt-1">
          <span className="font-mono text-[10px] text-zinc-600">
            {session.session_id.slice(0, 8)}
          </span>
          <span className="text-[10px] text-zinc-500">
            {session.model_display || "—"}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            {session.token_display || "—"}
          </span>
          {estimateCost(session) && (
            <span className="font-mono text-[10px] text-zinc-500" title="Estimated API cost">
              {estimateCost(session)}
            </span>
          )}
          {session.chars_since_summary > 0 && (
            <span
              className={cn(
                "text-[10px]",
                session.chars_since_summary > 10000 ? "text-amber-500" : "text-zinc-500"
              )}
              title={`${session.chars_since_summary.toLocaleString()} chars since last summary`}
            >
              summary: {session.chars_since_summary >= 1000
                ? `${(session.chars_since_summary / 1000).toFixed(1)}k`
                : session.chars_since_summary} chars behind
            </span>
          )}
          {!isManaged && (
            <span className="text-[10px] text-zinc-600 italic" title="Running in a regular terminal, not tmux. Some features limited.">
              terminal
            </span>
          )}
        </div>

        {/* User note */}
        {editingNote ? (
          <div className="flex items-center gap-1.5">
            <StickyNote className="size-3 text-amber-400/60 shrink-0" />
            <input
              ref={noteInputRef}
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              onBlur={handleNoteSave}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNoteSave();
                if (e.key === "Escape") { setNoteValue(session.user_note || ""); setEditingNote(false); }
              }}
              placeholder="Add a note..."
              className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-300 outline-none focus:border-amber-500/60"
              autoFocus
            />
            <button
              className="text-zinc-500 hover:text-emerald-400 transition-colors"
              onClick={handleNoteSave}
              title="Save note"
            >
              <Check className="size-3" />
            </button>
          </div>
        ) : session.user_note ? (
          <div
            className="flex items-start gap-1.5 group cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setEditingNote(true); }}
            title="Click to edit note"
          >
            <StickyNote className="size-3 text-amber-400/60 shrink-0 mt-0.5" />
            <span className="text-xs text-amber-200/70 italic leading-snug">{session.user_note}</span>
            <Pencil className="size-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
          </div>
        ) : !isManager ? (
          <button
            className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); setEditingNote(true); }}
          >
            <StickyNote className="size-3" />
            Add note
          </button>
        ) : null}

        <Separator className="bg-zinc-800/60" />

        {/* Actions — simplified to two buttons */}
        <div className="flex items-center gap-1.5">
          {/* Smart Open button */}
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              "transition-colors",
              openState === "success"
                ? "text-emerald-400"
                : "text-zinc-400 hover:text-zinc-100"
            )}
            disabled={openState === "loading" || openDisabled}
            title={openTooltip}
            onClick={(e) => {
              e.stopPropagation();
              handleOpen();
            }}
          >
            {openLabel}
          </Button>

          {/* View conversation (if not already expanded) */}
          {!expanded && (
            <Button
              variant="ghost"
              size="xs"
              className="text-zinc-400 hover:text-zinc-100"
              title="View conversation history"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              View Chat
            </Button>
          )}

          {/* Summarize / Update Summary */}
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              "transition-colors",
              summarizeState === "success" ? "text-emerald-400" :
              summarizeState === "error" ? "text-red-400" :
              summarizeState === "loading" ? "text-zinc-500" :
              "text-zinc-400 hover:text-zinc-100"
            )}
            disabled={summarizeState === "loading" || (hasSummary && session.chars_since_summary === 0)}
            title={hasSummary && session.chars_since_summary === 0 ? "No new messages since last summary" : hasSummary ? "Update summary with new messages. Summaries also auto-update at content checkpoints." : "Generate summary (uses Gemini). After this, summaries auto-update at content checkpoints."}
            onClick={(e) => {
              e.stopPropagation();
              handleSummarize();
            }}
          >
            {summarizeState === "loading" ? "Summarizing..." :
             summarizeState === "success" ? "Done" :
             summarizeState === "error" ? "Failed" :
             hasSummary ? "Update Summary" : "Summarize"}{" "}
            <span className="text-zinc-600 font-normal">
              {summarizeState === "idle" && estimateSummarizeCost(false)}
            </span>
          </Button>

          {/* Re-summarize — wipes and regenerates from scratch */}
          {hasSummary && (
            <Button
              variant="ghost"
              size="xs"
              className="text-zinc-500 hover:text-amber-400 transition-colors"
              title="Wipe summary and regenerate from the full session"
              disabled={summarizeState === "loading"}
              onClick={async (e) => {
                e.stopPropagation();
                setSummarizeState("loading");
                setSummarizeError("");
                try {
                  await fetch(`/api/sessions/${session.session_id}/summary`, { method: "DELETE" });
                  const res = await fetch(`/api/sessions/${session.session_id}/summarize`, { method: "POST" });
                  if (!res.ok) {
                    const data = await res.json().catch(() => ({ error: "Re-summarize failed" }));
                    throw new Error(data.error || `Failed (${res.status})`);
                  }
                  setSummarizeState("success");
                  setTimeout(() => setSummarizeState("idle"), 3000);
                } catch (e) {
                  setSummarizeState("error");
                  setSummarizeError(e instanceof Error ? e.message : "Re-summarize failed");
                  setTimeout(() => { setSummarizeState("idle"); setSummarizeError(""); }, 5000);
                }
              }}
            >
              Re-summarize{" "}
              <span className="text-zinc-600 font-normal">
                {estimateSummarizeCost(true)}
              </span>
            </Button>
          )}

          <div className="flex-1" />

          {/* Kill */}
          {isAlive && (
            <Button
              variant="ghost"
              size="xs"
              className={cn(
                "transition-colors",
                confirmKill
                  ? "text-red-400 bg-red-950/40 hover:bg-red-950/60 hover:text-red-300"
                  : "text-zinc-500 hover:text-red-400"
              )}
              disabled={killState === "loading"}
              title={confirmKill ? "Click again to confirm kill" : "Kill this session"}
              onClick={(e) => {
                e.stopPropagation();
                handleKill();
              }}
            >
              {killState === "loading"
                ? "Killing..."
                : confirmKill
                  ? "Confirm Kill"
                  : "Kill"}
            </Button>
          )}
        </div>

        {/* Errors */}
        {(killError || openError || summarizeError) && (
          <div className="space-y-0.5">
            {killError && <p className="text-xs text-red-400">Kill: {killError}</p>}
            {openError && <p className="text-xs text-red-400">{openError}</p>}
            {summarizeError && <p className="text-xs text-red-400">{summarizeError}</p>}
          </div>
        )}
      </CardContent>

      {/* Expanded conversation view with reply input */}
      {expanded && (
        <>
          <Separator className="bg-zinc-800/60" />
          <CardContent className="pt-0 relative">
            {/* Collapse button — sticky at top right */}
            <div className="flex justify-end py-1">
              <Button
                variant="ghost"
                size="xs"
                className="text-zinc-500 hover:text-zinc-300"
                title="Collapse conversation"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                }}
              >
                <X className="size-3.5 mr-1" />
                Close
              </Button>
            </div>
            <ConversationView
              sessionId={session.session_id}
              managed={isManaged}
              isAlive={isAlive}
              sessionStatus={session.status}
            />
          </CardContent>
        </>
      )}
    </Card>
  );
}
