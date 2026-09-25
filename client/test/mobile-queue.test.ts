import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueuedMessage } from '@unleashd/shared';
import { endConversation, handleMessage } from '../src/atoms/actions';
import { queueOf, transcriptFamily, transcriptStore } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { openSocket, setRows } from './fixtures/client-store';
import { syntheticConversation, syntheticDetail } from './fixtures/synthetic-conversations';

const queue = (id: string) => queueOf(jotaiStore.get(transcriptFamily(id)));

const conversationId = '11111111-1111-4111-8111-111111111111';

test('a queue patch reaches the queue view, and a missing queue is one stable value', () => {
  const q1: QueuedMessage = {
    id: 'q-1',
    content: 'first',
    queuedAt: new Date(),
    status: 'pending',
  };
  setRows([syntheticConversation(1, { id: conversationId })]);
  jotaiStore.set(transcriptStore.patch, {
    set: [
      [
        conversationId,
        {
          tag: 'loaded',
          epoch: 0,
          messages: [],
          detail: syntheticDetail(conversationId, { queue: [q1] }),
        },
      ],
    ],
    remove: [],
  });
  assert.equal(queue(conversationId).length, 1);
  handleMessage({ type: 'patch', id: conversationId, patch: { t: 'queue', queue: [] } });
  assert.equal(queue(conversationId).length, 0);
  // A fresh [] per read would re-render every subscriber on every store change
  // (hard rule: stable fallbacks are module constants).
  const unknown = '00000000-0000-4000-8000-000000000000';
  assert.equal(queue(unknown), queue(unknown));
});

/**
 * Mobile's Stop button calls endConversation (ComposerMobile), so this ordering
 * is load-bearing on a phone: WebSocket messages are handled in order, and if
 * stop_conversation went first the next queued message would start the instant
 * the turn died — "Stop" would visibly fail to stop anything. Mobile previously
 * called bare stopConversation and had exactly that bug.
 */
test('endConversation clears the queue before stopping the turn', () => {
  const sent = openSocket();
  setRows([syntheticConversation(1, { id: conversationId })]);
  endConversation(conversationId);
  assert.deepEqual(
    sent.map((m) => m.type),
    ['clear_queue', 'stop_conversation'],
    'clear_queue must precede stop_conversation'
  );
});
