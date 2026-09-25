import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SigilReply, SigilRequest } from '../src/components/buddies/sigil/client';

// Regression guard, 2026-09-26: a thread deep link rendered 12 Buddy sigils
// inline in one effect flush — a 0.8–3.5 s main-thread block (software GL)
// ahead of the thread fetch, so "Loading thread…" waited on avatars. A sigil
// load must go to the worker and must never draw on the calling thread: any
// canvas constructed here fails the test.
const posted: SigilRequest[] = [];
class FakeWorker {
  onmessage: ((event: { data: SigilReply }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  postMessage(request: SigilRequest) {
    posted.push(request);
    const reply: SigilReply =
      request.name === 'Broken'
        ? { kind: 'failed', id: request.id, error: 'WebGL2 is unavailable' }
        : { kind: 'png', id: request.id, png: new Blob(['png']) };
    setTimeout(() => this.onmessage?.({ data: reply }), 0);
  }
}
Object.assign(globalThis, {
  Worker: FakeWorker,
  OffscreenCanvas: class {
    constructor() {
      throw new assert.AssertionError({ message: 'a sigil rendered on the main thread' });
    }
  },
});

const { sigilResource } = await import('../src/components/buddies/BuddySigil');

test('a sigil load renders in the worker, not on the calling thread', async () => {
  const url = await sigilResource('Ada').load(new AbortController().signal);
  assert.match(url, /^blob:/);
  assert.deepEqual(
    posted.map((request) => request.name),
    ['Ada']
  );
});

test('a failed worker render rejects that sigil only', async () => {
  await assert.rejects(sigilResource('Broken').load(new AbortController().signal), /WebGL2/);
  assert.match(await sigilResource('Grace').load(new AbortController().signal), /^blob:/);
});
