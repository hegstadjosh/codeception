"use client";

import { useEffect, useRef, useState } from "react";
import type { Session } from "./types";

interface SessionSnapshot {
  ids: Set<string>;
  statuses: Map<string, string>;
}

export function useSessionHistory(sessions: Session[]) {
  const prevSnapshot = useRef<SessionSnapshot>({ ids: new Set(), statuses: new Map() });
  const [newSessionIds, setNewSessionIds] = useState<Set<string>>(new Set());
  const [changedStatusIds, setChangedStatusIds] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const prev = prevSnapshot.current;
    const currentIds = new Set(sessions.map((s) => s.id));
    const currentStatuses = new Map(sessions.map((s) => [s.id, s.status] as const));

    // Detect new sessions
    const freshNew: string[] = [];
    sessions.forEach((s) => {
      if (!prev.ids.has(s.id)) {
        freshNew.push(s.id);
      }
    });

    // Detect status changes
    const freshChanged = new Set<string>();
    currentStatuses.forEach((status, id) => {
      const prevStatus = prev.statuses.get(id);
      if (prevStatus !== undefined && prevStatus !== status) {
        freshChanged.add(id);
      }
    });

    // Merge new session IDs with existing ones (don't overwrite ones still within their 5s window)
    if (freshNew.length > 0) {
      setNewSessionIds((prev) => {
        const merged = new Set(prev);
        freshNew.forEach((id) => merged.add(id));
        return merged;
      });

      // Set 5s timers to clear each new session ID
      freshNew.forEach((id) => {
        const existing = timersRef.current.get(id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          setNewSessionIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          timersRef.current.delete(id);
        }, 5000);
        timersRef.current.set(id, timer);
      });
    }

    setChangedStatusIds(freshChanged);

    // Update snapshot
    prevSnapshot.current = { ids: currentIds, statuses: currentStatuses };
  }, [sessions]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return { newSessionIds, changedStatusIds };
}
