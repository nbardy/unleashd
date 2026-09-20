import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddyContext } from '@unleashd/shared';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { teamStore } from '../src/buddies/team-access';

test('a completed research handoff can start fresh recipient work and retains its source project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-new-work-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = teamStore(raw as unknown as BuddiesStorePort);
  try {
    const workspace = raw.createWorkspace({ name: 'Wave fixture', rootPath: root });
    const sender = raw.createBuddy({ project: workspace.id, name: 'Research', role: 'Theory' });
    const recipient = raw.createBuddy({ project: workspace.id, name: 'Simulation', role: 'Apply' });
    store.setCoordinationMembership(recipient.id, workspace.id, { background_enabled: true });
    const source = raw.newProject({
      buddy: sender.id,
      workspace: workspace.id,
      title: 'Theory',
      definitionOfDone: 'Proof',
    });
    store.updateCoordinatedProject(
      source.id,
      { baseRevision: source.revision, status: 'done', evidence: ['proof:reviewed'] },
      { actor: sender.id, key: 'finish' }
    );
    const active = store.beginBuddyChatRun({
      buddyId: sender.id,
      workspaceId: workspace.id,
      conversationId: 'research',
      projectId: source.id,
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    const context = {
      buddyId: sender.id,
      workspaceId: workspace.id,
      buddyProjectId: source.id,
      coordinationRunId: active.id,
      conversationId: 'research',
    };
    const operations = new BuddyOperationsService(store, context, {
      automationClaimToken: active.claim_token!,
    });
    const dispatch = createBuddyDispatchService({
      getStore: async () => store,
      createConversation: async () => {
        throw new Error('Durable dispatch must queue before creating a thread');
      },
      dispatchInitialMessage: async () => {},
      abandonConversation: () => {},
      createId: () => 'unused',
    });
    const input = {
      key: 'handoff',
      to: recipient.id,
      purpose: 'Apply reviewed theory',
      body: 'Create an implementation project from the proof.',
      projectId: null,
    };
    // The actual stdio/control transport parses the request at both boundaries.
    const { parentConversationId: _parent, ...body } = operations.prepareMessage(input);
    const prepared = operations.prepareMessage(body);
    assert.equal(prepared.projectId, null);
    await dispatch.send(context, prepared, active.claim_token!);
    const message = store.listMessages().find((m) => m.to_buddy_id === recipient.id)!;
    assert.equal(message.buddy_project_id, null);
    assert.equal(message.source_project_id, source.id);
    const queued = store.listBuddyRuns({ buddyId: recipient.id })[0];
    const run = store.claimBuddyRun(queued.id, {
      claimToken: 'simulation',
      conversationId: 'simulation',
    })!;
    store.startBuddyRun(run.id, 'simulation');
    const worker = new BuddyOperationsService(
      store,
      {
        buddyId: recipient.id,
        workspaceId: workspace.id,
        conversationId: 'simulation',
        coordinationRunId: run.id,
        allowedOperations: MESSAGE_BUDDY_OPERATIONS,
      },
      { automationClaimToken: 'simulation' }
    );
    const result = worker.execute('buddy.new_project', {
      key: 'implementation',
      title: 'Implement reviewed theory',
      definitionOfDone: 'Validated simulation and benchmark',
    });
    assert.equal(result.operation, 'buddy.new_project');
    assert.equal(store.listBuddyOwnedProjects({ buddy: recipient.id }).length, 1);
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('message enqueue checks current automation ownership after async conversation creation', async () => {
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({
    name: 'Dispatch',
    rootPath: '/tmp/buddy-dispatch-authority',
  });
  const sender = store.createBuddy({ project: workspace.id, name: 'Sender', role: 'Sender' });
  const recipient = store.createBuddy({
    project: workspace.id,
    name: 'Recipient',
    role: 'Recipient',
  });
  const automation = store.createAutomation({
    buddy: sender.id,
    workspace: workspace.id,
    name: 'Bounded messages',
    scheduleKind: 'interval',
    scheduleExpression: '60',
    jobKind: 'prompt',
    jobPayload: { prompt: 'Ask for evidence.' },
    policy: { allowedOperations: ['buddy.send'] },
  });
  let created = 0;
  let enqueued = 0;
  let abandoned = 0;
  const claimToken = 'dispatch-owner';
  let cancelDuringCreate = false;
  let activeRun = '';
  const service = createBuddyDispatchService({
    getStore: async () => store as unknown as BuddiesStorePort,
    createConversation: async () => {
      created += 1;
      if (cancelDuringCreate)
        store.updateAutomationRun(activeRun, { status: 'cancel_requested', claimToken });
      const id = `child-${created}`;
      return { id, toJSON: () => ({ id }) };
    },
    dispatchInitialMessage: async (_child, options) =>
      options.enqueueAuthorized(() => {
        enqueued += 1;
      }),
    abandonConversation: () => {
      abandoned += 1;
    },
    createId: () => 'unused',
  });
  const input = {
    to: recipient.id,
    purpose: 'evidence',
    body: 'Review it.',
    evidence: [],
    wait: false,
    timeoutSeconds: 10,
    parentConversationId: 'parent',
  };
  try {
    const first = store.claimAutomationRun(automation.id, { claimToken, idempotencyKey: 'one' });
    activeRun = first.id;
    store.updateAutomationRun(first.id, { status: 'running', claimToken });
    const context: BuddyContext = {
      buddyId: sender.id,
      workspaceId: workspace.id,
      buddyProjectId: null,
      automationRunId: first.id,
    };
    await service.send(context, input, claimToken);
    assert.equal(enqueued, 1);
    assert.equal(store.listMessages()[0].status, 'active');
    store.updateAutomationRun(first.id, { status: 'complete', claimToken });

    const second = store.claimAutomationRun(automation.id, { claimToken, idempotencyKey: 'two' });
    activeRun = second.id;
    store.updateAutomationRun(second.id, { status: 'running', claimToken });
    cancelDuringCreate = true;
    await assert.rejects(
      service.send({ ...context, automationRunId: second.id }, input, claimToken),
      /not active|cancel/i
    );
    assert.equal(enqueued, 1, 'cancellation wins before child binding and enqueue');
    assert.equal(abandoned, 1);
    assert.equal(store.listMessages().filter((message) => message.status === 'failed').length, 1);
  } finally {
    store.close();
  }
});

test('a send without an explicit config inherits the launching conversation, not the profile default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-launch-config-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = teamStore(raw as unknown as BuddiesStorePort);
  try {
    const workspace = raw.createWorkspace({ name: 'Wave fixture', rootPath: root });
    const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Direct' });
    const worker = raw.createBuddy({ project: workspace.id, name: 'Worker', role: 'Build' });
    store.setCoordinationMembership(worker.id, workspace.id, { background_enabled: true });
    // The launching chat runs on Claude; the worker's profile default would be Codex.
    const launching = {
      provider: 'claude' as const,
      model: { mode: 'explicit' as const, modelId: 'opus' },
      reasoning: { mode: 'explicit' as const, effort: 'high' },
    };
    const context: BuddyContext = {
      buddyId: lead.id,
      workspaceId: workspace.id,
      conversationId: 'human',
    };
    const dispatch = createBuddyDispatchService({
      getStore: async () => store,
      resolveAssignmentConfig: async (config) => ({
        requested: config,
        resolved: {
          provider: config.provider,
          modelId: config.model.mode === 'explicit' ? config.model.modelId : 'profile-default',
          reasoningEffort:
            config.reasoning.mode === 'explicit' ? config.reasoning.effort : undefined,
        },
        catalogRevision: 'test',
        source: 'assignment',
      }),
      launchConfig: (ctx, sourceId) =>
        sourceId === 'human' && ctx.buddyId === lead.id ? launching : undefined,
      createConversation: async () => {
        throw new Error('Durable dispatch must queue before creating a thread');
      },
      dispatchInitialMessage: async () => {},
      abandonConversation: () => {},
      createId: () => 'unused',
    });
    const operations = new BuddyOperationsService(store, context, {});
    const send = (key: string, extra: Record<string, unknown>) =>
      dispatch.send(
        context,
        operations.prepareMessage({
          key,
          to: worker.id,
          purpose: 'Amend',
          body: 'Use the new model.',
          ...extra,
        }),
        undefined
      );
    await send('inform-no-config', { expectsReply: false });
    const inherited = store.listBuddyRuns({ buddyId: worker.id })[0];
    assert.deepEqual(inherited.policy.assignment_config?.requested, launching);
    assert.equal(inherited.policy.assignment_config?.resolved.provider, 'claude');
    // An explicit config still wins over the launching conversation.
    await send('inform-explicit', {
      expectsReply: false,
      config: { provider: 'codex', model: { mode: 'default' }, reasoning: { mode: 'default' } },
    });
    const explicit = store
      .listBuddyRuns({ buddyId: worker.id })
      .find((run) => run.id !== inherited.id)!;
    assert.equal(explicit.policy.assignment_config?.resolved.provider, 'codex');
  } finally {
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
