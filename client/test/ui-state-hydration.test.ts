import assert from 'node:assert/strict';
import test from 'node:test';
import { UIStateSchema } from '@unleashd/shared';
import { jotaiStore } from '../src/atoms/store';
import {
  doneConversationsAtom,
  hydrateUiFromServer,
  lastSeenMessageIndexAtom,
  lastWorkingDirectoryAtom,
  markDone,
  markMessagesSeen,
  promoteWorker,
  promotedWorkersAtom,
  setLastWorkingDirectory,
} from '../src/atoms/ui';

// The merge below is asserted in memory; the debounced POST it schedules must
// never touch the network under test.
globalThis.fetch = (async () => ({ ok: true })) as typeof fetch;

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
