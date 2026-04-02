"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/** Events the recon WebSocket sends */
export interface WsEvent {
  type: "session:snapshot" | "session:update";
  session_count: number;
  input_count: number;
}

interface UseWebSocketOptions {
  /** Called when a session:update event arrives */
  onUpdate?: (event: WsEvent) => void;
}

interface UseWebSocketReturn {
  connected: boolean;
  lastEvent: WsEvent | null;
}

const WS_URL = "ws://localhost:3100/api/ws";
const MAX_BACKOFF_MS = 10_000;
const INITIAL_BACKOFF_MS = 500;

export function useWebSocket(options?: UseWebSocketOptions): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUpdateRef = useRef(options?.onUpdate);
  const mountedRef = useRef(true);

  // Keep callback ref up to date without causing reconnects
  useEffect(() => {
    onUpdateRef.current = options?.onUpdate;
  }, [options?.onUpdate]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onclose = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setConnected(true);
        backoffRef.current = INITIAL_BACKOFF_MS; // reset backoff on success
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          const data: WsEvent = JSON.parse(event.data);
          setLastEvent(data);
          if (data.type === "session:update" && onUpdateRef.current) {
            onUpdateRef.current(data);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        // Schedule reconnect with exponential backoff
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose will fire after onerror, so we just let it handle reconnect
      };
    } catch {
      // WebSocket constructor can throw if URL is invalid (shouldn't happen here)
      if (mountedRef.current) {
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onclose = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected, lastEvent };
}
