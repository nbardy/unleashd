import { useEffect, useRef, useState } from 'react';
import {
  type TurnAttemptSnapshotLike,
  turnDiagnosticsPollDelay,
} from '../utils/turn-diagnostics';

interface DiagnosticsResponse {
  attempt: TurnAttemptSnapshotLike | null;
}

export interface ConversationTurnDiagnostics {
  attempt: TurnAttemptSnapshotLike | null;
  error: string | null;
  isLoading: boolean;
}

export function conversationDiagnosticsUrl(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/diagnostics?limit=1`;
}

/**
 * Polls diagnostics for one mounted thread only.
 *
 * A running turn refreshes quickly. Idle threads refresh slowly after the
 * initial request, which catches delayed terminal/restart recovery without
 * subscribing Chat to the global conversations collection.
 */
export function useTurnDiagnostics(
  conversationId: string | undefined,
  isRunning: boolean
): ConversationTurnDiagnostics {
  const [state, setState] = useState<ConversationTurnDiagnostics>({
    attempt: null,
    error: null,
    isLoading: Boolean(conversationId),
  });
  const requestedConversationId = useRef<string | undefined>(conversationId);
  const latestAttempt = useRef<TurnAttemptSnapshotLike | null>(null);

  useEffect(() => {
    if (!conversationId) {
      requestedConversationId.current = undefined;
      latestAttempt.current = null;
      setState({ attempt: null, error: null, isLoading: false });
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let request: AbortController | null = null;
    let consecutiveNotFound = 0;

    const poll = async (): Promise<void> => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch(conversationDiagnosticsUrl(conversationId), {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (response.status === 404) {
          consecutiveNotFound += 1;
          if (cancelled) return;
          setState((current) => ({ ...current, error: null, isLoading: false }));
        } else {
          consecutiveNotFound = 0;
        }
        if (!response.ok) throw new Error(`Diagnostics request failed (${response.status})`);
        const body: unknown = await response.json();
        if (cancelled) return;
        latestAttempt.current = readLatestAttempt(body);
        setState({ attempt: latestAttempt.current, error: null, isLoading: false });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        if (consecutiveNotFound === 0) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error),
            isLoading: false,
          }));
        }
      }

      if (cancelled) return;
      timer = window.setTimeout(
        () => void poll(),
        turnDiagnosticsPollDelay(
          isRunning,
          latestAttempt.current?.state ?? null,
          consecutiveNotFound
        )
      );
    };

    const conversationChanged = requestedConversationId.current !== conversationId;
    requestedConversationId.current = conversationId;
    if (conversationChanged) latestAttempt.current = null;
    setState((current) => ({
      attempt: conversationChanged ? null : current.attempt,
      error: null,
      isLoading: true,
    }));
    void poll();
    return () => {
      cancelled = true;
      request?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [conversationId, isRunning]);

  return state;
}

function readLatestAttempt(value: unknown): TurnAttemptSnapshotLike | null {
  if (isAttempt(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const response = value as Partial<
    DiagnosticsResponse & {
      latestAttempt: unknown;
      attempts: unknown;
    }
  >;
  if (isAttempt(response.attempt)) return response.attempt;
  if (isAttempt(response.latestAttempt)) return response.latestAttempt;
  if (Array.isArray(response.attempts)) {
    return response.attempts.find(isAttempt) ?? null;
  }
  return null;
}

function isAttempt(value: unknown): value is TurnAttemptSnapshotLike {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TurnAttemptSnapshotLike>;
  return (
    typeof candidate.state === 'string' &&
    typeof candidate.createdAt !== 'undefined' &&
    typeof candidate.updatedAt !== 'undefined'
  );
}
