"use client";

import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/lib/types";

const statusConfig: Record<
  SessionStatus,
  { label: string; className: string; pulse: boolean }
> = {
  working: {
    label: "Working",
    className: "bg-emerald-500/20 text-emerald-400 ring-emerald-500/30",
    pulse: true,
  },
  input: {
    label: "Input",
    className: "bg-amber-500/20 text-amber-300 ring-amber-500/30",
    pulse: true,
  },
  idle: {
    label: "Idle",
    className: "bg-zinc-700 text-zinc-300 ring-zinc-600",
    pulse: false,
  },
  new: {
    label: "New",
    className: "bg-blue-500/20 text-blue-300 ring-blue-500/30",
    pulse: false,
  },
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        config.className
      )}
    >
      {config.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              status === "working" ? "bg-emerald-400" : "bg-amber-400"
            )}
          />
          <span
            className={cn(
              "relative inline-flex h-1.5 w-1.5 rounded-full",
              status === "working" ? "bg-emerald-400" : "bg-amber-400"
            )}
          />
        </span>
      )}
      {config.label}
    </span>
  );
}
