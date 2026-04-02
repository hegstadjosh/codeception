"use client";

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Pencil, Trash2, Plus, Check, X, GripVertical } from "lucide-react";
import type { Group, Session } from "@/lib/types";

/** Preset colors for group accents */
const COLOR_PRESETS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#ec4899", // pink
];

interface GroupManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: Group[];
  sessions: Session[];
  onGroupsChanged: () => void;
}

export function GroupManager({
  open,
  onOpenChange,
  groups,
  sessions,
  onGroupsChanged,
}: GroupManagerProps) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Session assignment state — which group is being configured
  const [assigningGroupId, setAssigningGroupId] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          color: newColor,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Create failed" }));
        throw new Error(data.error || `Create failed (${res.status})`);
      }
      setNewName("");
      setNewColor(null);
      onGroupsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group");
    } finally {
      setCreating(false);
    }
  }, [newName, newColor, onGroupsChanged]);

  const handleDelete = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/groups/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Delete failed" }));
          throw new Error(data.error || `Delete failed (${res.status})`);
        }
        onGroupsChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete group");
      }
    },
    [onGroupsChanged]
  );

  const startEdit = useCallback((group: Group) => {
    setEditingId(group.id);
    setEditName(group.name);
    setEditColor(group.color);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName("");
    setEditColor(null);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          color: editColor,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Update failed" }));
        throw new Error(data.error || `Update failed (${res.status})`);
      }
      setEditingId(null);
      onGroupsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update group");
    } finally {
      setSaving(false);
    }
  }, [editingId, editName, editColor, onGroupsChanged]);

  const toggleSessionInGroup = useCallback(
    async (groupId: string, sessionId: string, currentSessionIds: string[]) => {
      setError(null);
      const isInGroup = currentSessionIds.includes(sessionId);
      const newSessionIds = isInGroup
        ? currentSessionIds.filter((id) => id !== sessionId)
        : [...currentSessionIds, sessionId];

      try {
        const res = await fetch(`/api/groups/${groupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_ids: newSessionIds }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Update failed" }));
          throw new Error(data.error || `Update failed (${res.status})`);
        }
        onGroupsChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update sessions");
      }
    },
    [onGroupsChanged]
  );

  const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md bg-zinc-950 border-zinc-800">
        <SheetHeader>
          <SheetTitle className="text-zinc-100">Manage Groups</SheetTitle>
          <SheetDescription className="text-zinc-500">
            Create custom groups and assign sessions to them.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 px-4 overflow-y-auto">
          <div className="space-y-4 pb-4">
            {/* Error banner */}
            {error && (
              <div className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
                {error}
                <button
                  className="ml-2 text-red-500 hover:text-red-300"
                  onClick={() => setError(null)}
                >
                  dismiss
                </button>
              </div>
            )}

            {/* New group form */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-400">
                New Group
              </label>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Group name..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                  }}
                  className="flex-1 bg-zinc-900 border-zinc-700 text-zinc-100 placeholder:text-zinc-600"
                />
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={creating || !newName.trim()}
                  className="bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                >
                  <Plus className="size-3.5 mr-1" />
                  {creating ? "Adding..." : "Add"}
                </Button>
              </div>
              {/* Color picker */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-500 mr-1">Color:</span>
                <button
                  className={`size-5 rounded-full border-2 transition-colors ${
                    newColor === null
                      ? "border-zinc-400 bg-zinc-800"
                      : "border-zinc-700 bg-zinc-800"
                  }`}
                  onClick={() => setNewColor(null)}
                  title="No color"
                >
                  {newColor === null && (
                    <span className="flex items-center justify-center text-[10px] text-zinc-400">
                      --
                    </span>
                  )}
                </button>
                {COLOR_PRESETS.map((color) => (
                  <button
                    key={color}
                    className={`size-5 rounded-full border-2 transition-colors ${
                      newColor === color ? "border-white" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewColor(color)}
                    title={color}
                  />
                ))}
              </div>
            </div>

            <Separator className="bg-zinc-800/60" />

            {/* Existing groups */}
            {sortedGroups.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-600">
                No groups yet. Create one above.
              </p>
            ) : (
              <div className="space-y-3">
                {sortedGroups.map((group) => {
                  const isEditing = editingId === group.id;
                  const isAssigning = assigningGroupId === group.id;

                  return (
                    <div
                      key={group.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden"
                      style={
                        group.color
                          ? { borderLeftWidth: 3, borderLeftColor: group.color }
                          : undefined
                      }
                    >
                      {/* Group header */}
                      <div className="flex items-center gap-2 px-3 py-2">
                        <GripVertical className="size-3.5 text-zinc-600 shrink-0" />
                        {isEditing ? (
                          <>
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit();
                                if (e.key === "Escape") cancelEdit();
                              }}
                              className="h-7 flex-1 bg-zinc-800 border-zinc-700 text-zinc-100 text-sm"
                              autoFocus
                            />
                            <div className="flex items-center gap-1">
                              {COLOR_PRESETS.map((color) => (
                                <button
                                  key={color}
                                  className={`size-4 rounded-full border transition-colors ${
                                    editColor === color
                                      ? "border-white"
                                      : "border-transparent"
                                  }`}
                                  style={{ backgroundColor: color }}
                                  onClick={() => setEditColor(color)}
                                />
                              ))}
                              <button
                                className={`size-4 rounded-full border transition-colors ${
                                  editColor === null
                                    ? "border-zinc-400"
                                    : "border-zinc-700"
                                } bg-zinc-800`}
                                onClick={() => setEditColor(null)}
                                title="No color"
                              />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={handleSaveEdit}
                              disabled={saving}
                              className="text-emerald-400 hover:text-emerald-300"
                            >
                              <Check className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={cancelEdit}
                              className="text-zinc-500 hover:text-zinc-300"
                            >
                              <X className="size-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm font-medium text-zinc-200 truncate">
                              {group.name}
                            </span>
                            <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 text-[11px]">
                              {group.session_ids.length} sessions
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                setAssigningGroupId(isAssigning ? null : group.id)
                              }
                              className={
                                isAssigning
                                  ? "text-blue-400 hover:text-blue-300"
                                  : "text-zinc-500 hover:text-zinc-300"
                              }
                              title="Assign sessions"
                            >
                              <Plus className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => startEdit(group)}
                              className="text-zinc-500 hover:text-zinc-300"
                              title="Edit group"
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => handleDelete(group.id)}
                              className="text-zinc-500 hover:text-red-400"
                              title="Delete group"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>

                      {/* Session assignment panel */}
                      {isAssigning && (
                        <div className="border-t border-zinc-800 bg-zinc-900/80 px-3 py-2">
                          <p className="mb-2 text-[11px] text-zinc-500">
                            Toggle sessions in this group:
                          </p>
                          {sessions.length === 0 ? (
                            <p className="text-xs text-zinc-600">No sessions available</p>
                          ) : (
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {sessions.map((session) => {
                                const isInGroup = group.session_ids.includes(
                                  session.session_id
                                );
                                return (
                                  <button
                                    key={session.session_id}
                                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                                      isInGroup
                                        ? "bg-zinc-800 text-zinc-200"
                                        : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300"
                                    }`}
                                    onClick={() =>
                                      toggleSessionInGroup(
                                        group.id,
                                        session.session_id,
                                        group.session_ids
                                      )
                                    }
                                  >
                                    <span
                                      className={`flex size-4 items-center justify-center rounded border text-[10px] ${
                                        isInGroup
                                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-400"
                                          : "border-zinc-600"
                                      }`}
                                    >
                                      {isInGroup && <Check className="size-3" />}
                                    </span>
                                    <span className="truncate">
                                      {session.project_name}
                                    </span>
                                    {session.relative_dir && (
                                      <span className="text-[11px] text-zinc-600 truncate">
                                        {session.relative_dir}
                                      </span>
                                    )}
                                    <span className="ml-auto font-mono text-[10px] text-zinc-600">
                                      {session.session_id.slice(0, 8)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
