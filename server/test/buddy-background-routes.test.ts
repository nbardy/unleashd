import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import {
  type BuddyContext,
  BuddyProjectExecutionViewSchema,
  createDefaultConversationConfig,
} from '@unleashd/shared';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { BuddyRunExecutor } from '../src/buddies/run-executor';
import { teamStore } from '../src/buddies/team-access';
import {
  type ConversationRuntime,
  type ConversationRuntimeDependencies,
  createConversationRuntime,
} from '../src/conversations/runtime';
import { resolveConfigAgainstProviderCatalog } from '../src/providers/catalog-service';

async function until(check: () => boolean, tick: () => void = () => {}) {
  for (let count = 0; count < 200; count++) {
    tick();
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Background route fixture did not reach its expected state');
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'buddy-background-routes-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = teamStore(raw as unknown as BuddiesStorePort);
  const workspace = raw.createWorkspace({ name: 'Background route fixture', rootPath: root });
  const buddy = raw.createBuddy({ project: workspace.id, name: 'Builder', role: 'Deliver' });
  const project = raw.newProject({
    buddy: buddy.id,
    workspace: workspace.id,
    title: 'Produce reviewed demo',
    definitionOfDone: 'Demo artifact and review evidence exist.',
    todos: [{ title: 'Record demo', definitionOfDone: 'Demo contains the complete workflow.' }],
  });
  const conversations = new Map<string, ConversationRuntime>();
  const deleted = new Set<string>();
  const releases = new Set<() => void>();
  let providerStarts = 0;
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
    createSessionId: () => `session-${providerStarts}`,
    executeTurn: (() => {
      providerStarts++;
      const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
      let release!: () => void;
      const drained = new Promise<void>((resolve) => {
        release = () => {
          child.exitCode = 0;
          resolve();
          queueMicrotask(() => child.emit('close', 0));
        };
      });
      releases.add(release);
      async function* events() {
        yield { type: 'turn.started' as const };
        await drained;
        releases.delete(release);
        yield { type: 'turn.complete' as const, reason: 'success' as const };
      }
      return {
        child,
        events: events(),
        completed: drained.then(() => ({
          exitCode: 0,
          signal: null,
          reason: 'success',
          sessionId: `session-${providerStarts}`,
        })),
        stop: release,
      };
    }) as NonNullable<ConversationRuntimeDependencies['executeTurn']>,
  });
  const create = (id: string, context: BuddyContext, placement: 'default' | 'background' = 'default') => {
    const conversation = new Conversation({
      id,
      workingDirectory: root,
      configState: { config, revision: 0, resolution: resolveConfigAgainstProviderCatalog(config) },
      buddyContext: context,
      placement,
    });
    conversations.set(id, conversation);
    raw.linkConversation({
      buddy: context.buddyId,
      workspace: context.workspaceId,
      project: context.buddyProjectId ?? undefined,
      provider: 'codex',
      unleashdConversationId: id,
    });
    return conversation;
  };
  create('owner-builder', { buddyId: buddy.id, workspaceId: workspace.id });
  const executor = new BuddyRunExecutor({
    store,
    getConversation: (id) => conversations.get(id),
    createConversation: async (input) => create(input.conversationId, input.context, input.placement ?? 'default'),
  });
  const dispatch = createBuddyDispatchService({
    getStore: async () => store,
    createConversation: async () => {
      throw new Error(
        'A durable owner request must queue before the executor creates a transcript'
      );
    },
    dispatchInitialMessage: async () => {},
    abandonConversation: () => {},
    createId: () => 'unused-dispatch-id',
  });
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('Use the queued executor');
    },
    dispatchMessage: dispatch.send,
    sendError: (response, error, status) => response.status(status).json({ error: String(error) }),
    getNextAutomationRunAt: () => '2026-09-11T00:00:00Z',
    createId: () => 'unused-route-id',
    isConversationDeleted: async (id) => deleted.has(id),
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    raw,
    store,
    workspace,
    buddy,
    project,
    conversations,
    deleted,
    executor,
    request,
    create,
    get providerStarts() {
      return providerStarts;
    },
    async close() {
      executor.stop();
      for (const release of releases) release();
      await until(() => executor.activeRunIds.length === 0);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      raw.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('owner project start queues once, uses a separate self transcript, and exposes held and running work', async () => {
  const f = await fixture();
  try {
    const path = `/api/buddies/projects/${f.project.id}`;
    const before = await f.request(`${path}/execution`);
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(BuddyProjectExecutionViewSchema.parse(before.body).message, null);
    const input = {
      key: 'owner-background-start',
      parentConversationId: 'owner-builder',
      maxRuns: 3,
      maxDurationSeconds: 60,
    };
    const started = await f.request(`${path}/run`, 'POST', input);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const first = BuddyProjectExecutionViewSchema.parse(started.body);
    assert.equal(first.project.definition_of_done, f.project.definition_of_done);
    assert.equal(first.project.todos[0].definition_of_done, f.project.todos[0].definition_of_done);
    assert.equal(first.message?.execution?.code, 'background_disabled');
    assert.equal(first.message?.parent_conversation_id, 'owner-builder');
    assert.equal(first.message?.child_conversation_id, null);
    assert.equal(f.providerStarts, 0);
    const repeated = await f.request(`${path}/run`, 'POST', input);
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    const replay = BuddyProjectExecutionViewSchema.parse(repeated.body);
    assert.equal(replay.message?.id, first.message?.id);
    assert.deepEqual(
      replay.runs.map((run) => run.id),
      first.runs.map((run) => run.id)
    );
    assert.equal(f.raw.listMessages().length, 1);
    assert.equal(f.store.listBuddyRuns({ buddyId: f.buddy.id }).length, 1);
    const enabled = await f.request(
      `/api/buddies/${f.buddy.id}/memberships/${f.workspace.id}`,
      'PATCH',
      { background_enabled: true }
    );
    assert.equal(enabled.status, 200);
    await until(
      () => f.providerStarts === 1,
      () => f.executor.poll()
    );
    const current = await f.request(`${path}/execution`);
    assert.equal(current.status, 200, JSON.stringify(current.body));
    const running = BuddyProjectExecutionViewSchema.parse(current.body);
    assert.equal(running.message?.id, first.message?.id);
    assert.equal(running.runs.length, 1);
    assert.equal(running.runs[0].status, 'running');
    const transcript = running.runs[0].conversation_id!;
    assert.notEqual(transcript, 'owner-builder');
    assert.equal(f.conversations.get(transcript)?.buddyContext?.buddyId, f.buddy.id);
    assert.equal(f.conversations.get(transcript)?.buddyContext?.buddyProjectId, f.project.id);
    assert.equal(f.conversations.get('owner-builder')?.messages.length, 0);
    assert.doesNotMatch(JSON.stringify(running), /claim_token|claim_expires_at/);
    const stop = await f.request(
      `/api/buddies/messages/${first.message!.root_message_id ?? first.message!.id}/stop`,
      'POST',
      {}
    );
    assert.equal(stop.status, 200, JSON.stringify(stop.body));
    await until(
      () => f.executor.activeRunIds.length === 0,
      () => f.executor.poll()
    );
    const stopped = BuddyProjectExecutionViewSchema.parse(
      (await f.request(`${path}/execution`)).body
    );
    assert.equal(stopped.message?.status, 'cancelled');
    assert.equal(stopped.runs[0].status, 'cancelled');
    assert.equal(stopped.runs.length, 1);
  } finally {
    await f.close();
  }
});

test('owner background routes reject invalid limits, criteria edits and unrelated return destinations without queuing', async () => {
  const f = await fixture();
  try {
    const path = `/api/buddies/projects/${f.project.id}`;
    const outsider = f.raw.createBuddy({ project: f.workspace.id, name: 'Other', role: 'Other' });
    f.create('other-buddy', { buddyId: outsider.id, workspaceId: f.workspace.id });
    const otherWorkspace = f.raw.createWorkspace({
      name: 'Elsewhere',
      rootPath: join(tmpdir(), 'buddy-elsewhere'),
    });
    f.raw.assignBuddyToProject({ buddy: f.buddy.id, project: otherWorkspace.id });
    f.create('other-workspace', { buddyId: f.buddy.id, workspaceId: otherWorkspace.id });
    f.create('deleted-parent', { buddyId: f.buddy.id, workspaceId: f.workspace.id });
    f.deleted.add('deleted-parent');
    for (const input of [
      { key: 'bad-runs', maxRuns: 0 },
      { key: 'bad-duration', maxDurationSeconds: 86401 },
      { key: 'bad-field', to: outsider.id },
      ...['other-buddy', 'other-workspace', 'deleted-parent', 'missing-parent'].map(
        (parentConversationId) => ({ key: parentConversationId, parentConversationId })
      ),
    ]) {
      const result = await f.request(`${path}/run`, 'POST', input);
      assert.equal(result.status, 400, JSON.stringify(result.body));
    }
    for (const changes of [
      { definitionOfDone: '' },
      {
        todoOperations: [
          { operation: 'update', todoId: f.project.todos[0].id, definitionOfDone: '' },
        ],
      },
      { todoOperations: [{ operation: 'update', todoId: f.project.todos[0].id, evidence: [''] }] },
    ]) {
      const result = await f.request(path, 'PATCH', {
        key: `invalid:${JSON.stringify(changes)}`,
        baseRevision: f.project.revision,
        ...changes,
      });
      assert.equal(result.status, 400, JSON.stringify(result.body));
    }
    assert.equal(f.raw.listMessages().length, 0);
    assert.equal(f.store.listBuddyRuns({ buddyId: f.buddy.id }).length, 0);
    assert.equal(f.providerStarts, 0);
    const withoutThread = await f.request(`${path}/run`, 'POST', { key: 'task-page' });
    assert.equal(withoutThread.status, 200, JSON.stringify(withoutThread.body));
    assert.equal(
      BuddyProjectExecutionViewSchema.parse(withoutThread.body).message?.parent_conversation_id,
      null
    );
    assert.equal(
      f.providerStarts,
      0,
      'the task page queues work without starting a foreground conversation'
    );
  } finally {
    await f.close();
  }
});
