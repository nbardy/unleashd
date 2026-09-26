import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import type { BuddyMailingListPost } from '@unleashd/shared';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);

const { Provider } = await import('jotai');
const { jotaiStore } = await import('../src/atoms/store');
const { OutOfTokensChannelRetry } = await import('../src/components/buddies/HarnessRetry');

function post(body: string, purpose: string): BuddyMailingListPost {
  return {
    id: 'post_fail',
    listId: 'list_a',
    workspaceId: 'ws',
    author: { kind: 'buddy', buddyId: 'lead' },
    threadRootId: 'post_root',
    replyCount: 0,
    latestReplyAt: null,
    purpose,
    body,
    evidence: ['trigger:post_root', 'provider:codex'],
    projectId: null,
    createdAt: '2026-09-25T17:00:00.000Z',
    senderConversationId: null,
    senderRunId: null,
  };
}

function markup(notice: BuddyMailingListPost): string {
  return renderToStaticMarkup(
    <Provider store={jotaiStore}>
      <OutOfTokensChannelRetry post={notice} />
    </Provider>
  );
}

test('an out-of-tokens channel notice offers a harness retry; other failures do not', () => {
  assert.match(markup(post('Couldn’t reply: Provider ran out of tokens', 'reply_failed')), /Retry with a different harness/);
  assert.match(
    markup(post('Couldn’t reply: Provider completed the turn with reason: error', 'reply_failed')),
    /Retry with a different harness/
  );
  assert.match(
    markup(
      post(
        'Couldn’t reply: The gpt-5.4 model is not supported when using Codex ' +
          'with a ChatGPT account.',
        'reply_failed'
      )
    ),
    /Retry with a different harness/
  );
  assert.equal(markup(post('Couldn’t reply: provider is unavailable', 'reply_failed')), '');
  assert.equal(markup(post('out of tokens in a normal reply', 'reply')), '');
});
