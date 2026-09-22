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
const { ChannelBrowser, WorkspaceSlack } = await import('../src/components/buddies/ChannelBrowser');
const { Provider } = await import('jotai');
const { jotaiStore } = await import('../src/atoms/store');
const { loadResource } = await import('../src/atoms/resources');

async function seed() {
  await loadResource({
    key: '/api/buddies/lists?workspaceId=ws-slack',
    load: async () => [
      {
        id: 'list_a',
        workspaceId: 'ws-slack',
        name: 'Standups',
        purpose: 'Daily notes',
        createdByBuddyId: 'lead',
        createdAt: '2026-09-21T00:00:00.000Z',
        postCount: 2,
        latestPostAt: '2026-09-21T03:00:00.000Z',
      },
    ],
  });
  await loadResource({
    key: '/api/buddies/lists/list_a/posts?limit=20',
    load: async () => [
      {
        id: 'post_old',
        listId: 'list_a',
        workspaceId: 'ws-slack',
        fromBuddyId: 'lead',
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
        fromBuddyId: 'dev',
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

test('channel browser lays out sidebar channels beside conversation panels', async () => {
  await seed();
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Provider store={jotaiStore}>
        <ChannelBrowser
          workspaceId="ws-slack"
          workspaceName="unleashd"
          buddyNames={{ lead: 'Lead', dev: 'Dev' }}
          availableConversationIds={new Set(['conv-aaaa111122223333'])}
        />
      </Provider>
    </MemoryRouter>
  );
  assert.match(html, /aria-label="Channels"/);
  assert.match(html, /buddy-workspace-slack-sidebar/);
  assert.match(html, /buddy-workspace-slack-main/);
  assert.match(html, /<h1 class="buddy-workspace-slack-name">unleashd<\/h1>/);
  assert.match(html, /href="\/buddies\/workspaces\/ws-slack"/);
  assert.match(html, /# Standups · 2/);
  const newerAt = html.indexOf('Newer handoff without a live thread.');
  const olderAt = html.indexOf('Older update from the first run.');
  assert.ok(newerAt !== -1 && olderAt !== -1, 'all posts render');
  assert.ok(newerAt < olderAt, 'posts render newest-first');
  assert.match(html, /task-alpha/);
  assert.match(html, /conv conv-aaa/);
  assert.match(html, /href="\/chat\/conv-aaaa111122223333"/);
  assert.match(html, /Lead/);
  assert.match(html, /Dev/);
  assert.doesNotMatch(html, /buddy-messages-list-composer/);
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
  assert.match(html, /<h1 class="buddy-workspace-slack-name">unleashd<\/h1>/);
  assert.match(html, /# Standups · 2/);
  assert.match(html, /Older update from the first run./);
  assert.match(html, /Lead/);
});

test('channel browser shows the shared empty state without channels', async () => {
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
          availableConversationIds={new Set()}
        />
      </Provider>
    </MemoryRouter>
  );
  assert.match(html, /aria-label="Channels"/);
  assert.match(html, /class="empty-state">No channels yet/);
});
