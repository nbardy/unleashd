import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation } from '@unleashd/shared';
import { Provider, createStore } from 'jotai';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { buddyBackgroundConversationsAtomFamily } from '../src/atoms/buddy-background';
import { conversationLoadCompleteAtom, conversationsAtom } from '../src/atoms/conversations';
import { BuddyBackgroundTasks } from '../src/components/buddies/BuddyBackgroundTasks';
import { buddyTabPath } from '../src/components/buddies/buddy-tabs';

const make = (id: string, overrides: Partial<Conversation> = {}) =>
  ({
    id,
    kind: { kind: 'buddy', buddyId: 'lead', workspaceId: 'wave' },
    placement: 'background',
    createdAt: new Date('2026-09-13T00:00:00Z'),
    messages: [],
    provider: 'codex',
    isRunning: false,
    ...overrides,
  }) as Conversation;

const byId = (conversations: Conversation[]) =>
  new Map(conversations.map((conversation) => [conversation.id, conversation]));

const renderTab = (store: ReturnType<typeof createStore>, query: string) =>
  renderToStaticMarkup(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`${buddyTabPath('lead', 'background')}${query}`]}>
        <BuddyBackgroundTasks
          buddyId="lead"
          workspaces={[
            { id: 'wave', name: 'Wave', root_path: '/wave' },
            { id: 'other', name: 'Other', root_path: '/other' },
          ]}
        />
      </MemoryRouter>
    </Provider>
  );

const hrefs = (html: string) => [...html.matchAll(/href="(\/chat\/[^"]+)"/g)].map((m) => m[1]);

test('background destination shows running work first, retains history and scopes links to workspace', () => {
  const store = createStore();
  const conversations = byId([
    make('past', { createdAt: new Date('2026-09-13T01:00:00Z') }),
    make('active', { isRunning: true, parentConversationId: 'owner' }),
    make('owner', { placement: 'default', isRunning: true }),
    make('other-workspace', { kind: { kind: 'buddy', buddyId: 'lead', workspaceId: 'other' } }),
    make('other-buddy', { kind: { kind: 'buddy', buddyId: 'engineer', workspaceId: 'wave' } }),
  ]);
  store.set(conversationsAtom, conversations);
  store.set(conversationLoadCompleteAtom, true);
  const view = buddyBackgroundConversationsAtomFamily({ buddyId: 'lead', workspaceId: 'wave' });
  assert.deepEqual(
    store.get(view).conversations.map((c) => c.id),
    ['active', 'past']
  );
  assert.equal(store.get(view).runningCount, 1);
  const render = (query = '?workspace=wave') => renderTab(store, query);
  assert.deepEqual(hrefs(render()), ['/chat/active', '/chat/past']);
  assert.match(render(), /1 running · 2 conversations/);
  assert.deepEqual(hrefs(render('')), ['/chat/active', '/chat/past', '/chat/other-workspace']);

  // Live snapshots change the count; deletion removes its target immediately.
  store.set(conversationsAtom, new Map(conversations).set('active', make('active')));
  assert.match(render(), /0 running · 2 conversations/);
  const remaining = new Map(conversations);
  remaining.delete('active');
  store.set(conversationsAtom, remaining);
  assert.deepEqual(hrefs(render()), ['/chat/past']);
});

test('empty workspace param means all workspaces; a workspace with no runs offers to show all', () => {
  // Regression: the sidebar built `?workspace=` for buddies with no workspace
  // row, which the tab read as a workspace literally named "" — zero rows
  // while the badge counts showed work, and the Conversations tab hides
  // background placement by design, so the threads looked hidden everywhere.
  const store = createStore();
  store.set(
    conversationsAtom,
    byId([
      make('past'),
      make('active', { isRunning: true }),
      make('other-workspace', { kind: { kind: 'buddy', buddyId: 'lead', workspaceId: 'other' } }),
    ])
  );
  store.set(conversationLoadCompleteAtom, true);
  assert.deepEqual(hrefs(renderTab(store, '?workspace=')), [
    '/chat/active',
    '/chat/past',
    '/chat/other-workspace',
  ]);
  const empty = renderTab(store, '?workspace=missing');
  assert.match(empty, /No background conversations yet/);
  assert.match(empty, /Show all workspaces \(3\)/);
});
