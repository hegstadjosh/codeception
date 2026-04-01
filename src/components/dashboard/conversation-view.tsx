"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConversationMessage } from "@/lib/types";

interface ConversationViewProps {
  sessionId: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Render message content — handles all real shapes from Claude Code JSONL:
 * - string (user typed text)
 * - array of blocks: text, thinking, tool_use, tool_result, tool_reference
 */
function renderContent(content: unknown) {
  if (typeof content === "string") {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }
  if (!Array.isArray(content)) return null;

  return content.map((block: Record<string, unknown>, i: number) => {
    if (!block || typeof block !== "object") return null;
    const type = block.type as string;

    if (type === "text") {
      return (
        <span key={i} className="whitespace-pre-wrap">
          {block.text as string}
        </span>
      );
    }

    if (type === "thinking") {
      const text = block.thinking as string;
      return (
        <details key={i} className="mt-1">
          <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-400">
            thinking...
          </summary>
          <div className="mt-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-500 max-h-32 overflow-y-auto">
            {text.length > 500 ? text.slice(0, 500) + "..." : text}
          </div>
        </details>
      );
    }

    if (type === "tool_use") {
      return (
        <Badge
          key={i}
          variant="secondary"
          className="bg-zinc-800 text-zinc-300 text-[11px] font-mono"
        >
          {block.name as string}
        </Badge>
      );
    }

    if (type === "tool_result") {
      const raw = block.content;
      const text =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw.map((r: Record<string, unknown>) => r.tool_name ?? r.text ?? JSON.stringify(r)).join(", ")
            : JSON.stringify(raw);
      const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
      return (
        <div
          key={i}
          className={cn(
            "mt-1 rounded border px-2 py-1 font-mono text-xs",
            block.is_error
              ? "border-red-800/50 bg-red-950/30 text-red-300"
              : "border-zinc-800 bg-zinc-900/50 text-zinc-400"
          )}
        >
          {truncated}
        </div>
      );
    }

    if (type === "tool_reference") {
      return (
        <Badge
          key={i}
          variant="outline"
          className="text-[11px] font-mono text-zinc-500"
        >
          {block.tool_name as string}
        </Badge>
      );
    }

    // Unknown block type — skip silently
    return null;
  });
}

export function ConversationView({ sessionId }: ConversationViewProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchConversation() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setMessages(data.messages ?? []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      }
    }

    fetchConversation();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500 text-sm">
        Loading conversation...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500 text-sm">
        No messages yet
      </div>
    );
  }

  // Filter to only user/assistant messages with content
  const displayMessages = messages.filter(
    (msg) =>
      (msg.type === "user" || msg.type === "assistant") &&
      msg.message?.content != null
  );

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-1 p-3">
        {displayMessages.map((msg) => {
          const isUser = msg.message!.role === "user";

          return (
            <div key={msg.uuid} className="group flex gap-2 py-1.5">
              <span className="shrink-0 font-mono text-[11px] text-zinc-600 pt-0.5 select-none">
                {formatTime(msg.timestamp)}
              </span>
              <span
                className={cn(
                  "shrink-0 w-12 text-[11px] font-medium pt-0.5",
                  isUser ? "text-blue-400" : "text-violet-400"
                )}
              >
                {isUser ? "You" : "Claude"}
              </span>
              <div className="min-w-0 flex-1 text-sm text-zinc-200 leading-relaxed">
                {renderContent(msg.message!.content)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
