"use client";

import { useState, useCallback } from "react";
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

interface SessionCardProps {
  session: Session;
  isPinned?: boolean;
  onTogglePin?: (id: string) => void;
}

export function SessionCard({ session, isPinned = false, onTogglePin }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  const handleKill = useCallback(async () => {
    if (!confirmKill) {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    try {
      await fetch(`/api/sessions/${session.session_id}/kill`, { method: "POST" });
    } catch {
      // silently fail for now
    }
    setConfirmKill(false);
  }, [confirmKill, session.session_id]);

  const handleReply = useCallback(async () => {
    const text = replyText.trim();
    if (!text) {
      // Toggle inline reply input
      setReplying((r) => !r);
      return;
    }
    try {
      await fetch(`/api/sessions/${session.session_id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setReplyText("");
      setReplying(false);
    } catch {
      // silently fail for now
    }
  }, [replyText, session.session_id]);

  const handleFocus = useCallback(async () => {
    try {
      await fetch(`/api/sessions/${session.session_id}/focus`, { method: "POST" });
    } catch {
      // silently fail
    }
  }, [session.session_id]);

  const handleResume = useCallback(async () => {
    try {
      await fetch(`/api/sessions/${session.session_id}/resume`, { method: "POST" });
    } catch {
      // silently fail
    }
  }, [session.session_id]);

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
          <StatusBadge status={session.status} />
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
        {/* Tier 3: Overview */}
        <p className="text-xs text-zinc-500 leading-snug">
          {session.summary?.overview || "No summary yet"}
        </p>

        {/* Tier 2: Current task */}
        {session.summary?.current_task && (
          <p className="text-xs text-zinc-400 leading-snug">
            {session.summary.current_task}
          </p>
        )}

        {/* Tier 1: Latest message (emphasized) */}
        {session.summary?.latest && (
          <p className="text-[13px] text-zinc-200 leading-snug">
            {session.summary.latest}
          </p>
        )}

        {/* Session metadata */}
        <div className="flex items-center gap-3 pt-1">
          <span className="font-mono text-[10px] text-zinc-600">
            {session.session_id.slice(0, 8)}
          </span>
          <span className="text-[10px] text-zinc-600">
            {session.tokens}
          </span>
          <span className="text-[10px] text-zinc-600">
            {session.model}
          </span>
        </div>

        <Separator className="bg-zinc-800/60" />

        {/* Inline reply input */}
        {replying && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleReply();
                if (e.key === "Escape") { setReplying(false); setReplyText(""); }
              }}
              placeholder="Type a message..."
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              autoFocus
            />
            <Button
              variant="ghost"
              size="xs"
              className="text-zinc-400 hover:text-zinc-100"
              onClick={handleReply}
            >
              Send
            </Button>
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            onClick={(e) => {
              e.stopPropagation();
              setReplying((r) => !r);
            }}
          >
            Reply
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            onClick={(e) => {
              e.stopPropagation();
              handleFocus();
            }}
          >
            Terminal
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            onClick={(e) => {
              e.stopPropagation();
              handleResume();
            }}
          >
            Resume
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
            onClick={(e) => {
              e.stopPropagation();
              handleKill();
            }}
          >
            {confirmKill ? "Confirm Kill" : "Kill"}
          </Button>
        </div>
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
