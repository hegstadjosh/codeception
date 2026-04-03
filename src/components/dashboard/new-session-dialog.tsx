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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DirectoryBrowser } from "./directory-browser";

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

export function NewSessionDialog({ open, onOpenChange, onCreated }: NewSessionDialogProps) {
  const [cwd, setCwd] = useState("");
  const [name, setName] = useState("");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [permissionMode, setPermissionMode] = useState<"default" | "skip" | "plan">("default");
  const [extraFlags, setExtraFlags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!cwd.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      // Build flags string
      const flagParts: string[] = [];
      if (permissionMode === "skip") flagParts.push("--dangerously-skip-permissions");
      else if (permissionMode === "plan") flagParts.push("--permission-mode plan");
      if (extraFlags.trim()) flagParts.push(extraFlags.trim());
      const flags = flagParts.join(" ") || undefined;

      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: cwd.trim(),
          name: name.trim() || undefined,
          flags,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const result = await res.json().catch(() => ({}));
      const promptText = initialPrompt.trim();

      // Success — close, reset, and trigger immediate refresh
      onOpenChange(false);
      setCwd("");
      setName("");
      setInitialPrompt("");
      setPermissionMode("default");
      setExtraFlags("");
      setError(null);
      onCreated?.();

      // If an initial prompt was provided, send it after a delay to let Claude boot.
      // The create response returns session_name (tmux name), not session_id.
      // We poll /api/sessions to find the session by its tmux name, then send the prompt.
      if (promptText && result.session_name) {
        const tmuxName = result.session_name;
        setTimeout(async () => {
          try {
            const sessRes = await fetch("/api/sessions");
            if (sessRes.ok) {
              const sessData = await sessRes.json();
              const sess = (sessData.sessions ?? []).find(
                (s: { tmux_session: string | null }) => s.tmux_session === tmuxName
              );
              if (sess?.session_id) {
                await fetch(`/api/sessions/${sess.session_id}/reply`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text: promptText }),
                });
              }
            }
          } catch {
            // Best-effort — session may not be ready yet
          }
        }, 4000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  }, [cwd, name, initialPrompt, permissionMode, extraFlags, loading, onOpenChange, onCreated]);

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

          {/* Initial prompt */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-zinc-300">
              Initial prompt{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </Label>
            <Textarea
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="What should this session work on?"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 text-sm min-h-[80px] resize-y"
            />
          </div>

          {/* Permission mode */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-zinc-300">Permission mode</Label>
            <Select value={permissionMode} onValueChange={(v) => setPermissionMode(v as "default" | "skip" | "plan")}>
              <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                <SelectItem value="default" className="text-zinc-200">Default (ask for approval)</SelectItem>
                <SelectItem value="plan" className="text-zinc-200">Plan mode (approve plans only)</SelectItem>
                <SelectItem value="skip" className="text-zinc-200 text-red-400">Skip permissions (dangerous)</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[10px] text-zinc-600">
              {permissionMode === "skip" && "Runs with --dangerously-skip-permissions. Use for autonomous builds."}
              {permissionMode === "plan" && "Agent submits plans for approval before executing."}
              {permissionMode === "default" && "Agent asks for tool approval as needed."}
            </span>
          </div>

          {/* Extra CLI flags */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm text-zinc-300">
              Extra flags{" "}
              <span className="text-zinc-600 font-normal">(optional)</span>
            </Label>
            <Input
              value={extraFlags}
              onChange={(e) => setExtraFlags(e.target.value)}
              placeholder="--model sonnet --effort high"
              className="bg-zinc-900 border-zinc-700 text-zinc-200 text-xs font-mono"
            />
            <span className="text-[10px] text-zinc-600">
              Appended to the claude command. See docs for available flags.
            </span>
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
