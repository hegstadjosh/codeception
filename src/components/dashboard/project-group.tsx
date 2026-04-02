"use client";

import { useState } from "react";
import { SessionCard } from "./session-card";
import { StatusBadge } from "./status-badge";
import type { Session } from "@/lib/types";

interface ProjectGroupProps {
  projectName: string;
  sessions: Session[];
  pinnedIds: Set<string>;
  minimizedIds: Set<string>;
  onTogglePin: (id: string) => void;
  onToggleMinimize: (id: string) => void;
}

export function ProjectGroup({
  projectName,
  sessions,
  pinnedIds,
  minimizedIds,
  onTogglePin,
  onToggleMinimize,
}: ProjectGroupProps) {
  const [expanded, setExpanded] = useState(true);

  const hasWorking = sessions.some((s) => s.status === "working");
  const hasInput = sessions.some((s) => s.status === "input");

  return (
    <div className="space-y-2">
      {/* Group header */}
      <button
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-xs text-zinc-500 w-4">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
        <span className="text-sm font-semibold text-zinc-200">
          {projectName}
        </span>
        <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-400">
          {sessions.length}
        </span>
        {hasWorking && <StatusBadge status="working" />}
        {hasInput && !hasWorking && <StatusBadge status="input" />}
      </button>

      {/* Sessions */}
      {expanded && (
        <div className="space-y-2 pl-6">
          {sessions.map((session) => (
            <SessionCard
              key={session.session_id}
              session={session}
              isPinned={pinnedIds.has(session.session_id)}
              isMinimized={minimizedIds.has(session.session_id)}
              onTogglePin={onTogglePin}
              onToggleMinimize={onToggleMinimize}
            />
          ))}
        </div>
      )}
    </div>
  );
}
