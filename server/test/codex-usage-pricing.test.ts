/**
 * Codex cached input is a SUBSET of `input_tokens`, billed at a tenth of the
 * input rate. Until 2026-09-25 both Codex parsers read only `input_tokens`, so
 * cached re-reads (~97% of Codex input) were counted and priced as fresh input
 * and every Codex dollar figure in the UsagePanel was several-fold too high.
 * This drives a real rollout file through the session lookup the meter uses.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { lookupProviderUsageForSession } from '../src/http/usage-routes';

test('codex usage splits cached input out of input_tokens', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-usage-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const sessionId = '01a0c8cd-7001-7cc2-8bc6-5c2eefb0a959';
    const day = path.join(home, '.codex', 'sessions', '2026', '09', '25');
    fs.mkdirSync(day, { recursive: true });
    const tokenCount = (input: number, cached: number, output: number) =>
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
            },
          },
        },
      });
    fs.writeFileSync(
      path.join(day, `rollout-2026-09-25T10-00-00-${sessionId}.jsonl`),
      // Cumulative totals: the last event wins.
      `${tokenCount(1_000, 0, 10)}\n${tokenCount(40_000_000, 39_000_000, 100_000)}\n`
    );
    const usage = lookupProviderUsageForSession(sessionId);
    assert.ok(usage);
    assert.equal(usage.inputTokens, 1_000_000);
    assert.equal(usage.cacheReadTokens, 39_000_000);
    assert.equal(usage.cumulativeInputTokens, 40_000_000);
  } finally {
    process.env.HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
