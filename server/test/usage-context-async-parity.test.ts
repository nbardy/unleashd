/**
 * `/api/usage`, the per-session usage lookup and the context meter, end to end through the REAL
 * ingest crate (`Ingest.start` over a fixture HOME) and the server's read models of it.
 *
 * Until 2026-09-26 the server re-parsed transcripts itself for these (usage-routes.ts 788 lines,
 * session-context.ts 421). The per-source totals and context readings below are the numbers that
 * TS implementation recorded on this exact fixture (lean/integration @ ab47223), so this is the
 * parity guard of the switch. What deliberately changed: a usage window now counts REQUESTS by
 * their own time (the old parser credited a whole Claude session to its file mtime), and each
 * daily row is priced per provider; see CLAUDE_OLD and the daily rows.
 *
 * The fixture is a real on-disk HOME for all four harness layouts. The large Claude transcript
 * spans several 1 MiB chunks with multi-byte characters on the boundaries, has no trailing
 * newline, a CRLF line, a malformed line, duplicate message ids, a sidechain row and a
 * compaction marker.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Ingest, defaultRoots } from '@unleashd/ingest';
import { lookupSessionContext } from '../src/conversations/session-context';
import { lookupProviderUsageForSession, usageResponse } from '../src/http/usage-routes';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CLAUDE_MAIN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CLAUDE_OLD = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const CODEX = 'cccccccc-3333-4333-8333-cccccccccccc';
const CODEX_ANCIENT = 'dddddddd-4444-4444-8444-dddddddddddd';
const OPENCODE = 'ses_opencode_fixture';
const MUSE = 'muse-session-fixture';

function localDayParts(ms: number): [string, string, string] {
  const d = new Date(ms);
  return [
    String(d.getFullYear()),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ];
}

function writeFile(file: string, content: string, mtimeMs?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mtimeMs !== undefined) fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

function buildFixture(home: string, now: number): void {
  // --- Claude: one large current session, one 40-day-old session -------------
  const assistant = (
    id: string,
    ts: number,
    usage: Record<string, number>,
    extra: Record<string, unknown> = {}
  ) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: new Date(ts).toISOString(),
      message: { id, model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'é' }] },
      ...extra,
    });
  // ~2 KiB of multi-byte filler per line so 1 MiB chunk edges land mid-character.
  const filler = (i: number) =>
    JSON.stringify({ type: 'user', message: { content: `${'日本語テキスト🙂'.repeat(90)} ${i}` } });
  const lines: string[] = [];
  lines.push(assistant('m1', now - 10 * DAY, { input_tokens: 100, output_tokens: 50 }));
  for (let i = 0; i < 700; i++) lines.push(filler(i));
  lines.push(
    assistant('m2', now - 2 * DAY, {
      input_tokens: 7,
      output_tokens: 300,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 2_500,
    })
  );
  // Same request id on a second content-block line: counted once for billing.
  lines.push(
    assistant('m2', now - 2 * DAY, {
      input_tokens: 7,
      output_tokens: 300,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 2_500,
    })
  );
  lines.push('{"type":"assistant", this line is malformed');
  for (let i = 700; i < 1400; i++) lines.push(filler(i));
  lines.push(
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      compactMetadata: { preTokens: 150_000, postTokens: 9_000, trigger: 'auto' },
    })
  );
  lines.push(
    `${assistant('m3', now - 3 * HOUR, {
      input_tokens: 3,
      output_tokens: 1_200,
      cache_read_input_tokens: 12_000,
      cache_creation_input_tokens: 800,
    })}\r`
  );
  // A subagent row: billed, but never the thread's own context.
  lines.push(
    assistant(
      'm4',
      now - 1 * HOUR,
      { input_tokens: 5, output_tokens: 70, cache_read_input_tokens: 90_000 },
      { isSidechain: true }
    )
  );
  // No trailing newline on the final line.
  writeFile(
    path.join(home, '.claude', 'projects', '-tmp-fixture-a', `${CLAUDE_MAIN}.jsonl`),
    lines.join('\n'),
    now - 1 * HOUR
  );
  writeFile(
    path.join(home, '.claude', 'projects', '-tmp-fixture-b', `${CLAUDE_OLD}.jsonl`),
    [
      assistant('o1', now - 40 * DAY, { input_tokens: 999, output_tokens: 999 }),
      // Per-request dating: only this request is in a 29-day window; the old parser
      // credited the whole session (1009 / 1019) to the file's mtime.
      assistant('o2', now - 1 * DAY, { input_tokens: 10, output_tokens: 20 }),
      '',
    ].join('\n'),
    now - 1 * DAY
  );

  // --- Codex: one current rollout, one outside both windows -------------------
  const tokenCount = (
    at: number,
    total: [number, number, number],
    last: number,
    extra: Record<string, unknown> = {}
  ) =>
    JSON.stringify({
      timestamp: new Date(at).toISOString(),
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: total[0],
            cached_input_tokens: total[1],
            output_tokens: total[2],
          },
          last_token_usage: { input_tokens: last },
          model_context_window: 272_000,
        },
        ...extra,
      },
    });
  const [cy, cm, cd] = localDayParts(now - 2 * DAY);
  writeFile(
    path.join(
      home,
      '.codex',
      'sessions',
      cy,
      cm,
      cd,
      `rollout-${cy}-${cm}-${cd}T10-00-00-${CODEX}.jsonl`
    ),
    [
      // Real rollouts open with session_meta and a user message; the store keeps a session only
      // when it has a visible message.
      JSON.stringify({
        timestamp: new Date(now - 2 * DAY).toISOString(),
        type: 'session_meta',
        payload: { id: CODEX, cwd: '/tmp/fixture' },
      }),
      JSON.stringify({
        timestamp: new Date(now - 2 * DAY).toISOString(),
        type: 'event_msg',
        payload: { type: 'user_message', message: 'go' },
      }),
      tokenCount(now - 2 * DAY, [10_000, 8_000, 500], 10_000),
      JSON.stringify({
        timestamp: new Date(now - 2 * DAY + 60_000).toISOString(),
        type: 'compacted',
        payload: { window_number: 1 },
      }),
      tokenCount(now - 2 * DAY + 60_000, [10_000, 8_000, 500], 0),
      tokenCount(now - 2 * DAY + 120_000, [55_000, 50_000, 2_000], 31_000, {
        rate_limits: {
          primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1_900_000_000 },
          secondary: { used_percent: 40, window_minutes: 10_080, resets_at: 1_900_500_000 },
        },
      }),
      '',
    ].join('\n'),
    now - 2 * DAY
  );
  const [ay, am, ad] = localDayParts(now - 45 * DAY);
  writeFile(
    path.join(
      home,
      '.codex',
      'sessions',
      ay,
      am,
      ad,
      `rollout-${ay}-${am}-${ad}T10-00-00-${CODEX_ANCIENT}.jsonl`
    ),
    `${tokenCount(now - 45 * DAY, [7, 0, 7], 7)}\n`,
    now - 45 * DAY
  );

  // --- OpenCode: one JSON file per message ------------------------------------
  const opencodeDir = path.join(
    home,
    '.local',
    'share',
    'opencode',
    'storage',
    'message',
    OPENCODE
  );
  const created = now - 4 * DAY;
  writeFile(
    path.join(opencodeDir, 'msg_1.json'),
    JSON.stringify({
      role: 'assistant',
      providerID: 'anthropic',
      modelID: 'claude-sonnet',
      tokens: { input: 1_000, output: 200, cache: { read: 5_000, write: 100 } },
      cost: 0,
      time: { created, completed: created + 5_000 },
    })
  );
  writeFile(
    path.join(opencodeDir, 'msg_2.json'),
    JSON.stringify({
      role: 'assistant',
      tokens: { input: 2_000, output: 400, cache: { read: 7_000, write: 0 } },
      cost: 0.0123,
      time: { created: created + 60_000 },
    })
  );
  writeFile(path.join(opencodeDir, 'msg_3.json'), JSON.stringify({ role: 'user' }));
  // The user message's text lives in its part file (`storage/part/<message>/`).
  writeFile(
    path.join(home, '.local', 'share', 'opencode', 'storage', 'part', 'msg_3', 'p1.json'),
    JSON.stringify({ type: 'text', text: 'hello' })
  );
  writeFile(path.join(opencodeDir, 'msg_4.json'), '{ truncated');

  // --- Muse: durable session log ---------------------------------------------
  const museStart = (now - 5 * DAY) * 1000; // microseconds, as muse writes them
  const museEvent = (event: Record<string, unknown>, i: number) =>
    JSON.stringify({
      stream: { kind: 'session', id: MUSE },
      recorded_at: museStart + i * 1000,
      payload_type: 'runtime.session',
      payload: { kind: 'run', event },
    });
  writeFile(
    path.join(
      home,
      '.local',
      'share',
      'muse',
      'sessions',
      '2026',
      '09',
      '20',
      MUSE,
      'session.jsonl'
    ),
    [
      museEvent({ kind: 'started', prompt: 'hi' }, 0),
      museEvent({ kind: 'model_completed', usage: { input_tokens: 22_690 } }, 1),
      museEvent(
        {
          kind: 'context_compaction_candidate',
          status: 'succeeded',
          trigger: 'soft',
          strategy: { target_budget_tokens: 160_000, config_fingerprint: 'soft=0.8;hard=0.95' },
        },
        2
      ),
      museEvent({ kind: 'model_completed', usage: { input_tokens: 23_158 } }, 3),
      '',
    ].join('\n')
  );
}

// Fixed clock: every request lands on a known UTC day (the -3h and -1h requests share one).
const NOW = Date.parse('2026-09-20T12:00:00Z');

test('usage, session usage and the context meter read the ingest store with the recorded numbers', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-usage-parity-'));
  buildFixture(home, NOW);
  const ingest = await Ingest.start(defaultRoots(home), path.join(home, 'ingest.sqlite'), () => {});
  try {
    const actual = JSON.parse(
      JSON.stringify({
        usage: await usageResponse(ingest, ['claude', 'codex', 'opencode'], 29, NOW),
        perSession: {
          claude: await lookupProviderUsageForSession(ingest, CLAUDE_MAIN),
          codex: await lookupProviderUsageForSession(ingest, CODEX),
          opencode: await lookupProviderUsageForSession(ingest, OPENCODE),
          missing: await lookupProviderUsageForSession(ingest, 'no-such-session'),
        },
        context: {
          claude: await lookupSessionContext(ingest, CLAUDE_MAIN),
          codex: await lookupSessionContext(ingest, CODEX),
          opencode: await lookupSessionContext(ingest, OPENCODE),
          muse: await lookupSessionContext(ingest, MUSE),
          missing: await lookupSessionContext(ingest, 'no-such-session'),
        },
      })
    );
    roundCosts(actual.usage);
    assert.deepEqual(actual, EXPECTED);
  } finally {
    await ingest.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/** Float sums differ in the last bits by summation order; compare cost to 1e-9 USD. */
function roundCosts(usage: {
  totalCostUsd: number;
  daily: { costUsd: number }[];
  topSessions: { costUsd: number }[];
}) {
  const r = (n: number) => Math.round(n * 1e9) / 1e9;
  usage.totalCostUsd = r(usage.totalCostUsd);
  for (const row of [...usage.daily, ...usage.topSessions]) row.costUsd = r(row.costUsd);
}

// Claude $3 / $15 / $0.30 / $3.75 per 1M (input, output, cache read, cache write); Codex $2.50 /
// $10 / $0.25 with cached input at a tenth (0.045 here, not 0.1525 as all-uncached); OpenCode's
// own recorded cost wins over any estimate.
const claudeMain = {
  sessionId: CLAUDE_MAIN,
  provider: 'claude',
  model: 'claude-opus-5-5',
  inputTokens: 115,
  outputTokens: 1620,
  cacheReadTokens: 142000,
  cacheWriteTokens: 3300,
};
const codex = {
  sessionId: CODEX,
  provider: 'codex',
  model: null,
  inputTokens: 5000,
  outputTokens: 2000,
  cacheReadTokens: 50000,
  cacheWriteTokens: 0,
};
const opencode = {
  sessionId: OPENCODE,
  provider: 'opencode',
  model: 'anthropic/claude-sonnet',
  inputTokens: 3000,
  outputTokens: 600,
  cacheReadTokens: 12000,
  cacheWriteTokens: 100,
};

const EXPECTED = {
  usage: {
    totalCostUsd: 0.13725,
    totalInputTokens: 8125,
    totalOutputTokens: 4240,
    totalSessions: 4,
    days: 29,
    daily: [
      // m3 + m4 (the sidechain request is billed).
      { date: '2026-09-20', inputTokens: 8, outputTokens: 1270, costUsd: 0.052674, sessions: 1 },
      { date: '2026-09-19', inputTokens: 10, outputTokens: 20, costUsd: 0.00033, sessions: 1 },
      // Claude m2 (0.025896) + Codex (0.045): two providers' prices on one day.
      { date: '2026-09-18', inputTokens: 5007, outputTokens: 2300, costUsd: 0.070896, sessions: 2 },
      { date: '2026-09-16', inputTokens: 3000, outputTokens: 600, costUsd: 0.0123, sessions: 1 },
      { date: '2026-09-10', inputTokens: 100, outputTokens: 50, costUsd: 0.00105, sessions: 1 },
    ],
    topSessions: [
      { ...claudeMain, costUsd: 0.07962, date: '2026-09-20' },
      { ...codex, costUsd: 0.045, date: '2026-09-18' },
      { ...opencode, costUsd: 0.0123, date: '2026-09-16' },
      {
        sessionId: CLAUDE_OLD,
        provider: 'claude',
        model: 'claude-opus-5-5',
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.00033,
        date: '2026-09-19',
      },
    ],
    rateLimits: {
      claude: [
        // 5h: m3 (1203) + m4 (75). Week: + m2 (307) + o2 (30).
        {
          label: '5h window',
          usedPercent: 0,
          windowMinutes: 300,
          resetsAt: null,
          tokenCount: 1278,
        },
        { label: 'Weekly', usedPercent: 0, windowMinutes: 10080, resetsAt: null, tokenCount: 1615 },
      ],
      codex: [
        { label: '5h limit', usedPercent: 12.5, windowMinutes: 300, resetsAt: 1900000000 },
        { label: 'Weekly limit', usedPercent: 40, windowMinutes: 10080, resetsAt: 1900500000 },
      ],
      opencode: [],
    },
  },
  perSession: {
    claude: { ...claudeMain, cumulativeInputTokens: 145415 },
    codex: { ...codex, cumulativeInputTokens: 55000 },
    opencode: { ...opencode, cumulativeInputTokens: 15100 },
    missing: null,
  },
  context: {
    claude: {
      contextTokens: 12803,
      contextWindow: null,
      compaction: { count: 1, preTokens: 150000, postTokens: 9000, trigger: 'auto' },
    },
    codex: {
      contextTokens: 31000,
      contextWindow: 272000,
      compaction: { count: 1, preTokens: null, postTokens: null, trigger: null },
    },
    opencode: { contextTokens: 9000, contextWindow: null, compaction: null },
    muse: {
      contextTokens: 23158,
      contextWindow: 200000,
      compaction: { count: 1, preTokens: null, postTokens: null, trigger: 'soft' },
    },
    missing: null,
  },
};
