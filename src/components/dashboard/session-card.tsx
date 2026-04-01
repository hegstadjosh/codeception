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
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyState, setReplyState] = useState<ActionState>("idle");
  const [replyError, setReplyError] = useState("");
  const [killState, setKillState] = useState<ActionState>("idle");
  const [killError, setKillError] = useState("");
  const [focusState, setFocusState] = useState<ActionState>("idle");
  const [focusError, setFocusError] = useState("");
  const [resumeState, setResumeState] = useState<ActionState>("idle");
  const [resumeError, setResumeError] = useState("");
  const killTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isManaged = session.managed !== false;

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

  const handleSendReply = useCallback(async () => {
    const text = replyText.trim();
    if (!text) return;
    setReplyState("loading");
    setReplyError("");
    try {
      const res = await fetch(`/api/sessions/${session.session_id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Reply failed" }));
        throw new Error(data.error || `Reply failed (${res.status})`);
      }
      setReplyText("");
      setReplyState("success");
      setTimeout(() => {
        setReplyState("idle");
        setReplyOpen(false);
      }, 1500);
    } catch (e) {
      setReplyState("error");
      setReplyError(e instanceof Error ? e.message : "Reply failed");
    }
  }, [replyText, session.session_id]);

  const handleFocus = useCallback(async () => {
    setFocusState("loading");
    setFocusError("");
    try {
      const res = await fetch(`/api/sessions/${session.session_id}/focus`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Focus failed" }));
        throw new Error(data.error || `Focus failed (${res.status})`);
      }
      setFocusState("idle");
    } catch (e) {
      setFocusState("error");
      setFocusError(e instanceof Error ? e.message : "Focus failed");
    }
  }, [session.session_id]);

  const handleResume = useCallback(async () => {
    setResumeState("loading");
    setResumeError("");
    try {
      const res = await fetch(`/api/sessions/${session.session_id}/resume`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Resume failed" }));
        throw new Error(data.error || `Resume failed (${res.status})`);
      }
      setResumeState("success");
      setTimeout(() => setResumeState("idle"), 2000);
    } catch (e) {
      setResumeState("error");
      setResumeError(e instanceof Error ? e.message : "Resume failed");
    }
  }, [session.session_id]);

  const actionErrors = [
    killError && `Kill: ${killError}`,
    focusError && `Terminal: ${focusError}`,
    resumeError && `Resume: ${resumeError}`,
  ].filter(Boolean);

  return (
    <Card
      size="sm"
      className={cn(
        "bg-zinc-900/60 ring-zinc-800/80 transition-colors hover:ring-zinc-700/80 cursor-pointer",
        expanded && "ring-zinc-600/60",
        isPinned && "border-l-2 border-l-amber-500/60"
      )}
    >
      {/* Header row */}
      <CardHeader
        className="pb-0 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <CardTitle className="truncate text-sm font-semibold text-zinc-100">
            {session.project_name}
          </CardTitle>
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

      {/* Summary tiers */}
      <CardContent className="space-y-1.5 pt-0">
        {/* Tier 3: Overview — dimmer, smaller */}
        <p className="text-[11px] text-zinc-600 leading-snug">
          {session.summary?.overview || "No summary yet"}
        </p>

        {/* Tier 2: Current task — normal weight */}
        {session.summary?.current_task && (
          <p className="text-xs text-zinc-400 leading-snug">
            {session.summary.current_task}
          </p>
        )}

        {/* Tier 1: Latest — emphasized */}
        {session.summary?.latest && (
          <p className="text-[13px] font-medium text-zinc-200 leading-snug">
            {session.summary.latest}
          </p>
        )}

        {/* Session metadata */}
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
        </div>

        <Separator className="bg-zinc-800/60" />

        {/* Inline reply input */}
        {replyOpen && (
          <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSendReply();
                  if (e.key === "Escape") { setReplyOpen(false); setReplyText(""); setReplyError(""); }
                }}
                placeholder="Type a message..."
                className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                autoFocus
                disabled={replyState === "loading"}
              />
              <Button
                variant="ghost"
                size="xs"
                className="text-zinc-400 hover:text-zinc-100"
                onClick={handleSendReply}
                disabled={replyState === "loading" || !replyText.trim()}
                title="Send reply"
              >
                {replyState === "loading" ? "Sending..." : "Send"}
              </Button>
            </div>
            {replyState === "success" && (
              <p className="text-xs text-emerald-400">Sent</p>
            )}
            {replyState === "error" && replyError && (
              <p className="text-xs text-red-400">{replyError}</p>
            )}
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            disabled={!isManaged}
            title={
              isManaged
                ? "Send a reply to this session"
                : "Can only reply to tmux-managed sessions"
            }
            onClick={(e) => {
              e.stopPropagation();
              if (isManaged) {
                setReplyOpen((r) => !r);
                setReplyError("");
              }
            }}
          >
            Reply
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            disabled={focusState === "loading"}
            title={
              isManaged
                ? "Open terminal attached to this tmux session"
                : "Bring Terminal.app to front"
            }
            onClick={(e) => {
              e.stopPropagation();
              handleFocus();
            }}
          >
            {focusState === "loading" ? "Opening..." : "Open Terminal"}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            disabled={resumeState === "loading"}
            title="Resume this session in a new terminal window"
            onClick={(e) => {
              e.stopPropagation();
              handleResume();
            }}
          >
            {resumeState === "loading"
              ? "Resuming..."
              : resumeState === "success"
                ? "Opened in Terminal"
                : "Resume"}
          </Button>
          <div className="flex-1" />
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
        </div>

        {/* Action errors */}
        {actionErrors.length > 0 && (
          <div className="space-y-0.5">
            {actionErrors.map((err) => (
              <p key={err} className="text-xs text-red-400">{err}</p>
            ))}
          </div>
        )}
      </CardContent>

      {/* Expanded conversation view */}
      {expanded && (
        <>
          <Separator className="bg-zinc-800/60" />
          <CardContent className="pt-0">
            <ConversationView sessionId={session.session_id} />
          </CardContent>
        </>
      )}
    </Card>
  );
}
