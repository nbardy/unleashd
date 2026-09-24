import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pollForChanges } from '../src/adapters/loader';
import { getDiskAdapter } from '../src/adapters/registry';
import { TranscriptTails } from '../src/adapters/transcript-tails';

/**
 * Regression guard for the 2026-09-25 event-loop stall: the poller re-parsed
 * every still-growing external transcript from byte 0 every 5s (~1.2s per
 * poll for a 120MB Claude session). A poll of an appended transcript must
 * read only the appended bytes, and must never lose a record that was
 * half-written when a poll landed.
 */

const SESSION_ID = '5f0c9a52-7a4e-4a0e-9d8b-1c2d3e4f5a6b';

function record(role: 'user' | 'assistant', text: string, second: number): string {
  const timestamp = new Date(Date.UTC(2026, 8, 25, 12, 0, second)).toISOString();
  const entry =
    role === 'user'
      ? { type: 'user', cwd: '/tmp/tail-fixture', timestamp, message: { role, content: text } }
      : {
          type: 'assistant',
          cwd: '/tmp/tail-fixture',
          timestamp,
          message: { role, model: 'claude-fixture', content: [{ type: 'text', text }] },
        };
  return `${JSON.stringify(entry)}\n`;
}

test('polling a growing Claude transcript reads only appended bytes', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-tail-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, `${SESSION_ID}.jsonl`);
  await fs.writeFile(
    file,
    record('user', 'first question', 0) + record('assistant', 'first answer', 1)
  );

  const adapter = { ...getDiskAdapter('claude'), discoverFiles: async () => [file] };
  const tails = new TranscriptTails();
  let mtimes = new Map<string, number>();
  let clock = 1_000;
  async function poll(): Promise<string[]> {
    clock += 10;
    await fs.utimes(file, clock, clock);
    const result = await pollForChanges(mtimes, new Set(), { adapters: [adapter], tails });
    mtimes = result.mtimes;
    const conversation = result.updated.get(SESSION_ID);
    assert.ok(conversation, 'a changed transcript is reported');
    return conversation.messages.map((message) => message.content);
  }

  assert.deepEqual(await poll(), ['first question', 'first answer']);

  // Rewrite an already-read record in place (same byte length) and append a
  // new one. Only a resumed read keeps the old text: a full re-parse would
  // report the rewrite, so this proves the prefix was not read again.
  const bytes = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, bytes.replace('first question', 'FIRST QUESTION'));
  await fs.appendFile(file, record('user', 'second question', 2));
  assert.deepEqual(await poll(), ['first question', 'first answer', 'second question']);

  // A poll that lands mid-append must neither drop nor duplicate the record.
  const answer = record('assistant', 'second answer', 3);
  await fs.appendFile(file, answer.slice(0, 40));
  assert.deepEqual(await poll(), ['first question', 'first answer', 'second question']);
  await fs.appendFile(file, answer.slice(40));
  assert.deepEqual(await poll(), [
    'first question',
    'first answer',
    'second question',
    'second answer',
  ]);

  // A replaced file (new inode) is read in full, so the rewrite now shows.
  const replacement = `${file}.next`;
  await fs.writeFile(replacement, await fs.readFile(file));
  await fs.rename(replacement, file);
  assert.deepEqual(await poll(), [
    'FIRST QUESTION',
    'first answer',
    'second question',
    'second answer',
  ]);

  // A shrunk file is read in full rather than resumed past its end.
  await fs.writeFile(file, record('user', 'fresh start', 10));
  assert.deepEqual(await poll(), ['fresh start']);
});
