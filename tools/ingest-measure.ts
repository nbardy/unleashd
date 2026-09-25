/**
 * Measurements for the ingest crate against the current TS loader, on the real local roots.
 * Run each mode in its own process so peak RSS belongs to that mode alone.
 *
 *   pnpm exec tsx tools/ingest-measure.ts crate-cold  --db <scratch>/m.sqlite
 *   pnpm exec tsx tools/ingest-measure.ts crate-warm  --db <scratch>/m.sqlite
 *   pnpm exec tsx tools/ingest-measure.ts crate-tail  --scratch <dir> --format codex --source <file> [--appends 10]
 *   pnpm exec tsx tools/ingest-measure.ts ts-cold
 *   pnpm exec tsx tools/ingest-measure.ts ts-startup  --cache <a COPY of ~/.agent-viewer/session-cache-v1> [--limit 500]
 *   pnpm exec tsx tools/ingest-measure.ts ts-reparse  --format codex --source <file>
 *
 * Read-only on the transcript roots and on ~/.agent-viewer: `crate-tail` appends to an APFS
 * clone in --scratch, and `ts-startup` must be given a copy of the cache (the loader prunes it).
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { loadAllConversations } from '../server/src/adapters/loader';
import { getDiskAdapter } from '../server/src/adapters/registry';
import { NormalizedSessionCache } from '../server/src/adapters/session-cache';

const crate: typeof import('../crates/unleashd-ingest/index') = createRequire(import.meta.url)(
  '../crates/unleashd-ingest/index.js'
);

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}
const peakRssMb = () => Math.round(process.resourceUsage().maxRSS / 1024);
const mb = (bytes: number) => Math.round(bytes / 1e5) / 10;
function dbBytes(db: string): number {
  return ['', '-wal'].reduce(
    (sum, s) => sum + (fs.existsSync(db + s) ? fs.statSync(db + s).size : 0),
    0
  );
}
function report(result: Record<string, unknown>): void {
  console.log(JSON.stringify({ ...result, peakRssMb: peakRssMb() }));
}

async function crateStart(db: string) {
  const t0 = performance.now();
  const ingest = await crate.Ingest.start(crate.defaultRoots(os.homedir()), db, () => {});
  return { ingest, ms: performance.now() - t0 };
}

const TAIL_LINES: Record<string, (n: number) => string> = {
  // A response-item reply: the 934 MB rollout has no event messages, and an event message
  // would (correctly) switch it to event mode and force one full re-read.
  codex: (n) =>
    `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: `measure ${n}` }] } })}\n`,
  claude: (n) =>
    `${JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: `m${n}`, content: [{ type: 'text', text: `measure ${n}` }] } })}\n`,
};

/** Where a clone of `source` must sit under a scratch root for the crate to see it. */
function scratchLayout(
  format: string,
  scratch: string,
  source: string
): { root: string; file: string } {
  const root = path.join(scratch, `${format}-root`);
  const rel =
    format === 'codex'
      ? path.join('2026', '09', '25', path.basename(source))
      : path.join('-scratch', path.basename(source));
  return { root, file: path.join(root, rel) };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'crate-cold' || mode === 'crate-warm') {
    const db = required('db');
    if (mode === 'crate-cold')
      for (const s of ['', '-wal', '-shm']) fs.rmSync(db + s, { force: true });
    const { ingest, ms } = await crateStart(db);
    const page = await ingest.listSessions({ since: 0 });
    const scan = ingest.initialScan;
    await ingest.stop();
    report({
      mode,
      startMs: Math.round(ms),
      rows: page.rows.length,
      sources: scan.sources,
      full: scan.full,
      resumed: scan.resumed,
      unchanged: scan.unchanged,
      gbRead: mb(scan.bytesRead) / 1000,
      messages: scan.messagesWritten,
      dbMb: mb(dbBytes(db)),
    });
    return;
  }
  if (mode === 'crate-tail') {
    const format = required('format');
    const source = required('source');
    const appends = Number(arg('appends') ?? 10);
    const { root, file } = scratchLayout(format, required('scratch'), source);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A clone where the filesystem supports it, else a copy: appends never reach the original.
    fs.copyFileSync(source, file, fs.constants.COPYFILE_FICLONE);
    const db = path.join(path.dirname(root), `${format}-tail.sqlite`);
    for (const s of ['', '-wal', '-shm']) fs.rmSync(db + s, { force: true });
    let waiter: (() => void) | null = null;
    const t0 = performance.now();
    const ingest = await crate.Ingest.start(
      [{ format: format as 'codex', path: root }],
      db,
      (event) => {
        if (event.t === 'changes' && event.sessionIds.length > 0) waiter?.();
      }
    );
    const coldMs = performance.now() - t0;
    const latencies: number[] = [];
    for (let n = 0; n < appends; n++) {
      const seen = new Promise<void>((resolve) => {
        waiter = resolve;
      });
      const start = performance.now();
      fs.appendFileSync(file, TAIL_LINES[format](n));
      await seen;
      latencies.push(performance.now() - start);
      await new Promise((r) => setTimeout(r, 100));
    }
    const page = await ingest.listSessions({ since: 0 });
    const last = await ingest.messages(page.rows[0].sessionId, {
      afterSeq: page.rows[0].messageCount - 2,
      limit: 5,
    });
    await ingest.stop();
    latencies.sort((a, b) => a - b);
    report({
      mode,
      format,
      fileMb: mb(fs.statSync(source).size),
      fullReadMs: Math.round(coldMs),
      appendToOnChangeMs: {
        p50: Math.round(latencies[Math.floor(latencies.length / 2)]),
        max: Math.round(latencies.at(-1) ?? 0),
        all: latencies.map(Math.round),
      },
      lastMessage: last.at(-1)?.content,
    });
    return;
  }
  if (mode === 'ts-cold' || mode === 'ts-startup') {
    const cacheDir = mode === 'ts-startup' ? required('cache') : null;
    if (cacheDir?.startsWith(path.join(os.homedir(), '.agent-viewer')))
      throw new Error('pass a COPY of the cache, never the live one');
    const limit = arg('limit') ? Number(arg('limit')) : undefined;
    const t0 = performance.now();
    const result = await loadAllConversations({
      cache: cacheDir ? new NormalizedSessionCache(cacheDir) : undefined,
      limit,
      // The server's startup settings (server.ts CWV_STARTUP_*).
      concurrency: 16,
      batchSize: 100,
      initialBatchSize: 20,
    });
    const ms = performance.now() - t0;
    let messages = 0;
    for (const c of result.conversations.values()) messages += c.messages.length;
    report({
      mode,
      ms: Math.round(ms),
      conversations: result.conversations.size,
      messages,
      limit: limit ?? 'all',
      heapMb: mb(process.memoryUsage().heapUsed),
    });
    return;
  }
  if (mode === 'ts-reparse') {
    const adapter = getDiskAdapter(required('format') as 'codex');
    const t0 = performance.now();
    const session = await adapter.parseFile(required('source'));
    report({ mode, ms: Math.round(performance.now() - t0), messages: session?.messages.length });
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
