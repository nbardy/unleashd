import assert from 'node:assert/strict';
import test from 'node:test';
import { type Message, type ServerMessage, encodeRows } from '@unleashd/shared';
import { handleMessage, setActiveConversationId } from '../src/atoms/actions';
import { conversationsAtom, transcriptPatchAtom, transcriptsAtom } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { syntheticConversation } from './fixtures/synthetic-conversations';

/**
 * The disk poller broadcasts rows only (2026-09-25: full histories of growing
 * external transcripts were pushed to every client every 5s). A row keeps the
 * client's loaded transcript, so without this refresh an open chat never
 * showed new messages written by an external CLI session. Since T09 the
 * refresh pages in only the tail (the last held message and after), never the
 * whole history again.
 */

const openId = '21111111-1111-4111-8111-111111111111';
const closedId = '31111111-1111-4111-8111-111111111111';

function message(content: string): Message {
  return { role: 'assistant', content, timestamp: new Date('2026-09-25T00:00:00.000Z') };
}

function tailUrl(id: string): string {
  return `/api/conversations/${encodeURIComponent(id)}/messages?afterSeq=0&limit=500`;
}

test('a row with a moved message count pages in the open chat tail now and the rest when opened', () => {
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
        [openId, syntheticConversation(1, { id: openId, messageCount: 2 })],
        [closedId, syntheticConversation(2, { id: closedId, messageCount: 2 })],
      ])
    );
    jotaiStore.set(transcriptPatchAtom, {
      set: [
        [openId, { epoch: 0, messages: loaded }],
        [closedId, { epoch: 0, messages: loaded }],
      ],
      remove: [],
    });
    setActiveConversationId(openId);

    handleMessage({
      type: 'rows',
      ...encodeRows([
        syntheticConversation(1, { id: openId, messageCount: 3 }),
        syntheticConversation(2, { id: closedId, messageCount: 3 }),
      ]),
    } as unknown as ServerMessage);

    assert.deepEqual(fetched, [tailUrl(openId)], 'only the tail, only for the open chat');
    const transcripts = jotaiStore.get(transcriptsAtom);
    // Regression (review of c21b131): unloading made every reopened external
    // chat flash "Loading conversation history…".
    assert.deepEqual(
      transcripts.get(openId)?.messages.map((entry) => entry.content),
      ['one', 'two'],
      'the open chat keeps rendering while it refreshes'
    );
    assert.ok(transcripts.get(closedId), 'a closed chat keeps its history on screen');
    setActiveConversationId(closedId);
    assert.deepEqual(fetched, [tailUrl(openId), tailUrl(closedId)]);
    setActiveConversationId(openId);
    assert.equal(fetched.length, 2, 'a refreshed chat is not refetched on every activation');
  } finally {
    globalThis.fetch = realFetch;
    setActiveConversationId(null);
  }
});
