/**
 * Session-file context reader.
 *
 * These run against REAL files through the real fs — each test builds the
 * harness's actual on-disk layout under a temp HOME rather than stubbing the
 * parser. The shapes are copied from live logs inspected on 2026-09-20 (claude
 * session d468c888, a codex rollout with 21 compactions, and a muse durable
 * session log), so a harness format change breaks these instead of sailing
 * through a mock.
 *
 * Every case here is a trap that produced, or would produce, a wrong number on
 * screen. None of them restate the type.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const HOME = process.env.HOME;

/**
 * os.homedir() reads $HOME on POSIX, which is what lets these touch real fs.
 * Must AWAIT the body before restoring: returning the promise and cleaning up
 * synchronously tears the temp HOME down before the reader ever opens a file.
 */
async function withHome<T>(run: (home: string) => Promise<T>): Promise<T> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-sessctx-'));
  process.env.HOME = home;
  try {
    return await run(home);
  } finally {
    process.env.HOME = HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

async function readContext(sessionId: string) {
  // Imported lazily so each call re-reads $HOME rather than binding it at load.
  const { lookupSessionContext } = await import('../src/conversations/session-context');
  return lookupSessionContext(sessionId);
}

function writeLines(file: string, rows: unknown[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

const claudeAssistant = (usage: Record<string, number>, isSidechain = false) => ({
  type: 'assistant',
  isSidechain,
  message: { role: 'assistant', model: 'claude-opus-5', usage },
});

test('claude: the LAST main-thread request is the context, not the sum of all of them', async () => {
  const reading = await withHome(async (home) => {
    writeLines(path.join(home, '.claude', 'projects', '-tmp-proj', 'sess-claude.jsonl'), [
      claudeAssistant({
        input_tokens: 2,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 500,
      }),
      claudeAssistant({
        input_tokens: 2,
        cache_read_input_tokens: 20_000,
        cache_creation_input_tokens: 800,
      }),
    ]);
    return readContext('sess-claude');
  });
  // Summing would give 31,304 -- the billing number, which climbs forever and
  // is what made the old meter unable to fall.
  assert.equal(reading?.contextTokens, 20_802);
});

test('claude: cache fields are ADDED back (input_tokens alone reads as 2 on a cached turn)', async () => {
  const reading = await withHome(async (home) => {
    writeLines(path.join(home, '.claude', 'projects', '-tmp-proj', 'sess-cached.jsonl'), [
      claudeAssistant({
        input_tokens: 2,
        cache_read_input_tokens: 952_211,
        cache_creation_input_tokens: 9_577,
      }),
    ]);
    return readContext('sess-cached');
  });
  // Reading input_tokens alone here would render a ~1M context as "2 tokens".
  assert.equal(reading?.contextTokens, 961_790);
});

test('claude: subagent rows measure the SUBAGENT and must not become this thread’s context', async () => {
  const reading = await withHome(async (home) => {
    writeLines(path.join(home, '.claude', 'projects', '-tmp-proj', 'sess-side.jsonl'), [
      claudeAssistant({
        input_tokens: 5_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
      // A Task subagent runs last and reports its own, much smaller, context.
      claudeAssistant(
        { input_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        true
      ),
    ]);
    return readContext('sess-side');
  });
  // Taking the literal last row would report 40 and show an empty meter.
  assert.equal(reading?.contextTokens, 5_000);
});

test('claude: compaction comes from the harness marker, with its own pre/post counts', async () => {
  const reading = await withHome(async (home) => {
    writeLines(path.join(home, '.claude', 'projects', '-tmp-proj', 'sess-compact.jsonl'), [
      claudeAssistant({
        input_tokens: 2,
        cache_read_input_tokens: 961_788,
        cache_creation_input_tokens: 3_945,
      }),
      {
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'auto', preTokens: 968_884, postTokens: 10_737 },
      },
      claudeAssistant({
        input_tokens: 2,
        cache_read_input_tokens: 12_695,
        cache_creation_input_tokens: 39_146,
      }),
    ]);
    return readContext('sess-compact');
  });
  assert.equal(reading?.contextTokens, 51_843, 'post-boundary request is the live context');
  assert.equal(reading?.compaction?.count, 1);
  assert.equal(reading?.compaction?.preTokens, 968_884);
  assert.equal(reading?.compaction?.postTokens, 10_737);
  assert.equal(reading?.compaction?.trigger, 'auto');
});

const codexTokenCount = (last: number, total: number, window = 258_400) => ({
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: { input_tokens: total, cached_input_tokens: 0 },
      last_token_usage: { input_tokens: last, cached_input_tokens: 0 },
      model_context_window: window,
    },
  },
});

test('codex: context is last_token_usage, NOT the cumulative total_token_usage', async () => {
  const reading = await withHome(async (home) => {
    writeLines(
      path.join(
        home,
        '.codex',
        'sessions',
        '2026',
        '09',
        '20',
        'rollout-2026-09-20T18-39-16-sess-codex.jsonl'
      ),
      [codexTokenCount(25_246, 25_246), codexTokenCount(35_747, 250_000)]
    );
    return readContext('sess-codex');
  });
  // Reading total_token_usage is the original bug: 250,000 would show the
  // session's lifetime spend as though it were the live context.
  assert.equal(reading?.contextTokens, 35_747);
  assert.equal(reading?.contextWindow, 258_400, 'codex reports its own denominator');
});

test('codex: the input_tokens:0 reset sentinel after a boundary is skipped', async () => {
  const reading = await withHome(async (home) => {
    writeLines(
      path.join(
        home,
        '.codex',
        'sessions',
        '2026',
        '09',
        '20',
        'rollout-2026-09-20T18-39-16-sess-sentinel.jsonl'
      ),
      [
        codexTokenCount(232_954, 232_954),
        // Real shape: `compacted` is tagged at the TOP level. Nesting it under
        // payload (as this fixture originally did) silently found zero of the 21
        // boundaries in a real rollout while the test still passed.
        { type: 'compacted', payload: { replacement_history: [], window_number: 1 } },
        // Observed at every real boundary: a zeroed token_count that is a reset
        // record, not a request. Honouring it flatlines the meter for a tick.
        codexTokenCount(0, 232_954),
      ]
    );
    return readContext('sess-sentinel');
  });
  assert.equal(reading?.contextTokens, 232_954, 'holds the last REAL request');
  assert.equal(reading?.compaction?.count, 1, 'boundary still recorded');
});

test('muse: usage comes from the durable log, and the window from its own thresholds', async () => {
  const reading = await withHome(async (home) => {
    const dir = path.join(
      home,
      '.local',
      'share',
      'muse',
      'sessions',
      '2026',
      '09',
      '20',
      'sess-muse'
    );
    writeLines(path.join(dir, 'session.jsonl'), [
      {
        payload_type: 'runtime.session',
        payload: {
          event: {
            kind: 'context_compaction_candidate',
            trigger: 'soft_threshold_async',
            status: 'succeeded',
            strategy: {
              target_budget_tokens: 384_000,
              config_fingerprint: 'soft=0.7500,hard=0.9000',
            },
          },
        },
      },
      {
        payload_type: 'runtime.session',
        payload: {
          event: {
            kind: 'model_completed',
            usage: { input_tokens: 23_158, output_tokens: 116, cached_tokens: 22_641 },
          },
        },
      },
    ]);
    return readContext('sess-muse');
  });
  // muse exec --json carries NO token fields, so without the durable log this
  // harness can only ever show an estimate.
  assert.equal(reading?.contextTokens, 23_158, 'cached_tokens is a subset, not an addend');
  assert.equal(
    reading?.contextWindow,
    512_000,
    '384,000 soft threshold at 0.75 implies a 512K window'
  );
  assert.equal(reading?.compaction?.count, 1);
});

test('muse: a candidate that never completed is not a compaction', async () => {
  const reading = await withHome(async (home) => {
    const dir = path.join(
      home,
      '.local',
      'share',
      'muse',
      'sessions',
      '2026',
      '09',
      '20',
      'sess-running'
    );
    writeLines(path.join(dir, 'session.jsonl'), [
      {
        payload_type: 'runtime.session',
        payload: {
          event: {
            kind: 'context_compaction_candidate',
            status: 'running',
            strategy: {
              target_budget_tokens: 384_000,
              config_fingerprint: 'soft=0.7500,hard=0.9000',
            },
          },
        },
      },
      {
        payload_type: 'runtime.session',
        payload: { event: { kind: 'model_completed', usage: { input_tokens: 400_000 } } },
      },
    ]);
    return readContext('sess-running');
  });
  // The log carries running and superseded candidates; counting them would
  // report a compaction that never happened.
  assert.equal(reading?.compaction, null);
  assert.equal(reading?.contextTokens, 400_000);
});

test('an unknown session id yields null rather than a fabricated reading', async () => {
  const reading = await withHome(async () => readContext('no-such-session'));
  assert.equal(reading, null);
});

test('codex rollouts are found by their real `rollout-<ts>-<id>.jsonl` name', async () => {
  const reading = await withHome(async (home) => {
    // This is how codex actually names files. Probing for a bare
    // `<sessionId>.jsonl` matched ZERO files on a real ~/.codex/sessions tree,
    // so every codex thread silently fell back to the chars/4 estimate.
    writeLines(
      path.join(
        home,
        '.codex',
        'sessions',
        '2026',
        '07',
        '26',
        'rollout-2026-07-26T18-39-16-019f9dcb-05e0-76f1-96b5-5d62406c62d6.jsonl'
      ),
      [codexTokenCount(38_666, 500_000)]
    );
    return readContext('019f9dcb-05e0-76f1-96b5-5d62406c62d6');
  });
  assert.equal(reading?.contextTokens, 38_666);
});

test('muse: a FAILED compaction candidate dropped no history and is not counted', async () => {
  const reading = await withHome(async (home) => {
    const dir = path.join(
      home,
      '.local',
      'share',
      'muse',
      'sessions',
      '2026',
      '09',
      '20',
      'sess-failed'
    );
    writeLines(path.join(dir, 'session.jsonl'), [
      {
        payload_type: 'runtime.session',
        payload: {
          event: {
            kind: 'context_compaction_candidate',
            status: 'failed',
            strategy: {
              target_budget_tokens: 384_000,
              config_fingerprint: 'soft=0.7500,hard=0.9000',
            },
          },
        },
      },
      {
        payload_type: 'runtime.session',
        payload: { event: { kind: 'model_completed', usage: { input_tokens: 350_000 } } },
      },
    ]);
    return readContext('sess-failed');
  });
  assert.equal(reading?.compaction, null, 'a failed candidate is not a compaction');
  assert.equal(reading?.contextWindow, 512_000, 'the window is still recoverable from it');
});
