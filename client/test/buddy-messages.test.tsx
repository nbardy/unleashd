import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import type { BuddyMessage } from '@unleashd/shared';
// biome-ignore lint/correctness/noUnusedImports: tsx's test transform uses the classic JSX runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      return nextLoad(url, context);
    }
  `)}`,
  import.meta.url
);
const { BuddyMessages } = await import('../src/components/buddies/BuddyMessages');

const message: BuddyMessage = {
  id: 'message-owner',
  from_buddy_id: 'lead',
  to_buddy_id: null,
  workspace_id: 'workspace',
  buddy_project_id: null,
  purpose: 'deployment approval',
  body: 'The change is ready for your review.',
  evidence: ['https://example.test/pr/1'],
  parent_conversation_id: 'live-chat',
  child_conversation_id: null,
  status: 'pending',
  outcome: null,
  reply_body: null,
  reply_evidence: [],
  replied_by: null,
  wait_until: null,
  wait_status: 'none',
  created_at: '2026-09-08T00:00:00Z',
  updated_at: '2026-09-08T00:00:00Z',
  replied_at: null,
};

test('message inbox offers owner replies, preserves evidence, and links only available conversations', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <BuddyMessages
        buddyId="lead"
        messages={[
          message,
          {
            ...message,
            id: 'message-buddy',
            to_buddy_id: 'reviewer',
            parent_conversation_id: 'deleted-chat',
          },
          {
            ...message,
            id: 'message-done',
            parent_conversation_id: null,
            status: 'replied',
            outcome: 'approved',
            reply_body: 'Ship the reviewed change.',
            reply_evidence: ['Reviewed PR 1'],
          },
        ]}
        availableConversationIds={new Set(['live-chat'])}
        onReply={async () => {}}
      />
    </MemoryRouter>
  );
  assert.equal(
    (html.match(/<form/g) ?? []).length,
    1,
    'only a pending owner message accepts an owner reply'
  );
  assert.match(html, /href="\/chat\/live-chat"/);
  assert.doesNotMatch(html, /\/chat\/deleted-chat/);
  assert.match(html, /https:\/\/example.test\/pr\/1/);
  assert.match(html, /Ship the reviewed change/);
  assert.match(html, /Evidence or decision basis/);
  assert.match(html, /aria-label="Mailbox"/);
  assert.match(html, /Messages, replies, and requests for your approval/);
  assert.doesNotMatch(html, /Background coordination/);
});

test('mailbox-only returns are visible without claiming a model read the reply', () => {
  const render = (mailboxOnly?: boolean) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <BuddyMessages
          messages={[
            {
              ...message,
              status: 'replied',
              reply_body: 'Export verified.',
              reply_evidence: ['fixture: export passed'],
              execution: {
                messageId: message.id,
                runId: 'worker-run',
                projectId: null,
                state: 'complete',
                code: null,
                reason: null,
                remedy: null,
                acknowledgedAt: message.created_at,
                acceptedBy: 'reviewer',
                acceptedAt: message.updated_at,
                completionEvidence: ['fixture: export passed'],
                error: null,
                delivery: [
                  {
                    runId: 'return-run',
                    mailboxOnly,
                    kind: 'message_reply',
                    attempt: 1,
                    state: 'complete',
                    acknowledgedAt: null,
                    createdAt: message.created_at,
                    endedAt: message.updated_at,
                    errorCode: null,
                    error: null,
                    retryOfRunId: null,
                  },
                ],
              },
            },
          ]}
          availableConversationIds={new Set()}
          onReply={async () => {}}
        />
      </MemoryRouter>
    );
  const html = render(true);
  assert.doesNotMatch(
    render(),
    /Saved in mailbox/,
    'historical missing admission timestamps are not mailbox-only evidence'
  );
  assert.match(html, /Export verified/);
  assert.match(html, /fixture: export passed/);
  assert.match(html, /Saved in mailbox. No automated turn was started in your chat./);
});

test('held incoming work offers an owner action without resending the request', () => {
  const render = (code: string) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <BuddyMessages
          messages={[
            {
              ...message,
              to_buddy_id: 'pixel',
              execution: {
                messageId: message.id,
                runId: 'existing-run',
                projectId: null,
                state: 'held',
                code,
                reason: 'Recipient background execution is disabled.',
                remedy: 'Owner can enable incoming work.',
                conversationId: null,
                acknowledgedAt: null,
                acceptedBy: null,
                acceptedAt: null,
                completionEvidence: [],
                outcome: null,
                error: null,
              },
            },
          ]}
          availableConversationIds={new Set()}
          onReply={async () => {}}
        />
      </MemoryRouter>
    );
  assert.match(render('background_disabled'), />Enable incoming work<\/button>/);
  assert.doesNotMatch(render('TEAM_CONTRACT_UNAVAILABLE'), />Enable incoming work<\/button>/);
});

test('a pending structured setup proposal offers its concrete owner workflow instead of a textual approval', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <BuddyMessages
        messages={[
          {
            ...message,
            purpose: 'team_configuration',
            team_configuration: {
              key: 'existing-pixel-path-setup',
              configuration: {
                workspaceId: 'font-maker',
                reason: 'Attach Pixel and Path and enable their existing audits. No training.',
                memberships: [{ buddy: { id: 'pixel' }, present: true, incoming: true }],
              },
            },
          },
        ]}
        availableConversationIds={new Set()}
        onReply={async () => {}}
      />
    </MemoryRouter>
  );
  assert.match(html, /Attach Pixel and Path and enable their existing audits/);
  assert.match(html, /Requested setup/);
  assert.match(html, /Checking team setup/);
  assert.match(html, /Reason for declining/);
  assert.match(html, />Decline setup<\/button>/);
  assert.doesNotMatch(
    html,
    />Send reply<|>Apply this team setup<|placeholder="For example: approved/
  );
});
