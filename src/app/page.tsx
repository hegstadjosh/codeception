"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { SessionCard } from "@/components/dashboard/session-card";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ProjectGroup } from "@/components/dashboard/project-group";
import { CommandBar } from "@/components/dashboard/command-bar";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { NewSessionDialog } from "@/components/dashboard/new-session-dialog";
import { useNotifications } from "@/lib/use-notifications";
import { useSettings } from "@/lib/use-settings";
import type { Session, SessionStatus, FilterMode, Room } from "@/lib/types";

/** Priority order for sorting — lower number = higher priority */
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  input: 0,
  working: 1,
  idle: 2,
  new: 3,
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

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() => loadPinnedIds());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [settings, updateSettings] = useSettings();
  const fetchCountRef = useRef(0);

  useNotifications(sessions, settings);

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

  // Poll sessions every N seconds
  useEffect(() => {
    let active = true;

    async function fetchSessions() {
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (active) {
          setSessions(data.sessions ?? []);
          setRooms(data.rooms ?? []);
          setError(null);
          setLastUpdated(new Date());
          fetchCountRef.current += 1;
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Failed to fetch sessions"
          );
        }
      } finally {
        if (active) {
          setLoading(false);
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

  // Update "last updated" text every second
  useEffect(() => {
    if (!lastUpdated) return;
    setLastUpdatedText(timeAgo(lastUpdated));
    const interval = setInterval(() => {
      setLastUpdated((prev) => {
        if (prev) setLastUpdatedText(timeAgo(prev));
        return prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  // Sort helper: pinned first, then by status priority, then by last activity
  const sortSessions = useCallback(
    (list: Session[]) =>
      [...list].sort((a, b) => {
        const aPinned = pinnedIds.has(a.session_id) ? 0 : 1;
        const bPinned = pinnedIds.has(b.session_id) ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;

        const pa = STATUS_PRIORITY[a.status] ?? 99;
        const pb = STATUS_PRIORITY[b.status] ?? 99;
        if (pa !== pb) return pa - pb;

        const aTime = a.last_activity ? new Date(a.last_activity).getTime() : 0;
        const bTime = b.last_activity ? new Date(b.last_activity).getTime() : 0;
        return bTime - aTime;
      }),
    [pinnedIds]
  );

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let result = sessions;

    if (filter === "input") {
      result = sessions.filter((s) => s.status === "input");
    } else if (filter === "working") {
      result = sessions.filter((s) => s.status === "working");
    }

    return sortSessions(result);
  }, [sessions, filter, sortSessions]);

  // Group sessions by room for "by-project" view
  const projectGroups = useMemo(() => {
    if (filter !== "by-project") return null;

    // rooms is an array of { room_id, sessions: Session[] } from recon
    const groups: { name: string; sessions: Session[] }[] = rooms.map((room) => ({
      name: room.room_id,
      sessions: sortSessions(room.sessions),
    }));

    // Sort groups: groups with input/working sessions first, then alphabetically
    return groups.sort((a, b) => {
      const aHasUrgent = a.sessions.some(
        (s) => s.status === "input" || s.status === "working"
      );
      const bHasUrgent = b.sessions.some(
        (s) => s.status === "input" || s.status === "working"
      );
      if (aHasUrgent !== bHasUrgent) return aHasUrgent ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [rooms, filter, sortSessions]);

  const liveCount = sessions.filter(
    (s) => s.status === "working" || s.status === "input" || s.status === "idle"
  ).length;

  // --- Loading state ---
  if (loading) {
    return (
      <div className="flex flex-1 flex-col min-h-screen">
        <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                Claude Manager
              </h1>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-4">
          <div className="flex flex-col items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
            <p className="mt-4 text-sm text-zinc-500">Loading sessions...</p>
          </div>
        </main>
      </div>
    );
  }

  // --- Recon serve down error state ---
  if (error && sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col min-h-screen">
        <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                Claude Manager
              </h1>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-4">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-full max-w-md rounded-lg border border-red-900/60 bg-red-950/40 p-6 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-900/40">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-red-400"
                >
                  <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-red-300">
                Cannot connect to recon serve
              </h2>
              <p className="mt-2 text-sm text-red-400/80">
                Make sure <code className="rounded bg-red-900/40 px-1.5 py-0.5 font-mono text-xs text-red-300">recon serve</code> is running on port 3100
              </p>
              <p className="mt-1 text-xs text-zinc-600">{error}</p>
              <button
                onClick={() => window.location.reload()}
                className="mt-5 rounded-md bg-red-900/50 px-4 py-2 text-sm font-medium text-red-200 transition-colors hover:bg-red-900/70"
              >
                Retry
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --- Empty state helper ---
  function EmptyState({ message }: { message: string }) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mb-4 text-zinc-700"
        >
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="m9 12 2 2 4-4" />
        </svg>
        <p className="text-sm font-medium text-zinc-400">{message}</p>
        <p className="mt-1.5 max-w-xs text-center text-xs text-zinc-600">
          Start a session from the button above, or launch{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-400">claude</code>{" "}
          in any terminal
        </p>
        <button
          onClick={() => setNewSessionOpen(true)}
          className="mt-5 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
        >
          New Session
        </button>
      </div>
    );
  }

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
            {/* New Session button */}
            <button
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              onClick={() => setNewSessionOpen(true)}
              title="New Session"
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
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
            </button>
            {/* Settings button */}
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
        {/* Non-fatal error banner (recon was up but had a blip) */}
        {error && sessions.length > 0 && (
          <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {filter === "by-project" && projectGroups ? (
          projectGroups.length === 0 ? (
            <EmptyState message="No Claude Code sessions detected" />
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
          <EmptyState
            message={
              filter === "all"
                ? "No Claude Code sessions detected"
                : `No ${filter === "input" ? "sessions needing input" : "working sessions"}`
            }
          />
        ) : (
          <div className="space-y-2">
            {filteredSessions.map((session) => (
              <SessionCard
                key={session.session_id}
                session={session}
                isPinned={pinnedIds.has(session.session_id)}
                onTogglePin={togglePin}
              />
            ))}
          </div>
        )}
      </main>

      {/* Auto-refresh indicator */}
      {lastUpdatedText && (
        <div className="fixed bottom-[68px] right-4 z-40 flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-2.5 py-1 text-[11px] text-zinc-500 backdrop-blur-sm border border-zinc-800/50">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-40" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Updated {lastUpdatedText}
        </div>
      )}

      {/* Command bar */}
      <CommandBar />

      {/* Settings panel */}
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSettingsChange={updateSettings}
      />

      {/* New session dialog */}
      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
      />
    </div>
  );
}
