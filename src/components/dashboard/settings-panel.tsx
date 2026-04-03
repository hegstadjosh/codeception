"use client";

import { useState, useCallback } from "react";
import type { DashboardSettings } from "@/lib/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: DashboardSettings;
  onSettingsChange: (update: Partial<DashboardSettings>) => void;
  hasGeminiKey: boolean;
  onGeminiKeyChanged: () => void;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs text-zinc-400 uppercase tracking-wider font-medium">
      {children}
    </h3>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm text-zinc-300 font-normal">{label}</Label>
      {children}
    </div>
  );
}

const POLL_OPTIONS = [
  { value: 1000, label: "1s" },
  { value: 2000, label: "2s" },
  { value: 3000, label: "3s" },
  { value: 5000, label: "5s" },
  { value: 10000, label: "10s" },
];

export function SettingsPanel({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  hasGeminiKey,
  onGeminiKeyChanged,
}: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  const handleSaveKey = useCallback(async () => {
    if (!apiKey.trim()) return;
    setKeySaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gemini_api_key: apiKey.trim() }),
      });
      if (res.ok) {
        setKeySaved(true);
        setApiKey("");
        onGeminiKeyChanged();
        setTimeout(() => setKeySaved(false), 3000);
      }
    } catch {
      // ignore
    } finally {
      setKeySaving(false);
    }
  }, [apiKey, onGeminiKeyChanged]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto bg-zinc-950 border-zinc-800">
        <SheetHeader>
          <SheetTitle className="text-zinc-100">Settings</SheetTitle>
          <SheetDescription className="text-zinc-500">
            Configure dashboard behavior
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          {/* Polling */}
          <section className="flex flex-col gap-3">
            <SectionHeading>Polling</SectionHeading>

            <SettingRow label="Poll interval">
              <Select
                value={String(settings.pollIntervalMs)}
                onValueChange={(val) =>
                  onSettingsChange({ pollIntervalMs: Number(val) })
                }
              >
                <SelectTrigger className="w-28 bg-zinc-900 border-zinc-700 text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {POLL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          </section>

          <Separator className="bg-zinc-800" />

          {/* Notifications */}
          <section className="flex flex-col gap-3">
            <SectionHeading>Notifications</SectionHeading>

            <SettingRow label="Browser notifications">
              <Switch
                checked={settings.notificationBrowser}
                onCheckedChange={(val) =>
                  onSettingsChange({ notificationBrowser: val })
                }
              />
            </SettingRow>

            <SettingRow label="Sound alerts">
              <Switch
                checked={settings.notificationSound}
                onCheckedChange={(val) =>
                  onSettingsChange({ notificationSound: val })
                }
              />
            </SettingRow>
          </section>

          <Separator className="bg-zinc-800" />

          {/* Voice */}
          <section className="flex flex-col gap-3">
            <SectionHeading>Voice</SectionHeading>

            <SettingRow label="Voice input">
              <Switch
                checked={settings.voiceEnabled}
                onCheckedChange={(val) =>
                  onSettingsChange({ voiceEnabled: val })
                }
              />
            </SettingRow>

            <SettingRow label="Read responses aloud (TTS)">
              <Switch
                checked={settings.ttsEnabled}
                onCheckedChange={(val) =>
                  onSettingsChange({ ttsEnabled: val })
                }
              />
            </SettingRow>
          </section>

          <Separator className="bg-zinc-800" />

          {/* API Keys */}
          <section className="flex flex-col gap-3">
            <SectionHeading>API Keys</SectionHeading>

            <div className="flex flex-col gap-2">
              <Label className="text-sm text-zinc-300 font-normal">
                Gemini API Key
                {hasGeminiKey && (
                  <span className="ml-2 text-[11px] text-emerald-400">configured</span>
                )}
              </Label>
              <p className="text-[11px] text-zinc-500 leading-snug">
                Used for session summarization (Gemini Flash Lite). Get one at{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:text-violet-300 underline"
                >
                  aistudio.google.com
                </a>
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasGeminiKey ? "••••••••  (replace)" : "AI..."}
                  className="h-8 bg-zinc-900 border-zinc-700 text-zinc-200 text-xs font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveKey();
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs shrink-0"
                  disabled={!apiKey.trim() || keySaving}
                  onClick={handleSaveKey}
                >
                  {keySaving ? "Saving..." : keySaved ? "Saved" : "Save"}
                </Button>
              </div>
            </div>
          </section>

          <Separator className="bg-zinc-800" />

          {/* About */}
          <section className="flex flex-col gap-3">
            <SectionHeading>About</SectionHeading>

            <div className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Version</span>
                <span className="text-zinc-300">0.2.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Backend</span>
                <span className="text-zinc-300 font-mono text-xs">
                  recon serve :3100
                </span>
              </div>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
