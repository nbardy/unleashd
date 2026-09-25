import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { TeamSetupResult } from '@unleashd/shared';
import { type BuddyContext, createDefaultConversationConfig } from '@unleashd/shared';
import { chatRunAdmission } from '../src/buddies/chat-run-admission';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  BuddyControlServer,
  OWNER_CONTROL_TOKEN_ENV,
  OWNER_CONTROL_URL_ENV,
} from '../src/buddies/control-server';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
import { createOwnerTeamMcpServer } from '../src/buddies/owner-mcp';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

test('owner MCP configures unconfigured staff, releases original work, and completes worker-to-lead without owner authority', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-owner-e2e-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({
    name: 'Background runtime',
    rootPath: root,
  });
  const buddy = raw.createBuddy({ project: w.id, name: 'Engineer', role: 'Deliver' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
  const project = (
    new BuddyOperationsService(store, { buddyId: buddy.id, workspaceId: w.id }).execute(
      'buddy.new_project',
      {
        key: 'work',
        title: 'Export',
        definitionOfDone: 'Both exports pass',
        todos: [{ title: 'Implement export', definitionOfDone: 'Both cases pass' }],
      }
    ) as { data: { id: string } }
  ).data;
  const conversations = new Map<string, ConversationRuntime>();
  const visits: string[] = [];
  let input!: { context: BuddyContext; conversationId: string; token: string };
  let workerTurns = 0;
  let returnTurns = 0;
  let ownerTurns = 0;
  const origins: string[] = [];
  let ownerEnv: Readonly<Record<string, string>> = {};
  const control = new BuddyControlServer({
    getStore: async () => store,
    isConversationActive: (id) => conversations.get(id)?.isRunning === true,
    dispatchMessage: async () => {
      throw new Error('unused');
    },
  });
  await control.start();
  async function callOwner(input: unknown) {
    const response = await fetch(ownerEnv[OWNER_CONTROL_URL_ENV], {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerEnv[OWNER_CONTROL_TOKEN_ENV]}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as { data?: unknown; error?: string };
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.data;
  }
  const ownerMcp = createOwnerTeamMcpServer(callOwner);
  const ownerClient = new Client({ name: 'owner-e2e', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([ownerClient.connect(a), ownerMcp.connect(b)]);
  const tools = (await ownerClient.listTools()).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['configure_team']
  );
  assert.ok(tools[0].inputSchema.properties?.configuration);
  const setup = {
    workspaceId: w.id,
    reason: 'Owner requested lead and engineer',
    relationships: [
      { from: { id: lead.id }, to: { id: buddy.id }, kind: 'manager', present: true },
    ],
    memberships: [lead, buddy].map((member) => ({
      buddy: { id: member.id },
      present: true,
      incoming: false,
      dispatch: true,
    })),
    access: [
      {
        grantee: { id: lead.id },
        target: { id: buddy.id },
        profile: 'read',
        soul: 'write',
        memory: 'write',
        incoming: true,
      },
    ],
  };
  let setupKey = 'owner-setup';
  async function configure() {
    const preview = await ownerClient.callTool({
      name: 'configure_team',
      arguments: { key: setupKey, configuration: setup, preview: true },
    });
    assert.equal(preview.isError, undefined, JSON.stringify(preview));
    const plan = (preview.structuredContent as { teamSetup: TeamSetupResult }).teamSetup;
    assert.equal(plan.canApply, true, JSON.stringify(plan.blockers));
    const applied = await ownerClient.callTool({
      name: 'configure_team',
      arguments: {
        key: setupKey,
        configuration: setup,
        preview: false,
        expectedPlanHash: plan.planHash,
      },
    });
    assert.equal(applied.isError, undefined, JSON.stringify(applied));
    return (applied.structuredContent as { teamSetup: TeamSetupResult }).teamSetup;
  }
  const config = createDefaultConversationConfig('codex');
  const Conversation = createConversationRuntime({
    broadcast: () => {},
    registerSessionAlias: () => {},
    unregisterSessionAlias: () => {},
    clearExternalRunningStatus: () => {},
    clearLocalCompletionSuppression: () => {},
    markLocalCompletionSuppression: () => {},
    persistCurrentSession: async () => {},
    updateBuddyStatus: () => {},
    settleBuddyDelegation: () => {},
    getConversation: (id) => conversations.get(id),
    readLatestOompaRuntime: () => ({ available: false, run: null, reason: 'fixture' }),
    createSessionId: () => `session-${visits.length}`,
    readCurrentBuddyContext: (context) => ({
      briefing: `Current profile for ${context.buddyId}; turn ${visits.length}`,
      memoryGeneration: `revision:${visits.length}`,
    }),
    ...chatRunAdmission(
      () => store,
      () => MESSAGE_BUDDY_OPERATIONS
    ),
    finishBuddyChatRun: (id, token, status, detail) => {
      store.finishBuddyRun(id, { claimToken: token, status, outcome: detail });
    },
    recordBuddyTurnOrigin: (_id, source) => {
      origins.push(source.origin);
    },
    issueOwnerControlCapability: (source, conversationId) => {
      ownerEnv = control.issueOwner(source, conversationId, [w.id]);
      return ownerEnv;
    },
    revokeBuddyControlCapability: (id) => control.revoke(id),
    issueBuddyControlCapability: (context, conversationId, token) => {
      input = { context, conversationId, token: token! };
      return control.issue(context, conversationId, token);
    },
    executeTurn: ((request) => {
      const current = input;
      const run = store.getBuddyRun(current.context.coordinationRunId!)!;
      async function* events() {
        yield { type: 'turn.started' as const };
        visits.push(current.conversationId);
        if (
          'unleashd_owner' in
          ((request as { mcpServers?: Record<string, unknown> }).mcpServers ?? {})
        ) {
          ownerTurns++;
          const applied = await configure();
          assert.ok(applied.receipt);
          if (originalMessageId)
            assert.equal(applied.affectedWork[0]?.messageId, originalMessageId);
          const replay = await configure();
          assert.equal(replay.receipt?.auditId, applied.receipt.auditId);
          assert.equal(replay.receipt?.replayed, true);
          const leadOps = new BuddyOperationsService(
            store,
            { ...current.context, conversationId: current.conversationId },
            { automationClaimToken: current.token }
          );
          assert.ok(
            (
              leadOps.execute('buddy.get_current_work', { targetBuddyId: buddy.id }) as {
                data: { id: string }[];
              }
            ).data.some((p) => p.id === project.id)
          );
          const memory = leadOps.execute('buddy.get_memory', {
            targetBuddyId: buddy.id,
            doc: 'working',
          }) as { data: { revision: number } };
          if (ownerTurns === 1) {
            const preview = leadOps.execute('buddy.update_memory', {
              targetBuddyId: buddy.id,
              doc: 'working',
              key: 'import-memory',
              baseVersion: memory.data.revision,
              content: 'Bounded export audit; preserve historical decisions.',
              reasoning: 'Owner onboarding',
              preview: true,
            }) as { data: unknown };
            assert.ok(preview.data);
            leadOps.execute('buddy.update_memory', {
              targetBuddyId: buddy.id,
              doc: 'working',
              key: 'import-memory',
              baseVersion: memory.data.revision,
              content: 'Bounded export audit; preserve historical decisions.',
              reasoning: 'Owner onboarding',
            });
          }
        } else if (run.input_kind === 'message_reply') {
          returnTurns++;
          assert.equal(current.conversationId, 'owner-thread');
          assert.equal(
            run.policy.execution,
            undefined,
            'return turn must not inherit the worker loop'
          );
        } else {
          workerTurns++;
          assert.notEqual(current.conversationId, 'owner-thread');
          assert.equal(
            (request as { mcpServers?: Record<string, unknown> }).mcpServers?.unleashd_owner,
            undefined
          );
          assert.ok(String(request.prompt).includes(`Background work: project ${project.id}`));
          assert.match(String(request.prompt), /Read get_current_work and get_inbox/);
          assert.match(String(request.prompt), /runtime continues unfinished work/);
          assert.doesNotMatch(
            String(request.prompt),
            /todoOperations|baseRevision|Write through update_project|use reply with this message ID/
          );
          const operations = new BuddyOperationsService(
            store,
            {
              ...current.context,
              conversationId: current.conversationId,
              allowedOperations: current.context.allowedBuddyOperations,
            },
            { automationClaimToken: current.token }
          );
          const work = raw.getBuddyProject(project.id)!;
          if (workerTurns === 1) {
            operations.execute('buddy.update_project', {
              projectId: project.id,
              baseRevision: work.revision,
              key: 'progress',
              status: 'in_progress',
              nextAction: 'Run the second fixture',
            });
            assert.throws(
              () =>
                operations.execute('buddy.reply', {
                  messageId: run.input_id,
                  outcome: 'done',
                  body: 'Premature completion',
                  evidence: ['not enough'],
                }),
              /complet|unfinished|criteria|evidence/i
            );
          } else {
            operations.execute('buddy.update_project', {
              projectId: project.id,
              baseRevision: work.revision,
              key: 'done',
              status: 'done',
              evidence: ['fixture: both exported files match expected bytes'],
              todoOperations: [
                {
                  operation: 'update',
                  todoId: work.todos[0].id,
                  status: 'done',
                  evidence: ['fixture: empty and populated export passed'],
                },
              ],
            });
          }
        }
        yield { type: 'text.delta' as const, text: 'Attempt drained' };
        yield { type: 'turn.complete' as const, reason: 'success' as const };
      }
      return {
        child: { exitCode: 0 },
        events: events(),
        completed: Promise.resolve({
          exitCode: 0,
          signal: null,
          reason: 'success',
          sessionId: `provider-${visits.length}`,
        }),
        stop: () => {},
      };
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const create = (
    id: string,
    context: BuddyContext,
    placement: 'default' | 'background' = 'default'
  ) => {
    const c = new Conversation({
      id,
      workingDirectory: '/tmp',
      configState: { config, revision: 0, resolution: resolveConfigAgainstProviderCatalog(config) },
      buddyContext: context,
      placement,
    });
    conversations.set(id, c);
    return c;
  };
  const owner = create('owner-thread', { buddyId: lead.id, workspaceId: w.id });
  raw.linkConversation({
    buddy: lead.id,
    workspace: w.id,
    provider: 'codex',
    unleashdConversationId: 'owner-thread',
  });
  const executor = new BuddyRunExecutor({
    store,
    getConversation: (id) => conversations.get(id),
    createConversation: async (input) =>
      create(input.conversationId, input.context, input.placement ?? 'default'),
  });
  const dispatch = createBuddyDispatchService({
    getStore: async () => store,
    createConversation: async () => {
      throw new Error('durable producer must not start provider');
    },
    dispatchInitialMessage: async () => {},
    abandonConversation: () => {},
  });
  let originalMessageId = '';
  try {
    owner.sendMessage(
      'Attach my engineer and authorize onboarding while incoming work stays held.',
      { origin: 'owner_input', inputId: 'owner-onboarding' }
    );
    await owner.waitForTurnDrain();
    assert.equal(ownerTurns, 1);
    const context = { buddyId: lead.id, workspaceId: w.id };
    const operations = new BuddyOperationsService(store, {
      ...context,
      conversationId: 'owner-thread',
    });
    const prepared = operations.prepareMessage({
      to: buddy.id,
      projectId: project.id,
      key: 'background-start',
      purpose: 'deliver',
      body: 'Build export',
      execution: { mode: 'until_done', maxRuns: 3, maxDurationSeconds: 600 },
      expectsReply: true,
    });
    const first = (await dispatch.send(context, prepared)) as { data: { message: { id: string } } };
    const repeated = (await dispatch.send(context, prepared)) as {
      data: { message: { id: string } };
    };
    assert.equal(first.data.message.id, repeated.data.message.id);
    originalMessageId = first.data.message.id;
    assert.equal(raw.getMessageExecution(originalMessageId).code, 'background_disabled');
    setupKey = 'owner-activation';
    for (const membership of setup.memberships) membership.incoming = true;
    owner.sendMessage('Configure my lead and engineer and release the queued audit.', {
      origin: 'owner_input',
      inputId: 'real-owner-command',
    });
    await owner.waitForTurnDrain();
    assert.equal(ownerTurns, 2);
    assert.equal(
      (
        await fetch(ownerEnv[OWNER_CONTROL_URL_ENV], {
          method: 'POST',
          headers: { authorization: `Bearer ${ownerEnv[OWNER_CONTROL_TOKEN_ENV]}` },
          body: '{}',
        })
      ).status,
      403
    );
    for (let i = 0; i < 200; i++) {
      executor.poll();
      if (
        workerTurns === 2 &&
        executor.activeRunIds.length === 0 &&
        store
          .listBuddyRuns({ limit: 100 })
          .some((run) => run.input_kind === 'message_reply' && run.status === 'complete')
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(workerTurns, 2);
    assert.deepEqual(origins, ['owner_input', 'owner_input', 'buddy_message', 'buddy_message']);
    assert.equal(returnTurns, 0, 'background results do not restart the owner conversation');
    const returned = store
      .listBuddyRuns({ limit: 100 })
      .find((run) => run.input_kind === 'message_reply')!;
    assert.equal(returned.outcome, 'mailbox_only');
    assert.equal(returned.acknowledged_at, null);
    assert.equal(conversations.size, 2);
    assert.equal(new Set(visits.filter((id) => id !== 'owner-thread')).size, 1);
    assert.equal(store.getMessage(first.data.message.id)?.status, 'replied');
    const execution = raw.getMessageExecution(first.data.message.id);
    assert.equal(execution.background?.disposition, 'done');
    assert.equal(execution.background?.runsUsed, 2);
    assert.equal(store.listBuddyRuns({ limit: 100 }).length, 5);
    assert.ok(store.listBuddyRuns({ limit: 100 }).every((run) => run.status === 'complete'));
  } finally {
    executor.stop();
    await ownerClient.close();
    await ownerMcp.close();
    await control.close();
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
