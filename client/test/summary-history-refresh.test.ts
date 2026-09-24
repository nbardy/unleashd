import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation, Message } from '@unleashd/shared';
import { handleMessage, setActiveConversationId } from '../src/atoms/actions';
import { conversationDetailsLoadedAtom, conversationsAtom } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';

/**
 * The disk poller broadcasts summaries only (2026-09-25: full histories of
 * growing external transcripts were pushed to every client every 5s). A
 * summary keeps the client's loaded history, so without this refresh an open
 * chat never showed new messages written by an external CLI session.
 */

const openId = '21111111-1111-4111-8111-111111111111';
const closedId = '31111111-1111-4111-8111-111111111111';

function message(content: string): Message {
  return { role: 'assistant', content, timestamp: new Date('2026-09-25T00:00:00.000Z') };
}

function conversation(id: string, messages: Message[], messageCount: number): Conversation {
  return {
    id,
    messages,
    messageCount,
    isRunning: false,
    isStreaming: false,
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
    workingDirectory: '/tmp/project',
    provider: 'claude',
    queue: [],
    subAgents: [],
    swarmDebugPrefix: null,
  } as unknown as Conversation;
}

test('a summary with a moved message count refreshes the open chat and unloads the rest', () => {
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    fetched.push(url);
    return new Promise(() => {});
  }) as typeof fetch;
  try {
    const loaded = [message('one'), message('two')];
    jotaiStore.set(
      conversationsAtom,
      new Map([
        [openId, conversation(openId, loaded, 2)],
        [closedId, conversation(closedId, loaded, 2)],
      ])
    );
    jotaiStore.set(conversationDetailsLoadedAtom, new Set([openId, closedId]));
    setActiveConversationId(openId);

    handleMessage({
      type: 'conversations_updated',
      summaries: true,
      conversations: [
        conversation(openId, [message('three')], 3),
        conversation(closedId, [message('three')], 3),
      ],
    });

    assert.deepEqual(fetched, [`/api/conversations/${openId}`]);
    const details = jotaiStore.get(conversationDetailsLoadedAtom);
    assert.equal(details.has(openId), true, 'the open chat keeps rendering while it refreshes');
    assert.equal(details.has(closedId), false, 'a closed chat refetches when next opened');
    assert.deepEqual(
      jotaiStore
        .get(conversationsAtom)
        .get(openId)
        ?.messages.map((entry) => entry.content),
      ['one', 'two'],
      'the preview row never replaces loaded history'
    );
  } finally {
    globalThis.fetch = realFetch;
    setActiveConversationId(null);
  }
});
