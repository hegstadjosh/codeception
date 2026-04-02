"use client";

import { useState, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronRight,
  Folder,
  FolderGit2,
  FileText,
  ArrowUp,
  Home,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DirEntry {
  name: string;
  is_dir: boolean;
}

interface ListResponse {
  path: string;
  absolute_path: string;
  is_git_repo: boolean;
  entries: DirEntry[];
  error?: string;
}

interface DirectoryBrowserProps {
  value: string;
  onChange: (path: string) => void;
}

export function DirectoryBrowser({ value, onChange }: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState(value || "~");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [displayPath, setDisplayPath] = useState("~");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fs/list?path=${encodeURIComponent(path)}`);
      const data: ListResponse = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setEntries(data.entries);
      setIsGitRepo(data.is_git_repo);
      setDisplayPath(data.path);
      setCurrentPath(data.path);
      onChange(data.absolute_path);
    } catch {
      setError("Failed to browse filesystem");
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    fetchDir(currentPath);
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigateTo = useCallback(
    (name: string) => {
      const newPath =
        currentPath === "~" ? `~/${name}` : `${currentPath}/${name}`;
      fetchDir(newPath);
    },
    [currentPath, fetchDir]
  );

  const navigateUp = useCallback(() => {
    const parts = currentPath.split("/");
    if (parts.length <= 1) return;
    parts.pop();
    const parent = parts.join("/") || "/";
    fetchDir(parent);
  }, [currentPath, fetchDir]);

  const navigateHome = useCallback(() => {
    fetchDir("~");
  }, [fetchDir]);

  const handleManualGo = useCallback(() => {
    if (manualInput.trim()) {
      fetchDir(manualInput.trim());
      setManualInput("");
      setShowManualInput(false);
    }
  }, [manualInput, fetchDir]);

  // Split path into clickable breadcrumbs
  const breadcrumbs = displayPath.split("/").filter(Boolean);
  if (displayPath.startsWith("~")) {
    breadcrumbs[0] = "~";
  }

  const dirs = entries.filter((e) => e.is_dir);
  const files = entries.filter((e) => !e.is_dir);

  return (
    <div className="flex flex-col gap-2">
      {/* Breadcrumb path bar */}
      <div className="flex items-center gap-1 rounded-md bg-zinc-900 border border-zinc-700/50 px-2 py-1.5 min-h-[36px]">
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
          onClick={navigateHome}
          title="Home (~)"
        >
          <Home className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
          onClick={navigateUp}
          title="Go up"
        >
          <ArrowUp className="size-3.5" />
        </Button>

        <div className="flex items-center gap-0.5 overflow-x-auto flex-1 mx-1">
          {breadcrumbs.map((crumb, i) => {
            const pathUpTo = breadcrumbs.slice(0, i + 1).join("/");
            return (
              <span key={i} className="flex items-center shrink-0">
                {i > 0 && (
                  <ChevronRight className="size-3 text-zinc-600 mx-0.5" />
                )}
                <button
                  className="text-[12px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded px-1 py-0.5 transition-colors"
                  onClick={() => fetchDir(pathUpTo)}
                >
                  {crumb}
                </button>
              </span>
            );
          })}
        </div>

        {isGitRepo && (
          <span className="shrink-0 rounded bg-emerald-900/30 border border-emerald-700/30 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            git repo
          </span>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
          onClick={() => fetchDir(currentPath)}
          title="Refresh"
        >
          <RefreshCw className={cn("size-3", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Manual path input toggle */}
      {showManualInput ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="/exact/path/here"
            className="flex-1 bg-zinc-900 border-zinc-700 text-zinc-200 font-mono text-xs h-8"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleManualGo();
              if (e.key === "Escape") setShowManualInput(false);
            }}
          />
          <Button
            size="sm"
            className="h-8 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs"
            onClick={handleManualGo}
          >
            Go
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-zinc-500 hover:text-zinc-300 text-xs"
            onClick={() => setShowManualInput(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <button
          className="text-[11px] text-zinc-600 hover:text-zinc-400 text-left transition-colors"
          onClick={() => {
            setManualInput(currentPath);
            setShowManualInput(true);
          }}
        >
          or type a path directly...
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Directory listing */}
      <ScrollArea className="h-[320px] rounded-md border border-zinc-800 bg-zinc-950">
        <div className="p-1">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
            </div>
          ) : entries.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">
              Empty directory
            </p>
          ) : (
            <>
              {/* Directories */}
              {dirs.map((entry) => (
                <button
                  key={entry.name}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/60 group"
                  onDoubleClick={() => navigateTo(entry.name)}
                  onClick={() => navigateTo(entry.name)}
                >
                  {entry.name === ".git" ? (
                    <FolderGit2 className="size-4 text-emerald-500/70 shrink-0" />
                  ) : (
                    <Folder className="size-4 text-blue-400/70 shrink-0" />
                  )}
                  <span className="text-sm text-zinc-300 truncate">
                    {entry.name}
                  </span>
                  <ChevronRight className="size-3 text-zinc-700 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}

              {/* Files (muted, non-interactive) */}
              {files.length > 0 && dirs.length > 0 && (
                <div className="mx-2 my-1 border-t border-zinc-800/40" />
              )}
              {files.map((entry) => (
                <div
                  key={entry.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1 opacity-40"
                >
                  <FileText className="size-3.5 text-zinc-600 shrink-0" />
                  <span className="text-xs text-zinc-500 truncate">
                    {entry.name}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Selected path display */}
      <div className="flex items-center gap-2 rounded-md bg-zinc-900/50 border border-zinc-800/50 px-3 py-2">
        <span className="text-[11px] text-zinc-500 shrink-0">Selected:</span>
        <span className="font-mono text-xs text-zinc-300 truncate">
          {displayPath}
        </span>
      </div>
    </div>
  );
}
