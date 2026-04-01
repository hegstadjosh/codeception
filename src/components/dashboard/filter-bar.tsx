"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Session, FilterMode } from "@/lib/types";

interface FilterBarProps {
  sessions: Session[];
  activeFilter: FilterMode;
  onFilterChange: (filter: FilterMode) => void;
}

export function FilterBar({
  sessions,
  activeFilter,
  onFilterChange,
}: FilterBarProps) {
  const inputCount = sessions.filter((s) => s.status === "input").length;
  const workingCount = sessions.filter((s) => s.status === "working").length;
  const projectCount = new Set(sessions.map((s) => s.project_name)).size;

  return (
    <Tabs
      value={activeFilter}
      onValueChange={(val) => onFilterChange(val as FilterMode)}
    >
      <TabsList className="bg-zinc-900 border border-zinc-800">
        <TabsTrigger value="all" className="data-active:bg-zinc-800">
          All
          <span className="ml-1 text-[11px] text-zinc-500">
            {sessions.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="input" className="data-active:bg-zinc-800">
          <span className={inputCount > 0 ? "text-amber-400" : ""}>
            Needs Input
          </span>
          {inputCount > 0 ? (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[11px] font-semibold text-amber-400">
              {inputCount}
            </span>
          ) : (
            <span className="ml-1 text-[11px] text-zinc-500">0</span>
          )}
        </TabsTrigger>
        <TabsTrigger value="working" className="data-active:bg-zinc-800">
          Working
          <span className="ml-1 text-[11px] text-zinc-500">{workingCount}</span>
        </TabsTrigger>
        <TabsTrigger value="by-project" className="data-active:bg-zinc-800">
          By Project
          <span className="ml-1 text-[11px] text-zinc-500">{projectCount}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
