"use client";

import { useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DirectoryBrowser } from "./directory-browser";

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function NewSessionDialog({ open, onOpenChange, onCreated }: NewSessionDialogProps) {
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!cwd.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: cwd.trim(),
          name: name.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // Success — close, reset, and trigger immediate refresh
      onOpenChange(false);
      setCwd("");
      setName("");
      setError(null);
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  }, [cwd, name, loading, onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="overflow-y-auto bg-zinc-950 border-zinc-800 w-full sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle className="text-zinc-100">New Session</SheetTitle>
          <SheetDescription className="text-zinc-500">
            Browse to a project directory, then launch Claude Code
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* Directory browser */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-zinc-300">Project directory</Label>
            <DirectoryBrowser value="~" onChange={setCwd} />
          </div>

          {/* Session name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-zinc-300">
              Session name{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-generated from directory"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <Button
            onClick={handleCreate}
            disabled={loading || !cwd.trim()}
            className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-zinc-900" />
                Creating...
              </span>
            ) : (
              "Create Session Here"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
