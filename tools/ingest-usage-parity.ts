/**
 * Usage + context parity: the server's usage/cost parsers (http/usage-routes.ts) and context
 * meter (conversations/session-context.ts) versus the ingest crate's `usage()` and
 * `latestContext()`, over the REAL local provider roots.
 *
 *   pnpm exec tsx tools/ingest-usage-parity.ts --db /path/outside/the/repo/usage.sqlite [--fresh]
 *        [--days 30] [--json out.json]
 *
 * Read-only on the transcript roots: the crate writes only its store at --db, and the TS side
 * only reads. Three comparisons:
 *   1. per source, all-time token totals and model (what /api/usage computes per session);
 *   2. per session id, the context meter's reading;
 *   3. the /api/usage response for --days, TS handler vs the same numbers from `usage()`.
 * Every difference gets a category; `live:changed-during-run` is a transcript written after the
 * crate scanned it. Kept for T13b, which switches the server over.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { lookupSessionContext } from '../server/src/conversations/session-context';
import {
  parseClaudeSession,
  parseCodexTokenTotals,
  registerUsageRoutes,
} from '../server/src/http/usage-routes';

type CrateModule = typeof import('../crates/unleashd-ingest/index');
type UsageGroup = import('../crates/unleashd-ingest/index').UsageGroup;
const crate: CrateModule = createRequire(import.meta.url)('../crates/unleashd-ingest/index.js');

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}
const dbPath = arg('db');
if (!dbPath) throw new Error('--db <path> is required (a scratch store outside the repo)');
const days = Number(arg('days') ?? 30);
const jsonOut = arg('json');

type Mismatch = { check: string; category: string; key: string; detail: string };
const mismatches: Mismatch[] = [];
const tally = new Map<string, { compared: number; exact: number }>();
function count(check: string, exact: boolean) {
  const t = tally.get(check) ?? { compared: 0, exact: 0 };
  t.compared++;
  if (exact) t.exact++;
  tally.set(check, t);
}

/** Direct store reads go through the sqlite3 CLI (another process), never node:sqlite: see T12. */
function sql(query: string): Array<Record<string, unknown>> {
  const out = execFileSync('sqlite3', ['-json', dbPath as string, query], {
    maxBuffer: 1 << 30,
  }).toString();
  return out.trim() ? JSON.parse(out) : [];
}

const scannedMtime = new Map<string, number>();
function live(source: string): boolean {
  const scanned = scannedMtime.get(source);
  if (!fs.existsSync(source)) return true;
  return scanned !== undefined && Math.abs(fs.statSync(source).mtimeMs - scanned) > 1;
}

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

async function usageBySource(groups: UsageGroup[]): Promise<void> {
  const crateBy = new Map<string, UsageGroup>();
  for (const g of groups) if (g.key.t === 'session') crateBy.set(g.key.sourcePath, g);
  const undated = new Map(
    sql(
      'SELECT s.path AS path, count(*) AS n FROM usage_turn t JOIN source s ON s.id = t.source_id WHERE t.at IS NULL GROUP BY 1'
    ).map((r) => [String(r.path), Number(r.n)])
  );
  const sources = sql("SELECT path, format FROM source WHERE format IN ('claude', 'codex')");
  for (const { path: p, format } of sources as Array<{ path: string; format: string }>) {
    const key = p;
    let ts: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      model: string | null;
    } | null = null;
    if (format === 'claude') {
      const u = await parseClaudeSession(p, await fs.promises.stat(p));
      ts = {
        input: u.inputTokens,
        output: u.outputTokens,
        cacheRead: u.cacheReadTokens,
        cacheWrite: u.cacheWriteTokens,
        model: u.model === 'unknown' ? null : u.model,
      };
    } else {
      const t = await parseCodexTokenTotals(p);
      ts = t && {
        input: t.input,
        output: t.output,
        cacheRead: t.cacheRead,
        cacheWrite: 0,
        model: null,
      };
    }
    const tsHas = ts !== null && ts.input + ts.output + ts.cacheRead + ts.cacheWrite !== 0;
    const g = crateBy.get(p);
    if (!tsHas && !g) continue;
    const found: string[] = [];
    let category = 'usage:totals';
    if (!g || !ts) {
      category = !g && undated.has(p) ? 'crate:undated-turns' : `usage:${g ? 'crate' : 'ts'}-only`;
      found.push(`ts ${JSON.stringify(ts)} crate ${JSON.stringify(g ?? null)}`);
    } else {
      if (
        !same(ts.input, g.input) ||
        !same(ts.output, g.output) ||
        !same(ts.cacheRead, g.cacheRead) ||
        !same(ts.cacheWrite, g.cacheWrite)
      ) {
        category = undated.has(p) ? 'crate:undated-turns' : 'usage:totals';
        found.push(
          `ts ${ts.input}/${ts.output}/${ts.cacheRead}/${ts.cacheWrite} crate ${g.input}/${g.output}/${g.cacheRead}/${g.cacheWrite}`
        );
      }
      const crateModel = g.key.t === 'session' ? (g.key.model ?? null) : null;
      if (format === 'claude' && ts.model !== crateModel) {
        mismatches.push({
          check: 'usage',
          category: 'usage:model',
          key,
          detail: `ts ${ts.model} crate ${crateModel}`,
        });
      }
    }
    if (found.length > 0 && live(p)) category = 'live:changed-during-run';
    for (const detail of found) mismatches.push({ check: 'usage', category, key, detail });
    count(`usage:${format}`, found.length === 0);
  }
}

async function contextBySession(ingest: InstanceType<CrateModule['Ingest']>): Promise<void> {
  const rows = sql(
    "SELECT DISTINCT session_id AS id, format, source_path AS path FROM session WHERE format IN ('claude', 'codex', 'muse')"
  ) as Array<{ id: string; format: string; path: string }>;
  const seen = new Set<string>();
  let index = 0;
  const worker = async () => {
    while (index < rows.length) {
      const { id, format, path: p } = rows[index++];
      if (seen.has(id)) continue;
      seen.add(id);
      const [ts, rs] = await Promise.all([lookupSessionContext(id), ingest.latestContext(id)]);
      if (ts === null && (rs ?? null) === null) continue;
      const norm = (r: typeof ts) =>
        r && {
          tokens: r.contextTokens,
          window: r.contextWindow ?? null,
          compaction: r.compaction
            ? [
                r.compaction.count,
                r.compaction.preTokens ?? null,
                r.compaction.postTokens ?? null,
                r.compaction.trigger ?? null,
              ]
            : null,
        };
      const a = JSON.stringify(norm(ts));
      const b = JSON.stringify(norm((rs ?? null) as typeof ts));
      const exact = a === b;
      count(`context:${format}`, exact);
      if (!exact) {
        // TS findMuseSessionFile only probes `<Y/M/D>/<id>/session.jsonl`, so the meter never
        // finds a Muse child session (`…/approval-review/<id>.jsonl`); the crate reads it like any other.
        const tsMissesChild = !ts && format === 'muse' && !p.endsWith(`/${id}/session.jsonl`);
        const category = live(p)
          ? 'live:changed-during-run'
          : tsMissesChild
            ? 'ts:muse-child-session-not-looked-up'
            : `context:${!ts ? 'crate-only' : !rs ? 'ts-only' : 'reading'}`;
        mismatches.push({
          check: 'context',
          category,
          key: `${format} ${id}`,
          detail: `ts ${a} crate ${b}`,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
}

/** The TS /api/usage handler, called in-process with a stub app. */
async function tsRoute(): Promise<Record<string, unknown>> {
  let handler: ((req: unknown, res: unknown) => Promise<void>) | null = null;
  const app = {
    get: (_p: string, h: typeof handler) => {
      handler = h;
    },
  } as unknown as Parameters<typeof registerUsageRoutes>[0];
  registerUsageRoutes(app, ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'muse']);
  return new Promise((resolve) => {
    void handler?.({ query: { days: String(days) } }, { json: resolve });
  });
}

/** The same response computed from `usage()`, with the route's inclusion rules and prices. */
async function crateRoute(ingest: InstanceType<CrateModule['Ingest']>) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const report = await ingest.usage({ since: cutoff.getTime(), groupBy: 'session' });
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalSessions = 0;
  for (const g of report.groups) {
    if (g.key.t !== 'session') continue;
    const claude = g.key.format === 'claude';
    const keep = claude ? g.input + g.output > 0 : g.input + g.cacheRead + g.output > 0;
    if (!keep) continue;
    totalSessions++;
    totalInputTokens += g.input;
    totalOutputTokens += g.output;
    totalCostUsd += claude
      ? (g.input * 3 + g.output * 15 + g.cacheRead * 0.3 + g.cacheWrite * 3.75) / 1e6
      : g.reportedCostUsd || (g.input * 2.5 + g.output * 10 + g.cacheRead * 0.25) / 1e6;
  }
  return {
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    totalSessions,
    codexRateLimits: report.codexRateLimits,
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--fresh'))
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  const t0 = performance.now();
  const ingest = await crate.Ingest.start(
    crate.defaultRoots(os.homedir()),
    dbPath as string,
    () => {}
  );
  console.error(
    `crate start ${(performance.now() - t0).toFixed(0)} ms ${JSON.stringify(ingest.initialScan.fullReasons)}`
  );
  for (const r of sql('SELECT path, stamp FROM source'))
    scannedMtime.set(String(r.path), JSON.parse(String(r.stamp)).mtime_ms);

  const allTime = await ingest.usage({ since: 0, groupBy: 'session' });
  let t = performance.now();
  await usageBySource(allTime.groups);
  console.error(`usage per source: ${((performance.now() - t) / 1000).toFixed(1)} s`);
  t = performance.now();
  await contextBySession(ingest);
  console.error(`context per session: ${((performance.now() - t) / 1000).toFixed(1)} s`);
  t = performance.now();
  const tsResponse = await tsRoute();
  const tsRouteMs = performance.now() - t;
  t = performance.now();
  const crateResponse = await crateRoute(ingest);
  const crateRouteMs = performance.now() - t;
  await ingest.stop();

  const lines: string[] = ['| check | compared | exact | match |', '|---|---|---|---|'];
  for (const [check, s] of [...tally].sort()) {
    lines.push(
      `| ${check} | ${s.compared} | ${s.exact} | ${((s.exact / s.compared) * 100).toFixed(2)}% |`
    );
  }
  const byCategory = new Map<string, Mismatch[]>();
  for (const m of mismatches)
    byCategory.set(`${m.check} ${m.category}`, [
      ...(byCategory.get(`${m.check} ${m.category}`) ?? []),
      m,
    ]);
  lines.push('', '| category | count | example |', '|---|---|---|');
  for (const [category, list] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    const example = `${path.basename(list[0].key)}: ${list[0].detail}`
      .replace(/\|/g, '\\|')
      .slice(0, 260);
    lines.push(`| ${category} | ${list.length} | ${example} |`);
  }
  const pick = (r: Record<string, unknown>) => ({
    totalCostUsd: Number(r.totalCostUsd).toFixed(2),
    totalInputTokens: r.totalInputTokens,
    totalOutputTokens: r.totalOutputTokens,
    totalSessions: r.totalSessions,
  });
  const tsCodexLimits = ((tsResponse.rateLimits as Record<string, unknown[]>)?.codex ?? []).length;
  lines.push(
    '',
    `/api/usage?days=${days}: TS ${JSON.stringify(pick(tsResponse))} in ${tsRouteMs.toFixed(0)} ms`,
    `from usage():       ${JSON.stringify(pick(crateResponse))} in ${crateRouteMs.toFixed(0)} ms`,
    `codex rate limits: TS ${tsCodexLimits} windows, crate ${crateResponse.codexRateLimits ? 'present' : 'absent'}`
  );
  console.log(lines.join('\n'));
  if (jsonOut) {
    const examples = Object.fromEntries([...byCategory].map(([c, list]) => [c, list.slice(0, 20)]));
    fs.writeFileSync(
      jsonOut,
      JSON.stringify(
        { tally: Object.fromEntries(tally), examples, tsResponse, crateResponse },
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
