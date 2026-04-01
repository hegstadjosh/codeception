"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Loader2,
  AlertCircle,
  MessageSquare,
  ArrowDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { ConversationMessage } from "@/lib/types";

interface ConversationViewProps {
  sessionId: string;
}

// ---------- Time formatting ----------

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) {
    return d.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  const month = d.toLocaleString("en-US", { month: "short" });
  const day = d.getDate();
  const time = d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${month} ${day} ${time}`;
}

function fullTimestamp(iso: string): string {
  return new Date(iso).toISOString();
}

// ---------- Markdown renderer ----------

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-1 prose-code:text-[12px] prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-a:text-blue-400 prose-a:underline">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

// ---------- Kind styles ----------

type MessageKind = ConversationMessage["kind"];

const KIND_CONFIG: Record<
  MessageKind,
  {
    label: string;
    labelColor: string;
    bgColor: string;
  }
> = {
  user_text: {
    label: "You",
    labelColor: "text-blue-400",
    bgColor: "bg-blue-950/20 border-blue-900/20",
  },
  assistant_text: {
    label: "Claude",
    labelColor: "text-violet-400",
    bgColor: "bg-violet-950/20 border-violet-900/20",
  },
  tool_call: {
    label: "Tool",
    labelColor: "text-amber-500",
    bgColor: "bg-amber-950/10 border-amber-900/15",
  },
  tool_result: {
    label: "Output",
    labelColor: "text-zinc-500",
    bgColor: "bg-zinc-900/30 border-zinc-800/30",
  },
  thinking: {
    label: "Think",
    labelColor: "text-zinc-600",
    bgColor: "bg-zinc-950/30 border-zinc-800/20",
  },
};

// ---------- Expandable tool result ----------

function ToolResultContent({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const needsTruncation = lines.length > 3;
  const displayText = expanded ? text : lines.slice(0, 3).join("\n");

  return (
    <div>
      <div className="rounded border border-zinc-800/50 bg-zinc-900/40 px-2 py-1 font-mono text-xs text-zinc-500 whitespace-pre-wrap break-all">
        {displayText}
        {!expanded && needsTruncation && (
          <span className="text-zinc-600">...</span>
        )}
      </div>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {expanded ? "show less" : `show more (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
}

// ---------- Thinking block (collapsed by default) ----------

function ThinkingContent({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <span className="italic">[Thinking...]</span>
      </button>
      {expanded && (
        <div className="mt-1 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-xs text-zinc-600 max-h-48 overflow-y-auto whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

// ---------- Content rendering ----------

function renderMessage(msg: ConversationMessage) {
  const { kind, text, tool_name } = msg;

  if (kind === "tool_call" && tool_name) {
    const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;
    return (
      <span className="inline-flex items-center gap-1.5 flex-wrap">
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
    return <ToolResultContent text={text} />;
  }

  if (kind === "thinking") {
    return <ThinkingContent text={text} />;
  }

  if (kind === "user_text") {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }

  // assistant_text
  return <Markdown text={text} />;
}

// ---------- Skeleton loader ----------

function MessageSkeleton() {
  return (
    <div className="space-y-3 px-3 py-4">
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading conversation...</span>
      </div>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex gap-2 py-1 animate-pulse">
          <div className="h-3 w-14 rounded bg-zinc-800/60 shrink-0 mt-1" />
          <div className="h-3 w-10 rounded bg-zinc-800/40 shrink-0 mt-1" />
          <div className="flex-1 space-y-1.5">
            <div
              className="h-3 rounded bg-zinc-800/40"
              style={{ width: `${50 + (i % 3) * 20}%` }}
            />
            {i % 2 === 0 && (
              <div
                className="h-3 rounded bg-zinc-800/30"
                style={{ width: `${30 + (i % 4) * 15}%` }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Hidden tool calls indicator ----------

function HiddenToolIndicator({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 px-3">
      <div className="h-px flex-1 bg-zinc-800/50" />
      <span className="text-[10px] text-zinc-700 whitespace-nowrap">
        {count} tool {count === 1 ? "call" : "calls"} hidden
      </span>
      <div className="h-px flex-1 bg-zinc-800/50" />
    </div>
  );
}

// ---------- Component ----------

export function ConversationView({ sessionId }: ConversationViewProps) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showToolIO, setShowToolIO] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const fetchConversation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchConversation();
  }, [fetchConversation]);

  // Auto-scroll to bottom on first load
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (!loading && messages.length > 0 && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
      // Small delay to allow DOM to settle after render
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      });
    }
  }, [loading, messages.length]);

  // Track scroll position for "Jump to latest" button
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Find the actual scrollable viewport inside ScrollArea
    const viewport = container.querySelector(
      '[data-slot="scroll-area-viewport"]'
    );
    if (!viewport) return;

    function handleScroll() {
      const el = viewport as HTMLElement;
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJumpToLatest(distanceFromBottom > 200);
    }

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [loading]);

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  // Count tool-related messages
  const toolCount = useMemo(
    () =>
      messages.filter(
        (m) =>
          m.kind === "tool_call" ||
          m.kind === "tool_result" ||
          m.kind === "thinking"
      ).length,
    [messages]
  );

  // Build the displayed list, inserting hidden-tool indicators when collapsed
  const displayItems = useMemo(() => {
    if (showToolIO) {
      return messages.map((msg) => ({ type: "message" as const, msg }));
    }

    const items: (
      | { type: "message"; msg: ConversationMessage }
      | { type: "hidden"; count: number }
    )[] = [];

    let hiddenRun = 0;
    for (const msg of messages) {
      const isToolish =
        msg.kind === "tool_call" ||
        msg.kind === "tool_result" ||
        msg.kind === "thinking";
      if (isToolish) {
        hiddenRun++;
      } else {
        if (hiddenRun > 0) {
          items.push({ type: "hidden", count: hiddenRun });
          hiddenRun = 0;
        }
        items.push({ type: "message", msg });
      }
    }
    if (hiddenRun > 0) {
      items.push({ type: "hidden", count: hiddenRun });
    }
    return items;
  }, [messages, showToolIO]);

  // ---------- Loading ----------
  if (loading) {
    return <MessageSkeleton />;
  }

  // ---------- Error ----------
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="size-4" />
          <span className="text-sm font-medium">
            Failed to load conversation
          </span>
        </div>
        <p className="text-xs text-zinc-500 max-w-xs text-center">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchConversation}
        >
          Retry
        </Button>
      </div>
    );
  }

  // ---------- Empty ----------
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2 text-zinc-500">
        <MessageSquare className="size-5 text-zinc-600" />
        <span className="text-sm font-medium">No messages yet</span>
        <span className="text-xs text-zinc-600">
          This session hasn&apos;t had any conversation yet
        </span>
      </div>
    );
  }

  // ---------- Conversation ----------
  const hiddenLabel = !showToolIO && toolCount > 0
    ? ` (${toolCount} tool ${toolCount === 1 ? "call" : "calls"} hidden)`
    : "";

  return (
    <div className="flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/50">
        <span className="text-[11px] text-zinc-600">
          {messages.length} messages{hiddenLabel}
        </span>
        <div className="flex items-center gap-2">
          <label
            htmlFor={`tool-toggle-${sessionId}`}
            className="text-[11px] text-zinc-500 cursor-pointer select-none"
          >
            Tool calls
          </label>
          <Switch
            id={`tool-toggle-${sessionId}`}
            size="sm"
            checked={showToolIO}
            onCheckedChange={(checked: boolean) => setShowToolIO(checked)}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="relative" ref={scrollContainerRef}>
        <ScrollArea className="h-[calc(100vh-20rem)] min-h-[300px] max-h-[600px]">
          <div className="space-y-0.5 pb-3 pt-1">
            {displayItems.map((item, i) => {
              if (item.type === "hidden") {
                return <HiddenToolIndicator key={`hidden-${i}`} count={item.count} />;
              }

              const msg = item.msg;
              const config = KIND_CONFIG[msg.kind];
              const isCompact =
                msg.kind === "tool_call" || msg.kind === "tool_result";

              return (
                <div
                  key={`${msg.timestamp}-${i}`}
                  className={cn(
                    "group flex gap-2 px-3",
                    isCompact ? "py-0.5" : "py-1.5",
                    "rounded-sm mx-1",
                    config.bgColor,
                    "border border-transparent",
                    config.bgColor.includes("border-") && config.bgColor
                  )}
                >
                  {/* Label */}
                  <span
                    className={cn(
                      "shrink-0 w-12 text-[11px] font-semibold pt-0.5 select-none",
                      config.labelColor
                    )}
                  >
                    {config.label}
                  </span>

                  {/* Content */}
                  <div className="min-w-0 flex-1 text-sm text-zinc-200 leading-relaxed">
                    {renderMessage(msg)}
                  </div>

                  {/* Timestamp */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        className="shrink-0 font-mono text-[10px] text-zinc-700 pt-0.5 select-none whitespace-nowrap cursor-default"
                      >
                        {formatTimestamp(msg.timestamp)}
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <span className="font-mono text-[10px]">
                          {fullTimestamp(msg.timestamp)}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Jump to latest */}
        {showJumpToLatest && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10">
            <Button
              variant="secondary"
              size="xs"
              onClick={scrollToBottom}
              className="shadow-lg shadow-black/40 gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
            >
              <ArrowDown className="size-3" />
              Jump to latest
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
