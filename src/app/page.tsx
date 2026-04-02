"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { SessionCard } from "@/components/dashboard/session-card";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { ProjectGroup } from "@/components/dashboard/project-group";
import { CommandBar } from "@/components/dashboard/command-bar";
import { SettingsPanel } from "@/components/dashboard/settings-panel";
import { NewSessionDialog } from "@/components/dashboard/new-session-dialog";
import { GroupManager } from "@/components/dashboard/group-manager";
import { useNotifications } from "@/lib/use-notifications";
import { useSettings } from "@/lib/use-settings";
import { useWebSocket } from "@/lib/use-websocket";
import type { Session, SessionStatus, FilterMode, Room, Group } from "@/lib/types";

/** Priority order for sorting — lower number = higher priority */
const STATUS_PRIORITY: Record<SessionStatus, number> = {
  input: 0,
  working: 1,
  new: 2,
  idle: 3,
};

/** Filter out ghost sessions — stale session files with no real activity */
function isRealSession(s: Session): boolean {
  // Sessions with a known project and any activity are always shown
  if (s.project_name !== "unknown") return true;
  // "unknown" sessions with tokens or recent activity are kept
  if (s.token_ratio > 0) return true;
  if (s.last_activity) return true;
  // Managed (tmux) sessions are always shown even if brand new
  if (s.managed) return true;
  // Everything else is a ghost — stale session file, no conversation, no project
  return false;
}

const PINNED_STORAGE_KEY = "claude-manager-pinned";
const MINIMIZED_STORAGE_KEY = "claude-manager-minimized";

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

function loadMinimizedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(MINIMIZED_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveMinimizedIds(ids: Set<string>) {
  localStorage.setItem(MINIMIZED_STORAGE_KEY, JSON.stringify([...ids]));
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
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(() => loadMinimizedIds());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedText, setLastUpdatedText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, updateSettings] = useSettings();
  const fetchCountRef = useRef(0);
  const fetchSessionsRef = useRef<() => void>(() => {});

  // WebSocket: triggers immediate fetch on session:update events
  const { connected: wsConnected } = useWebSocket({
    onUpdate: () => {
      fetchSessionsRef.current();
    },
  });

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

  const toggleMinimize = useCallback((id: string) => {
    setMinimizedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveMinimizedIds(next);
      return next;
    });
  }, []);

  // Poll sessions every N seconds
  useEffect(() => {
    let active = true;

    async function fetchSessions() {
      try {
        const [sessRes, groupRes] = await Promise.all([
          fetch("/api/sessions"),
          fetch("/api/groups"),
        ]);
        if (!sessRes.ok) throw new Error(`HTTP ${sessRes.status}`);
        const data = await sessRes.json();
        if (active) {
          setSessions((data.sessions ?? []).filter(isRealSession));
          setRooms(data.rooms ?? []);
          setError(null);
          setLastUpdated(new Date());
          fetchCountRef.current += 1;
        }
        if (groupRes.ok) {
          const groupData = await groupRes.json();
          if (active) setGroups(groupData.groups ?? []);
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

    fetchSessionsRef.current = fetchSessions;
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

  // Search helper: case-insensitive substring match across key fields
  const matchesSearch = useCallback(
    (s: Session, query: string): boolean => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        s.project_name.toLowerCase().includes(q) ||
        (s.branch?.toLowerCase().includes(q) ?? false) ||
        s.session_id.toLowerCase().startsWith(q) ||
        s.cwd.toLowerCase().includes(q)
      );
    },
    []
  );

  // Filter and sort sessions (status filter + search, intersected)
  const filteredSessions = useMemo(() => {
    let result = sessions;

    if (filter === "input") {
      result = result.filter((s) => s.status === "input");
    } else if (filter === "working") {
      result = result.filter((s) => s.status === "working");
    }

    if (searchQuery) {
      result = result.filter((s) => matchesSearch(s, searchQuery));
    }

    return sortSessions(result);
  }, [sessions, filter, searchQuery, sortSessions, matchesSearch]);

  // Group sessions by room for "by-project" view
  const projectGroups = useMemo(() => {
    if (filter !== "by-project") return null;

    // rooms is an array of { room_id, sessions: Session[] } from recon
    const groups: { name: string; sessions: Session[] }[] = rooms.map((room) => ({
      name: room.room_id,
      sessions: sortSessions(
        searchQuery
          ? room.sessions.filter((s) => matchesSearch(s, searchQuery))
          : room.sessions
      ),
    })).filter((g) => g.sessions.length > 0); // hide empty groups after search

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
  }, [rooms, filter, searchQuery, sortSessions, matchesSearch]);

  // Group sessions by custom group for "by-group" view
  const customGroups = useMemo(() => {
    if (filter !== "by-group") return null;
    const grouped: { name: string; color: string | null; sessions: Session[] }[] = [];
    const assigned = new Set<string>();

    for (const group of groups) {
      const groupSessions = sessions.filter((s) =>
        group.session_ids.includes(s.session_id) &&
        (!searchQuery || matchesSearch(s, searchQuery))
      );
      if (groupSessions.length > 0) {
        grouped.push({
          name: group.name,
          color: group.color,
          sessions: sortSessions(groupSessions),
        });
        groupSessions.forEach((s) => assigned.add(s.session_id));
      }
    }

    // Ungrouped sessions
    const ungrouped = sessions.filter(
      (s) => !assigned.has(s.session_id) &&
        (!searchQuery || matchesSearch(s, searchQuery))
    );
    if (ungrouped.length > 0) {
      grouped.push({
        name: "Ungrouped",
        color: null,
        sessions: sortSessions(ungrouped),
      });
    }

    return grouped;
  }, [sessions, groups, filter, searchQuery, sortSessions, matchesSearch]);

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
            {/* WebSocket connection indicator */}
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${wsConnected ? "bg-emerald-500" : "bg-red-500"}`}
              title={wsConnected ? "WebSocket connected" : "WebSocket disconnected"}
            />
          </div>
          <div className="flex items-center gap-2">
            <FilterBar
              sessions={sessions}
              activeFilter={filter}
              onFilterChange={setFilter}
              groupCount={groups.length}
            />
            {/* Groups button */}
            <button
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              onClick={() => setGroupsOpen(true)}
              title="Manage Groups"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/></svg>
            </button>
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

      {/* Search bar */}
      <div className="sticky top-[53px] z-30 border-b border-zinc-800/50 bg-zinc-950/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-2">
          <div className="relative flex-1">
            {/* Magnifying glass icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="w-full rounded-md bg-zinc-800 py-1.5 pl-8 pr-8 text-sm text-zinc-200 placeholder:text-zinc-500 outline-none ring-1 ring-zinc-700/50 focus:ring-zinc-600 transition-colors"
            />
            {/* Clear button */}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Clear search"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Session list */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-4 pb-24">
        {/* Non-fatal error banner (recon was up but had a blip) */}
        {error && sessions.length > 0 && (
          <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {filter === "by-group" && customGroups ? (
          customGroups.length === 0 ? (
            <EmptyState message="No sessions in any group" />
          ) : (
            <div className="space-y-4">
              {customGroups.map((group) => (
                <div
                  key={group.name}
                  className="rounded-lg border border-zinc-800/60"
                  style={group.color ? { borderLeftWidth: 3, borderLeftColor: group.color } : undefined}
                >
                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/40 rounded-t-lg">
                    <span className="text-sm font-medium text-zinc-300">{group.name}</span>
                    <span className="text-[11px] text-zinc-500">{group.sessions.length}</span>
                  </div>
                  <div className="space-y-2 p-2">
                    {group.sessions.map((session) => (
                      <SessionCard
                        key={session.session_id}
                        session={session}
                        isPinned={pinnedIds.has(session.session_id)}
                        isMinimized={minimizedIds.has(session.session_id)}
                        onTogglePin={togglePin}
                        onToggleMinimize={toggleMinimize}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : filter === "by-project" && projectGroups ? (
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
                  minimizedIds={minimizedIds}
                  onTogglePin={togglePin}
                  onToggleMinimize={toggleMinimize}
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
                isMinimized={minimizedIds.has(session.session_id)}
                onTogglePin={togglePin}
                onToggleMinimize={toggleMinimize}
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
      <CommandBar
        voiceEnabled={settings.voiceEnabled}
        ttsEnabled={settings.ttsEnabled}
      />

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
        onCreated={() => {
          // Immediate fetch so the new session appears at the top right away
          fetchSessionsRef.current();
          // Scroll to top where "new" sessions sort
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      {/* Group manager */}
      <GroupManager
        open={groupsOpen}
        onOpenChange={setGroupsOpen}
        groups={groups}
        sessions={sessions}
        onGroupsChanged={() => fetchSessionsRef.current()}
      />
    </div>
  );
}
