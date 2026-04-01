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

// ---------- Message classification ----------

type MessageKind =
  | "user-text"      // Real human message
  | "assistant-text"  // Claude's text response
  | "tool-call"       // Claude calling a tool
  | "tool-result"     // Tool output returned to Claude
  | "thinking"        // Claude's thinking block
  | "skip";           // Don't display

/** Patterns that indicate system/protocol content, not real conversation */
const SYSTEM_PATTERNS = [
  /^<teammate-message/,
  /^<task-notification/,
  /^<system-reminder/,
  /^<local-command-stdout/,
  /^\{"type":"idle_notification"/,
  /^\{"type":"shutdown/,
  /^\{"type":"task_assignment"/,
  /^<command-name>/,
];

function isSystemContent(text: string): boolean {
  return SYSTEM_PATTERNS.some((p) => p.test(text.trim()));
}

/** Extract the visible text from content, stripping system tags */
function extractVisibleText(content: string): string {
  // Strip <system-reminder>...</system-reminder> blocks
  let cleaned = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "");
  // Strip <teammate-message ...>...</teammate-message> blocks
  cleaned = cleaned.replace(/<teammate-message[\s\S]*?<\/teammate-message>/g, "");
  // Strip <task-notification>...</task-notification>
  cleaned = cleaned.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "");
  // Strip <local-command-stdout>...</local-command-stdout>
  cleaned = cleaned.replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "");
  // Strip <command-name>...</command-name> and <command-message>...</command-message> and <command-args>...</command-args>
  cleaned = cleaned.replace(/<command-\w+>[\s\S]*?<\/command-\w+>/g, "");
  return cleaned.trim();
}

function classifyMessage(msg: ConversationMessage): MessageKind {
  const content = msg.message?.content;
  if (content == null) return "skip";

  const role = msg.message?.role;

  // String content — check for system/protocol messages
  if (typeof content === "string") {
    // If entire message is system content, skip it
    if (isSystemContent(content)) return "skip";
    // If it contains system tags mixed with real text, still show as user-text
    // (extractVisibleText will clean it at render time)
    return "user-text";
  }

  if (!Array.isArray(content)) return "skip";
  if (content.length === 0) return "skip";

  // Check for text blocks that are entirely system content
  const textBlocks = content.filter(
    (b: Record<string, unknown>) => b.type === "text"
  );
  if (
    role === "user" &&
    textBlocks.length > 0 &&
    textBlocks.every((b: Record<string, unknown>) =>
      isSystemContent(String(b.text ?? ""))
    )
  ) {
    // Check if there are also non-text blocks (tool_result etc)
    const hasOther = content.some(
      (b: Record<string, unknown>) => b.type !== "text"
    );
    if (!hasOther) return "skip";
  }

  // Check what block types are present
  const blockTypes = new Set(
    content.map((b: Record<string, unknown>) => b.type as string)
  );

  if (role === "assistant") {
    if (blockTypes.has("tool_use")) return "tool-call";
    if (blockTypes.has("thinking") && !blockTypes.has("text")) return "thinking";
    return "assistant-text";
  }

  if (role === "user") {
    if (blockTypes.has("tool_result")) return "tool-result";
    return "user-text";
  }

  return "skip";
}

const KIND_STYLES: Record<MessageKind, { label: string; color: string }> = {
  "user-text":      { label: "You",    color: "text-blue-400" },
  "assistant-text":  { label: "Claude", color: "text-violet-400" },
  "tool-call":       { label: "Tool",   color: "text-amber-500" },
  "tool-result":     { label: "Output", color: "text-zinc-500" },
  "thinking":        { label: "Think",  color: "text-zinc-600" },
  "skip":            { label: "",       color: "" },
};

// ---------- Content rendering ----------

function renderContent(content: unknown, kind: MessageKind) {
  if (typeof content === "string") {
    const cleaned = kind === "user-text" ? extractVisibleText(content) : content;
    if (!cleaned) return null;
    if (kind === "user-text") {
      return <span className="whitespace-pre-wrap">{cleaned}</span>;
    }
    return <Markdown text={cleaned} />;
  }
  if (!Array.isArray(content)) return null;

  return content.map((block: Record<string, unknown>, i: number) => {
    if (!block || typeof block !== "object") return null;
    const type = block.type as string;

    if (type === "text") {
      const raw = block.text as string;
      // Clean system tags from user text
      const text = kind === "user-text" ? extractVisibleText(raw) : raw;
      if (!text) return null;
      if (kind === "user-text") {
        return (
          <span key={i} className="whitespace-pre-wrap">
            {text}
          </span>
        );
      }
      return <Markdown key={i} text={text} />;
    }

    if (type === "thinking") {
      const text = block.thinking as string;
      return (
        <details key={i}>
          <summary className="cursor-pointer text-[11px] text-zinc-600 hover:text-zinc-500">
            {text.length > 80 ? text.slice(0, 80) + "..." : text}
          </summary>
          <div className="mt-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
            {text}
          </div>
        </details>
      );
    }

    if (type === "tool_use") {
      const name = block.name as string;
      const input = block.input as Record<string, unknown> | undefined;
      // Show a short preview of the input
      let preview = "";
      if (input) {
        if (input.command) preview = String(input.command).slice(0, 60);
        else if (input.file_path) preview = String(input.file_path).split("/").pop() ?? "";
        else if (input.pattern) preview = String(input.pattern);
        else if (input.query) preview = String(input.query).slice(0, 60);
      }
      return (
        <span key={i} className="inline-flex items-center gap-1.5">
          <Badge
            variant="secondary"
            className="bg-amber-950/40 text-amber-400/80 text-[11px] font-mono border-amber-900/30"
          >
            {name}
          </Badge>
          {preview && (
            <span className="font-mono text-[11px] text-zinc-500 truncate max-w-xs">
              {preview}
            </span>
          )}
        </span>
      );
    }

    if (type === "tool_result") {
      const raw = block.content;
      const isError = block.is_error as boolean;
      const text =
        typeof raw === "string"
          ? raw
          : Array.isArray(raw)
            ? raw
                .map((r: Record<string, unknown>) =>
                  r.tool_name ?? r.text ?? JSON.stringify(r)
                )
                .join(", ")
            : raw == null
              ? "(empty)"
              : JSON.stringify(raw);
      const truncated = text.length > 300 ? text.slice(0, 300) + "..." : text;
      return (
        <div
          key={i}
          className={cn(
            "rounded border px-2 py-1 font-mono text-xs whitespace-pre-wrap",
            isError
              ? "border-red-800/50 bg-red-950/30 text-red-400"
              : "border-zinc-800/50 bg-zinc-900/40 text-zinc-500"
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

    return null;
  });
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

  // Classify all messages
  const classified = messages
    .map((msg) => ({ msg, kind: classifyMessage(msg) }))
    .filter(({ kind }) => kind !== "skip");

  // By default hide tool-call and tool-result (noisy). Toggle to show.
  const displayed = showToolIO
    ? classified
    : classified.filter(
        ({ kind }) => kind !== "tool-call" && kind !== "tool-result" && kind !== "thinking"
      );

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] text-zinc-600">
          {classified.length} messages
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
          {displayed.map(({ msg, kind }) => {
            const style = KIND_STYLES[kind];

            return (
              <div key={msg.uuid} className="group flex gap-2 py-1">
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
                  {renderContent(msg.message!.content, kind)}
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
