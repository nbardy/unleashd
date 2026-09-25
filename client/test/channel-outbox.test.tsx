import assert from 'node:assert/strict';
import test from 'node:test';
import type { BuddyMailingListPost } from '@unleashd/shared';
import { Provider } from 'jotai';
import { renderToStaticMarkup } from 'react-dom/server';
import { outboxDrop, outboxSending, outboxSent } from '../src/atoms/channel-outbox';
import { jotaiStore } from '../src/atoms/store';
import { useWithOutbox } from '../src/components/buddies/channel-data';

// Send is optimistic (2026-09-25, owner: "a slow delay, it should be
// instant"): the owner's post renders from the outbox before the server
// returns it. The failure modes this guards are the ones a refactor of the
// merge would introduce silently: the message blinking out between the POST
// response and the refetch, or rendering twice once the refetch includes it.

function served(id: string, threadRootId: string | null): BuddyMailingListPost {
  return {
    id,
    listId: 'list',
    workspaceId: 'ws',
    author: { kind: 'owner' },
    threadRootId,
    replyCount: 0,
    latestReplyAt: null,
    purpose: 'message',
    body: 'hello',
    evidence: [],
    projectId: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    senderConversationId: null,
    senderRunId: null,
  };
}

function Feed({
  rootId,
  posts,
}: {
  rootId: string | null;
  posts: readonly BuddyMailingListPost[] | null;
}) {
  const shown = useWithOutbox('ws', 'list', rootId, posts);
  return <>{shown === null ? 'loading' : shown.map((post) => post.id).join(',')}</>;
}

const render = (rootId: string | null, posts: readonly BuddyMailingListPost[] | null) =>
  renderToStaticMarkup(
    <Provider store={jotaiStore}>
      <Feed rootId={rootId} posts={posts} />
    </Provider>
  );

test('an owner post shows from Send until the server feed carries it, exactly once', () => {
  outboxSending({
    kind: 'sending',
    key: 'k1',
    listId: 'list',
    threadRootId: null,
    body: 'hello',
    createdAt: '2026-09-25T00:00:00.000Z',
  });
  assert.equal(render(null, []), 'outbox:k1', 'visible while the POST is in flight');
  assert.equal(render('root', []), '', 'a channel post never leaks into a thread');

  outboxSent('k1', served('post_1', null));
  assert.equal(render(null, []), 'post_1', 'still visible before the refetch lands');
  assert.equal(render(null, [served('post_1', null)]), 'post_1', 'never twice');
  assert.equal(render(null, null), 'loading', 'an unloaded feed stays unloaded');

  outboxDrop(new Set(['k1']));
  assert.equal(render(null, []), '');
});
