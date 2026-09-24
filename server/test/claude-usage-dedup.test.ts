/**
 * Claude Code writes one JSONL line per assistant content block (thinking,
 * text, each tool_use) and stamps the SAME request usage on every one. The
 * usage parser summed every line, overcounting Claude tokens and cost ~2.4x
 * until 2026-09-25 (one session: 1,081 usage lines for 446 requests).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseClaudeSession } from '../src/http/usage-routes';

test('a request split across content-block lines is counted once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-usage-'));
  try {
    const usage = {
      input_tokens: 10,
      output_tokens: 200,
      cache_read_input_tokens: 40_000,
      cache_creation_input_tokens: 3_000,
    };
    const line = (id: string, block: string) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-25T10:00:00.000Z',
        message: { id, model: 'claude-opus-5-5', usage, content: [{ type: block }] },
      });
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      file,
      [
        line('msg_a', 'thinking'),
        line('msg_a', 'text'),
        line('msg_a', 'tool_use'),
        line('msg_b', 'text'),
      ].join('\n')
    );
    const parsed = parseClaudeSession(file, fs.statSync(file));
    assert.equal(parsed.cacheReadTokens, 80_000);
    assert.equal(parsed.cacheWriteTokens, 6_000);
    assert.equal(parsed.outputTokens, 400);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
