import type { ConversationRow, RowKind } from '@unleashd/shared';

/** A provider process is alive (streaming implies running). */
export function isRowRunning(row: Pick<ConversationRow, 'run'>): boolean {
  return row.run === 'running' || row.run === 'streaming';
}

/** Queued work, or a process alive: the conversation is busy. */
export function isRowBusy(row: Pick<ConversationRow, 'run'>): boolean {
  return row.run !== 'idle';
}

export type BuddyRowKind = Extract<RowKind, { t: 'buddy' }>;

/** The Buddy ids of a Buddy thread's row, or null for every other kind. */
export function rowBuddy(row: { kind: RowKind } | null | undefined): BuddyRowKind | null {
  return row?.kind.t === 'buddy' ? row.kind : null;
}

export type WorkerRowKind = Extract<RowKind, { t: 'worker' }>;

/** The swarm ids of a worker row (quarantined swarm, DESIGN C.5), or null. */
export function rowWorker(row: { kind: RowKind } | null | undefined): WorkerRowKind | null {
  return row?.kind.t === 'worker' ? row.kind : null;
}
