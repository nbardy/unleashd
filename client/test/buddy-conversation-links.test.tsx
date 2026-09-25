/**
 * Every "open this conversation" affordance in the buddy tree must be a real
 * anchor pointing at the conversation's own id, and must NOT be an anchor when
 * the client no longer holds that conversation.
 *
 * Both halves are regression guards, not schema mirrors:
 *
 *   - The Automations tab shipped these as `<button onClick={navigate(...)}>`.
 *     Buttons have no href: no middle-click, no open-in-new-tab, no status-bar
 *     target, and nothing in history. Reported 2026-08-21, fixed in 42dc28a.
 *
 *   - A buddy link row outlives its thread (deleting a conversation only
 *     terminalises the row) and an automation run keeps its `conversation_id`
 *     forever. Linking one of those lands on Chat.tsx's `navigate('/')` bounce,
 *     which reads to the user as "Open took me to the conversation list."
 *
 * Renders the real components through a real MemoryRouter — no mocks, no
 * assertions on TSX source text.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation } from '@unleashd/shared';
import { Provider, createStore } from 'jotai';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { conversationsAtom } from '../src/atoms/conversations';
import { BuddyAutomationsTab } from '../src/components/buddies/BuddyAutomationsTab';
import { BuddyConversationList } from '../src/components/buddies/BuddyConversationList';
import { BuddySectionNav } from '../src/components/buddies/BuddySectionNav';
import type { BuddyAutomation, ConversationLink } from '../src/components/buddies/types';
import { AutomationsTab } from '../src/mobile/buddies/BuddyDetailAutomationsTab';
import { ConversationsTab } from '../src/mobile/buddies/BuddyDetailConversationsTab';

const LIVE = 'live-conversation-id';
const DEAD = 'dead-conversation-id';

/** Ids the client actually holds. DEAD is deliberately absent. */
const AVAILABLE = new Set([LIVE]);

function link(conversationId: string, kind: ConversationLink['kind']): ConversationLink {
  return {
    id: `link-${conversationId}`,
    unleashd_conversation_id: conversationId,
    status: 'active',
    kind,
    last_active_at: '2026-08-21T00:00:00.000Z',
  };
}

const AUTOMATION: BuddyAutomation = {
  id: 'automation-1',
  name: 'Nightly report',
  schedule_kind: 'cron',
  schedule_expression: '0 22 * * *',
  timezone: 'UTC',
  job_kind: 'prompt',
  job_payload: { prompt: 'go' },
  policy: {
    max_runtime_seconds: 3600,
    max_iterations: 1,
    max_tokens: 1000,
    max_cost_usd: 1,
    allowed_operations: [],
  },
  // No `runs`: both shells fetch run history separately (mobile behind History),
  // so an inline runs array would be fixture data no component reads.
  enabled: true,
};

const render = (element: ReactElement): string =>
  renderToStaticMarkup(<MemoryRouter>{element}</MemoryRouter>);

/** Hrefs of anchors pointing at a chat route, in document order. */
function chatHrefs(html: string): string[] {
  return [...html.matchAll(/<a[^>]*href="(\/chat\/[^"]*)"/g)].map((match) => match[1]);
}

test('desktop automations tab links live automation threads and never links dead ones', () => {
  const html = render(
    <BuddyAutomationsTab
      automations={[]}
      approvals={[]}
      busy={false}
      mutate={async () => {}}
      availableConversationIds={AVAILABLE}
      automationConversations={[link(LIVE, 'automation'), link(DEAD, 'automation')]}
    />
  );

  assert.deepEqual(chatHrefs(html), [`/chat/${LIVE}`]);
  assert.ok(!html.includes(DEAD), 'a dead conversation id must not reach the markup as a target');
});

test('mobile automations tab exposes explicit history and links only loaded live threads', () => {
  const html = render(
    <AutomationsTab
      buddyId="buddy-1"
      automations={[AUTOMATION]}
      automationConversations={[link(LIVE, 'automation'), link(DEAD, 'automation')]}
      busy={null}
      setBusy={() => {}}
      error={null}
      availableIds={AVAILABLE}
      onRefresh={() => {}}
    />
  );

  // Runs are fetched only after History instead of pretending the bare automation-list
  // response contains them. The already-loaded live automation conversation remains a link.
  assert.ok(html.includes('History'));
  assert.deepEqual(chatHrefs(html), [`/chat/${LIVE}`]);
  assert.ok(!html.includes(DEAD), 'a dead conversation id must not reach the markup as a target');
});

test('mobile chats tab opens a conversation through an anchor, not an onClick', () => {
  // Availability is derived from the store (allConversationIdsAtom) rather than
  // passed in, so the tab needs a store holding exactly the live conversation.
  const store = createStore();
  store.set(
    conversationsAtom,
    new Map([[LIVE, { id: LIVE, messages: [] } as unknown as Conversation]])
  );
  const html = render(
    <Provider store={store}>
      <ConversationsTab
        conversations={[link(LIVE, 'conversation'), link(DEAD, 'conversation')]}
        reviewCount={0}
        showReviewConversations={false}
        onToggleReviews={() => {}}
        workspace={undefined}
        onTalk={() => {}}
      />
    </Provider>
  );

  assert.deepEqual(chatHrefs(html), [`/chat/${LIVE}`]);
  assert.ok(!html.includes(`/chat/${DEAD}`), 'a dead conversation must not be linked');
});

test('Buddy conversations show real previews, sort running first, and react to completion', () => {
  const store = createStore();
  const running = {
    id: LIVE,
    messages: [
      { role: 'user', content: 'Review the launch plan', timestamp: new Date('2026-09-15') },
    ],
    isRunning: true,
    createdAt: new Date('2026-09-15'),
  } as Conversation;
  const recent = {
    id: 'recent',
    messages: [
      { role: 'assistant', content: 'The rollout is ready', timestamp: new Date('2026-09-16') },
    ],
    isRunning: false,
    createdAt: new Date('2026-09-16'),
  } as Conversation;
  store.set(
    conversationsAtom,
    new Map([
      [LIVE, running],
      ['recent', recent],
    ])
  );
  const links = [
    link('recent', 'conversation'),
    link(LIVE, 'conversation'),
    link(LIVE, 'conversation'),
    link(DEAD, 'conversation'),
  ];
  const renderList = () =>
    render(
      <Provider store={store}>
        <BuddyConversationList links={links} />
      </Provider>
    );
  const html = renderList();
  assert.deepEqual(chatHrefs(html), [`/chat/${LIVE}`, '/chat/recent']);
  assert.ok(html.includes('Review the launch plan'));
  assert.ok(html.includes('The rollout is ready'));
  assert.ok(html.includes('Running'));
  assert.ok(html.includes('Unavailable'));
  store.set(
    conversationsAtom,
    new Map([
      [LIVE, { ...running, isRunning: false }],
      ['recent', recent],
    ])
  );
  const completed = renderList();
  assert.deepEqual(chatHrefs(completed), ['/chat/recent', `/chat/${LIVE}`]);
  assert.ok(!completed.includes('Running'));
});

test('Buddy navigation keeps secondary sections reachable as real routes', () => {
  const html = render(<BuddySectionNav buddyId="buddy-1" activeTab="memory" />);
  assert.ok(html.includes('href="/buddies/buddy-1/conversations"'));
  const memoryLink = html.match(/<a[^>]*href="\/buddies\/buddy-1\/memory"[^>]*>/)?.[0];
  assert.ok(memoryLink?.includes('aria-current="page"'));
  assert.ok(html.includes('href="/buddies/buddy-1/settings"'));
});
