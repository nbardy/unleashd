/**
 * `/api/usage`, the per-session usage lookup and the context meter used to read
 * whole transcripts with readFileSync on the event loop (up to 3.1 GB Claude +
 * 6.8 GB codex for /api/usage). They now stream. The EXPECTED values below were
 * recorded from the synchronous implementation (lean/integration @ ab47223)
 * against this exact fixture, so this test is the before/after proof that the
 * async rewrite returns the same numbers, and it keeps guarding them.
 *
 * The fixture is a real on-disk HOME for all four harness layouts. The large
 * Claude transcript spans several 1 MiB read chunks with multi-byte characters
 * on the boundaries, has no trailing newline, a CRLF line, a malformed line,
 * duplicate message ids, a sidechain row and a compaction marker, so a
 * chunk-splitting or last-line bug changes a number here.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

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

interface Fixture {
  claudeMainDate: string;
  codexDate: string;
  opencodeDate: string;
}

function buildFixture(home: string, now: number): Fixture {
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
  const claudeMainMtime = now - 1 * HOUR;
  writeFile(
    path.join(home, '.claude', 'projects', '-tmp-fixture-a', `${CLAUDE_MAIN}.jsonl`),
    lines.join('\n'),
    claudeMainMtime
  );
  writeFile(
    path.join(home, '.claude', 'projects', '-tmp-fixture-b', `${CLAUDE_OLD}.jsonl`),
    `${assistant('o1', now - 40 * DAY, { input_tokens: 999, output_tokens: 999 })}\n`,
    now - 40 * DAY
  );

  // --- Codex: one current rollout, one outside both windows -------------------
  const tokenCount = (
    total: [number, number, number],
    last: number,
    extra: Record<string, unknown> = {}
  ) =>
    JSON.stringify({
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
      tokenCount([10_000, 8_000, 500], 10_000),
      JSON.stringify({ type: 'compacted', payload: { window_number: 1 } }),
      tokenCount([10_000, 8_000, 500], 0),
      tokenCount([55_000, 50_000, 2_000], 31_000, {
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
    `${tokenCount([7, 0, 7], 7)}\n`,
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
  writeFile(path.join(opencodeDir, 'msg_4.json'), '{ truncated');

  // --- Muse: durable session log ---------------------------------------------
  const museEvent = (event: Record<string, unknown>) =>
    JSON.stringify({ payload_type: 'runtime.session', payload: { event } });
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
      museEvent({ kind: 'model_completed', usage: { input_tokens: 22_690 } }),
      museEvent({
        kind: 'context_compaction_candidate',
        status: 'succeeded',
        trigger: 'soft',
        strategy: { target_budget_tokens: 160_000, config_fingerprint: 'soft=0.8;hard=0.95' },
      }),
      museEvent({ kind: 'model_completed', usage: { input_tokens: 23_158 } }),
      '',
    ].join('\n')
  );

  return {
    claudeMainDate: new Date(claudeMainMtime).toISOString().slice(0, 10),
    codexDate: `${cy}-${cm}-${cd}`,
    opencodeDate: new Date(created + 60_000).toISOString().slice(0, 10),
  };
}

async function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const previous = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-usage-parity-'));
  process.env.HOME = home;
  try {
    await run(home);
  } finally {
    process.env.HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('usage route, session usage and context meter return the recorded synchronous numbers', async () => {
  await withHome(async (home) => {
    const now = Date.now();
    const dates = buildFixture(home, now);
    const usageRoutes = await import('../src/http/usage-routes');
    const { lookupSessionContext } = await import('../src/conversations/session-context');

    const app = express();
    usageRoutes.registerUsageRoutes(app, ['claude', 'codex', 'opencode']);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let usage: unknown;
    try {
      const port = (server.address() as AddressInfo).port;
      // A days value no other test uses: the response cache is module-level.
      usage = await (await fetch(`http://127.0.0.1:${port}/api/usage?days=29`)).json();
    } finally {
      server.close();
    }

    const perSession = {
      claude: await usageRoutes.lookupProviderUsageForSession(CLAUDE_MAIN),
      codex: await usageRoutes.lookupProviderUsageForSession(CODEX),
      opencode: await usageRoutes.lookupProviderUsageForSession(OPENCODE),
      missing: await usageRoutes.lookupProviderUsageForSession('no-such-session'),
    };
    const context = {
      claude: await lookupSessionContext(CLAUDE_MAIN),
      codex: await lookupSessionContext(CODEX),
      opencode: await lookupSessionContext(OPENCODE),
      muse: await lookupSessionContext(MUSE),
      missing: await lookupSessionContext('no-such-session'),
    };

    const actual = JSON.parse(JSON.stringify({ usage, perSession, context }));
    assert.deepEqual(actual, recorded(dates, now));
  });
});

// Recorded from the synchronous implementation; see the header. Only the dates
// and absolute timestamps are computed, because they follow the clock.
function recorded({ claudeMainDate, codexDate, opencodeDate }: Fixture, now: number) {
  const claudeEntry = {
    sessionId: CLAUDE_MAIN,
    provider: 'claude',
    model: 'claude-opus-5-5',
    inputTokens: 115,
    outputTokens: 1620,
    cacheReadTokens: 142000,
    cacheWriteTokens: 3300,
    costUsd: 0.07962,
    date: claudeMainDate,
  };
  const codexEntry = {
    sessionId: CODEX,
    provider: 'codex',
    model: 'codex',
    inputTokens: 5000,
    outputTokens: 2000,
    cacheReadTokens: 50000,
    cacheWriteTokens: 0,
    costUsd: 0.045,
    date: codexDate,
  };
  const opencodeEntry = {
    sessionId: OPENCODE,
    provider: 'opencode',
    model: 'anthropic/claude-sonnet',
    inputTokens: 3000,
    outputTokens: 600,
    cacheReadTokens: 12000,
    cacheWriteTokens: 100,
    costUsd: 0.0123,
    date: opencodeDate,
  };
  return {
    usage: {
      totalCostUsd: 0.13692,
      totalInputTokens: 8115,
      totalOutputTokens: 4220,
      totalSessions: 3,
      days: 29,
      daily: [
        {
          date: claudeMainDate,
          inputTokens: 115,
          outputTokens: 1620,
          costUsd: 0.07962,
          sessions: 1,
        },
        { date: codexDate, inputTokens: 5000, outputTokens: 2000, costUsd: 0.045, sessions: 1 },
        { date: opencodeDate, inputTokens: 3000, outputTokens: 600, costUsd: 0.0123, sessions: 1 },
      ],
      topSessions: [
        {
          ...claudeEntry,
          // The Claude row has always leaked its rate-limit samples into the response.
          timestampedTokens: [
            { ts: now - 10 * DAY, tokens: 150 },
            { ts: now - 2 * DAY, tokens: 307 },
            { ts: now - 3 * HOUR, tokens: 1203 },
            { ts: now - 1 * HOUR, tokens: 75 },
          ],
        },
        codexEntry,
        opencodeEntry,
      ],
      rateLimits: {
        claude: [
          {
            label: '5h window',
            usedPercent: 0,
            windowMinutes: 300,
            resetsAt: null,
            tokenCount: 1278,
          },
          {
            label: 'Weekly',
            usedPercent: 0,
            windowMinutes: 10080,
            resetsAt: null,
            tokenCount: 1585,
          },
        ],
        codex: [
          { label: '5h limit', usedPercent: 12.5, windowMinutes: 300, resetsAt: 1900000000 },
          { label: 'Weekly limit', usedPercent: 40, windowMinutes: 10080, resetsAt: 1900500000 },
        ],
        opencode: [],
      },
    },
    perSession: {
      claude: { ...withoutCost(claudeEntry), cumulativeInputTokens: 145415 },
      codex: { ...withoutCost(codexEntry), cumulativeInputTokens: 55000 },
      opencode: { ...withoutCost(opencodeEntry), cumulativeInputTokens: 15100 },
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
}

function withoutCost<T extends { costUsd: number; date: string }>(entry: T) {
  const { costUsd: _cost, date: _date, ...rest } = entry;
  return rest;
}
