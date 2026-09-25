import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
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
const { ChannelBrowser, WorkspaceSlack } = await import('../src/components/buddies/ChannelBrowser');
const { channelRows } = await import('../src/components/buddies/channel-data');
const { Provider } = await import('jotai');
const { jotaiStore } = await import('../src/atoms/store');
const { loadResource } = await import('../src/atoms/resources');

const UNREPORTED = { kind: 'unreported' } as const;

async function seed() {
  await loadResource({
    key: '/api/buddies/lists?workspaceId=ws-slack',
    load: async () => [
      {
        id: 'list_a',
        workspaceId: 'ws-slack',
        name: 'Standups',
        purpose: 'Daily notes',
        createdBy: { kind: 'buddy', buddyId: 'lead' },
        createdAt: '2026-09-21T00:00:00.000Z',
        postCount: 2,
        latestPostAt: '2026-09-21T03:00:00.000Z',
      },
    ],
  });
  await loadResource({
    key: '/api/buddies/lists/list_a/posts?limit=50',
    load: async () => [
      {
        id: 'post_old',
        listId: 'list_a',
        workspaceId: 'ws-slack',
        author: { kind: 'buddy', buddyId: 'lead' },
        threadRootId: null,
        replyCount: 0,
        latestReplyAt: null,
        purpose: 'standup',
        body: 'Older update from the first run.',
        evidence: [],
        projectId: 'task-alpha',
        createdAt: '2026-09-21T01:00:00.000Z',
        senderConversationId: 'conv-aaaa111122223333',
        senderRunId: 'run-aaa',
      },
      {
        id: 'post_new',
        listId: 'list_a',
        workspaceId: 'ws-slack',
        author: { kind: 'buddy', buddyId: 'dev' },
        threadRootId: null,
        replyCount: 0,
        latestReplyAt: null,
        purpose: 'handoff',
        body: 'Newer handoff without a live thread.',
        evidence: [],
        projectId: null,
        createdAt: '2026-09-21T03:00:00.000Z',
        senderConversationId: null,
        senderRunId: null,
      },
    ],
  });
  await loadResource({
    key: '/api/buddies/workspaces/ws-slack/activity',
    load: async () => ({
      generatedAt: '2026-09-22T00:00:00.000Z',
      workspace: { id: 'ws-slack', name: 'unleashd', rootPath: '~/git/unleashd' },
      members: [
        {
          id: 'lead',
          name: 'Lead',
          role: 'Own the work',
          status: 'active',
          jobs: [],
        },
        {
          id: 'dev',
          name: 'Dev',
          role: 'Build the work',
          status: 'active',
          jobs: [],
        },
      ],
    }),
  });
}

test('channel browser renders a Slack transcript, oldest first, with instance tags', async () => {
  await seed();
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Provider store={jotaiStore}>
        <ChannelBrowser
          workspaceId="ws-slack"
          workspaceName="unleashd"
          members={[
            {
              id: 'lead',
              name: 'Lead',
              role: 'Own the work',
              status: 'active',
              execution: UNREPORTED,
            },
            {
              id: 'dev',
              name: 'Dev',
              role: 'Build the work',
              status: 'active',
              execution: UNREPORTED,
            },
          ]}
          tasks={[]}
          availableConversationIds={new Set(['conv-aaaa111122223333'])}
        />
      </Provider>
    </MemoryRouter>
  );
  assert.match(html, /<h1>unleashd<\/h1>/);
  assert.match(html, /channel-browser-channel-name">Standups</);
  const newerAt = html.indexOf('Newer handoff without a live thread.');
  const olderAt = html.indexOf('Older update from the first run.');
  assert.ok(newerAt !== -1 && olderAt !== -1, 'all posts render');
  assert.ok(olderAt < newerAt, 'transcript reads oldest-first, newest at the bottom');
  // A held thread is a link; a post without provenance carries no instance tag.
  assert.match(html, /href="\/chat\/conv-aaaa111122223333"[^>]*>conv conv-aaa</);
  assert.equal(html.match(/channel-browser-instance/g)?.length, 1);
  assert.match(html, /<option value="task-alpha"/);
  assert.doesNotMatch(html, /buddy-messages-list-composer/);
});

// Regression guard for the instance-uuid feature: two conversations running
// as the SAME Buddy must never collapse into one sender group, or the reader
// loses which instance said what.
test('concurrent conversations of one Buddy start separate message groups', () => {
  const post = (id: string, conversation: string, minute: number) => ({
    id,
    listId: 'list_a',
    workspaceId: 'ws',
    author: { kind: 'buddy' as const, buddyId: 'lead' },
    threadRootId: null,
    replyCount: 0,
    latestReplyAt: null,
    purpose: 'standup',
    body: id,
    evidence: [],
    projectId: null,
    createdAt: new Date(Date.UTC(2026, 8, 21, 12, minute)).toISOString(),
    senderConversationId: conversation,
    senderRunId: null,
  });
  const kinds = (posts: ReturnType<typeof post>[]) =>
    channelRows(posts)
      .filter((row) => row.kind !== 'day')
      .map((row) => row.kind);
  assert.deepEqual(
    kinds([post('c', 'conv-one', 2), post('b', 'conv-two', 1), post('a', 'conv-one', 0)]),
    ['lead', 'lead', 'lead']
  );
  assert.deepEqual(kinds([post('b', 'conv-one', 1), post('a', 'conv-one', 0)]), [
    'lead',
    'continuation',
  ]);
});

test('workspace slack page resolves the workspace name and member names', async () => {
  await seed();
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/buddies/workspaces/ws-slack/channels']}>
      <Provider store={jotaiStore}>
        <Routes>
          <Route path="/buddies/workspaces/:workspaceId/channels" element={<WorkspaceSlack />} />
        </Routes>
      </Provider>
    </MemoryRouter>
  );
  assert.match(html, /<h1>unleashd<\/h1>/);
  assert.match(html, /Older update from the first run./);
  assert.match(html, /channel-browser-author[^>]*>Lead</);
  // Like Slack, a post author's name opens the DM, not the Buddy page
  // (ChannelAuthor, not BuddyMessages' PostAuthor).
  assert.match(html, /<button[^>]*class="channel-browser-author"[^>]*title="Message Lead"/);
  assert.doesNotMatch(html, /<a[^>]*class="channel-browser-author"/);
});

test('channel browser shows an empty state without channels', async () => {
  await loadResource({
    key: '/api/buddies/lists?workspaceId=ws-bare',
    load: async () => [],
  });
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Provider store={jotaiStore}>
        <ChannelBrowser
          workspaceId="ws-bare"
          workspaceName="bare"
          members={[]}
          tasks={[]}
          availableConversationIds={new Set()}
        />
      </Provider>
    </MemoryRouter>
  );
  assert.match(html, /No channels yet/);
});

// The body is markdown with app links: an owner mention, a live Task chip and
// inline media must each render as their own element — a regression to plain
// text would show raw `[@Lead](buddy:lead)` tokens and absolute file paths.
test('posts render markdown mentions, live Task chips, inline media and thread summaries', async () => {
  await loadResource({
    key: '/api/buddies/lists?workspaceId=ws-rich',
    load: async () => [
      {
        id: 'list_rich',
        workspaceId: 'ws-rich',
        name: 'general',
        purpose: 'Team chat',
        createdBy: { kind: 'owner' },
        createdAt: '2026-09-23T00:00:00.000Z',
        postCount: 1,
        latestPostAt: '2026-09-23T01:00:00.000Z',
      },
    ],
  });
  await loadResource({
    key: '/api/buddies/lists/list_rich/posts?limit=50',
    load: async () => [
      {
        id: 'post_ask',
        listId: 'list_rich',
        workspaceId: 'ws-rich',
        author: { kind: 'owner' },
        threadRootId: null,
        replyCount: 2,
        latestReplyAt: '2026-09-23T01:05:00.000Z',
        purpose: 'message',
        body: '[@Lead](buddy:lead) is [Ship channels](task:task-ship) done?\n\n![login](/Users/me/.agent-viewer/uploads/channels/list_rich/abc.png)\n![demo](/Users/me/.agent-viewer/uploads/channels/list_rich/def.mp4)',
        evidence: [],
        projectId: null,
        createdAt: '2026-09-23T01:00:00.000Z',
        senderConversationId: null,
        senderRunId: null,
      },
    ],
  });
  await loadResource({ key: '/api/buddies/lists/list_rich/responding', load: async () => [] });
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Provider store={jotaiStore}>
        <ChannelBrowser
          workspaceId="ws-rich"
          workspaceName="rich"
          members={[
            {
              id: 'lead',
              name: 'Lead',
              role: 'Own the work',
              status: 'active',
              execution: UNREPORTED,
            },
            {
              id: 'gone',
              name: 'Gone',
              role: 'Retired',
              status: 'archived',
              execution: UNREPORTED,
            },
          ]}
          tasks={[
            {
              id: 'task-ship',
              title: 'Ship channels',
              status: 'in_progress',
              ownerBuddyId: 'lead',
              ownerName: 'Lead',
              todosDone: 3,
              todosTotal: 5,
              nextAction: 'Wire the composer',
              updatedAt: '2026-09-23T00:30:00.000Z',
            },
          ]}
          availableConversationIds={new Set()}
        />
      </Provider>
    </MemoryRouter>
  );
  assert.match(html, /class="channel-browser-author">You</);
  assert.match(html, /<a class="channel-mention" href="\/buddies\/lead"[^>]*>@Lead<\/a>/);
  assert.doesNotMatch(html, /buddy:lead/);
  // Live chip: in-progress tone, links to the owner's work. Its hover card is
  // portalled only while hovered or focused; card content is covered in
  // channel-markdown.test.tsx.
  assert.match(
    html,
    /class="channel-task-chip" data-tone="active"[^>]*href="\/buddies\/lead\/work"/
  );
  // Local media goes through the authenticated file route; .mp4 is a player.
  assert.match(
    html,
    /<img class="channel-media" src="\/api\/files\?path=%2FUsers%2Fme%2F[^"]*abc\.png"/
  );
  assert.match(html, /<video class="channel-media" src="\/api\/files\?path=[^"]*def\.mp4"/);
  assert.match(html, /<strong>2 replies<\/strong>/);
  // The composer posts to this channel; archived Buddies stay out of the rail.
  assert.match(html, /placeholder="Message #general"/);
  assert.match(html, /channel-browser-buddies/);
  assert.doesNotMatch(html, />Gone</);
});

// Until 2026-09-25 the thread pane read a thread's first 200 replies and the
// Task filter one page, and neither could page back. Both now read through
// the channel's keyset feed: each opens on its newest page with the flame
// above it while older posts may remain, and a thread keeps its root on top.
test('the thread pane and the Task filter open on their newest page and page back like the channel', async () => {
  const post = (id: string, minute: number, overrides: Record<string, unknown> = {}) => ({
    id,
    listId: 'list_long',
    workspaceId: 'ws-long',
    author: { kind: 'buddy', buddyId: 'lead' },
    threadRootId: null,
    replyCount: 0,
    latestReplyAt: null,
    purpose: 'message',
    body: `Body of ${id}.`,
    evidence: [],
    projectId: null,
    createdAt: new Date(Date.UTC(2026, 8, 24, 9, minute)).toISOString(),
    senderConversationId: null,
    senderRunId: null,
    ...overrides,
  });
  // A full page, newest-first: more may sit before it.
  const fullPage = (prefix: string, overrides: Record<string, unknown>) =>
    Array.from({ length: 50 }, (_, index) =>
      post(`${prefix}-${49 - index}`, 200 - index, overrides)
    );
  const root = post('root', 1, { replyCount: 260, latestReplyAt: '2026-09-24T12:20:00.000Z' });
  await loadResource({
    key: '/api/buddies/lists?workspaceId=ws-long',
    load: async () => [
      {
        id: 'list_long',
        workspaceId: 'ws-long',
        name: 'general',
        purpose: 'Team chat',
        createdBy: { kind: 'owner' },
        createdAt: '2026-09-24T00:00:00.000Z',
        postCount: 400,
        latestPostAt: '2026-09-24T12:20:00.000Z',
      },
    ],
  });
  await loadResource({
    key: '/api/buddies/lists/list_long/posts?limit=50',
    load: async () => [post('tasked', 2, { projectId: 'task-long' }), root],
  });
  await loadResource({
    key: '/api/buddies/posts?workspaceId=ws-long&projectId=task-long&limit=50',
    load: async () => fullPage('task', { projectId: 'task-long' }),
  });
  await loadResource({
    key: '/api/buddies/lists/list_long/threads/root?limit=50',
    load: async () => ({ root, replies: fullPage('reply', { threadRootId: 'root' }) }),
  });
  await loadResource({ key: '/api/buddies/lists/list_long/responding', load: async () => [] });
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/?channel=list_long&task=task-long&thread=root']}>
      <Provider store={jotaiStore}>
        <ChannelBrowser
          workspaceId="ws-long"
          workspaceName="long"
          members={[
            {
              id: 'lead',
              name: 'Lead',
              role: 'Own the work',
              status: 'active',
              execution: UNREPORTED,
            },
          ]}
          tasks={[]}
          availableConversationIds={new Set()}
        />
      </Provider>
    </MemoryRouter>
  );
  const [channelPane, threadPane = ''] = html.split('aria-label="Thread"');
  const inOrder = (pane: string, needles: string[]) => {
    const at = needles.map((needle) => pane.indexOf(needle));
    assert.deepEqual(
      needles.filter((_, index) => at[index] === -1),
      [],
      'missing from the pane'
    );
    assert.deepEqual(
      at,
      [...at].sort((a, b) => a - b),
      `out of order: ${needles.join(' < ')}`
    );
  };
  const flame = 'class="channel-history"';
  // The Task filter pages its cross-channel feed.
  inOrder(channelPane, [flame, 'Body of task-0.', 'Body of task-49.']);
  // The thread opens on its newest replies, the root above the older ones' flame.
  inOrder(threadPane, ['Body of root.', flame, 'Body of reply-0.', 'Body of reply-49.']);
});
