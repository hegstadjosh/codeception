"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { SessionCard } from "@/components/dashboard/session-card";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ProjectGroup } from "@/components/dashboard/project-group";
import { CommandBar } from "@/components/dashboard/command-bar";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { useNotifications } from "@/lib/use-notifications";
import { useSettings } from "@/lib/use-settings";
import type { Session, SessionStatus, FilterMode } from "@/lib/types";

/** Priority order for sorting — lower number = higher priority */
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  waiting: 0,
  active: 1,
  idle: 2,
  stale: 3,
  completed: 4,
  dead: 5,
};

const PINNED_STORAGE_KEY = "claude-manager-pinned";

function loadPinnedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch {
    // ignore corrupt data
  }
  return new Set();
}

function savePinnedIds(ids: Set<string>) {
  localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...ids]));
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedIds());
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, updateSettings] = useSettings();

  useNotifications(sessions);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      savePinnedIds(next);
      return next;
    });
  }, []);

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
    const interval = setInterval(fetchSessions, settings.pollIntervalMs);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [settings.pollIntervalMs]);

  // Sort helper: pinned first, then by status priority, then by last activity
  const sortSessions = useCallback(
    (list: Session[]) =>
      [...list].sort((a, b) => {
        const aPinned = pinnedIds.has(a.id) ? 0 : 1;
        const bPinned = pinnedIds.has(b.id) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;

        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        if (pa !== pb) return pa - pb;

        return b.lastActivityAt - a.lastActivityAt;
      }),
    [pinnedIds]
  );

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let result = sessions;

    if (filter === "waiting") {
      result = sessions.filter((s) => s.status === "waiting");
    } else if (filter === "active") {
      result = sessions.filter((s) => s.status === "active");
    }

    return sortSessions(result);
  }, [sessions, filter, sortSessions]);

  // Group sessions by project for "by-project" view
  const projectGroups = useMemo(() => {
    if (filter !== "by-project") return null;

    const groups = new Map<string, Session[]>();
    for (const session of sessions) {
      const key = session.projectName;
      const list = groups.get(key);
      if (list) {
        list.push(session);
      } else {
        groups.set(key, [session]);
      }
    }

    // Sort groups: groups with waiting/active sessions first, then alphabetically
    return [...groups.entries()]
      .sort(([nameA, sessionsA], [nameB, sessionsB]) => {
        const aHasUrgent = sessionsA.some(
          (s) => s.status === "waiting" || s.status === "active"
        );
        const bHasUrgent = sessionsB.some(
          (s) => s.status === "waiting" || s.status === "active"
        );
        if (aHasUrgent !== bHasUrgent) return aHasUrgent ? -1 : 1;
        return nameA.localeCompare(nameB);
      })
      .map(([name, groupSessions]) => ({
        name,
        sessions: sortSessions(groupSessions),
      }));
  }, [sessions, filter, sortSessions]);

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
          <div className="flex items-center gap-2">
            <FilterBar
              sessions={sessions}
              activeFilter={filter}
              onFilterChange={setFilter}
            />
            <button
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Session list */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-4 pb-24">
        {error && (
          <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {filter === "by-project" && projectGroups ? (
          projectGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
              <p className="text-sm">No sessions found</p>
              <p className="mt-1 text-xs text-zinc-700">
                Sessions will appear here when Claude Code is running
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {projectGroups.map((group) => (
                <ProjectGroup
                  key={group.name}
                  projectName={group.name}
                  sessions={group.sessions}
                  pinnedIds={pinnedIds}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          )
        ) : filteredSessions.length === 0 && !error ? (
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
              <SessionCard
                key={session.id}
                session={session}
                isPinned={pinnedIds.has(session.id)}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        )}
      </main>

      {/* Command bar */}
      <CommandBar />

      {/* Settings panel */}
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={updateSettings}
      />
    </div>
  );
}
