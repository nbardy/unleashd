import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useState } from 'react';
import { resumeInterruptedMessages } from '../atoms/actions';
import { clearRestartRecovery, restartRecoveryAtomFamily } from '../atoms/restart-recovery';
import type { TurnAttemptSnapshotLike } from '../utils/turn-diagnostics';

export interface RestartRecoveryController {
  currentMessage: string;
  queuedCount: number;
  isResuming: boolean;
  error: string | null;
  resume: () => Promise<void>;
  dismiss: () => void;
}

function attemptSettledAfterSnapshot(
  attempt: TurnAttemptSnapshotLike,
  snapshotUpdatedAt: string
): boolean {
  const settledAt = new Date(attempt.terminalAt ?? attempt.updatedAt).getTime();
  const capturedAt = new Date(snapshotUpdatedAt).getTime();
  return Number.isFinite(settledAt) && Number.isFinite(capturedAt) && settledAt >= capturedAt;
}

export function shouldOfferRestartRecovery(
  snapshot: { updatedAt: string } | null,
  attempt: TurnAttemptSnapshotLike | null,
  runtimeTurnActive: boolean
): boolean {
  return Boolean(
    !runtimeTurnActive &&
      snapshot &&
      attempt?.state === 'interrupted' &&
      attempt.terminalCause === 'server_restart' &&
      attemptSettledAfterSnapshot(attempt, snapshot.updatedAt)
  );
}

export function useRestartRecovery(
  conversationId: string,
  attempt: TurnAttemptSnapshotLike | null,
  runtimeTurnActive: boolean
): RestartRecoveryController | null {
  const snapshot = useAtomValue(restartRecoveryAtomFamily(conversationId));
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interruptedByRestart = shouldOfferRestartRecovery(snapshot, attempt, runtimeTurnActive);

  useEffect(() => {
    if (
      !runtimeTurnActive &&
      attempt &&
      snapshot &&
      attemptSettledAfterSnapshot(attempt, snapshot.updatedAt) &&
      !['queued', 'starting', 'running', 'stopping'].includes(attempt.state) &&
      !(attempt.state === 'interrupted' && attempt.terminalCause === 'server_restart')
    ) {
      clearRestartRecovery(conversationId);
    }
  }, [attempt, conversationId, runtimeTurnActive, snapshot]);

  const dismiss = useCallback(() => {
    setError(null);
    clearRestartRecovery(conversationId);
  }, [conversationId]);

  const resume = useCallback(async () => {
    if (!snapshot || isResuming) return;
    setIsResuming(true);
    setError(null);
    try {
      await resumeInterruptedMessages(conversationId, [
        snapshot.currentMessage,
        ...snapshot.queuedMessages,
      ]);
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : String(resumeError));
    } finally {
      setIsResuming(false);
    }
  }, [conversationId, isResuming, snapshot]);

  if (!snapshot || !interruptedByRestart) return null;
  return {
    currentMessage: snapshot.currentMessage,
    queuedCount: snapshot.queuedMessages.length,
    isResuming,
    error,
    resume,
    dismiss,
  };
}
