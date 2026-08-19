import { type ServerMessage, safeParseServerMessage } from '@unleashd/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { probeSessionAfterSocketFailure } from '../auth/session';

type Status = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket(url: string, onMessage: (data: ServerMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialConnectTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted = useRef(true);
  const isIntentionalClose = useRef(false);
  // STABILITY FIX: Use ref for callback to avoid reconnecting when callback changes.
  // Without this, any state change that causes handleMessage to be recreated
  // (like activeConversationId) would cause WebSocket to disconnect/reconnect.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    setStatus('connecting');
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      if (isMounted.current) {
        console.log('WebSocket connected');
        setStatus('connected');
      }
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const parsed = safeParseServerMessage(JSON.parse(event.data));
        if (!parsed.success) {
          console.error('Rejected invalid WebSocket server message:', parsed.error.issues);
          return;
        }
        onMessageRef.current(parsed.data);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (isMounted.current && !isIntentionalClose.current) {
        console.log('WebSocket disconnected, reconnecting...');
        setStatus('disconnected');
        // A rejected (401) upgrade looks identical to a dead server here.
        void probeSessionAfterSocketFailure();
        // Reconnect after 2 seconds
        reconnectTimeout.current = window.setTimeout(() => {
          if (isMounted.current) {
            connect();
          }
        }, 2000);
      }
    };

    ws.onerror = (error) => {
      if (wsRef.current !== ws) return;
      if (isMounted.current) {
        console.error('WebSocket error:', error);
      }
    };

    wsRef.current = ws;
  }, [url]); // Only reconnect when URL changes, not when callback changes

  useEffect(() => {
    isMounted.current = true;
    isIntentionalClose.current = false;
    // Defer the initial connection by one task. React Strict Mode immediately
    // cleans up and re-runs effects in development; deferring prevents that
    // probe from opening a throwaway socket that is closed mid-handshake.
    initialConnectTimeout.current = window.setTimeout(() => {
      initialConnectTimeout.current = null;
      if (isMounted.current) connect();
    }, 0);

    return () => {
      isMounted.current = false;
      isIntentionalClose.current = true;
      if (initialConnectTimeout.current) {
        clearTimeout(initialConnectTimeout.current);
        initialConnectTimeout.current = null;
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [connect]);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    } else {
      console.warn('WebSocket not connected');
    }
  }, []);

  return { send, status };
}
