import type {
  BuddyMemory,
  BuddyMemoryDocumentKind,
  BuddyMemoryNote,
  BuddyMemoryRecallResult,
  BuddyMemoryRevision,
} from './types';

const EMPTY_JOURNAL: BuddyMemory['recentJournal'] = [];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNonNegativeInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizeRevision(value: unknown): BuddyMemoryRevision | null {
  const record = asRecord(value);
  if (!record || typeof record.body !== 'string' || typeof record.reasoning !== 'string')
    return null;
  return {
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.buddy_id === 'string' ? { buddy_id: record.buddy_id } : {}),
    ...(record.document_kind === 'working' || record.document_kind === 'long_term'
      ? { document_kind: record.document_kind }
      : {}),
    revision: asNonNegativeInteger(record.revision),
    ...(typeof record.generation === 'number' ? { generation: record.generation } : {}),
    body: record.body,
    reasoning: record.reasoning,
    ...(typeof record.author_kind === 'string' ? { author_kind: record.author_kind } : {}),
    ...(typeof record.requested_by === 'string' || record.requested_by === null
      ? { requested_by: record.requested_by }
      : {}),
    ...(typeof record.provenance !== 'undefined' ? { provenance: record.provenance } : {}),
    ...(typeof record.sha256 === 'string' ? { sha256: record.sha256 } : {}),
    ...(record.view_status === 'current' || record.view_status === 'stale'
      ? { view_status: record.view_status }
      : {}),
    ...(typeof record.view_error === 'string' ? { view_error: record.view_error } : {}),
    ...(typeof record.updated_at === 'string' ? { updated_at: record.updated_at } : {}),
  };
}

function normalizeRevisions(
  value: unknown
): Partial<Record<'working' | 'longTerm', BuddyMemoryRevision[]>> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const result: Partial<Record<'working' | 'longTerm', BuddyMemoryRevision[]>> = {};
  for (const [key, target] of [
    ['working', 'working'],
    ['longTerm', 'longTerm'],
    ['long_term', 'longTerm'],
  ] as const) {
    if (!Array.isArray(record[key])) continue;
    const revisions = record[key]
      .map(normalizeRevision)
      .filter((revision): revision is BuddyMemoryRevision => revision !== null);
    if (revisions.length > 0) result[target] = revisions;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Accepts the current legacy response and the locked v2 response. */
export function normalizeBuddyMemory(
  payload: unknown,
  soul?: string,
  soulPath?: string | null
): BuddyMemory {
  const record = asRecord(payload) ?? {};
  const rawOperations = asRecord(record.operations);
  const rawNotes = Array.isArray(record.notes) ? record.notes : [];
  const notes = rawNotes.filter((note): note is BuddyMemoryNote => {
    const candidate = asRecord(note);
    return Boolean(
      candidate && typeof candidate.id === 'string' && typeof candidate.content === 'string'
    );
  });
  const hasV2Document = hasOwn(record, 'working') || hasOwn(record, 'longTerm');
  const working = hasV2Document ? asString(record.working) : undefined;
  const longTerm = hasV2Document ? asString(record.longTerm, asString(record.summary)) : undefined;
  const workingRevision = hasV2Document
    ? asNonNegativeInteger(record.workingRevision ?? record.working_revision)
    : undefined;
  const longTermRevision = hasV2Document
    ? asNonNegativeInteger(record.longTermRevision ?? record.long_term_revision)
    : undefined;
  const generation = hasV2Document ? asNonNegativeInteger(record.generation) : undefined;
  const revisions = normalizeRevisions(record.revisions);
  return {
    ...(typeof soul === 'string' ? { soul } : {}),
    ...(typeof soulPath === 'string' || soulPath === null ? { soulPath } : {}),
    summary: asString(record.summary, longTerm ?? ''),
    recentJournal: Array.isArray(record.recentJournal) ? record.recentJournal : EMPTY_JOURNAL,
    ...(hasV2Document ? { working, longTerm, workingRevision, longTermRevision, generation } : {}),
    ...(revisions ? { revisions } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(rawOperations
      ? {
          operations: {
            ...(typeof rawOperations.updateMemory === 'boolean'
              ? { updateMemory: rawOperations.updateMemory }
              : {}),
            ...(typeof rawOperations.rememberNote === 'boolean'
              ? { rememberNote: rawOperations.rememberNote }
              : {}),
            ...(typeof rawOperations.recall === 'boolean' ? { recall: rawOperations.recall } : {}),
          },
        }
      : {}),
  };
}

export function hasV2Memory(memory: BuddyMemory): boolean {
  return memory.working !== undefined || memory.longTerm !== undefined;
}

export function memoryDocument(
  memory: BuddyMemory,
  kind: BuddyMemoryDocumentKind
): { body: string; revision: number; label: string } {
  if (kind === 'working') {
    return {
      body: memory.working ?? '',
      revision: memory.workingRevision ?? 0,
      label: 'WORKING_MEMORY.md',
    };
  }
  return {
    body: memory.longTerm ?? memory.summary,
    revision: memory.longTermRevision ?? 0,
    label: 'LONG_TERM_MEMORY.md',
  };
}

export function formatMemoryWriteError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const payload = asRecord(asRecord(cause)?.payload);
  const currentFromPayload = payload?.currentVersion ?? payload?.current_version;
  const suppliedFromPayload = payload?.yourBase ?? payload?.your_base ?? payload?.baseVersion;
  const current =
    (typeof currentFromPayload === 'number' ? String(currentFromPayload) : undefined) ??
    message.match(
      /(?:current(?: version| revision)?(?: is)?(?: at)?(?: revision)?|memory is at revision)\s+(\d+)/i
    )?.[1];
  const supplied =
    (typeof suppliedFromPayload === 'number' ? String(suppliedFromPayload) : undefined) ??
    message.match(/(?:supplied base|your base|base)\s+(\d+)/i)?.[1];
  if (/stale(?:memory)?write|stale memory write/i.test(message)) {
    const detail = [current && `current revision ${current}`, supplied && `your base ${supplied}`]
      .filter(Boolean)
      .join('; ');
    return `Memory changed while you were editing${detail ? ` (${detail})` : ''}. Reload the document and retry.`;
  }
  return message;
}

export function emptyRecallResult(pattern = ''): BuddyMemoryRecallResult {
  return { pattern, matches: [], truncated: false };
}
