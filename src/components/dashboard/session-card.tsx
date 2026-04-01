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

function relativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
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
}

export function SessionCard({ session }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);

  const handleKill = useCallback(async () => {
    if (!confirmKill) {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    try {
      await fetch(`/api/sessions/${session.id}/kill`, { method: "POST" });
    } catch {
      // silently fail for now
    }
    setConfirmKill(false);
  }, [confirmKill, session.id]);

  const handleReply = useCallback(() => {
    // Will be wired to command bar or reply sheet later
  }, []);

  const handleOpenTerminal = useCallback(() => {
    // Will open terminal via API later
  }, []);

  return (
    <Card
      size="sm"
      className={cn(
        "bg-zinc-900/60 ring-zinc-800/80 transition-colors hover:ring-zinc-700/80 cursor-pointer",
        expanded && "ring-zinc-600/60"
      )}
    >
      {/* Header row */}
      <CardHeader
        className="pb-0 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <CardTitle className="truncate text-sm font-semibold text-zinc-100">
            {session.projectName}
          </CardTitle>
          <StatusBadge status={session.status} />
          {session.gitBranch && (
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
              {session.gitBranch}
            </span>
          )}
        </div>
        <CardAction>
          <span className="font-mono text-[11px] text-zinc-500">
            {relativeTime(session.lastActivityAt)}
          </span>
        </CardAction>
      </CardHeader>

      {/* Summary tiers */}
      <CardContent className="space-y-1.5 pt-0">
        {/* Tier 3: Overview */}
        <p className="text-xs text-zinc-500 leading-snug">
          {session.summaryOverview || "No summary yet"}
        </p>

        {/* Tier 2: Current task */}
        {session.summaryTask && (
          <p className="text-xs text-zinc-400 leading-snug">
            {session.summaryTask}
          </p>
        )}

        {/* Tier 1: Latest message (emphasized) */}
        {session.summaryLatest && (
          <p className="text-[13px] text-zinc-200 leading-snug">
            {session.summaryLatest}
          </p>
        )}

        {/* Last user prompt */}
        {session.lastUserPrompt && (
          <div className="mt-1 rounded border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
            <p className="font-mono text-[11px] text-zinc-500 leading-relaxed line-clamp-2">
              {session.lastUserPrompt}
            </p>
          </div>
        )}

        {/* Session ID + message count */}
        <div className="flex items-center gap-3 pt-1">
          <span className="font-mono text-[10px] text-zinc-600">
            {session.id.slice(0, 8)}
          </span>
          <span className="text-[10px] text-zinc-600">
            {session.messageCount} messages
          </span>
        </div>

        <Separator className="bg-zinc-800/60" />

        {/* Actions row */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            className="text-zinc-400 hover:text-zinc-100"
            onClick={(e) => {
              e.stopPropagation();
              handleReply();
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
              handleOpenTerminal();
            }}
          >
            Terminal
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
            <ConversationView sessionId={session.id} />
          </CardContent>
        </>
      )}
    </Card>
  );
}
