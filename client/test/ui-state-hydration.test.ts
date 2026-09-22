import assert from 'node:assert/strict';
import test from 'node:test';
import { UIStateSchema } from '@unleashd/shared';
import { jotaiStore } from '../src/atoms/store';
import {
  doneConversationsAtom,
  flushSharedSync,
  hydrateUiFromServer,
  lastSeenMessageIndexAtom,
  lastWorkingDirectoryAtom,
  markDone,
  markMessagesSeen,
  promoteWorker,
  promotedWorkersAtom,
  setLastWorkingDirectory,
} from '../src/atoms/ui';

// Syncs are asserted via captured POST bodies; they must never touch the
// network under test.
const postedBodies: unknown[] = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  if (typeof init?.body === 'string') postedBodies.push(JSON.parse(init.body));
  return { ok: true };
}) as typeof fetch;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Regression: hidden (done) conversations flashed back to visible after a
 * server or client refresh, forcing the user to re-hide them.
 *
 * Root cause: every WS `init` — including reconnects after a restart —
 * overwrote the shared UI slice with the server snapshot. An init arriving
 * inside the 500ms POST debounce, or after a restart whose debounced disk
 * write never landed, discarded unflushed client writes; the sync-back then
 * cemented the loss server-side. Hydration now merges (union / max /
 * client-unless-null) so neither side's additions are lost.
 */
test('reconnect init keeps locally hidden conversations and absorbs server additions', () => {
  markDone('hide-local-A');
  hydrateUiFromServer(
    UIStateSchema.parse({
      doneConversations: ['hide-server-B'],
      lastWorkingDirectory: '/server/dir',
    })
  );
  const done = jotaiStore.get(doneConversationsAtom);
  assert.ok(done.includes('hide-local-A'), 'unflushed local hide survives reconnect init');
  assert.ok(done.includes('hide-server-B'), 'server-side hide is adopted');
  assert.equal(
    jotaiStore.get(lastWorkingDirectoryAtom),
    '/server/dir',
    'null client directory adopts the server value'
  );
});

test('unflushed seen progress survives reconnect, taking the max per conversation', () => {
  markMessagesSeen('seen-c1', 10);
  hydrateUiFromServer(
    UIStateSchema.parse({ lastSeenMessageIndex: { 'seen-c1': 4, 'seen-c2': 7 } })
  );
  assert.deepEqual(jotaiStore.get(lastSeenMessageIndexAtom)['seen-c1'], 10);
  assert.deepEqual(jotaiStore.get(lastSeenMessageIndexAtom)['seen-c2'], 7);
});

test('promoted workers union and a set client directory beats the snapshot', () => {
  promoteWorker('w-local');
  setLastWorkingDirectory('/client/dir');
  hydrateUiFromServer(
    UIStateSchema.parse({ promotedWorkers: ['w-server'], lastWorkingDirectory: '/server/dir' })
  );
  const workers = jotaiStore.get(promotedWorkersAtom);
  assert.ok(workers.includes('w-local'), 'unflushed local promotion survives');
  assert.ok(workers.includes('w-server'), 'server-side promotion is adopted');
  assert.equal(jotaiStore.get(lastWorkingDirectoryAtom), '/client/dir');
});

/**
 * The unload flush rides on `keepalive`, capped at 64KB — the full slice is
 * ~570KB on a large workspace, so flushing everything is rejected and a
 * refresh inside the debounce window loses the hide. Deltas keep the flush
 * to the changed keys only.
 */
test('unload flush sends only the changed keys, never the full slice', async () => {
  await sleep(650); // drain debounced syncs from the tests above
  postedBodies.length = 0;
  markDone('delta-done-Z');
  flushSharedSync();
  await sleep(20); // let the stubbed fetch settle
  assert.equal(postedBodies.length, 1);
  const body = postedBodies[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ['doneConversations']);
  assert.ok((body.doneConversations as string[]).includes('delta-done-Z'));
});

test('acknowledged state is not resent on a clean flush', async () => {
  await sleep(650); // settle the flush above: success advances lastSynced
  postedBodies.length = 0;
  flushSharedSync();
  await sleep(20);
  assert.equal(postedBodies.length, 0);
});
