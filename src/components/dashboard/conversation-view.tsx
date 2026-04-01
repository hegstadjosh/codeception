"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConversationMessage, MessageContent } from "@/lib/types";

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

function renderContent(content: MessageContent[]) {
  return content.map((block, i) => {
    if (block.type === "text") {
      return (
        <span key={i} className="whitespace-pre-wrap">
          {block.text}
        </span>
      );
    }
    if (block.type === "tool_use") {
      return (
        <Badge
          key={i}
          variant="secondary"
          className="bg-zinc-800 text-zinc-300 text-[11px] font-mono"
        >
          {block.name}
        </Badge>
      );
    }
    if (block.type === "tool_result") {
      const text = block.content;
      const truncated =
        text.length > 200 ? text.slice(0, 200) + "..." : text;
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

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-1 p-3">
        {messages.map((msg) => {
          const role = msg.message?.role;
          if (!role || !msg.message?.content) return null;

          const isUser = role === "user";

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
                {renderContent(msg.message.content)}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
