import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BuddyDirectPosts,
  BuddyWaitingOn,
  PostAsBuddyForm,
  ownerDirectChannel,
} from '../src/components/buddies/BuddyMessages';
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
  ord: id,
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
      threads={[]}
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

// T11 removed "post to a channel as this Buddy" from the Messages tab and the owner asked for it
// back (no visible feature goes without approval). It offers the workspace's public channels only.
test('the Messages tab can post to a public channel as the Buddy', () => {
  const inbox: Inbox = {
    requests: [],
    waitingOn: [],
    channels: [
      { channel: direct('general', { type: 'public', name: 'general', purpose: 'p' }), unread: 0 },
      {
        channel: direct('dm-ada', {
          type: 'direct',
          members: [{ kind: 'owner' }, { kind: 'buddy', id: 'ada' }],
        }),
        unread: 0,
      },
    ],
  };
  const html = renderToStaticMarkup(
    <PostAsBuddyForm buddyId="ada" inbox={inbox} refresh={async () => undefined} />
  );
  assert.match(html, /Post as Buddy/);
  assert.match(html, /#general/);
  assert.doesNotMatch(html, /dm-ada/);
});

// T11 dropped the DM thread view and the owner's "waiting on" list; the owner asked for both back.
test('a DM post shows its thread as a reply count, and the owner sees what it waits on', () => {
  const html = renderToStaticMarkup(
    <BuddyDirectPosts
      posts={[post('Status?', { author: { kind: 'owner' } }), post('Deploy done', {})]}
      threads={[
        {
          rootId: 'Status?',
          replies: 3,
          lastReplyAt: '2026-09-20T05:00:00Z',
          lastReplyOrd: 'z',
          lastReplyAuthor: { kind: 'buddy', id: 'ada' },
        },
      ]}
      awaitingOwner={new Set()}
      names={{ ada: 'Ada' }}
      refresh={async () => {}}
    />
  );
  // Oldest first: the "Deploy done" row renders before the "Status?" row.
  const [deployRow, statusRow] = html.split('Status?</p>');
  assert.match(statusRow, /3 replies · last reply/);
  assert.doesNotMatch(deployRow, /replies/);
  assert.match(deployRow, /<summary>Reply<\/summary>/, 'a post without replies can start one');

  const waiting = renderToStaticMarkup(
    <BuddyWaitingOn
      buddyName="Ada"
      waitingOn={[
        post('Second ask', { ord: '2', request: { state: 'awaiting' } }),
        post('First ask', { ord: '1', request: { state: 'awaiting' } }),
      ]}
    />
  );
  assert.match(waiting, /Waiting on Ada/);
  assert.ok(waiting.indexOf('First ask') < waiting.indexOf('Second ask'), 'oldest first');
  assert.equal(renderToStaticMarkup(<BuddyWaitingOn buddyName="Ada" waitingOn={[]} />), '');
});
