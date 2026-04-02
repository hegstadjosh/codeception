"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VoiceButton } from "./voice-button";
import { cn } from "@/lib/utils";
import type { ManagerResponse, ManagerAction } from "@/lib/types";

interface CommandBarProps {
  voiceEnabled?: boolean;
  ttsEnabled?: boolean;
}

/** Execute a manager action against the session API */
async function executeAction(
  action: ManagerAction
): Promise<{ ok: boolean; message: string }> {
  try {
    let url: string;
    let method = "POST";
    let body: string | undefined;

    switch (action.type) {
      case "send_message":
        if (!action.session_id) return { ok: false, message: "No session_id for send_message" };
        url = `/api/sessions/${action.session_id}/reply`;
        body = JSON.stringify({ text: action.text ?? "" });
        break;
      case "kill":
        if (!action.session_id) return { ok: false, message: "No session_id for kill" };
        url = `/api/sessions/${action.session_id}/kill`;
        break;
      case "focus":
        if (!action.session_id) return { ok: false, message: "No session_id for focus" };
        url = `/api/sessions/${action.session_id}/focus`;
        break;
      case "spawn":
        url = "/api/sessions";
        body = JSON.stringify({ cwd: action.cwd, name: action.name });
        break;
      default:
        return { ok: false, message: `Unknown action type: ${(action as ManagerAction).type}` };
    }

    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      return { ok: false, message: errData.error ?? `Action failed (HTTP ${res.status})` };
    }

    return { ok: true, message: `${action.type} executed successfully` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Action execution failed",
    };
  }
}

export function CommandBar({ voiceEnabled = true, ttsEnabled = false }: CommandBarProps) {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on Cmd+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleManagerResponse = useCallback(async (data: ManagerResponse) => {
    setResponse(data.text);
    setActionResult(null);

    // If the manager returned an action, auto-execute it
    if (data.action) {
      const result = await executeAction(data.action);
      setActionResult(result);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setResponse(null);
    setActionResult(null);

    try {
      const res = await fetch("/api/manager/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setResponse(errData.error ?? `HTTP ${res.status}`);
      } else {
        const data: ManagerResponse = await res.json();
        await handleManagerResponse(data);
      }

      setInput("");
    } catch (err) {
      setResponse(
        err instanceof Error ? err.message : "Failed to send command"
      );
    } finally {
      setLoading(false);
    }
  }, [input, loading, handleManagerResponse]);

  // Handle voice transcript: populate input and auto-submit via the voice button's own flow
  const handleVoiceTranscript = useCallback((text: string) => {
    setInput(text);
    setLoading(true);
    setResponse(null);
    setActionResult(null);
  }, []);

  // Handle voice manager response (comes from VoiceButton after sending to manager)
  const handleVoiceResponse = useCallback(
    async (data: ManagerResponse) => {
      setLoading(false);
      await handleManagerResponse(data);
    },
    [handleManagerResponse]
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
      {/* Response area */}
      {(response || actionResult) && (
        <div className="mx-auto max-w-4xl px-4 pt-3">
          {response && (
            <div className="rounded-md border border-zinc-800 bg-zinc-800 px-3 py-2 text-sm text-zinc-200">
              {response}
            </div>
          )}
          {actionResult && (
            <div
              className={cn(
                "mt-1.5 rounded-md border px-3 py-1.5 text-xs",
                actionResult.ok
                  ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-400"
                  : "border-red-900/60 bg-red-950/40 text-red-400"
              )}
            >
              {actionResult.ok ? "\u2713" : "\u2717"} {actionResult.message}
            </div>
          )}
        </div>
      )}

      {/* Input row */}
      <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Ask the manager or type a command..."
            className="h-9 bg-zinc-900/80 border-zinc-800 pr-16 font-sans text-sm text-zinc-200 placeholder:text-zinc-600"
            disabled={loading}
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            {"\u2318"}K
          </kbd>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          disabled={loading || !input.trim()}
          onClick={handleSubmit}
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 animate-spin rounded-full border border-zinc-500 border-t-zinc-200" />
              Sending
            </span>
          ) : (
            "Send"
          )}
        </Button>

        {/* Voice input */}
        <VoiceButton
          voiceEnabled={voiceEnabled}
          ttsEnabled={ttsEnabled}
          onTranscript={handleVoiceTranscript}
          onManagerResponse={handleVoiceResponse}
        />
      </div>
    </div>
  );
}
