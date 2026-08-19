import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { registerBuddyRoutes } from '../src/buddies/routes';

test('Buddy overview route forwards the optional cutoff and returns one projection', async () => {
  const app = express();
  app.use(express.json());
  const calls: Array<Date | string | undefined> = [];
  const overview = {
    generatedAt: '2026-07-28T00:00:00.000Z',
    employees: [],
    topLevel: [],
    recentRuns: [],
  };
  const store = {
    overview(options?: { recentSince?: Date | string }) {
      calls.push(options?.recentSince);
      return overview;
    },
  } as unknown as BuddiesStorePort;
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('not used');
    },
    sendError(response, error, fallbackStatus) {
      response
        .status(fallbackStatus)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    getNextAutomationRunAt: () => '2026-07-29T00:00:00.000Z',
    createId: () => 'test-id',
    isConversationDeleted: async () => false,
  });

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/buddies/overview?recentSince=2026-07-01T00%3A00%3A00.000Z`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), overview);
    assert.deepEqual(calls, ['2026-07-01T00:00:00.000Z']);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('Buddy detail classifies review and automation conversations for separate UI surfaces', async () => {
  const app = express();
  app.use(express.json());
  const empty = () => [];
  const store = {
    getBuddy: () => ({ id: 'buddy-1', name: 'Lead', status: 'active' }),
    listBuddyWorkspaces: empty,
    listBuddyOwnedProjects: empty,
    listWorkItems: empty,
    listConversationLinks: () => [
      { id: 'link-general', unleashd_conversation_id: 'conversation-general' },
      { id: 'link-review', unleashd_conversation_id: 'conversation-review' },
      { id: 'link-automation', unleashd_conversation_id: 'conversation-automation' },
      { id: 'link-deleted', unleashd_conversation_id: 'conversation-deleted' },
      // Provider-session-only link: nothing to tombstone it against, so it stays.
      { id: 'link-sessionless', provider_session_id: 'session-1' },
    ],
    listAutomations: () => [{ id: 'automation-1' }],
    listAutomationRuns: () => [{ conversation_id: 'conversation-automation' }],
    listBuddyRelationships: empty,
    listBuddySkills: empty,
    listDelegations: empty,
    listReviews: () => [{ conversation_id: 'conversation-review' }],
    listApprovalRequests: empty,
  } as unknown as BuddiesStorePort;
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('not used');
    },
    sendError(response, error, fallbackStatus) {
      response
        .status(fallbackStatus)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    getNextAutomationRunAt: () => '2026-07-29T00:00:00.000Z',
    createId: () => 'test-id',
    isConversationDeleted: async (conversationId) => conversationId === 'conversation-deleted',
  });

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/buddies/buddy-1`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      conversations: Array<{ id: string; kind: string }>;
    };
    // `link-deleted` is absent: deleting a conversation only terminalizes its
    // link row, so the route must ask the config store for the tombstone.
    assert.deepEqual(
      Object.fromEntries(body.conversations.map((conversation) => [conversation.id, conversation.kind])),
      {
        'link-general': 'conversation',
        'link-review': 'review',
        'link-automation': 'automation',
        'link-sessionless': 'conversation',
      }
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test('human approval routes list pending requests and persist one terminal owner decision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-approval-routes-'));
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: root });
  const buddy = store.createBuddy({
    project: workspace.id,
    name: 'Lead',
    role: 'Own outcomes',
  });
  const approval = store.createApprovalRequest({
    buddy: buddy.id,
    workspace: workspace.id,
    action: 'Publish campaign',
    reason: 'Internal checks passed.',
    risk: 'Changes public state.',
  });
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store as unknown as BuddiesStorePort,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('not used');
    },
    sendError(response, error, fallbackStatus) {
      response
        .status(fallbackStatus)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    getNextAutomationRunAt: () => '2026-07-29T00:00:00.000Z',
    createId: () => 'test-id',
    isConversationDeleted: async () => false,
  });

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address() as AddressInfo;
    const pending = await fetch(
      `http://127.0.0.1:${port}/api/buddies/approvals?buddyId=${encodeURIComponent(buddy.id)}&status=pending`
    );
    assert.equal(pending.status, 200);
    assert.equal(((await pending.json()) as Array<{ id: string }>)[0]?.id, approval.id);

    const resolved = await fetch(
      `http://127.0.0.1:${port}/api/buddies/approvals/${encodeURIComponent(approval.id)}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          resolvedBy: 'Owner',
          note: 'Approved for this action only.',
        }),
      }
    );
    assert.equal(resolved.status, 200);
    assert.equal(((await resolved.json()) as { status: string }).status, 'approved');

    const secondDecision = await fetch(
      `http://127.0.0.1:${port}/api/buddies/approvals/${encodeURIComponent(approval.id)}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected', resolvedBy: 'Owner' }),
      }
    );
    assert.equal(secondDecision.status, 400);
    assert.equal(store.getApprovalRequest(approval.id)?.status, 'approved');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('manager review request dispatches one least-privilege reviewer conversation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-review-routes-'));
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: root });
  const lead = store.createBuddy({ project: workspace.id, name: 'Lead', role: 'Lead' });
  const operator = store.createBuddy({
    project: workspace.id,
    name: 'Operator',
    role: 'Operate',
  });
  const critic = store.createBuddy({
    project: workspace.id,
    name: 'Critic',
    role: 'Review',
  });
  store.setBuddyRelationship({ fromBuddy: lead.id, toBuddy: operator.id, kind: 'manager' });
  store.setBuddyRelationship({ fromBuddy: lead.id, toBuddy: critic.id, kind: 'manager' });
  const project = store.newProject({
    buddy: operator.id,
    workspace: workspace.id,
    title: 'Proof slice',
    definitionOfDone: 'Evidence reviewed',
  });
  const created: Array<Record<string, unknown>> = [];
  const conversationId = 'a2e89aa3-f8df-4ceb-bf66-44cc031024fe';
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store as unknown as BuddiesStorePort,
    getScheduler: () => null,
    createConversation: async (input) => {
      created.push(input as unknown as Record<string, unknown>);
      return { id: conversationId, toJSON: () => ({ id: conversationId }) };
    },
    sendError(response, error, fallbackStatus) {
      response
        .status(fallbackStatus)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    getNextAutomationRunAt: () => '2026-07-29T00:00:00.000Z',
    createId: () => conversationId,
    isConversationDeleted: async () => false,
  });

  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/buddies/${encodeURIComponent(lead.id)}/review-requests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviewerBuddyId: critic.id,
          subjectBuddyId: operator.id,
          workspaceId: workspace.id,
          buddyProjectId: project.id,
          purpose: 'Pressure-test the evidence',
          evidence: [
            {
              kind: 'conversation',
              reference: 'delegation-proof',
              observation: 'The report submitted a failed terminal outcome.',
            },
          ],
        }),
      }
    );
    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      review: { reviewer_buddy_id: string; subject_buddy_id: string; conversation_id: string };
    };
    assert.equal(body.review.reviewer_buddy_id, critic.id);
    assert.equal(body.review.subject_buddy_id, operator.id);
    assert.equal(body.review.conversation_id, conversationId);
    assert.match(
      String(created[0]?.initialMessage),
      /delegation-proof/
    );
    assert.equal(created.length, 1);
    assert.deepEqual(created[0]?.context, {
      buddyId: critic.id,
      workspaceId: workspace.id,
      buddyProjectId: null,
      delegatedByBuddyId: lead.id,
      parentBuddyConversationId: null,
      allowedBuddyOperations: [
        'buddy.get_current_work',
        'buddy.get_inbox',
        'buddy.get_automations',
        'buddy.remember',
        'buddy.submit_review',
        'buddy.request_human_approval',
      ],
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
