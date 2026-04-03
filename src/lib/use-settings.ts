"use client";

import { useState, useEffect } from "react";
import type { DashboardSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

const STORAGE_KEY = "codeception-settings";

export function useSettings(): [
  DashboardSettings,
  (update: Partial<DashboardSettings>) => void,
] {
  const [settings, setSettings] = useState<DashboardSettings>(DEFAULT_SETTINGS);

  // Read from localStorage after hydration
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<DashboardSettings>;
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch {
      // Corrupted storage — fall back to defaults
    }
  }, []);

  const updateSettings = (update: Partial<DashboardSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...update };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage full or unavailable
      }
      return next;
    });
  };

  return [settings, updateSettings];
}
