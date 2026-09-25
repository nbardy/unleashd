/**
 * The conversation LIST as a read model of the ingest store: each active conversation record joined
 * with the transcript rows (`Ingest.listSessions`) of the sessions it binds.
 *
 * Why this exists (T13b S1): the TS loader hydrates only the newest 500 transcripts, so the list
 * was capped at what it had parsed into memory. The crate lists every session in ~0.65 s from its
 * own store, so the list no longer waits on, or is capped by, transcript parsing.
 *
 * What stays elsewhere for now: a conversation the server holds as a runtime (`isLive`) keeps
 * serving its own row, run state and message bodies (the old loader); this list fills in the rest
 * and stays silent about live ids. Message bodies from the store are the next slice.
 * Guard: server/test/ingest-list.test.ts (boot over a fixture HOME → list rows).
 */
// Pattern: one-write-path (docs/patterns.md#one-write-path)

import type { ChangeEvent, Ingest, RecordSummary, SessionRow } from '@unleashd/ingest';
import {
  type ConversationRow,
  type RowPatch,
  type ConversationKind as SharedKind,
  encodeRows,
  rowKind,
} from '@unleashd/shared';
import type { ConversationBroadcast } from '../conversations/runtime';

type Records = {
  listSummaries(): Promise<RecordSummary[]>;
};

/** What one record contributes to the list. A sum, so the join never guesses a row. */
type Listing =
  | { t: 'listed'; row: ConversationRow }
  /** No bound transcript in the store: the loader's recovery path owns these (runtime rows). */
  | { t: 'no_transcript' }
  /**
   * No working directory anywhere: neither the record nor any transcript names one. Today these are
   * the Muse approval-review children (95 on 2026-09-26); the old loader showed them under the
   * server's own cwd, which was a guess. Left out and counted instead.
   */
  | { t: 'no_cwd' };

function cwdOf(record: RecordSummary, sessions: readonly SessionRow[]): string | null {
  if (record.workingDirectory) return record.workingDirectory;
  for (const session of sessions) {
    if (session.cwd.t !== 'unknown') return session.cwd.path;
  }
  return null;
}

/**
 * Pure join of one record with its sessions (oldest first). Mirrors what the loader derived from a
 * hydrated runtime: label = current session's provider title, else the first session's first user
 * line; activity = newest session; count = the sessions' counts summed (bound histories rarely
 * overlap; a hydrated runtime, which merges them exactly, overrides this row).
 */
export function listingFor(
  record: RecordSummary,
  sessions: readonly SessionRow[],
  conversationOfSession: (sessionId: string) => string | undefined
): Listing {
  if (sessions.length === 0) return { t: 'no_transcript' };
  const cwd = cwdOf(record, sessions);
  if (cwd === null) return { t: 'no_cwd' };
  const current =
    sessions.find((session) => session.sessionId === record.currentSession?.sessionId) ??
    sessions[sessions.length - 1];
  const recordCreated = Date.parse(record.createdAt);
  // Discovered records were stamped at import time; the transcript's own birth is the truth.
  const createdAt =
    record.provenance === 'external_discovered'
      ? Math.min(recordCreated, ...sessions.map((session) => session.createdAt))
      : recordCreated;
  const parentSession = sessions.find((session) => session.parentSessionId)?.parentSessionId;
  return {
    t: 'listed',
    row: {
      id: record.conversationId,
      kind: rowKind(record.kind as SharedKind),
      parent: parentSession ? (conversationOfSession(parentSession) ?? parentSession) : null,
      resumedFrom:
        sessions.find((s) => s.resumedFromConversationId)?.resumedFromConversationId ?? null,
      provider: record.provider,
      cwd,
      label: current.title?.trim() || sessions[0].label || 'New conversation',
      createdAt,
      activityAt: Math.max(createdAt, ...sessions.map((session) => session.activityAt)),
      messageCount: sessions.reduce((sum, session) => sum + session.messageCount, 0),
      run: 'idle',
      done: record.done,
    },
  };
}

export interface ConversationList {
  /** Rows for every listed conversation the server does NOT hold as a runtime. */
  rows(): ConversationRow[];
  ids(): string[];
  /** `Ingest.start`'s onChange: re-list the changed sessions and send field patches. */
  onChange(event: ChangeEvent): void;
}

export interface ConversationListDependencies {
  ingest: Pick<Ingest, 'listSessions'>;
  records: Records;
  /** The runtime owns these ids' rows (hydrated by the loader or created this run). */
  isLive(conversationId: string): boolean;
  broadcast(data: ConversationBroadcast): void;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/**
 * Build the list once (boot), then keep it current from `onChange`. Records created after boot
 * belong to a runtime (created or hydrated by the loader), so only the boot snapshot of records
 * is joined here.
 */
export async function createConversationList(
  dependencies: ConversationListDependencies
): Promise<ConversationList> {
  const logger = dependencies.logger ?? console;
  const sessions = new Map<string, SessionRow>();
  const recordOf = new Map<string, RecordSummary>();
  const conversationBySession = new Map<string, string>();
  const rows = new Map<string, ConversationRow>();
  let rev = 0;

  const [page, summaries] = await Promise.all([
    dependencies.ingest.listSessions({ since: 0 }),
    dependencies.records.listSummaries(),
  ]);
  rev = page.rev;
  for (const row of page.rows) sessions.set(row.sessionId, row);
  for (const record of summaries) {
    if (record.status !== 'active') continue;
    recordOf.set(record.conversationId, record);
    for (const key of record.sessions)
      conversationBySession.set(key.sessionId, record.conversationId);
  }

  const boundSessions = (record: RecordSummary): SessionRow[] =>
    record.sessions
      .map((key) => sessions.get(key.sessionId))
      .filter((row): row is SessionRow => row !== undefined)
      .sort((a, b) => a.createdAt - b.createdAt);
  const listing = (record: RecordSummary) =>
    listingFor(record, boundSessions(record), (id) => conversationBySession.get(id));

  let withoutCwd = 0;
  for (const record of recordOf.values()) {
    const result = listing(record);
    switch (result.t) {
      case 'listed':
        rows.set(record.conversationId, result.row);
        break;
      case 'no_cwd':
        withoutCwd++;
        break;
      case 'no_transcript':
        break;
    }
  }
  if (withoutCwd > 0) {
    logger.warn(
      `[ingest-list] ${withoutCwd} conversations have no working directory in their record or transcripts (Muse approval-review children); left out of the list`
    );
  }
  logger.log(`[ingest-list] ${rows.size} conversations listed from ${sessions.size} sessions`);

  // Serialize change handling: each re-list pages from the previous `rev`.
  let pending: Promise<void> = Promise.resolve();

  async function relist(): Promise<void> {
    const next = await dependencies.ingest.listSessions({ since: rev });
    rev = next.rev;
    const touched = new Set<string>();
    for (const row of next.rows) {
      sessions.set(row.sessionId, row);
      const id = conversationBySession.get(row.sessionId);
      if (id) touched.add(id);
    }
    for (const removed of next.removed) {
      sessions.delete(removed.sessionId);
      const id = conversationBySession.get(removed.sessionId);
      if (id) touched.add(id);
    }
    const upserts: ConversationRow[] = [];
    const gone: string[] = [];
    for (const id of touched) {
      const record = recordOf.get(id);
      if (!record) continue;
      const result = listing(record);
      const before = rows.get(id);
      if (result.t !== 'listed') {
        rows.delete(id);
        if (before && !dependencies.isLive(id)) gone.push(id);
        continue;
      }
      rows.set(id, result.row);
      if (dependencies.isLive(id)) continue;
      if (!before) {
        upserts.push(result.row);
        continue;
      }
      for (const patch of patchesBetween(before, result.row)) {
        dependencies.broadcast({ type: 'patch', id, patch });
      }
    }
    if (upserts.length > 0) dependencies.broadcast({ type: 'rows', ...encodeRows(upserts) });
    if (gone.length > 0) dependencies.broadcast({ type: 'removed', ids: gone });
  }

  return {
    rows: () => [...rows.values()].filter((row) => !dependencies.isLive(row.id)),
    ids: () => [...rows.keys()],
    onChange(event) {
      switch (event.t) {
        case 'failed':
          logger.error(`[ingest-list] ingest watcher failed: ${event.message}`);
          return;
        case 'changes':
          pending = pending
            .then(relist)
            .catch((error: Error) => logger.error('[ingest-list] re-list failed:', error.message));
          return;
      }
    },
  };
}

// Pattern: patches-not-snapshots (docs/patterns.md#patches-not-snapshots)
/** The field patches that move `before` to `after` (only the fields the store derives). */
function patchesBetween(before: ConversationRow, after: ConversationRow): RowPatch[] {
  const patches: RowPatch[] = [];
  if (before.label !== after.label) patches.push({ t: 'label', label: after.label });
  if (before.activityAt !== after.activityAt || before.messageCount !== after.messageCount) {
    patches.push({
      t: 'activity',
      activityAt: after.activityAt,
      messageCount: after.messageCount,
    });
  }
  return patches;
}
