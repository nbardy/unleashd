import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddyContext, ConversationConfig } from '@unleashd/shared';
import { resolveBuddyAssignmentConfig } from '../src/buddies/assignment-config';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import { createBuddyCreationService } from '../src/conversations/buddy-creation-service';
import { ConversationConfigService } from '../src/conversations/config-service';
import { ConversationConfigStore } from '../src/conversations/config-store';
import {
  createConversationRuntime,
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

test('native assignment preview, durable admission, real conversation creation and provider request agree', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-assignment-config-'));
  const raw = new BuddiesStore(join(root, 'buddies.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const workspace = raw.createWorkspace({ name: 'Configuration', rootPath: root });
  const lead = raw.createBuddy({ project: workspace.id, name: 'Lead', role: 'Review' });
  const worker = raw.createBuddy({ project: workspace.id, name: 'Worker', role: 'Build' });
  store.setCoordinationMembership(worker.id, workspace.id, {
    background_enabled: true,
    max_active_runs: 3,
  });
  const conversations = new Map<string, ConversationRuntime>();
  const integration = createBuddiesIntegration({
    getConversation: (id) => conversations.get(id),
    store,
  });
  await integration.getStore();
  let changedDefault: string | undefined;
  const configService = new ConversationConfigService({
    store: new ConversationConfigStore({ appDataRoot: root }),
    resolver: {
      resolve: async (config) =>
        resolveConfigAgainstProviderCatalog(
          changedDefault && config.model.mode === 'default'
            ? { ...config, model: { mode: 'explicit', modelId: changedDefault } }
            : config
        ),
    },
  });
  let activeContext!: BuddyContext;
  const requests: Array<{ runId: string; model: unknown; effort: unknown; harness: string }> = [];
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
    readLatestOompaRuntime: async () => ({ available: false, run: null, reason: 'fixture' }),
    createSessionId: randomUUID,
    readCurrentBuddyContext: integration.readCurrentConversation,
    issueBuddyControlCapability: (context) => {
      activeContext = context;
      return {};
    },
    executeTurn: ((request) => {
      requests.push({
        runId: activeContext.coordinationRunId!,
        model: request.model,
        effort: request.reasoningEffort,
        harness: request.harness,
      });
      async function* events() {
        yield { type: 'turn.started' as const };
        yield { type: 'text.delta' as const, text: 'Saved artifact' };
        yield { type: 'turn.complete' as const, reason: 'success' as const };
      }
      return {
        events: events(),
        completed: Promise.resolve({ exitCode: 0, killed: false }),
        stop: () => {},
        kill: () => {},
      };
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  let profileModel = 'gpt-6-astra';
  const creation = createBuddyCreationService({
    configService,
    getConversation: (id) => conversations.get(id),
    resolveBuddyConversation: async (context) => ({
      ...(await integration.resolveConversation(context)),
      provider: 'codex',
      model: profileModel,
      reasoningEffort: 'high',
    }),
    resolveWorkingDirectory: (directory) => directory,
    isProviderAvailable: () => true,
    createId: randomUUID,
    createConversation: (options) => new Conversation(options),
    registerConversation: (conversation) => {
      conversations.set(conversation.id, conversation);
    },
    createConversationLink: async (conversation) => {
      raw.linkConversation({
        buddy: conversation.buddyContext!.buddyId,
        workspace: workspace.id,
        provider: conversation.provider,
        unleashdConversationId: conversation.id,
      });
    },
    updateConversationStatus: () => {},
    broadcast: () => {},
  });
  await creation.createServerBuddyConversation({
    context: { buddyId: lead.id, workspaceId: workspace.id },
    conversationId: 'owner',
    commandId: 'owner',
    deferInitialMessage: true,
  });
  const dispatch = createBuddyDispatchService({
    getStore: async () => store,
    resolveAssignmentConfig: (config, id) =>
      resolveBuddyAssignmentConfig(configService, config, id),
    createConversation: creation.createServerBuddyConversation,
    dispatchInitialMessage: async () => {},
    abandonConversation: () => {},
  });
  const context = { buddyId: lead.id, workspaceId: workspace.id, conversationId: 'owner' };
  const server = createBuddyMcpServer(store, context, {
    dispatchMessage: (input) => dispatch.send(context, input),
  });
  const client = new Client({ name: 'assignment-contract', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const executor = new BuddyRunExecutor({
    store,
    getConversation: (id) => conversations.get(id),
    getConversationRecord: (id) => configService.getRecord(id),
    createConversation: creation.createServerBuddyConversation,
    ensureConversationReady: creation.ensureConversationReady,
  });
  const call = async (input: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'send', arguments: input });
    assert.ok(!result.isError, JSON.stringify(result));
    return (result.structuredContent as any).data;
  };
  const config = (modelId: string, effort: string): ConversationConfig => ({
    provider: 'codex',
    model: { mode: 'explicit', modelId },
    reasoning: { mode: 'explicit', effort },
  });
  const luna = config('gpt-5.6-luna', 'low');
  const sol = config('gpt-5.6-sol', 'medium');
  const payload = (key: string, selection: ConversationConfig) => ({
    key,
    to: worker.id,
    purpose: 'Inspect',
    body: 'Inspect one artifact',
    delivery: { kind: 'request', config: selection },
  });
  const drain = async () => {
    executor.poll();
    const until = Date.now() + 5000;
    while (executor.activeRunIds.length && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(executor.activeRunIds.length, 0);
  };
  try {
    const preview = await call({ ...payload('luna', luna), preview: true });
    assert.deepEqual(preview.assignmentConfig.requested, luna);
    assert.equal(preview.assignmentConfig.resolved.modelId, 'gpt-5.6-luna');
    assert.equal(store.listBuddyRuns().length, 0);
    assert.equal(conversations.size, 1);
    const invalid = await client.callTool({
      name: 'send',
      arguments: { ...payload('bad', config('gpt-5.6-luna', 'invalid-effort')), preview: true },
    });
    assert.equal(invalid.isError, true);
    assert.equal((invalid.structuredContent as any).code, 'reasoning_unavailable');
    const first = await call(payload('luna', luna));
    const second = await call(payload('sol', sol));
    assert.equal(first.assignmentConfig.resolved.modelId, 'gpt-5.6-luna');
    assert.equal((await call(payload('luna', luna))).message.id, first.message.id);
    profileModel = 'gpt-5.6-sol'; // Changed after queueing: explicit assignment remains pinned.
    await drain();
    assert.equal(
      requests.length,
      2,
      JSON.stringify(
        store.listBuddyRuns().map((r) => ({ status: r.status, error: r.error, code: r.error_code }))
      )
    );
    for (const request of requests) {
      const run = store.getBuddyRun(request.runId)!;
      assert.equal(run.status, 'complete', run.error ?? 'run failed');
      assert.equal(run.execution_snapshot?.model, request.model);
      assert.equal(run.execution_snapshot?.reasoningEffort, request.effort);
      assert.equal(run.execution_snapshot?.provider, request.harness);
      assert.equal(run.execution_snapshot?.assignment?.resolved.modelId, request.model);
      const record = await configService.getRecord(run.conversation_id!);
      assert.deepEqual(record?.config.model, { mode: 'explicit', modelId: request.model });
    }
    const mismatch = await client.callTool({
      name: 'send',
      arguments: {
        ...payload('conflict', sol),
        preview: true,
        delivery: { kind: 'request', config: sol, continueFrom: first.message.id },
      },
    });
    assert.equal(mismatch.isError, true);
    assert.equal((mismatch.structuredContent as any).code, 'assignment_config_conflict');
    assert.equal(store.listBuddyRuns().length, 2);
    const continuation = await call({
      ...payload('continue', luna),
      delivery: { kind: 'request', config: luna, continueFrom: first.message.id },
    });
    assert.equal(continuation.assignmentConfig.source, 'continued_conversation');
    await drain();
    assert.equal(
      store.getBuddyRun(continuation.execution.runId)?.conversation_id,
      store.getBuddyRun(first.execution.runId)?.conversation_id
    );
    assert.equal(requests.at(-1)?.model, 'gpt-5.6-luna');
    const cancelled = await call(payload('cancel', sol));
    store.stopBuddyMessageRoot(cancelled.message.id);
    await drain();
    assert.equal(requests.length, 3, 'cancellation does not invoke provider');
    assert.equal(store.getBuddyRun(cancelled.execution.runId)?.execution_snapshot, null);
    assert.notEqual(first.execution.runId, second.execution.runId);
    const defaults = await call(
      payload('defaults', {
        provider: 'codex',
        model: { mode: 'default' },
        reasoning: { mode: 'default' },
      })
    );
    changedDefault =
      defaults.assignmentConfig.resolved.modelId === 'gpt-5.6-sol' ? 'gpt-6-astra' : 'gpt-5.6-sol';
    await drain();
    assert.equal(
      requests.at(-1)?.model,
      defaults.assignmentConfig.resolved.modelId,
      'queued defaults stay pinned even when the resolver default changes'
    );
    assert.equal(requests.length, 4);
    const drift = await call({
      ...payload('drift', luna),
      delivery: { kind: 'request', config: luna, continueFrom: first.message.id },
    });
    const destination = conversations.get(
      store.getBuddyRun(first.execution.runId)!.conversation_id!
    )!;
    const change = await configService.update(
      {
        config: destination.config,
        revision: destination.configRevision,
        resolution: destination.configResolution,
      },
      { isRunning: false, queueDepth: 0, hasStartedSession: true },
      {
        conversationId: destination.id,
        commandId: 'owner-model-change',
        expectedRevision: destination.configRevision,
        patch: { kind: 'replace', config: sol },
      }
    );
    assert.ok(change.ok);
    destination.applyConfigState(change.value.next);
    await drain();
    assert.equal(
      requests.length,
      4,
      'configuration drift after preview is rejected before provider invocation'
    );
    const rejected = store.getBuddyRun(drift.execution.runId)!;
    assert.equal(rejected.status, 'failed');
    assert.equal(rejected.error_code, 'assignment_config_conflict');
    assert.match(rejected.error!, /Assignment configuration conflicts/);
    assert.equal(rejected.execution_snapshot, null);
  } finally {
    executor.stop();
    await Promise.all([client.close(), server.close()]);
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
