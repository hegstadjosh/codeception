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
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { Session } from "@/lib/types";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
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
  onTogglePin?: (id: string) => void;
}

export function SessionCard({ session, isPinned = false, onTogglePin }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [killState, setKillState] = useState<ActionState>("idle");
  const [killError, setKillError] = useState("");
  const [openState, setOpenState] = useState<ActionState>("idle");
  const [openError, setOpenError] = useState("");
  const killTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isManaged = session.managed !== false;
  const isAlive = session.status === "working" || session.status === "input" || session.status === "new";

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

  // Open button label + tooltip — different for managed vs unmanaged
  let openLabel: string;
  let openTooltip: string;

  if (openState === "loading") {
    openLabel = "Opening...";
    openTooltip = "";
  } else if (openState === "success") {
    openLabel = "Opened";
    openTooltip = "";
  } else if (!isAlive) {
    openLabel = "Resume in Terminal";
    openTooltip = "Resume this session in a new tmux terminal (full control: reply, status detection)";
  } else if (isManaged) {
    openLabel = "Switch to Terminal";
    openTooltip = "Open the terminal window for this session";
  } else {
    // Alive but unmanaged — explain, don't auto-kill
    openLabel = "Running in Terminal";
    openTooltip = "This session is in a regular terminal — limited features. Close it there and click Resume here to get full control (reply, status detection).";
  }

  return (
    <Card
      size="sm"
      className={cn(
        "transition-colors hover:ring-zinc-700/80",
        // Managed + alive: full color with green left accent
        isManaged && isAlive && "bg-zinc-900/60 ring-zinc-800/80 border-l-2 border-l-emerald-500/50",
        // Unmanaged + alive: muted/cooler background
        !isManaged && isAlive && "bg-zinc-900/40 ring-zinc-800/60 opacity-90",
        // Dead sessions: most muted
        !isAlive && "bg-zinc-950/60 ring-zinc-800/50 opacity-75",
        expanded && "ring-zinc-600/60",
        isPinned && "border-l-2 border-l-amber-500/60"
      )}
    >
      {/* Header row — always clickable to expand/collapse */}
      <CardHeader
        className="pb-0 cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Expand/collapse chevron */}
          {expanded ? (
            <ChevronDown className="size-3.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-zinc-500 shrink-0" />
          )}
          <CardTitle className="truncate text-sm font-semibold text-zinc-100">
            {session.project_name}
          </CardTitle>
          {session.relative_dir && (
            <span className="text-[11px] text-zinc-500">{session.relative_dir}</span>
          )}
          <StatusBadge status={session.status} managed={isManaged} />
          {!isManaged && isAlive && (
            <span className="text-[11px] text-zinc-500" title="Running in a regular terminal, not managed via tmux">
              &#x1f441;
            </span>
          )}
          {session.branch && (
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
              {session.branch}
            </span>
          )}
        </div>
        <CardAction>
          {onTogglePin && (
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

      {/* Summary + metadata (always visible) */}
      <CardContent className="space-y-1.5 pt-0">
        {/* Tier 3: Overview */}
        <p className="text-[11px] text-zinc-600 leading-snug">
          {session.summary?.overview || "No summary yet"}
        </p>

        {/* Tier 2: Current task */}
        {session.summary?.current_task && (
          <p className="text-xs text-zinc-400 leading-snug">
            {session.summary.current_task}
          </p>
        )}

        {/* Tier 1: Latest */}
        {session.summary?.latest && (
          <p className="text-[13px] font-medium text-zinc-200 leading-snug">
            {session.summary.latest}
          </p>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-3 pt-1">
          <span className="font-mono text-[10px] text-zinc-600">
            {session.session_id.slice(0, 8)}
          </span>
          <span className="text-[10px] text-zinc-500">
            {session.model}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            {session.tokens}
          </span>
          {!isManaged && (
            <span className="text-[10px] text-zinc-600 italic" title="Running in a regular terminal, not tmux. Some features limited.">
              terminal
            </span>
          )}
        </div>

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
            disabled={openState === "loading"}
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
        {(killError || openError) && (
          <div className="space-y-0.5">
            {killError && <p className="text-xs text-red-400">Kill: {killError}</p>}
            {openError && <p className="text-xs text-red-400">{openError}</p>}
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
            />
          </CardContent>
        </>
      )}
    </Card>
  );
}
