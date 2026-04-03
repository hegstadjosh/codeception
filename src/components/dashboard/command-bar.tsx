"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VoiceButton } from "./voice-button";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";

interface ManagerMessage {
  timestamp: string;
  kind: "user_text" | "assistant_text";
  text: string;
}

interface ManagerStatus {
  alive: boolean;
  tmux_session: string | null;
}

interface CommandBarProps {
  voiceEnabled?: boolean;
  ttsEnabled?: boolean;
}

export function CommandBar({ voiceEnabled = true, ttsEnabled = false }: CommandBarProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ManagerMessage[]>([]);
  const [status, setStatus] = useState<ManagerStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Focus input on Cmd+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOverlayVisible(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch manager status on mount
  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/manager/status");
        if (res.ok) {
          const data: ManagerStatus = await res.json();
          setStatus(data);
        }
      } catch {
        setStatus({ alive: false, tmux_session: null });
      }
    }
    checkStatus();
  }, []);

  // Fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/manager/messages?limit=20");
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages ?? []);
        // If we got messages, manager is alive
        if (data.messages?.length > 0) {
          setStatus((prev) => prev ? { ...prev, alive: true } : { alive: true, tmux_session: null });
        }
      }
    } catch {
      // silent — recon may not be running
    }
  }, []);

  // Fetch messages on mount
  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Poll messages every 3s when overlay is visible
  useEffect(() => {
    if (overlayVisible) {
      fetchMessages();
      pollRef.current = setInterval(fetchMessages, 3000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [overlayVisible, fetchMessages]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Show overlay when input is focused
  const handleFocus = useCallback(() => {
    setOverlayVisible(true);
  }, []);

  // Send message to manager
  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    setOverlayVisible(true);

    // Optimistic: add user message immediately
    const optimisticMsg: ManagerMessage = {
      timestamp: new Date().toISOString(),
      kind: "user_text",
      text,
    };
    setMessages((prev) => [...prev, optimisticMsg]);
    setInput("");

    try {
      const res = await fetch("/api/manager/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        // Remove optimistic message on failure
        setMessages((prev) => prev.filter((m) => m !== optimisticMsg));
        setInput(text); // restore input
      } else {
        // Fetch fresh messages to get any immediate response
        setTimeout(fetchMessages, 500);
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m !== optimisticMsg));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, sending, fetchMessages]);

  // Start manager
  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/manager/start", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setStatus({ alive: true, tmux_session: data.session_name ?? null });
        // Start polling for messages
        setTimeout(fetchMessages, 1000);
      }
    } catch {
      // silent
    } finally {
      setStarting(false);
    }
  }, [fetchMessages]);

  // Voice: send transcript as message
  const handleVoiceTranscript = useCallback((text: string) => {
    setInput(text);
  }, []);

  // Voice: after transcript, auto-send
  const handleVoiceResponse = useCallback(async () => {
    // Voice button currently calls /api/manager/command which now proxies to /message
    // Just refresh messages after voice sends
    setTimeout(fetchMessages, 500);
    setSending(false);
  }, [fetchMessages]);

  const managerAlive = status?.alive ?? false;
  const displayMessages = messages.slice(-10);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
      {/* Chat overlay */}
      {overlayVisible && (
        <div className="mx-auto max-w-4xl px-4">
          <div className="relative">
            {/* Manager label + close */}
            <div className="flex items-center justify-between pt-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-400/70">
                Manager
              </span>
              <button
                className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                onClick={() => setOverlayVisible(false)}
              >
                close
              </button>
            </div>

            {/* Messages area with fade mask */}
            <div
              className="max-h-[200px] overflow-y-auto space-y-1.5 pb-1"
              style={{
                maskImage: "linear-gradient(to bottom, transparent 0%, black 25%)",
                WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 25%)",
              }}
            >
              {!managerAlive && (
                <div className="flex items-center justify-center gap-2 py-6">
                  <span className="text-xs text-zinc-500">Manager not running</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-violet-500/30 bg-violet-950/30 text-violet-300 hover:bg-violet-900/40 hover:text-violet-200"
                    disabled={starting}
                    onClick={handleStart}
                  >
                    {starting ? (
                      <span className="flex items-center gap-1.5">
                        <span className="h-3 w-3 animate-spin rounded-full border border-violet-400 border-t-transparent" />
                        Starting...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Play className="size-3" />
                        Start Manager
                      </span>
                    )}
                  </Button>
                </div>
              )}

              {managerAlive && displayMessages.length === 0 && (
                <div className="flex items-center justify-center py-6">
                  <span className="text-xs text-zinc-600 italic">No messages yet</span>
                </div>
              )}

              {displayMessages.map((msg, i) => (
                <div
                  key={`${msg.timestamp}-${i}`}
                  className={cn(
                    "flex",
                    msg.kind === "user_text" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-1.5 text-xs leading-relaxed",
                      msg.kind === "user_text"
                        ? "bg-zinc-800 text-zinc-200"
                        : "bg-violet-900/30 text-zinc-300"
                    )}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
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
            onFocus={handleFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === "Escape") {
                setOverlayVisible(false);
                inputRef.current?.blur();
              }
            }}
            placeholder="Send to manager..."
            className="h-9 bg-zinc-900/80 border-zinc-800 pr-16 font-sans text-sm text-zinc-200 placeholder:text-zinc-600"
            disabled={sending}
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            {"\u2318"}K
          </kbd>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="border-zinc-700 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
          disabled={sending || !input.trim()}
          onClick={handleSubmit}
        >
          {sending ? (
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
