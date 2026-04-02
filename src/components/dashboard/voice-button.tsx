"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ManagerResponse } from "@/lib/types";

// Extend Window for vendor-prefixed SpeechRecognition
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface VoiceButtonProps {
  voiceEnabled: boolean;
  ttsEnabled: boolean;
  onTranscript: (text: string) => void;
  onManagerResponse?: (response: ManagerResponse) => void;
}

export function VoiceButton({
  voiceEnabled,
  ttsEnabled,
  onTranscript,
  onManagerResponse,
}: VoiceButtonProps) {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Check for Web Speech API support on mount
  useEffect(() => {
    setSupported(getSpeechRecognition() !== null);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const SpeechRecognitionClass = getSpeechRecognition();
    if (!SpeechRecognitionClass) return;

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setListening(true);
      setTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(final || interim);
    };

    recognition.onend = () => {
      setListening(false);
      // Get the final transcript from the ref closure
      setTranscript((currentTranscript) => {
        if (currentTranscript.trim()) {
          sendToManager(currentTranscript.trim());
        }
        return currentTranscript;
      });
      recognitionRef.current = null;
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" and "aborted" are not real errors
      if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("Speech recognition error:", event.error);
      }
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendToManager = useCallback(
    async (text: string) => {
      onTranscript(text);

      try {
        const res = await fetch("/api/manager/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({
            error: `HTTP ${res.status}`,
          }));
          onManagerResponse?.({
            text: errData.error ?? `HTTP ${res.status}`,
            action: null,
          });
          return;
        }

        const data: ManagerResponse = await res.json();
        onManagerResponse?.(data);

        // TTS: speak the response aloud if enabled
        if (ttsEnabled && data.text && typeof window !== "undefined" && window.speechSynthesis) {
          const utterance = new SpeechSynthesisUtterance(data.text);
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          window.speechSynthesis.speak(utterance);
        }
      } catch (err) {
        onManagerResponse?.({
          text: err instanceof Error ? err.message : "Failed to send command",
          action: null,
        });
      }
    },
    [onTranscript, onManagerResponse, ttsEnabled]
  );

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  }, [listening, stopListening, startListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const isDisabled = !supported || !voiceEnabled;

  return (
    <div className="flex items-center gap-1.5">
      {/* Live transcript indicator while listening */}
      {listening && transcript && (
        <span className="max-w-[200px] truncate text-xs text-zinc-400 italic">
          {transcript}
        </span>
      )}

      <Button
        size="icon-sm"
        variant="ghost"
        className={cn(
          "relative transition-colors",
          listening
            ? "text-red-400 hover:text-red-300"
            : "text-zinc-500 hover:text-zinc-300",
          isDisabled && "opacity-40 cursor-not-allowed"
        )}
        onClick={toggleListening}
        disabled={isDisabled}
        title={
          !supported
            ? "Voice input not supported in this browser"
            : !voiceEnabled
              ? "Voice input disabled in settings"
              : listening
                ? "Stop listening"
                : "Voice input"
        }
      >
        {/* Pulsing ring when listening */}
        {listening && (
          <span className="absolute inset-0 rounded-[inherit] animate-ping bg-red-500/20" />
        )}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="relative"
        >
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" x2="12" y1="19" y2="22" />
        </svg>
      </Button>
    </div>
  );
}
