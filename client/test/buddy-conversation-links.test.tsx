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
// biome-ignore lint/style/useImportType: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { BuddyAutomationsTab } from '../src/components/buddies/BuddyAutomationsTab';
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
  enabled: true,
  runs: [
    {
      id: 'run-live',
      status: 'complete',
      scheduled_for: '2026-08-21T00:00:00.000Z',
      conversation_id: LIVE,
    },
    {
      id: 'run-dead',
      status: 'complete',
      scheduled_for: '2026-08-21T00:00:00.000Z',
      conversation_id: DEAD,
    },
  ],
};

const render = (element: React.ReactElement): string =>
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
      refresh={async () => {}}
      availableConversationIds={AVAILABLE}
      automationConversations={[link(LIVE, 'automation'), link(DEAD, 'automation')]}
    />
  );

  assert.deepEqual(chatHrefs(html), [`/chat/${LIVE}`]);
  assert.ok(!html.includes(DEAD), 'a dead conversation id must not reach the markup as a target');
});

test('mobile automations tab links live run threads and never links dead ones', () => {
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

  // One anchor for the live run in history, one for the live automation
  // conversation. The dead run and the dead link render as plain text.
  assert.deepEqual(chatHrefs(html), [`/chat/${LIVE}`, `/chat/${LIVE}`]);
  assert.ok(!html.includes(DEAD), 'a dead conversation id must not reach the markup as a target');
});

test('mobile chats tab opens a conversation through an anchor, not an onClick', () => {
  const html = render(
    <ConversationsTab
      visibleConversations={[link(LIVE, 'conversation'), link(DEAD, 'conversation')]}
      reviewCount={0}
      showReviewConversations={false}
      onToggleReviews={() => {}}
      workspace={undefined}
      onTalk={() => {}}
      availableIds={AVAILABLE}
    />
  );

  assert.deepEqual(chatHrefs(html), [`/chat/${LIVE}`]);
  assert.ok(!html.includes(`/chat/${DEAD}`), 'a dead conversation must not be linked');
});
