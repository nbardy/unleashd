import { type ServerFrame, type ServerMessage, classifyServerFrame } from '@unleashd/shared';
import { useCallback, useEffect, useRef } from 'react';
import { noteProtocolMismatch, setSocket } from '../atoms/actions';
import { probeSessionAfterSocketFailure } from '../auth/session';

// Pattern: parse-dont-validate (docs/patterns.md#parse-dont-validate)
// A streamed reply is 100-200 `chunk` frames, and running the whole
// ServerMessage union (a 13-way Zod parse) on each was the hot spot of the
// stream path (06-target-client §1.4). A chunk is checked by its type tag and
// two string fields; every other frame — hello, rows, patches, acks — still
// gets the full schema once at this boundary. Guard:
// client/test/stream-frame-validation.test.ts.
type ChunkMessage = Extract<ServerMessage, { type: 'chunk' }>;

export function parseServerFrame(raw: unknown): ServerFrame {
  const record = raw as Partial<Record<keyof ChunkMessage, unknown>> | null;
  if (record !== null && typeof record === 'object' && record.type === 'chunk') {
    return typeof record.conversationId === 'string' &&
      record.conversationId.length > 0 &&
      typeof record.text === 'string'
      ? {
          t: 'message',
          message: { type: 'chunk', conversationId: record.conversationId, text: record.text },
        }
      : { t: 'invalid', issues: 'chunk: conversationId and text must be strings' };
  }
  return classifyServerFrame(raw);
}

/**
 * The one WebSocket (AGENTS.md: one bridge). Socket state and the send
 * function go straight into connectionAtom (setSocket); frames go to
 * `onMessage` (the handleMessage spine).
 */
export function useWebSocket(url: string, onMessage: (data: ServerMessage) => void): void {
  const wsRef = useRef<WebSocket | null>(null);
  // window.setTimeout returns a number; ReturnType<typeof setTimeout> resolves to
  // NodeJS.Timeout once @types/node is in scope (client/tsconfig.test.json).
  const reconnectTimeout = useRef<number | null>(null);
  const initialConnectTimeout = useRef<number | null>(null);
  const isMounted = useRef(true);
  const isIntentionalClose = useRef(false);
  // STABILITY FIX: Use ref for callback to avoid reconnecting when callback changes.
  // Without this, any state change that causes handleMessage to be recreated
  // (like the active route) would cause WebSocket to disconnect/reconnect.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    // Don't connect if already connected or connecting
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    setSocket({ tag: 'connecting' });
    const ws = new WebSocket(url);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      if (isMounted.current) {
        setSocket({ tag: 'open', send: (message) => ws.send(JSON.stringify(message)) });
      }
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const frame = parseServerFrame(JSON.parse(event.data));
        switch (frame.t) {
          case 'message':
            onMessageRef.current(frame.message);
            return;
          case 'skew':
            // An older backend is still up (dev reload in flight). Keep every
            // row; close so onclose reconnects until the v3 backend answers.
            noteProtocolMismatch(frame.serverVersion);
            ws.close();
            return;
          case 'invalid':
            console.error('Rejected invalid WebSocket server message:', frame.issues);
            return;
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (isMounted.current && !isIntentionalClose.current) {
        setSocket({ tag: 'closed' });
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
}
