import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerMessage } from '@unleashd/shared';
import { handleMessage, loadConversationDetails } from '../src/atoms/actions';
import { messagesOf, transcriptFamily } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { setRows } from './fixtures/client-store';
import { syntheticConversation, syntheticDetail } from './fixtures/synthetic-conversations';

// Regression (final review 2026-09-26): a `rewritten` patch that arrived while the FIRST load was
// in flight was ignored (nothing loaded to drop), so the load landed the replaced history. With the
// same message count the open view never refetched, and the chat showed the old rows for good.
const id = '31111111-1111-4111-8111-111111111111';

function page(content: string) {
  return {
    epoch: 0,
    total: 1,
    afterSeq: -1,
    messages: [{ role: 'assistant', content, timestamp: '2026-09-26T00:00:00.000Z' }],
  };
}

test('a history replaced during the first load is read again before it lands', async () => {
  const realFetch = globalThis.fetch;
  const bodies = ['before rewrite', 'after rewrite'];
  let releaseFirst: () => void = () => {};
  const firstHeld = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  globalThis.fetch = (async (url: string) => {
    if (!url.includes('/messages')) {
      return new Response(JSON.stringify(syntheticDetail(id)));
    }
    const content = bodies.shift() ?? 'unexpected third read';
    if (content === 'before rewrite') await firstHeld;
    return new Response(JSON.stringify(page(content)));
  }) as typeof fetch;
  try {
    setRows([syntheticConversation(1, { id, messageCount: 1 })]);
    const load = loadConversationDetails(id);
    handleMessage({ type: 'patch', id, patch: { t: 'rewritten' } } as ServerMessage);
    releaseFirst();
    await load;
    const transcript = jotaiStore.get(transcriptFamily(id));
    assert.equal(transcript.tag, 'loaded');
    assert.deepEqual(
      messagesOf(transcript).map((message) => message.content),
      ['after rewrite']
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
