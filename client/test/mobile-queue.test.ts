import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientMessage, QueuedMessage } from '@unleashd/shared';
import { endConversation, handleMessage, setSendFn } from '../src/atoms/actions';
import { conversationsAtom, queueAtomFamily } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';

const conversationId = '11111111-1111-4111-8111-111111111111';

function makeConversation(queue: QueuedMessage[]) {
  return {
    id: conversationId,
    messages: [],
    messageCount: 0,
    isRunning: false,
    isStreaming: false,
    confirmed: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    workingDirectory: '/tmp/project',
    provider: 'claude' as const,
    config: {
      provider: 'claude',
      model: { mode: 'default' as const },
      reasoning: { mode: 'default' as const },
    },
    configRevision: 0,
    configResolution: {
      kind: 'resolved' as const,
      provider: 'claude' as const,
      model: { mode: 'default' as const },
      reasoning: { mode: 'default' as const },
    },
    subAgents: [],
    queue,
    isWorker: false,
    swarmId: null,
    workerId: null,
    workerRole: null,
    parentConversationId: null,
    resumedFromConversationId: null,
    modelName: null,
    swarmDebugPrefix: null,
    kind: { kind: 'chat' as const },
    buddyContext: null,
    purpose: undefined,
  } as unknown as import('@unleashd/shared').Conversation;
}

test('a queue_updated event reaches the queue view, and a missing queue is one stable value', () => {
  const q1: QueuedMessage = {
    id: 'q-1',
    content: 'first',
    queuedAt: new Date(),
    status: 'pending',
  };
  jotaiStore.set(conversationsAtom, new Map([[conversationId, makeConversation([q1])]]));
  assert.equal(jotaiStore.get(queueAtomFamily(conversationId)).length, 1);
  handleMessage({ type: 'queue_updated', conversationId, queue: [] });
  assert.equal(jotaiStore.get(queueAtomFamily(conversationId)).length, 0);
  // A fresh [] per read would re-render every subscriber on every store change
  // (hard rule: stable fallbacks are module constants).
  const unknown = '00000000-0000-4000-8000-000000000000';
  assert.equal(jotaiStore.get(queueAtomFamily(unknown)), jotaiStore.get(queueAtomFamily(unknown)));
});

/**
 * Mobile's Stop button calls endConversation (ComposerMobile), so this ordering
 * is load-bearing on a phone: WebSocket messages are handled in order, and if
 * stop_conversation went first the next queued message would start the instant
 * the turn died — "Stop" would visibly fail to stop anything. Mobile previously
 * called bare stopConversation and had exactly that bug.
 */
test('endConversation clears the queue before stopping the turn', () => {
  const sent: ClientMessage[] = [];
  setSendFn((msg) => {
    sent.push(msg);
  });
  jotaiStore.set(conversationsAtom, new Map([[conversationId, makeConversation([])]]));
  endConversation(conversationId);
  assert.deepEqual(
    sent.map((m) => m.type),
    ['clear_queue', 'stop_conversation'],
    'clear_queue must precede stop_conversation'
  );
});
