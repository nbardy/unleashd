import assert from 'node:assert/strict';
import test from 'node:test';
import { type Message, type ServerMessage, encodeRows } from '@unleashd/shared';
import { handleMessage, refreshTranscript } from '../src/atoms/actions';
import { messagesOf, rowFamily, transcriptFamily } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { bodiesStep } from '../src/hooks/useConversationBodies';
import { setLoaded, setRows } from './fixtures/client-store';
import { syntheticConversation } from './fixtures/synthetic-conversations';

/**
 * The disk poller broadcasts rows only (2026-09-25: full histories of growing
 * external transcripts were pushed to every client every 5s). A row keeps the
 * client's loaded transcript, so without a refresh an open chat never showed
 * new messages written by an external CLI session. Since T19 the open view
 * (useConversationBodies) compares the row's messageCount with the messages
 * it holds and pages in only the tail; the WS spine never fetches bodies.
 */

const openId = '21111111-1111-4111-8111-111111111111';

function message(content: string): Message {
  return { role: 'assistant', content, timestamp: new Date('2026-09-25T00:00:00.000Z') };
}

test('a moved message count pages in the open chat tail and keeps its history on screen', () => {
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    fetched.push(url);
    return new Promise(() => {});
  }) as typeof fetch;
  try {
    setRows([syntheticConversation(1, { id: openId, messageCount: 2 })]);
    setLoaded(openId, [message('one'), message('two')]);
    handleMessage({
      type: 'rows',
      ...encodeRows([syntheticConversation(1, { id: openId, messageCount: 3 })]),
    } as unknown as ServerMessage);
    assert.deepEqual(fetched, [], 'the rows handler fetches nothing');

    const count = jotaiStore.get(rowFamily(openId))?.messageCount ?? -1;
    const transcript = jotaiStore.get(transcriptFamily(openId));
    assert.equal(bodiesStep(transcript, count), 'refresh');
    void refreshTranscript(openId);
    assert.deepEqual(fetched, [`/api/conversations/${openId}/messages?afterSeq=0&limit=500`]);
    // Regression (review of c21b131): unloading made every reopened external
    // chat flash "Loading conversation history…".
    assert.deepEqual(
      messagesOf(jotaiStore.get(transcriptFamily(openId))).map((entry) => entry.content),
      ['one', 'two']
    );
    assert.equal(bodiesStep(transcript, 2), 'none', 'a current chat is not refetched');
  } finally {
    globalThis.fetch = realFetch;
  }
});
