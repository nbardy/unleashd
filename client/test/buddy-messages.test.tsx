import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuddyDirectPosts, ownerDirectChannel } from '../src/components/buddies/BuddyMessages';
import type { Channel, Inbox, Post } from '../src/components/buddies/types';

const direct = (id: string, members: Channel['kind']): Channel => ({
  id,
  workspaceId: 'ws-1',
  kind: members,
  createdBy: { kind: 'owner' },
  createdAt: '2026-09-20T00:00:00Z',
});

const post = (id: string, overrides: Partial<Post>): Post => ({
  id,
  channelId: 'dm-ada',
  author: { kind: 'buddy', id: 'ada' },
  body: id,
  evidence: [],
  request: { state: 'none' },
  createdAt: '2026-09-20T00:00:00Z',
  ...overrides,
});

test("the Messages tab reads the owner's one-to-one DM, never a group DM the Buddy is in", () => {
  const inbox: Inbox = {
    requests: [],
    waitingOn: [],
    channels: [
      {
        channel: direct('group', {
          type: 'direct',
          members: [{ kind: 'owner' }, { kind: 'buddy', id: 'ada' }, { kind: 'buddy', id: 'bo' }],
        }),
        unread: 0,
      },
      {
        channel: direct('buddies-only', {
          type: 'direct',
          members: [
            { kind: 'buddy', id: 'ada' },
            { kind: 'buddy', id: 'bo' },
          ],
        }),
        unread: 0,
      },
      {
        channel: direct('dm-ada', {
          type: 'direct',
          members: [{ kind: 'owner' }, { kind: 'buddy', id: 'ada' }],
        }),
        unread: 1,
      },
    ],
  };
  assert.equal(ownerDirectChannel(inbox, 'ada')?.channel.id, 'dm-ada');
  assert.equal(ownerDirectChannel(inbox, 'bo'), undefined);
});

test('DM posts read oldest first and only requests awaiting the owner offer an answer', () => {
  const html = renderToStaticMarkup(
    <BuddyDirectPosts
      // Newest first, as the server pages them.
      posts={[
        post('Can you approve the deploy?', {
          createdAt: '2026-09-20T03:00:00Z',
          request: { state: 'awaiting' },
        }),
        post('Which branch?', {
          createdAt: '2026-09-20T02:00:00Z',
          request: { state: 'awaiting' },
        }),
        post('Please check the release', {
          author: { kind: 'owner' },
          createdAt: '2026-09-20T01:00:00Z',
          request: { state: 'answered', answerId: 'a1' },
        }),
      ]}
      awaitingOwner={new Set(['Can you approve the deploy?'])}
      names={{ ada: 'Ada' }}
      refresh={async () => {}}
    />
  );
  const order = ['Please check the release', 'Which branch?', 'Can you approve the deploy?'].map(
    (text) => html.indexOf(text)
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order
  );
  assert.match(html, /Answered/);
  // "Which branch?" awaits someone else (not in the owner's inbox): no answer form for it.
  assert.equal(html.match(/Send answer/g)?.length, 1);
  assert.match(html, /You/);
  assert.match(html, /Ada/);
});
