import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { parseJsonlFile } from '../src/adapters/jsonl';

/**
 * Claude persists provider-generated labels as ai-title (auto, re-emitted
 * per turn) and custom-title (user-set via /rename or --name) lines in the
 * session JSONL. parseJsonlFile must surface them so disk hydration and the
 * file poller can label the sidebar without reading the first user message
 * (which on buddy turns is the raw buddy-context envelope).
 */
async function parseLines(lines: unknown[]): Promise<string | null | undefined> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'unleashd-title-'));
  const file = path.join(dir, 'session-abc.jsonl');
  await fs.promises.writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  try {
    return (await parseJsonlFile(file)).title;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const USER = {
  type: 'user',
  timestamp: '2026-09-22T00:00:00.000Z',
  cwd: '/tmp/work',
  message: { role: 'user', content: 'hello' },
};

test('ai-title is surfaced when no custom title exists', async () => {
  const title = await parseLines([
    USER,
    { type: 'ai-title', aiTitle: 'Channels and task overlap' },
  ]);
  assert.equal(title, 'Channels and task overlap');
});

test('custom-title wins over ai-title, last observation wins', async () => {
  const title = await parseLines([
    USER,
    { type: 'ai-title', aiTitle: 'Auto label' },
    { type: 'custom-title', customTitle: 'My demo thread' },
    { type: 'ai-title', aiTitle: 'Auto label v2' },
  ]);
  assert.equal(title, 'My demo thread');
});

test('blank titles are ignored and missing titles stay null', async () => {
  assert.equal(await parseLines([USER, { type: 'ai-title', aiTitle: '   ' }]), null);
  assert.equal(await parseLines([USER]), null);
});
