import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  BUDDY_REVIEW_RESULT_END,
  BUDDY_REVIEW_RESULT_START,
  createBuddiesIntegration,
} from '../src/buddies/integration';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';

test('Buddy closure loop survives restart with work, review, delegation, memory, and recent run', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-lifecycle-e2e-'));
  const workspaceRoot = join(root, 'workspace');
  const database = join(root, 'buddies.sqlite');
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(
    join(workspaceRoot, 'BUDDY_SOUL.md'),
    '# Growth Lead\nClose GTM work with evidence and preserve the next action.\n'
  );

  let store = new BuddiesStore(database);
  const workspace = store.createWorkspace({ name: 'Magic Genie', rootPath: workspaceRoot });
  const lead = store.createBuddy({
    project: workspace.id,
    name: 'Growth Lead',
    role: 'Own GTM closure',
    soulPath: 'BUDDY_SOUL.md',
    memoryPath: 'lead-memory',
    provider: 'codex',
  });
  const critic = store.createBuddy({
    project: workspace.id,
    name: 'Go-to-Market Critic',
    role: 'Pressure-test buyer fit',
  });
  store.setBuddyRelationship({
    fromBuddy: lead.id,
    toBuddy: critic.id,
    kind: 'manager',
  });
  const sprint = store.createSprint({
    project: workspace.id,
    name: 'Proof sprint',
    goal: 'Close one GTM proof loop',
    status: 'active',
  });
  const project = store.newProject({
    buddy: lead.id,
    workspace: workspace.id,
    sprint: sprint.id,
    title: 'Adjudicate concierge onboarding proof',
    objective: 'Decide whether the onboarding wedge produces qualified activation',
    definitionOfDone: 'A dated carry, sharpen, or kill decision cites measured evidence',
    status: 'in_progress',
    nextAction: 'Record the bounded proof result',
    todos: [
      {
        title: 'Record the bounded proof result',
        status: 'in_progress',
      },
    ],
  });
  store.rememberNote(lead.id, {
    topic: 'proof-result',
    kind: 'decision',
    body: 'Failed attempt: destination evidence was stale. Next attempt must refresh the audit first. Source metric:concierge-proof-2026-07-28.',
    workspace: workspace.id,
    scope: 'current',
  });

  const integration = createBuddiesIntegration({
    getConversation: () => undefined,
    loadModule: async () => ({
      BuddiesStore: function StoreConstructor() {
        return store;
      },
    }),
  });
  const resolved = await integration.resolveConversation({
    buddyId: lead.id,
    workspaceId: workspace.id,
    buddyProjectId: project.id,
    allowedBuddyOperations: ['buddy.get_current_work'],
  });
  assert.equal(resolved.context.buddyId, lead.id);
  assert.equal(resolved.workingDirectory, workspaceRoot);
  assert.match(resolved.briefing, /Close GTM work with evidence/);
  assert.match(resolved.briefing, /Adjudicate concierge onboarding proof/);
  assert.match(resolved.briefing, /WORKING_MEMORY\.md/);
  assert.match(resolved.briefing, /LONG_TERM_MEMORY\.md/);
  assert.match(resolved.briefing, /Use recall before repeating an attempt/);
  assert.doesNotMatch(resolved.briefing, /destination evidence was stale/);
  assert.match(resolved.briefing, /SOUL_CHANGE_PROPOSAL/);
  assert.match(resolved.briefing, /native `unleashd_buddy` tools/);
  assert.deepEqual(resolved.context.allowedBuddyOperations, ['buddy.get_current_work']);
  assert.ok(resolved.briefing.length <= 40_000);

  const automationResolved = await integration.resolveConversation({
    buddyId: lead.id,
    workspaceId: workspace.id,
    automationRunId: 'automation-run-1',
    allowedBuddyOperations: ['buddy.get_current_work', 'buddy.remember'],
  });
  assert.match(automationResolved.briefing, /AUTOMATION AUTHORITY/);
  assert.match(automationResolved.briefing, /CLI compatibility fallback is prohibited/);

  await integration.createLink({
    id: 'lead-conversation',
    sessionId: 'lead-provider-session',
    provider: 'codex',
    buddyContext: resolved.context,
  });

  const mcpServer = createBuddyMcpServer(store as unknown as BuddiesStorePort, {
    buddyId: lead.id,
    workspaceId: workspace.id,
    buddyProjectId: project.id,
  });
  const mcpClient = new Client({ name: 'buddy-lifecycle-e2e', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
  try {
    const completed = await mcpClient.callTool({
      name: 'update_project',
      arguments: {
        status: 'done',
        evidence: ['metric:concierge-proof-2026-07-28'],
        todoOperations: [
          {
            operation: 'update',
            todoId: project.todos[0].id,
            status: 'done',
          },
        ],
      },
    });
    assert.equal(completed.isError, undefined);

    const remembered = await mcpClient.callTool({
      name: 'remember',
      arguments: {
        kind: 'journal',
        content:
          'Concierge onboarding proof closed; metric:concierge-proof-2026-07-28 is the source.',
      },
    });
    assert.equal(remembered.isError, undefined);

    const compacted = await mcpClient.callTool({
      name: 'compact_memory',
      arguments: {
        summary: 'Concierge onboarding was adjudicated from metric:concierge-proof-2026-07-28.',
        retainDays: 0,
      },
    });
    assert.equal(compacted.isError, undefined);
  } finally {
    await mcpClient.close();
    await mcpServer.close();
  }

  const delegation = store.createDelegation({
    fromBuddy: lead.id,
    toBuddy: critic.id,
    workspace: workspace.id,
    project: project.id,
    purpose: 'Pressure-test whether the evidence supports the decision',
    childConversationId: 'critic-conversation',
    status: 'active',
  });
  const review = store.createReview({
    reviewer: critic.id,
    subject: lead.id,
    workspace: workspace.id,
    project: project.id,
    conversationId: 'critic-conversation',
  });
  await integration.createLink({
    id: 'critic-conversation',
    sessionId: 'critic-provider-session',
    provider: 'codex',
    buddyContext: {
      buddyId: critic.id,
      workspaceId: workspace.id,
      buddyProjectId: null,
      delegatedByBuddyId: lead.id,
      parentBuddyConversationId: 'lead-conversation',
    },
  });
  await integration.settleDelegation(
    {
      id: 'critic-conversation',
      sessionId: 'critic-provider-session',
      provider: 'codex',
      buddyContext: {
        buddyId: critic.id,
        workspaceId: workspace.id,
        delegatedByBuddyId: lead.id,
        parentBuddyConversationId: 'lead-conversation',
      },
    },
    'complete',
    [
      'The evidence supports the decision, but the next test must isolate repeat activation.',
      BUDDY_REVIEW_RESULT_START,
      JSON.stringify({
        verdict: 'needs_work',
        score: 78,
        summary: 'The bounded decision is supported; repeat activation remains unproven.',
        evidence: [
          {
            kind: 'metric',
            reference: 'metric:concierge-proof-2026-07-28',
            observation: 'The measured result supports the recorded bounded decision.',
          },
        ],
        requiredActions: ['Create a separate repeat-activation proof project before scaling.'],
      }),
      BUDDY_REVIEW_RESULT_END,
    ].join('\n')
  );

  assert.equal(store.getBuddyProject(project.id)?.status, 'done');
  assert.equal(store.getDelegation(delegation.id)?.status, 'complete');
  assert.equal(store.getReview(review.id)?.status, 'complete');
  const auditCountBeforeRestart = store.listAuditEvents({}).length;
  assert.ok(auditCountBeforeRestart >= 5);
  store.close();

  store = new BuddiesStore(database);
  try {
    const reopenedProject = store.getBuddyProject(project.id);
    assert.equal(reopenedProject?.status, 'done');
    assert.equal(reopenedProject?.todos[0].status, 'done');
    assert.equal(store.getDelegation(delegation.id)?.status, 'complete');
    assert.equal(store.getReview(review.id)?.verdict, 'needs_work');
    assert.equal(store.listAuditEvents({}).length, auditCountBeforeRestart);

    const memory = store.recall(lead.id, {
      pattern: 'metric:concierge-proof-2026-07-28',
      workspace: workspace.id,
      scope: 'current',
    });
    assert.equal(memory.matches.length, 1);

    const overview = store.overview({ recentSince: '2020-01-01T00:00:00.000Z' });
    assert.equal(overview.topLevel.length, 1);
    assert.equal(overview.topLevel[0].buddy.id, lead.id);
    assert.equal(overview.topLevel[0].team.length, 1);
    assert.equal(overview.recentRuns.length, 2);
    assert.deepEqual(
      new Set(overview.recentRuns.map((run) => run.conversationId)),
      new Set(['lead-conversation', 'critic-conversation'])
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
