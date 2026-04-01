"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CommandBar() {
  const [input, setInput] = useState("");
  const [response, setResponse] = useState<string | null>(null);
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

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setLoading(true);
    setResponse(null);

    try {
      const res = await fetch("/api/manager/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: text }),
      });
      if (res.status === 404) {
        setResponse("Command endpoint not configured. The manager API is not running.");
      } else {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setResponse(data.response ?? data.error ?? "No response");
      }
      setInput("");
    } catch (err) {
      setResponse(
        err instanceof Error ? err.message : "Failed to send command"
      );
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
      {/* Response area */}
      {response && (
        <div className="mx-auto max-w-4xl px-4 pt-3">
          <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-300">
            {response}
          </div>
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

        {/* Mic button (placeholder) */}
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-zinc-500 hover:text-zinc-300"
          title="Voice input (coming soon)"
          disabled
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
