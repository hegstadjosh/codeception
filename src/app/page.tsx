"use client";

import { useEffect, useState, useMemo } from "react";
import { SessionCard } from "@/components/dashboard/session-card";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { CommandBar } from "@/components/dashboard/command-bar";
import type { Session, SessionStatus } from "@/lib/types";

/** Priority order for sorting — lower number = higher priority */
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  waiting: 0,
  active: 1,
  idle: 2,
  stale: 3,
  completed: 4,
  dead: 5,
};

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filter, setFilter] = useState<"all" | "waiting" | "active">("all");
  const [error, setError] = useState<string | null>(null);

  // Poll sessions every 3 seconds
  useEffect(() => {
    let active = true;

    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (active) {
          setSessions(data.sessions ?? data ?? []);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch sessions"
          );
        }
      }
    }

    fetchSessions();
    const interval = setInterval(fetchSessions, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let result = sessions;

    if (filter === "waiting") {
      result = sessions.filter((s) => s.status === "waiting");
    } else if (filter === "active") {
      result = sessions.filter((s) => s.status === "active");
    }

    return [...result].sort((a, b) => {
      const pa = STATUS_PRIORITY[a.status] ?? 99;
      const pb = STATUS_PRIORITY[b.status] ?? 99;
      if (pa !== pb) return pa - pb;
      // Within same priority, most recent activity first
      return b.lastActivityAt - a.lastActivityAt;
    });
  }, [sessions, filter]);

  const liveCount = sessions.filter(
    (s) => s.status === "active" || s.status === "waiting" || s.status === "idle"
  ).length;

  return (
    <div className="flex flex-1 flex-col min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">
              Claude Manager
            </h1>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
              {liveCount} live
            </span>
          </div>
          <FilterBar
            sessions={sessions}
            activeFilter={filter}
            onFilterChange={setFilter}
          />
        </div>
      </header>

      {/* Session list */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-4 pb-24">
        {error && (
          <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {filteredSessions.length === 0 && !error ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
            <p className="text-sm">
              {filter === "all"
                ? "No sessions found"
                : `No ${filter} sessions`}
            </p>
            <p className="mt-1 text-xs text-zinc-700">
              Sessions will appear here when Claude Code is running
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))}
          </div>
        )}
      </main>

      {/* Command bar */}
      <CommandBar />
    </div>
  );
}
