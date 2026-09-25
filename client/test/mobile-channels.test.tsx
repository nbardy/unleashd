import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
const { ChannelsMobile } = await import('../src/mobile/channels/ChannelsMobile');
const { isImmersiveChannelRoute, mobileChannelScreen } = await import(
  '../src/mobile/channels/channel-route'
);
const { channelLinkPath, postLink } = await import('../src/components/buddies/channel-link');
const { mobilePrimarySectionForPath, resolveMobileConversationDestination } = await import(
  '../src/utils/conversation-route-state'
);
const { Provider } = await import('jotai');
const { jotaiStore } = await import('../src/atoms/store');
const { loadResource } = await import('../src/atoms/resources');

const WS = 'ws-phone';
const CHANNELS = `/buddies/workspaces/${WS}/channels`;

// Permalinks are built by desktop (channel-link.ts) but parsed by a separate
// mobile router (channel-route.ts). A link pasted into a bug report from the
// desktop must open the same thread, and the same reply, on a phone.
test('a desktop message permalink opens its thread and reply on mobile', () => {
  const post = postFixture({
    id: 'post_reply',
    channelId: 'ch_a',
    author: { kind: 'buddy', id: 'b1' },
    rootId: 'post_root',
    replyToId: 'post_root',
    purpose: 'reply',
  });
  const reply = new URL(channelLinkPath(WS, postLink(post)), 'http://host');
  assert.equal(reply.pathname, CHANNELS);
  assert.deepEqual(mobileChannelScreen(reply.search), {
    kind: 'thread',
    channelId: 'ch_a',
    rootId: 'post_root',
    linkedPostId: 'post_reply',
  });
  // A top-level message links to its own thread, which loads it by id however old it is.
  const root = new URL(
    channelLinkPath(WS, postLink(postFixture({ id: 'post_root', channelId: 'ch_a' }))),
    'http://host'
  );
  assert.deepEqual(mobileChannelScreen(root.search), {
    kind: 'thread',
    channelId: 'ch_a',
    rootId: 'post_root',
    linkedPostId: null,
  });
});

// The channel URL is shared with desktop, so the section and the immersive
// flag are derived from it. Misreading it as the Buddies section would light
// the wrong tab and keep the tab bar over the pinned composer.
test('channel URLs belong to the Channels tab; only channel and thread screens are immersive', () => {
  assert.equal(mobilePrimarySectionForPath(CHANNELS), 'channels');
  assert.equal(mobilePrimarySectionForPath('/channels'), 'channels');
  assert.equal(mobilePrimarySectionForPath(`/buddies/workspaces/${WS}`), 'buddies');
  assert.equal(isImmersiveChannelRoute(CHANNELS, ''), false);
  assert.equal(isImmersiveChannelRoute(CHANNELS, '?channel=list_a'), true);
  assert.equal(isImmersiveChannelRoute(CHANNELS, '?channel=list_a&thread=post_1'), true);
  assert.equal(isImmersiveChannelRoute('/buddies/b1', '?channel=list_a'), false);
  // A DM opened from Channels comes back to the exact channels screen.
  const back = resolveMobileConversationDestination(
    {
      mobileConversationOrigin: {
        section: 'channels',
        pathname: CHANNELS,
        search: '?channel=list_a',
        hash: '',
      },
    },
    null
  );
  assert.deepEqual(back, { path: `${CHANNELS}?channel=list_a`, section: 'channels' });
});

const lead = buddyFixture({ id: 'lead', name: 'Lead', role: 'Own the work', workspaceId: WS });

async function seed() {
  await loadResource({
    key: '/api/buddies/overview',
    load: async () => [rosterFixture([lead], { id: WS, name: 'unleashd' })],
  });
  await loadResource({
    key: `/api/buddies/workspaces/${WS}/inbox`,
    load: async () =>
      inboxFixture([
        { channel: publicChannel('ch_a', 'general', WS), unread: 0 },
        {
          channel: {
            id: 'ch_dm',
            workspaceId: WS,
            kind: { type: 'direct', members: [{ kind: 'owner' }, { kind: 'buddy', id: 'lead' }] },
            createdBy: { kind: 'owner' },
            createdAt: '2026-09-24T00:00:00.000Z',
          },
          unread: 0,
        },
      ]),
  });
  await loadResource({ key: `/api/buddies/tasks?workspaceId=${WS}`, load: async () => [] });
  await loadResource({ key: '/api/buddies/channels/ch_a/responding', load: async () => [] });
  await loadResource({
    key: '/api/buddies/channels/ch_a/posts?limit=50',
    load: async () => ({
      posts: [
        postFixture({
          id: 'post_ask',
          body: '[@Lead](buddy:lead) ship it?',
          createdAt: '2026-09-24T01:00:00.000Z',
        }),
      ],
    }),
  });
}

function render(url: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <Provider store={jotaiStore}>
        <Routes>
          <Route path="/buddies/workspaces/:workspaceId/channels" element={<ChannelsMobile />} />
        </Routes>
      </Provider>
    </MemoryRouter>
  );
}

test('mobile channel screen: back to Home, thread link, touch composer', async () => {
  await seed();
  const html = render(`${CHANNELS}?channel=ch_a`);
  assert.match(
    html,
    /class="mobile-channel-header__back"[^>]*href="\/buddies\/workspaces\/ws-phone\/channels"/
  );
  assert.match(html, /<h1># general<\/h1>/);
  assert.match(html, /<a class="channel-mention" href="\/buddies\/lead"[^>]*>@Lead<\/a>/);
  // Every root opens its thread screen at the shared URL (posts carry no reply count).
  assert.match(
    html,
    /class="mobile-channel-post__reply" href="\/buddies\/workspaces\/ws-phone\/channels\?channel=ch_a&amp;thread=post_ask"/
  );
  // Touch composer: Return is a newline, so no Shift+Enter hint.
  assert.match(html, /placeholder="Message #general"/);
  assert.doesNotMatch(html, /new line/);
});

// A reply permalink opens its thread FROM the reply (`&from=`, T22): the
// linked reply is on the first page however old it is, highlighted, the root
// sits on top and older replies wait behind the flame.
test('a reply permalink opens its thread with the reply highlighted and the root on top', async () => {
  await seed();
  const reply = (number: number) =>
    postFixture({
      id: `reply-${number}`,
      author: { kind: 'buddy', id: 'lead' },
      rootId: 'post_ask',
      purpose: 'reply',
      body: `Reply number ${number}.`,
      createdAt: new Date(Date.UTC(2026, 8, 24, 2, number - 100)).toISOString(),
    });
  await loadResource({
    key: '/api/buddies/posts/post_ask/thread?limit=50&from=reply-120',
    load: async () => ({
      root: postFixture({ id: 'post_ask', body: '[@Lead](buddy:lead) ship it?' }),
      posts: [125, 124, 123, 122, 121, 120].map(reply),
      next: { createdAt: '2026-09-24T02:19:00.000Z', id: 'reply-119' },
    }),
  });
  const html = render(`${CHANNELS}?channel=ch_a&thread=post_ask&post=reply-120`);
  const at = ['ship it?', 'class="channel-history"', 'Reply number 120.', 'Reply number 125.'].map(
    (needle) => html.indexOf(needle)
  );
  assert.ok(!at.includes(-1), `missing: ${at}`);
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
    'root, flame, linked reply, newest'
  );
  assert.match(html, /data-post-id="reply-120" data-linked="true"/);
});

test('mobile channels Home lists channels, DMs by Buddy, and Buddies with a visible Wake', async () => {
  await seed();
  const html = render(CHANNELS);
  assert.match(html, /mobile-channels-row__name">general</);
  assert.match(html, /Add channel/);
  const dms = html.slice(html.indexOf('Direct messages'));
  assert.match(dms, /href="\/buddies\/workspaces\/ws-phone\/channels\?channel=ch_dm"/);
  assert.match(html, /mobile-channels-row__name">Lead</);
  assert.match(html, /aria-label="Wake Lead: catch up on the channels and act"/);
});

// Regression guard: the Channels tab once opened the alphabetically first
// workspace (an empty one) instead of where the team was active.
test('the Channels tab opens the most recently active workspace first', async () => {
  const { overviewWorkspaces } = await import('../src/mobile/channels/ChannelsIndex');
  const ordered = overviewWorkspaces(
    [
      rosterFixture([], { id: 'a', name: 'alpha-empty' }),
      rosterFixture([], { id: 'u', name: 'unleashd' }),
    ],
    new Map([['u', Date.parse('2026-09-24T01:00:00.000Z')]])
  );
  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ['u', 'a']
  );
});
