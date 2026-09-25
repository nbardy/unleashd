/**
 * Conversation records (T23a): the TS config store and the Rust records table, side by side on
 * the same COPY of `conversation-config/v1`.
 *
 *   pnpm exec tsx tools/records-parity.ts --app-data <dir holding conversation-config/v1> --db <imported.sqlite>
 *
 * 1. Timing: config-store.ts `list()` (today's startup scan: readdir + read + JSON.parse + Zod of
 *    every file) vs the addon's `listSummaries()`, each on a fresh instance, 5 runs.
 * 2. Parity: every record config-store.ts serves (Zod-parsed, defaults filled) equals the
 *    addon's `get()` of the same id, compared as canonical JSON; and for every bound session,
 *    `findBySession` answers the same conversation on both sides.
 * 3. One `setConfig` CAS latency through the addon, on a scratch copy of the database.
 *
 * Point --app-data at a copy: config-store.ts moves a record it cannot parse into quarantine/.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { ConversationConfigStore } from '../server/src/conversations/config-store';

const crate: typeof import('../crates/unleashd-ingest/index') = createRequire(import.meta.url)(
  '../crates/unleashd-ingest/index.js'
);

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const appDataRoot = path.resolve(arg('app-data'));
  const db = path.resolve(arg('db'));
  const runs = 5;

  const tsMs: number[] = [];
  let tsRecords: Awaited<ReturnType<ConversationConfigStore['list']>> = [];
  for (let run = 0; run < runs; run += 1) {
    const store = new ConversationConfigStore({ appDataRoot });
    const t = performance.now();
    tsRecords = await store.list();
    tsMs.push(performance.now() - t);
  }

  const rustMs: number[] = [];
  let summaries: Awaited<
    ReturnType<InstanceType<typeof crate.ConversationRecords>['listSummaries']>
  > = [];
  for (let run = 0; run < runs; run += 1) {
    const t = performance.now();
    const records = await crate.ConversationRecords.open(db);
    summaries = await records.listSummaries();
    rustMs.push(performance.now() - t);
  }

  const records = await crate.ConversationRecords.open(db);
  let equal = 0;
  const differ: string[] = [];
  for (const ts of tsRecords) {
    const stored = await records.get(ts.conversationId);
    if (stored && canonical(ts) === canonical({ version: 1, ...stored })) equal += 1;
    else differ.push(ts.conversationId);
  }

  const tsStore = new ConversationConfigStore({ appDataRoot });
  let lookups = 0;
  const lookupDiffer: string[] = [];
  for (const record of tsRecords) {
    const bindings = [
      ...record.sessionBindings,
      ...(record.currentSession ? [record.currentSession] : []),
    ];
    for (const binding of bindings) {
      lookups += 1;
      const [a, b] = await Promise.all([
        tsStore.findBySession(binding.provider, binding.sessionId),
        records.findBySession(binding.provider, binding.sessionId),
      ]);
      if (a?.conversationId !== b?.conversationId) {
        lookupDiffer.push(
          `${binding.provider}/${binding.sessionId}: ts=${a?.conversationId} rust=${b?.conversationId}`
        );
      }
    }
  }

  // CAS latency on a scratch copy, so the imported database stays as imported.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'records-cas-'));
  const scratchDb = path.join(scratch, 'records.sqlite');
  fs.copyFileSync(db, scratchDb);
  const writable = await crate.ConversationRecords.open(scratchDb);
  const target = tsRecords.find((r) => r.status === 'active' && r.lastResolvedConfig);
  if (!target?.lastResolvedConfig) throw new Error('no active resolved record to update');
  let revision = target.configRevision;
  const casMs: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const t = performance.now();
    const outcome = await writable.setConfig(
      {
        conversationId: target.conversationId,
        expectedConfigRevision: revision,
        config: target.config,
        lastResolvedConfig: target.lastResolvedConfig,
      },
      Date.now()
    );
    casMs.push(performance.now() - t);
    if (outcome.t !== 'committed') throw new Error(`unexpected ${outcome.t}`);
    revision = outcome.record.configRevision;
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  const sorted = [...casMs].sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        records: { ts: tsRecords.length, rust: summaries.length },
        listMs: {
          tsConfigStoreList: { median: median(tsMs), runs: tsMs },
          rustListSummaries: { median: median(rustMs), runs: rustMs },
        },
        parity: { equal, differ: differ.length, differSample: differ.slice(0, 5) },
        findBySession: {
          lookups,
          differ: lookupDiffer.length,
          differSample: lookupDiffer.slice(0, 5),
        },
        setConfigThroughAddonMs: {
          p50: sorted[Math.floor(sorted.length * 0.5)],
          p90: sorted[Math.floor(sorted.length * 0.9)],
          max: sorted[sorted.length - 1],
        },
        loadAverage: os.loadavg(),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
