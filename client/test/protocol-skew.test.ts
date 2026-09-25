import assert from 'node:assert/strict';
import test from 'node:test';
import { type ServerMessage, classifyServerFrame, encodeRows } from '@unleashd/shared';
import { handleMessage, noteProtocolMismatch } from '../src/atoms/actions';
import { conversationsAtom, protocolMismatchAtom } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { syntheticConversation } from './fixtures/synthetic-conversations';

/**
 * Dev reloads run two protocol versions side by side: Vite serves this client
 * at once while the backend defers its restart until turns finish. On
 * 2026-09-24 a required field made every `init` from the older backend fail
 * validation and the list went empty (fixed in e54fe26). v3 makes the skew a
 * typed state: an old `init` is recognised by type, the rows the client holds
 * stay, and the socket reconnects until a v3 `hello` arrives. (A v2 client
 * facing a v3 backend drops `hello` as an unknown type and keeps its list.)
 */

const V2_INIT = {
  type: 'init',
  conversations: [{ id: 'from-old-backend', messages: [] }],
  defaultCwd: '/',
  protocol: { version: 2, capabilities: ['conversation_config'] },
};

test('a v2 init is a version skew that leaves the rows the client holds', () => {
  const held = syntheticConversation(1, { id: 'held' });
  jotaiStore.set(conversationsAtom, new Map([[held.id, held]]));

  const frame = classifyServerFrame(V2_INIT);
  assert.deepEqual(frame, { t: 'skew', serverVersion: 2 });
  if (frame.t === 'skew') noteProtocolMismatch(frame.serverVersion);

  assert.deepEqual([...jotaiStore.get(conversationsAtom).keys()], ['held']);
  assert.deepEqual(jotaiStore.get(protocolMismatchAtom), { serverVersion: 2 });
});

test('a v3 hello parses, replaces the rows and clears the skew state', () => {
  // `hello` reconciles the device's pending creations, which live in localStorage.
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  const frame = classifyServerFrame({
    type: 'hello',
    protocol: { version: 3 },
    defaultCwd: '/',
    loading: false,
    archivedBuddyIds: [],
    ...encodeRows([syntheticConversation(2, { id: 'fresh' })]),
  });
  assert.equal(frame.t, 'message');
  if (frame.t === 'message') handleMessage(frame.message as ServerMessage);
  assert.deepEqual([...jotaiStore.get(conversationsAtom).keys()], ['fresh']);
  assert.equal(jotaiStore.get(protocolMismatchAtom), null);
});

// T14b renamed channel_changed's `listId` to `channelId`. A backend that has not
// reloaded yet still sends `listId`; that frame must be dropped as invalid, not
// applied, or the client would invalidate `/api/buddies/channels/undefined` and
// miss the real channel silently.
test('a pre-rename channel_changed frame is invalid; the renamed one names its channel', () => {
  assert.equal(classifyServerFrame({ type: 'channel_changed', listId: 'ch_a' }).t, 'invalid');
  const frame = classifyServerFrame({ type: 'channel_changed', channelId: 'ch_a' });
  assert.deepEqual(frame, {
    t: 'message',
    message: { type: 'channel_changed', channelId: 'ch_a' },
  });
});
