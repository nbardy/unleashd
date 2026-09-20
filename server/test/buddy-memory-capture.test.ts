import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import {
  type BuddiesStorePort,
  type BuddyAutomationRun,
  BuddyMemoryOperationError,
} from '../src/buddies/contract';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { BuddyOperationInputSchemas, BuddyOperationsService } from '../src/buddies/operations';
import { BuddyScheduler } from '../src/buddies/scheduler';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'buddy-memory-capture-'));
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'BUDDY_SOUL.md'), 'Act on evidence.');
  const store = new BuddiesStore(join(root, 'state.sqlite'));
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: workspaceRoot });
  const buddy = store.createBuddy({
    project: workspace.id,
    name: 'Lead',
    role: 'Delivery',
    memoryPath: 'memory',
    soulPath: 'BUDDY_SOUL.md',
  });
  return {
    root,
    workspace,
    buddy,
    store,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function settled(store: BuddiesStore, runId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const run = store.getAutomationRun(runId);
    if (run && ['complete', 'cancelled', 'failed'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Scheduler did not settle');
}

for (const behavior of [
  'save',
  'none',
  'fail',
  'no-permission',
  'no-budget',
  'cancel',
  'independent',
] as const) {
  test(`automation memory capture: ${behavior}`, async () => {
    const f = fixture();
    try {
      const definition = f.store.createAutomation({
        buddy: f.buddy.id,
        workspace: f.workspace.id,
        name: 'Capture proof',
        scheduleKind: 'interval',
        scheduleExpression: '60',
        jobKind: 'prompt',
        jobPayload: { prompt: 'Do the work' },
        enabled: true,
        policy: {
          maxRuntimeSeconds: 30,
          maxIterations: behavior === 'no-budget' ? 1 : 2,
          allowedOperations:
            behavior === 'no-permission' ? ['buddy.get_current_work'] : ['buddy.remember_note'],
        },
      });
      const prompts: string[] = [];
      const finishes: string[] = [];
      let capturedRun: BuddyAutomationRun;
      let cancelCapture: (() => void) | undefined;
      let captureStarted!: () => void;
      const captureReady = new Promise<void>((resolve) => {
        captureStarted = resolve;
      });
      let drains = 0;
      const scheduler = new BuddyScheduler({
        store: f.store as unknown as BuddiesStorePort,
        memoryReviewAfterEachTurn: behavior === 'independent',
        logger: { warn() {}, error() {} },
        async createConversation(_automation, run) {
          capturedRun = run;
          return {
            conversationId: 'capture-conversation',
            async runTurn(prompt) {
              prompts.push(prompt);
              if (prompts.length === 1) return 'Original work result';
              captureStarted();
              if (behavior === 'fail') throw new Error('Capture provider unavailable');
              if (behavior === 'cancel')
                return new Promise<string>((_resolve, reject) => {
                  cancelCapture = () => reject(new Error('Cancelled capture'));
                });
              if (behavior === 'save') {
                const service = new BuddyOperationsService(
                  f.store as unknown as BuddiesStorePort,
                  {
                    buddyId: f.buddy.id,
                    workspaceId: f.workspace.id,
                    conversationId: 'capture-conversation',
                    automationRunId: capturedRun.id,
                  },
                  { automationClaimToken: capturedRun.claim_token! }
                );
                service.execute('buddy.remember_note', {
                  body: 'The retry failed because the fixture used stale evidence.',
                  topic: 'retry-evidence',
                });
              }
              return behavior === 'save' ? 'Saved retry evidence.' : 'NONE';
            },
            stop() {
              cancelCapture?.();
            },
            async stopAndDrain() {
              drains++;
              cancelCapture?.();
            },
            finish(status) {
              finishes.push(status);
            },
          };
        },
      });
      const run = await scheduler.runNow(definition.id);
      if (behavior === 'cancel') {
        await captureReady;
        await scheduler.cancel(run.id);
      }
      const terminal = await settled(f.store, run.id);
      assert.equal(terminal.status, behavior === 'cancel' ? 'cancelled' : 'complete');
      assert.equal(terminal.outcome, 'Original work result');
      assert.equal(
        prompts.length,
        behavior === 'no-budget' || behavior === 'no-permission' || behavior === 'independent'
          ? 1
          : 2
      );
      assert.equal(terminal.iteration, prompts.length);
      assert.deepEqual(scheduler.health().activeRunIds, []);
      assert.deepEqual(finishes, [terminal.status]);
      if (behavior === 'fail' || behavior === 'cancel') assert.equal(drains, 1);
      if (behavior !== 'cancel') {
        const capture = f.store
          .listAuditEvents({ buddy: f.buddy.id })
          .find((event) => event.operation === 'buddy.memory_capture');
        assert.ok(capture);
        assert.equal(
          capture.payload.status,
          behavior === 'fail' ? 'failed' : prompts.length === 1 ? 'skipped' : 'complete'
        );
        if (prompts.length === 2)
          assert.deepEqual(capture.payload.writes, {
            notes: behavior === 'save' ? 1 : 0,
            working: 0,
            longTerm: 0,
          });
      }
      if (behavior === 'save') {
        assert.equal(
          f.store.listKnowledgeDocuments(
            {
              targetBuddyId: f.buddy.id,
              scope: { kind: 'workspace', workspaceId: f.workspace.id },
              pattern: 'stale evidence',
            },
            {
              actor: f.buddy.id,
              workspaceId: f.workspace.id,
              scope: { kind: 'workspace', workspaceId: f.workspace.id },
            }
          ).length,
          1
        );
      }
    } finally {
      f.close();
    }
  });
}

test('briefing keeps full memory and final authority instructions with large work records', async () => {
  const f = fixture();
  try {
    const memory = f.store.readBuddyMemory(f.buddy.id);
    const content = `${'x'.repeat(3980)}FINAL_DURABLE_FACT`;
    f.store.updateMemory(f.buddy.id, {
      documentKind: 'long_term',
      content,
      reasoning: 'Boundary proof',
      baseVersion: memory.longTermRevision,
    });
    for (let index = 0; index < 12; index++) {
      f.store.newProject({
        buddy: f.buddy.id,
        workspace: f.workspace.id,
        title: `Project ${index}`,
        definitionOfDone: 'large'.repeat(3000),
        todos: [{ title: 'A large todo', definitionOfDone: 'detail'.repeat(3000) }],
      });
    }
    f.store.recordAuditEvent({
      buddy: f.buddy.id,
      workspace: f.workspace.id,
      operation: 'buddy.update_project',
      payload: { body: 'PRIVATE_AUDIT_PAYLOAD' },
    });
    const integration = createBuddiesIntegration({
      getConversation: () => undefined,
      loadModule: async () => ({
        BuddiesStore: function StoreConstructor() {
          return f.store;
        },
      }),
    });
    const { briefing } = await integration.resolveConversation({
      buddyId: f.buddy.id,
      workspaceId: f.workspace.id,
    });
    assert.match(briefing, /FINAL_DURABLE_FACT/);
    assert.match(briefing, /never use the CLI, HTTP, database, or files to bypass it/);
    assert.match(briefing, /buddy.update_project/);
    assert.doesNotMatch(briefing, /PRIVATE_AUDIT_PAYLOAD/);
    assert.ok(briefing.length <= 40000);
    const workBlock = briefing
      .split('Selected project: (none)\n')[1]
      .split('\nOther projects omitted:')[0];
    const summary = JSON.parse(workBlock);
    assert.equal(summary.items.length, 8);
    assert.equal(summary.items[0].openTodos, 1);
    assert.equal(summary.items[0].definition_of_done, undefined);
    assert.match(briefing, /Other projects omitted: 4/);
  } finally {
    f.close();
  }
});

test('note schema enforces the store byte cap for Unicode as well as ASCII', () => {
  assert.equal(
    BuddyOperationInputSchemas['buddy.remember_note'].safeParse({ body: 'a'.repeat(16000) })
      .success,
    true
  );
  assert.equal(
    BuddyOperationInputSchemas['buddy.remember_note'].safeParse({ body: '😀'.repeat(4000) })
      .success,
    true
  );
  assert.equal(
    BuddyOperationInputSchemas['buddy.remember_note'].safeParse({ body: '😀'.repeat(4001) })
      .success,
    false
  );
});

test('stale tool writes return the current document so three verbs suffice for retry', () => {
  const f = fixture();
  try {
    const baseVersion = f.store.readBuddyMemory(f.buddy.id).workingRevision;
    const operations = new BuddyOperationsService(f.store as unknown as BuddiesStorePort, {
      buddyId: f.buddy.id,
      workspaceId: f.workspace.id,
    });
    operations.execute('buddy.update_memory', {
      doc: 'working',
      baseVersion,
      content: 'Keep the winning hypothesis.',
      reasoning: 'New evidence',
    });
    assert.throws(
      () =>
        operations.execute('buddy.update_memory', {
          doc: 'working',
          baseVersion,
          content: 'Stale replacement',
          reasoning: 'Concurrent edit',
        }),
      (error) => {
        assert.ok(error instanceof BuddyMemoryOperationError);
        assert.equal(error.code, 'MEMORY_STALE');
        assert.equal(error.details.current_content, 'Keep the winning hypothesis.');
        assert.equal(error.details.current_version, baseVersion + 1);
        return true;
      }
    );
  } finally {
    f.close();
  }
});
