// Channel features the T11 client migration dropped and T22 restored, each
// rendered through the real ChannelBrowser against seeded route responses.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ChannelUnread, Post, ThreadStat } from '../src/components/buddies/types';
import { buddyFixture, rosterFixture } from './fixtures/buddy-roster';
import { inboxFixture, postFixture, publicChannel } from './fixtures/channel-posts';
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { ChannelBrowser } = await import('../src/components/buddies/ChannelBrowser');
const { workspaceDirectory } = await import('../src/components/buddies/channel-data');
const { Provider } = await import('jotai');
const { jotaiStore } = await import('../src/atoms/store');
const { loadResource } = await import('../src/atoms/resources');

const lead = buddyFixture({ id: 'lead', name: 'Lead' });

const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 9, minute)).toISOString();
const post = (id: string, minute: number, overrides: Partial<Post> = {}) =>
  postFixture({ id, author: { kind: 'buddy', id: 'lead' }, createdAt: at(minute), ...overrides });
const stat = (root: Post, replies: number, last: Post): ThreadStat => ({
  rootId: root.id,
  replies,
  lastReplyAt: last.createdAt,
  lastReplyOrd: last.ord,
  lastReplyAuthor: last.author,
});

/** Seeds one workspace with one channel and renders the browser at `url`. */
async function renderChannel(opts: {
  ws: string;
  entry: Omit<ChannelUnread, 'channel'>;
  posts: Post[];
  threads?: ThreadStat[];
  url?: string;
}) {
  const channelId = `ch_${opts.ws}`;
  await loadResource({
    key: `/api/buddies/workspaces/${opts.ws}/inbox`,
    load: async () =>
      inboxFixture([{ channel: publicChannel(channelId, 'general', opts.ws), ...opts.entry }]),
  });
  await loadResource({
    key: `/api/buddies/channels/${channelId}/posts?limit=50`,
    load: async () => ({
      posts: opts.posts.map((p) => ({ ...p, channelId })),
      threads: opts.threads ?? [],
    }),
  });
  await loadResource({ key: `/api/buddies/channels/${channelId}/responding`, load: async () => [] });
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[opts.url ?? '/']}>
      <Provider store={jotaiStore}>
        <ChannelBrowser
          workspaceId={opts.ws}
          directory={workspaceDirectory([rosterFixture([lead], { id: opts.ws })], opts.ws, [])}
          availableConversationIds={new Set()}
        />
      </Provider>
    </MemoryRouter>
  );
}

/** The markup of one post's row, from its `<li>` to the next row. */
function rowOf(html: string, postId: string): string {
  const start = html.indexOf(`data-post-id="${postId}"`);
  assert.notEqual(start, -1, `row ${postId} renders`);
  const end = html.indexOf('<li', start);
  return html.slice(start, end === -1 ? undefined : end);
}

// Feature 1: the channel page carries each root's reply stats beside the
// posts (`threads`); a root with replies says how many and when the last one
// landed, a root without replies shows no thread line at all.
test('channel rows show reply counts and the last reply time', async () => {
  const busy = post('busy', 1);
  const single = post('single', 2);
  const quiet = post('quiet', 3);
  const html = await renderChannel({
    ws: 'ws-counts',
    entry: { unread: 0 },
    posts: [quiet, single, busy],
    threads: [
      stat(busy, 3, post('r3', 30, { rootId: 'busy' })),
      stat(single, 1, post('r1', 20, { rootId: 'single' })),
    ],
  });
  assert.match(rowOf(html, 'busy'), /<strong>3 replies<\/strong><span>Last reply [^<]+<\/span>/);
  assert.match(rowOf(html, 'single'), /<strong>1 reply<\/strong>/);
  assert.doesNotMatch(rowOf(html, 'quiet'), /channel-browser-thread-summary/);
});

// Feature 2: the inbox's read cursor (`lastReadOrd`) places "New messages"
// above the oldest post someone else wrote after it, and bolds the threads
// whose newest reply by someone else landed after it. The owner's own posts
// and replies never count as new.
test('the New messages line and bold threads follow the read cursor', async () => {
  const read = post('read', 1);
  const mark = post('mark', 2);
  const mine = post('mine', 3, { author: { kind: 'owner' } });
  const fresh = post('fresh', 4);
  const newest = post('newest', 5);
  const html = await renderChannel({
    ws: 'ws-unread',
    entry: { unread: 2, lastReadOrd: mark.ord },
    posts: [newest, fresh, mine, mark, read],
    threads: [
      stat(read, 2, post('from-lead', 10, { rootId: 'read' })),
      stat(mark, 1, post('from-me', 11, { rootId: 'mark', author: { kind: 'owner' } })),
      stat(mine, 1, post('seen', 1, { rootId: 'mine' })),
    ],
  });
  assert.equal(html.match(/aria-label="New messages"/g)?.length, 1);
  const line = html.indexOf('aria-label="New messages"');
  assert.ok(html.indexOf('data-post-id="mine"') < line, 'the owner post after the mark is not new');
  assert.ok(line < html.indexOf('data-post-id="fresh"'), 'the line sits above the first new post');
  assert.match(rowOf(html, 'read'), /data-unread="true"/);
  assert.doesNotMatch(rowOf(html, 'mark'), /data-unread/);
  assert.doesNotMatch(rowOf(html, 'mine'), /data-unread/);
});

// Feature 3: a reply permalink asks the thread page FROM the reply, so a reply
// older than the newest page still renders, highlighted, under its root.
test('a reply permalink opens the desktop thread on the linked reply', async () => {
  const root = post('root', 1);
  await loadResource({
    key: '/api/buddies/posts/root/thread?limit=50&from=old-reply',
    load: async () => ({
      root,
      posts: [post('newer', 9, { rootId: 'root' }), post('old-reply', 2, { rootId: 'root' })],
    }),
  });
  const html = await renderChannel({
    ws: 'ws-link',
    entry: { unread: 0 },
    posts: [root],
    url: '/?channel=ch_ws-link&thread=root&post=old-reply',
  });
  const thread = html.slice(html.indexOf('aria-label="Thread"'));
  assert.match(thread, /data-post-id="old-reply" data-linked="true"/);
  assert.ok(thread.indexOf('Body of root.') < thread.indexOf('Body of old-reply.'));
});
