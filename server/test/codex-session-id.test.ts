/**
 * Codex rollout filename -> session id.
 *
 * Regression guard for the UsagePanel id defect found 2026-09-20. The usage
 * aggregate derived a session id with `file.replace('.jsonl', '')`, but codex
 * names every rollout `rollout-<timestamp>-<sessionId>.jsonl`. The prefix
 * survived, so `UsagePanel.tsx`'s `sessionId.slice(0, 8)` rendered the literal
 * string "rollout-" for EVERY codex row — all codex sessions looked identical
 * and none could be traced back to a thread.
 *
 * The two timestamp shapes below are both real: scanning 2,124 rollouts under
 * ~/.codex/sessions turned up an older `-024Z-` variant that a regex written
 * against the current shape alone silently fails to strip. That is the bug a
 * future narrowing of this pattern would reintroduce, and the reason this test
 * asserts on the rendered 8-char slice rather than just the id.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { codexSessionIdFromFilename } from '../src/http/usage-routes';

test('strips the rollout prefix from both real codex timestamp shapes', () => {
  assert.equal(
    codexSessionIdFromFilename(
      'rollout-2026-09-16T11-22-44-01a0a83c-fc26-7ae0-acf0-25f77473fe75.jsonl'
    ),
    '01a0a83c-fc26-7ae0-acf0-25f77473fe75'
  );
  // Older shape carries milliseconds and a trailing Z before the id.
  assert.equal(
    codexSessionIdFromFilename(
      'rollout-2026-08-06T11-14-43-024Z-81d506e9-bf6a-4985-bdc0-f1793f3f6d09.jsonl'
    ),
    '81d506e9-bf6a-4985-bdc0-f1793f3f6d09'
  );
});

test('a bare <sessionId>.jsonl passes through unchanged', () => {
  // findCodexSessionFile accepts this form too; the two must stay inverse.
  assert.equal(
    codexSessionIdFromFilename('81d506e9-bf6a-4985-bdc0-f1793f3f6d09.jsonl'),
    '81d506e9-bf6a-4985-bdc0-f1793f3f6d09'
  );
});

test('the id UsagePanel renders identifies the session, not the word "rollout"', () => {
  const rendered = codexSessionIdFromFilename(
    'rollout-2026-09-16T11-22-44-01a0a83c-fc26-7ae0-acf0-25f77473fe75.jsonl'
  ).slice(0, 8);
  assert.equal(rendered, '01a0a83c');
  assert.notEqual(rendered, 'rollout-');
});
