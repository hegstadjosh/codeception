"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
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

// ---------- Markdown renderer ----------

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-code:text-[12px] prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-a:text-blue-400">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

// ---------- Kind styles ----------

type MessageKind = ConversationMessage["kind"];

const KIND_STYLES: Record<MessageKind, { label: string; color: string }> = {
  user_text:      { label: "You",    color: "text-blue-400" },
  assistant_text: { label: "Claude", color: "text-violet-400" },
  tool_call:      { label: "Tool",   color: "text-amber-500" },
  tool_result:    { label: "Output", color: "text-zinc-500" },
  thinking:       { label: "Think",  color: "text-zinc-600" },
};

// ---------- Content rendering ----------

function renderMessage(msg: ConversationMessage) {
  const { kind, text, tool_name } = msg;

  if (kind === "tool_call" && tool_name) {
    const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge
          variant="secondary"
          className="bg-amber-950/40 text-amber-400/80 text-[11px] font-mono border-amber-900/30"
        >
          {tool_name}
        </Badge>
        {preview && (
          <span className="font-mono text-[11px] text-zinc-500 truncate max-w-xs">
            {preview}
          </span>
        )}
      </span>
    );
  }

  if (kind === "tool_result") {
    const truncated = text.length > 300 ? text.slice(0, 300) + "..." : text;
    return (
      <div className="rounded border border-zinc-800/50 bg-zinc-900/40 px-2 py-1 font-mono text-xs text-zinc-500 whitespace-pre-wrap">
        {truncated}
      </div>
    );
  }

  if (kind === "thinking") {
    return (
      <details>
        <summary className="cursor-pointer text-[11px] text-zinc-600 hover:text-zinc-500">
          {text.length > 80 ? text.slice(0, 80) + "..." : text}
        </summary>
        <div className="mt-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {text}
        </div>
      </details>
    );
  }

  if (kind === "user_text") {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  // assistant_text
  return <Markdown text={text} />;
}

// ---------- Component ----------

export function ConversationView({ sessionId }: ConversationViewProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showToolIO, setShowToolIO] = useState(false);
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

  // By default hide tool-call and tool-result (noisy). Toggle to show.
  const displayed = showToolIO
    ? messages
    : messages.filter(
        (m) => m.kind !== "tool_call" && m.kind !== "tool_result" && m.kind !== "thinking"
      );

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] text-zinc-600">
          {messages.length} messages
        </span>
        <button
          onClick={() => setShowToolIO((v) => !v)}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {showToolIO ? "Hide tool calls" : "Show tool calls"}
        </button>
      </div>
      <ScrollArea className="h-[400px]">
        <div className="space-y-0.5 px-3 pb-3">
          {displayed.map((msg, i) => {
            const style = KIND_STYLES[msg.kind];

            return (
              <div key={`${msg.timestamp}-${i}`} className="group flex gap-2 py-1">
                <span className="shrink-0 font-mono text-[11px] text-zinc-700 pt-0.5 select-none w-16">
                  {formatTime(msg.timestamp)}
                </span>
                <span
                  className={cn(
                    "shrink-0 w-12 text-[11px] font-medium pt-0.5",
                    style.color
                  )}
                >
                  {style.label}
                </span>
                <div className="min-w-0 flex-1 text-sm text-zinc-200 leading-relaxed">
                  {renderMessage(msg)}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </div>
  );
}
