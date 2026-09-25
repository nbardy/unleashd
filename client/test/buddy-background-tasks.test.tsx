import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import type { ConversationRow } from '@unleashd/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { syntheticConversation } from './fixtures/synthetic-conversations';
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { Provider, createStore } = await import('jotai');
const { buddyBackgroundConversationsAtomFamily } = await import('../src/atoms/buddy-background');
const { conversationLoadCompleteAtom, conversationsAtom } = await import(
  '../src/atoms/conversations'
);
const { BuddyBackgroundTasks } = await import('../src/components/buddies/BuddyBackgroundTasks');

const T0 = Date.parse('2026-09-13T00:00:00Z');
const make = (id: string, overrides: Partial<ConversationRow> = {}) =>
  syntheticConversation(1, {
    id,
    kind: { t: 'buddy', buddyId: 'lead', workspaceId: 'wave', visibility: 'background' },
    createdAt: T0,
    activityAt: T0,
    messageCount: 0,
    provider: 'codex',
    ...overrides,
  });

const hrefs = (html: string) => [...html.matchAll(/href="(\/chat\/[^"]+)"/g)].map((m) => m[1]);

test('background destination shows running work first, keeps history and drops deleted targets', () => {
  const store = createStore();
  const conversations = new Map(
    [
      make('past', { activityAt: Date.parse('2026-09-13T01:00:00Z') }),
      make('active', { run: 'running', parent: 'owner' }),
      make('owner', {
        kind: { t: 'buddy', buddyId: 'lead', workspaceId: 'wave', visibility: 'foreground' },
        run: 'running',
      }),
      make('other-buddy', {
        kind: { t: 'buddy', buddyId: 'engineer', workspaceId: 'wave', visibility: 'background' },
      }),
    ].map((conversation) => [conversation.id, conversation])
  );
  store.set(conversationsAtom, conversations);
  store.set(conversationLoadCompleteAtom, true);
  const view = buddyBackgroundConversationsAtomFamily('lead');
  assert.deepEqual(
    store.get(view).conversations.map((c) => c.id),
    ['active', 'past']
  );
  const render = () =>
    renderToStaticMarkup(
      <Provider store={store}>
        <MemoryRouter>
          <BuddyBackgroundTasks buddyId="lead" runs={[]} refresh={async () => {}} />
        </MemoryRouter>
      </Provider>
    );
  assert.deepEqual(hrefs(render()), ['/chat/active', '/chat/past']);
  assert.match(render(), /1 running · 2 conversations/);

  // Live snapshots change the count; deletion removes its target immediately.
  store.set(conversationsAtom, new Map(conversations).set('active', make('active')));
  assert.match(render(), /0 running · 2 conversations/);
  const remaining = new Map(conversations);
  remaining.delete('active');
  store.set(conversationsAtom, remaining);
  assert.deepEqual(hrefs(render()), ['/chat/past']);
});
