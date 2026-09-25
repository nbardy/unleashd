import type { ConversationRow, OompaRuntimeSnapshot } from '@unleashd/shared';
import { isRowRunning } from './conversation-row';

function workerId(worker: ConversationRow): string {
  return (worker.kind.t === 'worker' ? worker.kind.workerId : null) || worker.id;
}

export interface WorkerVisibilitySummary {
  sessionCount: number;
  hasWorkers: boolean;
  totalWorkers: number;
  runningWorkers: number;
}

export function getWorkerVisibilitySummary(
  workers: readonly ConversationRow[],
  runtimeSnapshot: OompaRuntimeSnapshot | null | undefined,
  isRunning: (worker: ConversationRow) => boolean = isRowRunning
): WorkerVisibilitySummary {
  const sessionCount = workers.length;
  const workerIds = workers.map(workerId);
  const distinctWorkerIds = new Set(workerIds);

  if (runtimeSnapshot?.available && runtimeSnapshot.run) {
    const totalWorkers = runtimeSnapshot.run.totalWorkers;
    const runningWorkers = Math.min(runtimeSnapshot.run.activeWorkers, totalWorkers);
    return {
      sessionCount,
      hasWorkers: sessionCount > 0 || totalWorkers > 0,
      totalWorkers,
      runningWorkers,
    };
  }

  const runningWorkers = new Set(
    workers.filter(isRunning).map(workerId)
  ).size;
  return {
    sessionCount,
    hasWorkers: sessionCount > 0,
    totalWorkers: distinctWorkerIds.size || sessionCount,
    runningWorkers,
  };
}
