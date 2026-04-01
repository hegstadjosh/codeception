"use client";

import { useEffect, useRef } from "react";
import type { Session, SessionStatus } from "./types";

export function useNotifications(sessions: Session[]) {
  const prevStatuses = useRef<Map<string, SessionStatus>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Request notification permission on mount
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, []);

  // Compare statuses and fire notifications
  useEffect(() => {
    const prev = prevStatuses.current;

    for (const session of sessions) {
      const prevStatus = prev.get(session.session_id);
      if (
        prevStatus !== undefined &&
        prevStatus !== "input" &&
        session.status === "input"
      ) {
        // Fire browser notification
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          new Notification("Session needs attention", {
            body: `${session.project_name} is waiting for input`,
            tag: session.session_id,
          });
        }

        // Play beep via AudioContext
        try {
          if (!audioCtxRef.current && typeof AudioContext !== "undefined") {
            audioCtxRef.current = new AudioContext();
          }
          const ctx = audioCtxRef.current;
          if (ctx) {
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.connect(gain);
            gain.connect(ctx.destination);
            oscillator.frequency.value = 440;
            gain.gain.value = 0.1;
            oscillator.start();
            oscillator.stop(ctx.currentTime + 0.15);
          }
        } catch {
          // AudioContext may require user gesture or be unavailable
        }
      }
    }

    // Update previous statuses
    const next = new Map<string, SessionStatus>();
    for (const session of sessions) {
      next.set(session.session_id, session.status);
    }
    prevStatuses.current = next;

    // Update document title with input count
    if (typeof document !== "undefined") {
      const inputCount = sessions.filter((s) => s.status === "input").length;
      document.title =
        inputCount > 0
          ? `(${inputCount} waiting) Claude Manager`
          : "Claude Manager";
    }
  }, [sessions]);
}
