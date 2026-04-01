"use client";

import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/lib/types";

const statusConfig: Record<
  SessionStatus,
  { label: string; className: string; dotColor: string; pulse: boolean; tooltip: string }
> = {
  working: {
    label: "Working",
    className: "bg-emerald-500/20 text-emerald-400 ring-emerald-500/30",
    dotColor: "bg-emerald-400",
    pulse: true,
    tooltip: "Claude is actively generating a response or running tools",
  },
  input: {
    label: "Needs Input",
    className: "bg-amber-500/20 text-amber-300 ring-amber-500/30",
    dotColor: "bg-amber-400",
    pulse: true,
    tooltip: "Waiting for your approval or response",
  },
  idle: {
    label: "Idle",
    className: "bg-zinc-700 text-zinc-300 ring-zinc-600",
    dotColor: "bg-zinc-400",
    pulse: false,
    tooltip: "Waiting for your next prompt",
  },
  new: {
    label: "New",
    className: "bg-blue-500/20 text-blue-300 ring-blue-500/30",
    dotColor: "bg-blue-400",
    pulse: false,
    tooltip: "Session started, no interaction yet",
  },
};

interface StatusBadgeProps {
  status: SessionStatus;
  managed?: boolean;
}

export function StatusBadge({ status, managed = true }: StatusBadgeProps) {
  const config = statusConfig[status];
  const unmanagedSuffix = !managed ? " (terminal)" : "";
  const unmanagedTooltip = !managed
    ? ". Running in a regular terminal. Status detection is approximate."
    : "";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        config.className
      )}
      title={config.tooltip + unmanagedTooltip}
    >
      <span className="relative flex h-1.5 w-1.5">
        {config.pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              config.dotColor
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            config.dotColor
          )}
        />
      </span>
      {config.label}{unmanagedSuffix}
    </span>
  );
}
