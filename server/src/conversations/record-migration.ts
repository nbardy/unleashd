import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type BuddyContext,
  BuddyContextSchema,
  CONVERSATION_RECORD_VERSION,
  type ConversationKind,
  PersistedConversationConfigRecordSchema,
  buddyKind,
} from '@unleashd/shared';

// Pattern: delete-and-migrate (docs/patterns.md#delete-and-migrate)
/**
 * One-time v1 → v2 rewrite of the conversation config records (T09,
 * 2026-09-25). v1 had no stored kind: identity was re-derived at every
 * hydration from `creation.buddyContext`, `creation.purpose`,
 * `creation.placement` and — for records without those — a marker hidden in
 * the transcript's first user message. v2 stores `kind` once and drops the
 * three creation fields; nothing reads the markers as identity again.
 *
 * Marker-only identity comes from the normalized session cache (raw first
 * user messages, markers intact). On the 2026-09-25 copy that decided 3 of
 * 1,161 live conversations (external_discovered codex records of Buddy
 * turns). A record whose transcript was never cached keeps `chat`; the report
 * lists every record by kind source so that is visible, not silent.
 *
 * Safety: the by-conversation directory is copied to
 * `backup-v1-<timestamp>/` before any write, each record is rewritten
 * atomically, every rewritten record is re-read and checked against the v2
 * schema with its non-identity fields hashed equal to the original, and the
 * marker file is written last. A crash before the marker reruns the
 * migration over the partly migrated directory (v2 records are skipped).
 *
 * Since T23b (2026-09-26) the server no longer reads these files at all: it
 * reads conversation-records.sqlite. This is now step 2 of the owner-gated
 * import, run on a COPY of the data dir before `records-tool import` (which
 * refuses v1 files):
 *
 *   pnpm --dir server exec tsx src/conversations/record-migration.ts <copy>
 *
 * where <copy> holds `conversation-config/` (copied) and `session-cache-v1/`
 * (read only; a symlink to the live one is fine). Delete this module with
 * crates/unleashd-ingest/src/records/import.rs after the live swap.
 */

export const RECORD_MIGRATION_MARKER = '.migrated-to-v2';
export const RECORD_MIGRATION_REPORT = 'migration-v2-report.json';

type KindSource = 'creation.buddyContext' | 'creation.purpose' | 'transcript-marker' | 'default';

export interface RecordMigrationReport {
  migratedAt: string;
  backupDirectory: string | null;
  records: number;
  alreadyV2: number;
  migrated: number;
  byKind: Record<ConversationKind['t'], number>;
  byKindSource: Record<KindSource, number>;
  visibility: { foreground: number; background: number };
  /** Every record whose kind came from a transcript marker. */
  markerDerived: Array<{ conversationId: string; kind: ConversationKind['t'] }>;
  verified: number;
  failures: Array<{ file: string; error: string }>;
}

export type RecordMigrationResult =
  | { t: 'already_migrated' }
  | { t: 'migrated'; report: RecordMigrationReport; reportPath: string };

interface V1Record {
  version: 1;
  conversationId: string;
  sessionBindings?: Array<{ provider: string; sessionId: string }>;
  currentSession?: { provider: string; sessionId: string };
  creation?: {
    buddyContext?: unknown;
    purpose?: string;
    placement?: 'default' | 'background';
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export async function migrateConversationRecords(options: {
  appDataRoot: string;
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'warn'>;
}): Promise<RecordMigrationResult> {
  const root = path.join(options.appDataRoot, 'conversation-config', 'v1');
  const conversationDirectory = path.join(root, 'by-conversation');
  const markerPath = path.join(root, RECORD_MIGRATION_MARKER);
  if (await exists(markerPath)) return { t: 'already_migrated' };
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? console;

  const files = (await readdirOrEmpty(conversationDirectory)).filter((name) =>
    name.endsWith('.json')
  );
  const report: RecordMigrationReport = {
    migratedAt: now().toISOString(),
    backupDirectory: null,
    records: files.length,
    alreadyV2: 0,
    migrated: 0,
    byKind: { chat: 0, buddy: 0, builder: 0, worker: 0 },
    byKindSource: {
      'creation.buddyContext': 0,
      'creation.purpose': 0,
      'transcript-marker': 0,
      default: 0,
    },
    visibility: { foreground: 0, background: 0 },
    markerDerived: [],
    verified: 0,
    failures: [],
  };

  const pending: Array<{ file: string; record: V1Record }> = [];
  for (const file of files) {
    const decoded = JSON.parse(await readFile(path.join(conversationDirectory, file), 'utf8'));
    if (decoded?.version === CONVERSATION_RECORD_VERSION) {
      report.alreadyV2 += 1;
      continue;
    }
    if (decoded?.version !== 1) {
      report.failures.push({ file, error: `unknown record version ${String(decoded?.version)}` });
      continue;
    }
    pending.push({ file, record: decoded as V1Record });
  }

  if (pending.length > 0) {
    const backup = path.join(root, `backup-v1-${now().toISOString().replace(/[:.]/g, '-')}`);
    await cp(conversationDirectory, backup, { recursive: true, errorOnExist: true });
    report.backupDirectory = backup;
    const markers = await transcriptMarkerKinds(
      path.join(options.appDataRoot, 'session-cache-v1'),
      pending.some(({ record }) => !record.creation?.buddyContext && !isBuilder(record))
    );
    for (const { file, record } of pending) {
      try {
        const { kind, source } = recordKind(record, markers);
        const migrated = toV2(record, kind);
        // Validate, but write the record as it was plus `kind`: schema defaults
        // (status, done, recordRevision) stay implicit, as in v1.
        PersistedConversationConfigRecordSchema.parse(migrated);
        const target = path.join(conversationDirectory, file);
        const temporary = path.join(conversationDirectory, `.${file}.${process.pid}.migrate.tmp`);
        await writeFile(temporary, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
        await rename(temporary, target);
        // Verify what landed on disk, not what we meant to write.
        const reread = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
        PersistedConversationConfigRecordSchema.parse(reread);
        if (preservedHash(reread) !== preservedHash(record)) {
          throw new Error('non-identity fields changed during migration');
        }
        report.verified += 1;
        report.migrated += 1;
        report.byKind[kind.t] += 1;
        report.byKindSource[source] += 1;
        if (kind.t === 'buddy') report.visibility[kind.visibility] += 1;
        if (source === 'transcript-marker') {
          report.markerDerived.push({ conversationId: record.conversationId, kind: kind.t });
        }
      } catch (error) {
        report.failures.push({
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const reportPath = path.join(root, RECORD_MIGRATION_REPORT);
  // A fresh data directory has no store yet; boot must still record that
  // there was nothing to migrate (auth.test's real-server boot hit ENOENT here).
  await mkdir(root, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (report.failures.length > 0) {
    // No marker: the next boot retries, and the store refuses (never
    // quarantines) any v1 record it meets meanwhile.
    logger.warn(
      `[record-migration] ${report.failures.length} record(s) not migrated; see ${reportPath}`
    );
    return { t: 'migrated', report, reportPath };
  }
  await writeFile(markerPath, `${report.migratedAt}\n`, 'utf8');
  logger.log(
    `[record-migration] v1 -> v2: ${report.migrated} migrated, ${report.alreadyV2} already v2, ` +
      `kinds ${JSON.stringify(report.byKind)}; report ${reportPath}`
  );
  return { t: 'migrated', report, reportPath };
}

function isBuilder(record: V1Record): boolean {
  return record.creation?.purpose === 'buddy_builder';
}

function recordKind(
  record: V1Record,
  markers: ReadonlyMap<string, ConversationKind>
): { kind: ConversationKind; source: KindSource } {
  const context = record.creation?.buddyContext
    ? BuddyContextSchema.parse(record.creation.buddyContext)
    : null;
  if (context) {
    const placement = record.creation?.placement;
    return {
      kind: buddyKind(
        context,
        placement === 'background'
          ? 'background'
          : placement === 'default'
            ? 'foreground'
            : undefined
      ),
      source: 'creation.buddyContext',
    };
  }
  if (isBuilder(record)) return { kind: { t: 'builder' }, source: 'creation.purpose' };
  const bindings = [
    ...(record.currentSession ? [record.currentSession] : []),
    ...(record.sessionBindings ?? []),
  ];
  for (const binding of bindings) {
    const marked = markers.get(`${binding.provider}\0${binding.sessionId}`);
    if (marked) return { kind: marked, source: 'transcript-marker' };
  }
  return { kind: { t: 'chat' }, source: 'default' };
}

function toV2(record: V1Record, kind: ConversationKind): Record<string, unknown> {
  const { buddyContext: _b, purpose: _p, placement: _pl, ...creation } = record.creation ?? {};
  const { creation: _c, version: _v, ...rest } = record;
  return {
    ...rest,
    version: CONVERSATION_RECORD_VERSION,
    kind,
    ...(record.creation ? { creation } : {}),
  };
}

/** Hash of everything but identity: must be equal before and after. */
function preservedHash(record: Record<string, unknown>): string {
  const {
    buddyContext: _buddyContext,
    purpose: _purpose,
    placement: _placement,
    ...creation
  } = (record.creation as Record<string, unknown> | undefined) ?? {};
  const { version: _version, kind: _kind, ...fields } = record;
  const rest: Record<string, unknown> = { ...fields, creation };
  return createHash('sha256').update(stableJson(rest)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// --- transcript markers (read ONLY here, once) ------------------------------

const BUDDY_CONTEXT_V2_HEADER_RE =
  /^<!-- unleashd:buddy-context-v2 ([A-Za-z0-9_-]+) ([0-9]+) -->\n/;
const BUDDY_CONTEXT_V1_RE = /^<!-- unleashd:buddy-context (.+) -->\n/;
const BUDDY_BUILDER_V1_HEADER_RE = /^<!-- unleashd:buddy-builder-v1 ([0-9]+) -->\n/;
const OOMPA_TAG_RE = /^\[oompa(?::([^:\]]+))?(?::([^\]]+))?\]/i;

interface CachedSession {
  session: {
    sessionId: string;
    provider: string;
    messages: Array<{ role: string; content: string }>;
  } | null;
}

async function transcriptMarkerKinds(
  cacheDirectory: string,
  needed: boolean
): Promise<Map<string, ConversationKind>> {
  const kinds = new Map<string, ConversationKind>();
  if (!needed) return kinds;
  for (const name of await readdirOrEmpty(cacheDirectory)) {
    if (!name.endsWith('.json')) continue;
    const raw = await readFile(path.join(cacheDirectory, name), 'utf8').catch(() => '');
    if (!raw.includes('unleashd:buddy-') && !raw.includes('[oompa')) continue;
    let cached: CachedSession;
    try {
      cached = JSON.parse(raw) as CachedSession;
    } catch {
      continue;
    }
    const session = cached.session;
    if (!session) continue;
    const firstUser = session.messages.find((message) => message.role === 'user');
    const kind = firstUser ? markerKind(firstUser.content) : null;
    if (kind) kinds.set(`${session.provider}\0${session.sessionId}`, kind);
  }
  return kinds;
}

function markerKind(content: string): ConversationKind | null {
  const v2 = content.match(BUDDY_CONTEXT_V2_HEADER_RE);
  if (v2) return buddyFromPayload(() => Buffer.from(v2[1], 'base64url').toString('utf8'));
  const v1 = content.match(BUDDY_CONTEXT_V1_RE);
  if (v1) return buddyFromPayload(() => v1[1]);
  if (BUDDY_BUILDER_V1_HEADER_RE.test(content)) return { t: 'builder' };
  const oompa = content.match(OOMPA_TAG_RE);
  if (oompa) {
    return { t: 'worker', swarmId: oompa[1] ?? null, workerId: oompa[2] ?? null, role: null };
  }
  return null;
}

function buddyFromPayload(read: () => string): ConversationKind | null {
  try {
    const parsed = BuddyContextSchema.safeParse(JSON.parse(read()));
    return parsed.success ? buddyKind(parsed.data as BuddyContext) : null;
  } catch {
    return null;
  }
}

async function readdirOrEmpty(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

// The CLI step of the import (see the module comment). Exit 1 when any record
// failed, so the sequence stops before `records-tool import`.
if (require.main === module) {
  const [appDataRoot] = process.argv.slice(2);
  if (!appDataRoot || !path.isAbsolute(appDataRoot)) {
    console.error('usage: record-migration.ts <absolute path of the data-dir copy>');
    process.exit(2);
  }
  migrateConversationRecords({ appDataRoot }).then(
    (result) => process.exit(result.t === 'migrated' && result.report.failures.length > 0 ? 1 : 0),
    (error) => {
      console.error(error);
      process.exit(1);
    }
  );
}
