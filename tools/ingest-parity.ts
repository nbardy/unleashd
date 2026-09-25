/**
 * Ingest parity: the TypeScript transcript parsers (server/src/adapters) versus the Rust crate
 * (crates/unleashd-ingest) over the REAL local provider roots, compared per session.
 *
 *   pnpm exec tsx tools/ingest-parity.ts --db /path/outside/the/repo/parity.sqlite [--fresh]
 *        [--format claude|codex|cursor|muse|gemini|opencode] [--limit N] [--json out.json]
 *
 * Both sides only READ the transcript roots. The crate writes its store to --db (keep it out of
 * any transcript directory and ~/.agent-viewer). The TS side runs each adapter's parseFile() and
 * sessionToConversation() with no session cache, exactly as the loader does on a cache miss.
 *
 * Every difference is sorted into a category. Categories listed in KNOWN_TS_DEFECTS are TS
 * behaviour the crate deliberately does not copy (see the report); anything else is a crate bug
 * until explained. Kept for T13, which switches the server to the crate.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  BuddyBuilderEventSchema,
  type DiscoveredConversation,
  type Message,
} from '@unleashd/shared';
import { type ParsedSession, sessionToConversation } from '../server/src/adapters/disk-adapter';
import { diskAdapters } from '../server/src/adapters/registry';
import {
  parseClaudeSession,
  parseCodexTokenTotals,
  parseOpenCodeSessionUsage,
} from '../server/src/http/usage-routes';

type CrateModule = typeof import('../crates/unleashd-ingest/index');
type Row = import('../crates/unleashd-ingest/index').SessionRow;
type CrateMessage = import('../crates/unleashd-ingest/index').Message;

const require = createRequire(import.meta.url);
const crate: CrateModule = require('../crates/unleashd-ingest/index.js');

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
const dbPath = arg('db');
if (!dbPath) throw new Error('--db <path> is required (a scratch store outside the repo)');
const onlyFormat = arg('format');
const limit = Number(arg('limit') ?? Number.POSITIVE_INFINITY);
const jsonOut = arg('json');

/** TS behaviour the crate does not reproduce on purpose. Reported, not counted as failures. */
const KNOWN_TS_DEFECTS: Record<string, string> = {
  'cwd:ts-process-cwd':
    'No cwd recorded: TS substitutes the server process cwd; the crate reports {t:"unknown"}.',
  'time:ts-now':
    'No timestamp recorded: TS stamps new Date() (changes on every parse); the crate keeps null / file mtime.',
  'time:cursor-mtime':
    'Cursor lines carry no times: TS stamps every message with the current file mtime; crate keeps null.',
  'text:merge-prefix':
    'Old merge-review envelope still in the first prompt: TS stopped stripping it in 8c9fcfa; the crate strips it.',
  'ts:readline-splits-u2028':
    'Node readline also ends lines at U+2028/U+2029, so the TS Codex/Cursor/Muse parsers cut a record holding a raw one in two and drop it as malformed; the crate splits on \\n only.',
  'receipt:zod-normalized':
    'Builder receipt equal after BuddyBuilderEventSchema.parse: TS embeds the Zod output (defaults filled, unknown keys stripped), the crate the recorded JSON; the client parses both to the same event.',
  'live:changed-during-run':
    'The transcript was written to after the crate scanned it (a running agent); the two sides read different bytes.',
};

type Mismatch = { category: string; source: string; detail: string };
const mismatches: Mismatch[] = [];
const perFormat = new Map<
  string,
  {
    sources: number;
    listedTs: number;
    listedCrate: number;
    exact: number;
    withMismatch: number;
    knownOnly: number;
  }
>();
let tsParseMs = 0;

function stat(format: string) {
  let s = perFormat.get(format);
  if (!s) {
    s = { sources: 0, listedTs: 0, listedCrate: 0, exact: 0, withMismatch: 0, knownOnly: 0 };
    perFormat.set(format, s);
  }
  return s;
}

function snippet(s: string | undefined | null, at = 0): string {
  if (s == null) return String(s);
  const start = Math.max(0, at - 40);
  return JSON.stringify(s.slice(start, start + 160));
}

function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

const MERGE_MARKERS = ['<!-- unleashd:merge-prefix -->', '<!-- unleashd:merge-prefix-v1 '];
const BUILDER_RECEIPT = /<!--buddy_builder_result:(.*?)-->/g;

/** Both sides' receipts as the client reads them. */
function zodNormalized(text: string): string {
  return text.replace(BUILDER_RECEIPT, (_, payload: string) => {
    const parsed = BuddyBuilderEventSchema.safeParse(JSON.parse(decodeURIComponent(payload)));
    return parsed.success
      ? `<!--buddy_builder_result:${JSON.stringify(parsed.data)}-->`
      : '<!--invalid builder receipt-->';
  });
}

function compareMessages(
  format: string,
  ts: Message[],
  rs: CrateMessage[],
  out: (c: string, d: string) => void
): void {
  if (ts.length !== rs.length) out('messages:count', `ts ${ts.length} vs crate ${rs.length}`);
  const n = Math.min(ts.length, rs.length);
  let textReported = false;
  let timeReported = false;
  for (let i = 0; i < n; i++) {
    const a = ts[i];
    const b = rs[i];
    if (a.role !== b.role) {
      out(
        'messages:role',
        `#${i} ts ${a.role} vs crate ${b.role}: ts ${snippet(a.content)} crate ${snippet(b.content)}`
      );
      return; // everything after an alignment break is noise
    }
    if (a.content !== b.content && !textReported) {
      textReported = true;
      const at = firstDiff(a.content, b.content);
      const merge = MERGE_MARKERS.some((m) => a.content.startsWith(m));
      const receipt = !merge && zodNormalized(a.content) === zodNormalized(b.content);
      const category = merge
        ? 'text:merge-prefix'
        : receipt
          ? 'receipt:zod-normalized'
          : 'messages:text';
      out(category, `#${i} @${at}: ts ${snippet(a.content, at)} crate ${snippet(b.content, at)}`);
    }
    const tsTool = a.toolCall ? `${a.toolCall.name}\u0000${a.toolCall.input ?? ''}` : '';
    const rsTool = b.toolCall ? `${b.toolCall.name}\u0000${b.toolCall.input ?? ''}` : '';
    if (tsTool !== rsTool)
      out('messages:toolCall', `#${i} ts ${snippet(tsTool)} crate ${snippet(rsTool)}`);
    if (!timeReported) {
      const tsAt = a.timestamp.getTime();
      const rsAt = b.at ?? null;
      const tsDone = a.completedAt ? new Date(a.completedAt).getTime() : null;
      const rsDone = b.completedAt ?? null;
      if (tsAt !== rsAt || tsDone !== rsDone) {
        timeReported = true;
        const category =
          format === 'cursor'
            ? 'time:cursor-mtime'
            : rsAt === null
              ? 'time:ts-now'
              : 'messages:time';
        out(category, `#${i} ts ${tsAt}/${tsDone} crate ${rsAt}/${rsDone}`);
      }
    }
  }
}

function identityOf(c: DiscoveredConversation): string {
  if (c.isWorker) return `worker:${c.swarmId ?? ''}:${c.workerId ?? ''}:${c.workerRole ?? ''}`;
  const kind = c.kind?.kind ?? 'general';
  if (kind === 'buddy') return `buddy:${(c.kind as { buddyId: string }).buddyId}`;
  if (kind === 'buddy_builder') return 'builder';
  return 'general';
}

function crateIdentity(row: Row): string {
  const id = row.identity;
  switch (id.t) {
    case 'worker':
      return `worker:${id.swarmId ?? ''}:${id.workerId ?? ''}:${id.role}`;
    case 'buddy':
      return `buddy:${id.buddyId}`;
    case 'builder':
      return 'builder';
    case 'general':
      return 'general';
  }
}

async function tsUsage(
  format: string,
  source: string,
  session: ParsedSession
): Promise<{ input: number; output: number; cacheRead: number; cacheWrite: number } | null> {
  if (format === 'claude') {
    const u = await parseClaudeSession(source, await fs.promises.stat(source));
    return {
      input: u.inputTokens,
      output: u.outputTokens,
      cacheRead: u.cacheReadTokens,
      cacheWrite: u.cacheWriteTokens,
    };
  }
  if (format === 'codex') {
    const t = await parseCodexTokenTotals(source);
    return t ? { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: 0 } : null;
  }
  if (format === 'opencode') {
    const u = await parseOpenCodeSessionUsage(session.filePath);
    return u
      ? {
          input: u.inputTokens,
          output: u.outputTokens,
          cacheRead: u.cacheReadTokens,
          cacheWrite: u.cacheWriteTokens,
        }
      : null;
  }
  return null;
}

async function compareSource(
  format: string,
  adapter: (typeof diskAdapters)[number],
  source: string,
  row: Row | undefined,
  ingest: InstanceType<CrateModule['Ingest']>
): Promise<void> {
  const s = stat(format);
  s.sources++;
  const found: Mismatch[] = [];
  const out = (category: string, detail: string) => found.push({ category, source, detail });

  const t0 = performance.now();
  let session: ParsedSession | null = null;
  try {
    session = await adapter.parseFile(source);
  } catch (error) {
    out('ts:parse-error', String(error));
  }
  const conversation = session
    ? sessionToConversation({ ...session, messages: session.messages.map((m) => ({ ...m })) })
    : null;
  tsParseMs += performance.now() - t0;
  const tsListed = conversation !== null && conversation.messages.length > 0;
  if (tsListed) s.listedTs++;
  if (row) s.listedCrate++;

  if (tsListed && !row)
    out(
      'presence:ts-only',
      `${conversation?.sessionId} (${conversation?.messages.length} messages)`
    );
  if (!tsListed && row)
    out('presence:crate-only', `${row.sessionId} (${row.messageCount} messages)`);
  if (tsListed && row && session && conversation) {
    if (conversation.sessionId !== row.sessionId)
      out('sessionId', `ts ${conversation.sessionId} crate ${row.sessionId}`);
    if (conversation.provider !== row.provider)
      out('provider', `ts ${conversation.provider} crate ${row.provider}`);
    const crateCwd = row.cwd.t === 'unknown' ? null : row.cwd.path;
    if (crateCwd === null) {
      if (conversation.workingDirectory !== path.resolve(process.cwd()))
        out('cwd', `ts ${conversation.workingDirectory} crate unknown`);
      else out('cwd:ts-process-cwd', conversation.workingDirectory);
    } else if (crateCwd !== conversation.workingDirectory) {
      out('cwd', `ts ${conversation.workingDirectory} crate ${crateCwd} (${row.cwd.t})`);
    }
    if ((conversation.title ?? null) !== (row.title ?? null))
      out('title', `ts ${snippet(conversation.title)} crate ${snippet(row.title)}`);
    if (identityOf(conversation) !== crateIdentity(row))
      out('identity', `ts ${identityOf(conversation)} crate ${crateIdentity(row)}`);
    if ((conversation.swarmDebugPrefix ?? null) !== (row.swarmDebugPrefix ?? null))
      out(
        'swarmDebugPrefix',
        `ts ${snippet(conversation.swarmDebugPrefix)} crate ${snippet(row.swarmDebugPrefix)}`
      );
    if ((conversation.parentConversationId ?? null) !== (row.parentSessionId ?? null))
      out(
        'parentSessionId',
        `ts ${conversation.parentConversationId} crate ${row.parentSessionId}`
      );
    const observed = session.model === 'unknown' ? null : session.model;
    if (observed !== (row.observedModel ?? null))
      out('model', `ts ${observed} crate ${row.observedModel}`);
    if (row.messageCount !== conversation.messages.length)
      out('messageCount', `ts ${conversation.messages.length} crate ${row.messageCount}`);
    // `messages(sessionId)` serves the most recently active copy of a duplicated id (6 Cursor
    // transcripts exist in two project directories); read those by source instead.
    const messages = duplicated.has(row.sessionId)
      ? messagesBySource(source)
      : await ingest.messages(row.sessionId, { afterSeq: -1, limit: 1_000_000 });
    compareMessages(format, conversation.messages, messages, out);
    if (row.timeFrom === 'transcript') {
      if (session.createdAt.getTime() !== row.createdAt)
        out(
          'time:createdAt',
          `ts ${session.createdAt.toISOString()} crate ${new Date(row.createdAt).toISOString()}`
        );
      if (session.modifiedAt.getTime() !== row.activityAt)
        out(
          'time:activityAt',
          `ts ${session.modifiedAt.toISOString()} crate ${new Date(row.activityAt).toISOString()}`
        );
    } else if (format !== 'cursor') {
      out(
        'time:ts-now',
        `no transcript time; ts ${session.createdAt.toISOString()} crate file mtime`
      );
    }
    const usage = await tsUsage(format, source, session);
    const rsUsage = row.usage ?? null;
    if (
      JSON.stringify(usage) !==
      JSON.stringify(
        rsUsage && {
          input: rsUsage.input,
          output: rsUsage.output,
          cacheRead: rsUsage.cacheRead,
          cacheWrite: rsUsage.cacheWrite,
        }
      )
    ) {
      out('usage', `ts ${JSON.stringify(usage)} crate ${JSON.stringify(rsUsage)}`);
    }
  }
  // Reclassify: a source written after the crate scanned it, or one whose bytes hold a raw
  // U+2028/U+2029 that readline (TS Codex/Cursor/Muse) splits on.
  // A source deleted mid-run (Muse rewrites its snapshots) counts as changed.
  const mtime = fs.existsSync(source) ? fs.statSync(source).mtimeMs : Number.NaN;
  const scanned = scannedMtime.get(source);
  const live = Number.isNaN(mtime) || (scanned !== undefined && Math.abs(scanned - mtime) > 1);
  const readlineFormat = format === 'codex' || format === 'cursor' || format === 'muse';
  const lineSeparators =
    !live &&
    readlineFormat &&
    found.some((m) => !(m.category in KNOWN_TS_DEFECTS)) &&
    hasLineSeparator(source);
  for (const m of found) {
    if (m.category in KNOWN_TS_DEFECTS) continue;
    if (live) m.category = 'live:changed-during-run';
    else if (lineSeparators) m.category = 'ts:readline-splits-u2028';
  }
  if (found.length === 0) s.exact++;
  else if (found.every((m) => m.category in KNOWN_TS_DEFECTS)) s.knownOnly++;
  else s.withMismatch++;
  mismatches.push(...found);
}

const duplicated = new Set<string>();
/** Each source's mtime as the crate's initial scan stamped it. */
const scannedMtime = new Map<string, number>();

function hasLineSeparator(source: string): boolean {
  const bytes = fs.readFileSync(source);
  // U+2028 / U+2029 in UTF-8: E2 80 A8 / E2 80 A9.
  for (
    let i = bytes.indexOf(0xe2);
    i !== -1 && i < bytes.length - 2;
    i = bytes.indexOf(0xe2, i + 1)
  ) {
    if (bytes[i + 1] === 0x80 && (bytes[i + 2] === 0xa8 || bytes[i + 2] === 0xa9)) return true;
  }
  return false;
}
/**
 * Direct store reads go through the sqlite3 CLI, a separate process. Opening the store with a
 * second SQLite library in THIS process (node:sqlite) crashed the first full run with SIGBUS:
 * POSIX locks are per process, so closing node's handle dropped the crate's locks, and node's
 * connection then truncated the WAL index the crate had mapped (2026-09-25).
 */
function sql(query: string): Array<Record<string, unknown>> {
  const out = execFileSync('sqlite3', ['-readonly', '-json', dbPath as string, query], {
    maxBuffer: 1 << 30,
  }).toString();
  return out.trim() ? JSON.parse(out) : [];
}

function messagesBySource(source: string): CrateMessage[] {
  const rows = sql(
    `SELECT m.seq, m.role, m.at, m.completed_at, m.content, m.tool_name, m.tool_input FROM message m
     JOIN source s ON s.id = m.source_id WHERE s.path = '${source.replaceAll("'", "''")}' ORDER BY m.seq`
  );
  return rows.map((r) => ({
    seq: Number(r.seq),
    role: r.role as CrateMessage['role'],
    at: (r.at as number | null) ?? undefined,
    completedAt: (r.completed_at as number | null) ?? undefined,
    content: String(r.content),
    toolCall: r.tool_name
      ? { name: String(r.tool_name), input: (r.tool_input as string | null) ?? undefined }
      : undefined,
  }));
}

async function main(): Promise<void> {
  const roots = crate
    .defaultRoots(os.homedir())
    .filter((r) => !onlyFormat || r.format === onlyFormat);
  if (process.argv.includes('--fresh'))
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  const t0 = performance.now();
  const ingest = await crate.Ingest.start(roots, dbPath as string, () => {});
  const crateMs = performance.now() - t0;
  const page = await ingest.listSessions({ since: 0 });
  const rows = new Map(page.rows.map((r) => [r.sourcePath, r]));
  for (const r of sql('SELECT path, stamp FROM source')) {
    scannedMtime.set(String(r.path), JSON.parse(String(r.stamp)).mtime_ms);
  }
  const seen = new Set<string>();
  for (const r of page.rows) (seen.has(r.sessionId) ? duplicated : seen).add(r.sessionId);
  console.error(
    `crate: ${page.rows.length} listed rows, start ${crateMs.toFixed(0)} ms (${JSON.stringify(ingest.initialScan)})`
  );

  const pending: Promise<void>[] = [];
  const CONCURRENCY = 4;
  for (const adapter of diskAdapters) {
    if (onlyFormat && adapter.provider !== onlyFormat) continue;
    const sources = (await adapter.discoverFiles()).slice(0, limit);
    console.error(`${adapter.provider}: ${sources.length} sources`);
    let index = 0;
    const worker = async () => {
      while (index < sources.length) {
        const source = sources[index++];
        await compareSource(adapter.provider, adapter, source, rows.get(source), ingest);
        rows.delete(source);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }
  for (const [source, row] of rows) {
    if (Number.isFinite(limit) || (onlyFormat && row.format !== onlyFormat)) continue;
    mismatches.push({
      category: 'presence:crate-only-undiscovered',
      source,
      detail: `${row.sessionId} is a source TS discovery does not list`,
    });
  }
  await Promise.all(pending);
  await ingest.stop();

  const byCategory = new Map<string, Mismatch[]>();
  for (const m of mismatches)
    byCategory.set(m.category, [...(byCategory.get(m.category) ?? []), m]);
  const lines: string[] = [];
  lines.push(
    '| format | sources | listed (TS) | listed (crate) | exact | known TS defects only | unexplained | match rate |'
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const [format, s] of perFormat) {
    const rate = s.sources === 0 ? 0 : ((s.exact + s.knownOnly) / s.sources) * 100;
    lines.push(
      `| ${format} | ${s.sources} | ${s.listedTs} | ${s.listedCrate} | ${s.exact} | ${s.knownOnly} | ${s.withMismatch} | ${rate.toFixed(2)}% |`
    );
  }
  lines.push(
    '',
    `TS parse time (adapters, no cache, concurrency ${CONCURRENCY}): ${(tsParseMs / 1000).toFixed(1)} s cumulative`,
    ''
  );
  lines.push('| category | kind | sessions | example |', '|---|---|---|---|');
  for (const [category, list] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    const kind = category in KNOWN_TS_DEFECTS ? 'explained' : 'UNEXPLAINED';
    const example = `${path.basename(list[0].source)}: ${list[0].detail}`
      .replace(/\|/g, '\\|')
      .slice(0, 300);
    lines.push(
      `| ${category} | ${kind} | ${new Set(list.map((m) => m.source)).size} | ${example} |`
    );
  }
  console.log(lines.join('\n'));
  if (jsonOut) {
    const examples = Object.fromEntries([...byCategory].map(([c, list]) => [c, list.slice(0, 20)]));
    fs.writeFileSync(
      jsonOut,
      JSON.stringify(
        {
          perFormat: Object.fromEntries(perFormat),
          counts: Object.fromEntries([...byCategory].map(([c, l]) => [c, l.length])),
          examples,
          knownTsDefects: KNOWN_TS_DEFECTS,
          crateStartMs: crateMs,
          tsParseMs,
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
