"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Session } from "@/lib/types";

interface FilterBarProps {
  sessions: Session[];
  activeFilter: "all" | "waiting" | "active";
  onFilterChange: (filter: "all" | "waiting" | "active") => void;
}

export function FilterBar({
  sessions,
  activeFilter,
  onFilterChange,
}: FilterBarProps) {
  const waitingCount = sessions.filter((s) => s.status === "waiting").length;
  const activeCount = sessions.filter((s) => s.status === "active").length;

  return (
    <Tabs
      value={activeFilter}
      onValueChange={(val) =>
        onFilterChange(val as "all" | "waiting" | "active")
      }
    >
      <TabsList className="bg-zinc-900 border border-zinc-800">
        <TabsTrigger value="all" className="data-active:bg-zinc-800">
          All
          <span className="ml-1 text-[11px] text-zinc-500">
            {sessions.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="waiting" className="data-active:bg-zinc-800">
          <span className={waitingCount > 0 ? "text-amber-400" : ""}>
            Waiting
          </span>
          <span
            className={`ml-1 text-[11px] ${
              waitingCount > 0 ? "text-amber-400 font-semibold" : "text-zinc-500"
            }`}
          >
            {waitingCount}
          </span>
        </TabsTrigger>
        <TabsTrigger value="active" className="data-active:bg-zinc-800">
          Active
          <span className="ml-1 text-[11px] text-zinc-500">{activeCount}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
