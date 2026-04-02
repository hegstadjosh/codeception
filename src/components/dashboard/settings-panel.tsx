"use client";

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
}: SettingsPanelProps) {
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
