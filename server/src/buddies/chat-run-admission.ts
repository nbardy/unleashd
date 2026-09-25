import type { BuddyContext } from '@unleashd/shared';
import type { BuddyChatAdmission } from '../conversations/runtime';
import type { CoordinationStore } from './coordination-store';

// Runtime ports for foreground Buddy chat/channel turns. A turn joins its
// Buddy's FIFO run line (per-Buddy limit, default 5; owner decision 2026-09-25),
// then polls start until admitted. A full Buddy delays a turn instead of
// failing it.
export function chatRunAdmission(
  store: () => CoordinationStore,
  defaultOperations: () => readonly string[]
) {
  return {
    enqueueBuddyChatRun: (context: BuddyContext, conversationId: string) =>
      store().enqueueBuddyChatRun({
        buddyId: context.buddyId,
        workspaceId: context.workspaceId,
        conversationId,
        projectId: context.buddyProjectId,
        allowedOperations: context.allowedBuddyOperations ?? [...defaultOperations()],
      }),
    startBuddyChatRun: (
      runId: string,
      conversationId: string,
      maxRuntimeMs: number
    ): BuddyChatAdmission => {
      const run = store().startBuddyChatRun(runId, {
        conversationId,
        // Explicitly pass the foreground budget (runtime ms -> package seconds).
        // Do not fall back to a package/background default: that reintroduced
        // the 600s cutoff independently of the already-fixed bridge watchdog.
        maxRuntimeSeconds: maxRuntimeMs / 1000,
      });
      if (run)
        return {
          kind: 'admitted',
          run: { id: run.id, claim_token: run.claim_token!, deadline: run.deadline! },
        };
      const queued = store().getBuddyRun(runId);
      return queued?.status === 'queued'
        ? { kind: 'waiting', reason: queued.error ?? 'Waiting for admission' }
        : { kind: 'gone' };
    },
    abandonBuddyChatRun: (runId: string) => {
      store().abandonQueuedBuddyChatRuns({ ids: [runId] });
    },
  };
}
