import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
const { isImmersiveChannelRoute } = await import('../src/mobile/channels/channel-route');
const { mobilePrimarySectionForPath, resolveMobileConversationDestination } = await import(
  '../src/utils/conversation-route-state'
);
const { Provider } = await import('jotai');
const { jotaiStore } = await import('../src/atoms/store');
const { loadResource } = await import('../src/atoms/resources');

const WS = 'ws-phone';
const CHANNELS = `/buddies/workspaces/${WS}/channels`;

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

const post = (overrides: Record<string, unknown>) => ({
  listId: 'list_a',
  workspaceId: WS,
  threadRootId: null,
  replyCount: 0,
  latestReplyAt: null,
  purpose: 'message',
  evidence: [],
  projectId: null,
  senderConversationId: null,
  senderRunId: null,
  ...overrides,
});

async function seed() {
  await loadResource({
    key: `/api/buddies/lists?workspaceId=${WS}`,
    load: async () => [
      {
        id: 'list_a',
        workspaceId: WS,
        name: 'general',
        purpose: 'Team chat',
        createdBy: { kind: 'owner' },
        createdAt: '2026-09-24T00:00:00.000Z',
        postCount: 2,
        latestPostAt: '2026-09-24T01:00:00.000Z',
      },
    ],
  });
  await loadResource({
    key: `/api/buddies/workspaces/${WS}/activity`,
    load: async () => ({
      generatedAt: '2026-09-24T00:00:00.000Z',
      workspace: { id: WS, name: 'unleashd', rootPath: '~/git/unleashd' },
      members: [{ id: 'lead', name: 'Lead', role: 'Own the work', status: 'active', jobs: [] }],
    }),
  });
  await loadResource({ key: `/api/buddies/workspaces/${WS}/tasks`, load: async () => [] });
  await loadResource({ key: '/api/buddies/lists/list_a/responding', load: async () => [] });
  await loadResource({
    key: '/api/buddies/lists/list_a/posts?limit=50',
    load: async () => [
      post({
        id: 'post_ask',
        author: { kind: 'owner' },
        body: '[@Lead](buddy:lead) ship it?',
        replyCount: 1,
        latestReplyAt: '2026-09-24T01:05:00.000Z',
        createdAt: '2026-09-24T01:00:00.000Z',
      }),
    ],
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
  const html = render(`${CHANNELS}?channel=list_a`);
  assert.match(
    html,
    /class="mobile-channel-header__back"[^>]*href="\/buddies\/workspaces\/ws-phone\/channels"/
  );
  assert.match(html, /<h1># general<\/h1>/);
  assert.match(html, /<a class="channel-mention" href="\/buddies\/lead"[^>]*>@Lead<\/a>/);
  // "1 reply" opens the thread screen at the shared URL.
  assert.match(
    html,
    /class="mobile-channel-post__replies" href="\/buddies\/workspaces\/ws-phone\/channels\?channel=list_a&amp;thread=post_ask"/
  );
  // Touch composer: Return is a newline, so no Shift+Enter hint.
  assert.match(html, /placeholder="Message #general"/);
  assert.doesNotMatch(html, /new line/);
});

test('mobile channels Home lists channels and Buddies with a visible Wake', async () => {
  await seed();
  const html = render(CHANNELS);
  assert.match(html, /mobile-channels-row__name">general</);
  assert.match(html, /Add channel/);
  assert.match(html, /mobile-channels-row__name">Lead</);
  assert.match(html, /aria-label="Wake Lead: catch up on the channels and act"/);
});

// Regression guard: the Channels tab once opened the alphabetically first
// workspace (an empty one) instead of where the team was active.
test('the Channels tab opens the most recently active workspace first', async () => {
  const { overviewWorkspaces } = await import('../src/mobile/channels/ChannelsMobile');
  const workspace = (id: string, name: string) => ({ id, name, root_path: `/tmp/${id}` });
  const employee = (workspaces: ReturnType<typeof workspace>[]) =>
    ({ workspaces }) as unknown as Parameters<typeof overviewWorkspaces>[0] extends infer O
      ? O extends { employees: Array<infer E> }
        ? E
        : never
      : never;
  const ordered = overviewWorkspaces({
    generatedAt: '2026-09-24T00:00:00.000Z',
    employees: [employee([workspace('a', 'alpha-empty')]), employee([workspace('u', 'unleashd')])],
    topLevel: [],
    recentRuns: [
      {
        conversationId: 'c',
        buddyId: 'b',
        buddyName: 'B',
        workspaceId: 'u',
        workspaceName: 'unleashd',
        status: 'complete',
        lastActiveAt: '2026-09-24T01:00:00.000Z',
      },
    ],
  });
  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ['u', 'a']
  );
});
