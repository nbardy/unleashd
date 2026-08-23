import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import { BuddyContextSchema, ConversationSchema } from '@unleashd/shared';
import { extractBuddyContext } from '../src/adapters/jsonl';
import type {
  BuddiesStorePort,
  BuddyAutomation,
  BuddyAutomationRun,
} from '../src/buddies/contract';
import {
  BuddyScheduler,
  nextAutomationRunAt,
  parseAutomationCompletion,
} from '../src/buddies/scheduler';

function automation(overrides: Partial<BuddyAutomation> = {}): BuddyAutomation {
  return {
    id: 'automation-1',
    buddy_id: 'buddy-1',
    workspace_id: 'workspace-1',
    buddy_project_id: null,
    name: 'Daily review',
    schedule_kind: 'interval',
    schedule_expression: '60',
    timezone: 'UTC',
    job_kind: 'prompt',
    job_payload: { prompt: 'Review growth' },
    policy: {
      max_runtime_seconds: 600,
      max_iterations: 10,
      max_tokens: 50_000,
      max_cost_usd: 2,
      allowed_operations: ['buddy.get_current_work'],
    },
    enabled: true,
    next_run_at: '2026-01-01T00:00:00.000Z',
    last_run_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('nextAutomationRunAt handles intervals and timezone-aware cron', () => {
  assert.equal(
    nextAutomationRunAt(automation(), new Date('2026-01-01T00:00:00.000Z')),
    '2026-01-01T00:01:00.000Z'
  );
  assert.equal(
    nextAutomationRunAt(
      automation({
        schedule_kind: 'cron',
        schedule_expression: '0 9 * * *',
        timezone: 'Asia/Seoul',
      }),
      new Date('2026-01-01T00:00:00.000Z')
    ),
    '2026-01-02T00:00:00.000Z'
  );
});

test('cron follows standard OR semantics when day-of-month and weekday are both restricted', () => {
  assert.equal(
    nextAutomationRunAt(
      automation({
        schedule_kind: 'cron',
        schedule_expression: '0 9 15 * 1',
        timezone: 'UTC',
      }),
      new Date('2026-01-05T09:00:00.000Z')
    ),
    '2026-01-12T09:00:00.000Z'
  );
});

test('cron rejects impossible calendar combinations before the minute scan', () => {
  const startedAt = performance.now();
  assert.throws(
    () =>
      nextAutomationRunAt(
        automation({
          schedule_kind: 'cron',
          schedule_expression: '0 9 31 2 *',
          timezone: 'UTC',
        }),
        new Date('2026-01-01T00:00:00.000Z')
      ),
    /cannot occur/
  );
  assert.ok(performance.now() - startedAt < 100, 'impossible cron validation must be bounded');
  assert.throws(
    () =>
      nextAutomationRunAt(
        automation({ schedule_kind: 'cron', schedule_expression: '0 nope * * *' }),
        new Date('2026-01-01T00:00:00.000Z')
      ),
    /Invalid cron field/
  );
});

test('automation completion requires structured JSON', () => {
  assert.deepEqual(
    parseAutomationCompletion(
      '```json\n{"buddyAutomation":{"done":true,"outcome":"Campaign is ready."}}\n```'
    ),
    { done: true, outcome: 'Campaign is ready.' }
  );
  assert.deepEqual(parseAutomationCompletion('[BUDDY_AUTOMATION_DONE]'), {
    done: false,
    outcome: null,
  });
});

test('Buddy context is typed conversation metadata independent of swarm state', () => {
  const buddyContext = BuddyContextSchema.parse({
    buddyId: 'buddy-1',
    workspaceId: 'workspace-1',
    automationRunId: null,
  });
  const conversation = ConversationSchema.parse({
    id: '00000000-0000-4000-8000-000000000001',
    messages: [],
    isRunning: false,
    createdAt: new Date(),
    workingDirectory: '/tmp',
    config: {
      provider: 'claude',
      model: { mode: 'default' },
      reasoning: { mode: 'default' },
    },
    configRevision: 0,
    configResolution: {
      status: 'resolved',
      catalogRevision: 'test',
      value: { provider: 'claude', modelId: 'opus' },
    },
    // ConversationSchema requires the canonical `kind`; it must agree with the
    // legacy buddyContext mirror below (same buddyId/workspaceId).
    kind: {
      kind: 'buddy',
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      automationRunId: null,
    },
    buddyContext,
  });
  assert.deepEqual(conversation.buddyContext, buddyContext);
  assert.equal(conversation.isWorker, false);
  assert.equal(conversation.swarmId, undefined);
  assert.equal(conversation.swarmDebugPrefix, undefined);
});

test('Buddy sentinel hydration restores metadata and keeps the visible user prompt clean', () => {
  const context = {
    buddyId: 'buddy-1',
    workspaceId: 'workspace-1',
    delegatedByBuddyId: null,
  };
  const messages = [
    {
      role: 'user' as const,
      content: `<!-- unleashd:buddy-context ${JSON.stringify(context)} -->\nhidden soul and memory\n<!-- /unleashd:buddy-context -->\n\nWhat should we ship?`,
      timestamp: new Date(),
    },
  ];
  assert.deepEqual(extractBuddyContext(messages), context);
  assert.equal(messages[0].content, 'What should we ship?');
});

test('scheduler executes bounded loop and records each iteration once', async () => {
  const definition = automation({
    job_kind: 'loop',
    job_payload: {
      prompt: 'Improve campaign',
      termination: {
        condition: 'campaign is ready',
        max_iterations: 3,
        max_duration_seconds: 30,
      },
    },
  });
  let run: BuddyAutomationRun = {
    id: 'run-1',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:2026-01-01',
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    outcome: null,
    error: null,
    claimed_at: definition.next_run_at!,
    started_at: null,
    ended_at: null,
  };
  const prompts: string[] = [];
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => run,
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      run = { ...run, ...changes };
      return run;
    },
    getAutomation: () => definition,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    now: () => new Date(definition.next_run_at!),
    createConversation: async () => ({
      conversationId: 'conversation-1',
      async runTurn(prompt) {
        prompts.push(prompt);
        return prompts.length === 2
          ? '{"buddyAutomation":{"done":true,"outcome":"Ready."}}'
          : '{"buddyAutomation":{"done":false,"outcome":"Continue."}}';
      },
      stop() {},
      finish() {},
    }),
  });

  await scheduler.poll();
  for (let attempt = 0; attempt < 20 && run.status !== 'complete'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(run.status, 'complete');
  assert.equal(run.iteration, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Termination condition: campaign is ready/);
});

test('scheduler fails a bounded loop that exhausts iterations without structured completion', async () => {
  const definition = automation({
    job_kind: 'loop',
    job_payload: {
      prompt: 'Improve campaign',
      termination: {
        condition: 'campaign is ready',
        max_iterations: 2,
        max_duration_seconds: 30,
      },
    },
  });
  let run: BuddyAutomationRun = {
    id: 'run-exhausted',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:exhausted',
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    outcome: null,
    error: null,
    claimed_at: definition.next_run_at!,
    started_at: null,
    ended_at: null,
  };
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => run,
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      run = { ...run, ...changes };
      return run;
    },
    getAutomation: () => definition,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    now: () => new Date(definition.next_run_at!),
    logger: { warn() {}, error() {} },
    createConversation: async () => ({
      conversationId: 'conversation-exhausted',
      async runTurn() {
        return 'continue';
      },
      stop() {},
      finish() {},
    }),
  });

  await scheduler.poll();
  for (let attempt = 0; attempt < 20 && run.status !== 'failed'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(run.status, 'failed');
  assert.equal(run.iteration, 2);
  assert.match(run.error ?? '', /did not satisfy its termination condition/);
});

test('scheduler rejects a sequence that exceeds its immutable run iteration policy', async () => {
  const definition = automation({
    job_kind: 'sequence',
    job_payload: { prompts: ['first', 'second'] },
    policy: {
      max_runtime_seconds: 600,
      max_iterations: 1,
      max_tokens: 50_000,
      max_cost_usd: 2,
      allowed_operations: ['buddy.get_current_work'],
    },
  });
  let run: BuddyAutomationRun = {
    id: 'run-policy-iterations',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:policy-iterations',
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    tokens_used: 0,
    cost_usd: 0,
    policy: definition.policy,
    outcome: null,
    error: null,
    claimed_at: definition.next_run_at!,
    started_at: null,
    ended_at: null,
  };
  let turns = 0;
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => run,
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      run = { ...run, ...changes };
      return run;
    },
    getAutomation: () => definition,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    logger: { warn() {}, error() {} },
    now: () => new Date(definition.next_run_at!),
    createConversation: async () => ({
      conversationId: 'conversation-policy-iterations',
      async runTurn() {
        turns += 1;
        return 'should not run';
      },
      stop() {},
      finish() {},
    }),
  });

  await scheduler.poll();
  for (let attempt = 0; attempt < 20 && run.status !== 'failed'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(run.status, 'failed');
  assert.equal(turns, 0);
  assert.match(run.error ?? '', /requires 2 iterations but policy allows 1/);
});

test('overdue intervals schedule from now instead of replaying missed ticks', async () => {
  const definition = automation();
  const now = new Date('2026-01-01T01:00:00.000Z');
  let run: BuddyAutomationRun = {
    id: 'run-overdue',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:overdue',
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    outcome: null,
    error: null,
    claimed_at: now.toISOString(),
    started_at: null,
    ended_at: null,
  };
  let recordedNextRunAt: string | undefined;
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => run,
    updateAutomationRun: (
      _id: string,
      changes: Partial<BuddyAutomationRun> & { nextRunAt?: string }
    ) => {
      recordedNextRunAt = changes.nextRunAt ?? recordedNextRunAt;
      run = { ...run, ...changes };
      return run;
    },
    getAutomation: () => definition,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    now: () => now,
    createConversation: async () => ({
      conversationId: 'conversation-overdue',
      async runTurn() {
        return 'done';
      },
      stop() {},
      finish() {},
    }),
  });

  await scheduler.poll();
  for (let attempt = 0; attempt < 20 && run.status !== 'complete'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(recordedNextRunAt, '2026-01-01T01:01:00.000Z');
});

test('scheduler start immediately coalesces an overdue definition into one catch-up run', async () => {
  const definition = automation();
  const now = new Date('2026-01-01T01:00:00.000Z');
  let claims = 0;
  let turns = 0;
  let recordedNextRunAt: string | undefined;
  let run: BuddyAutomationRun = {
    id: 'run-startup-catch-up',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: `${definition.id}:${definition.next_run_at}`,
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    outcome: null,
    error: null,
    claimed_at: now.toISOString(),
    started_at: null,
    ended_at: null,
  };
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => {
      claims += 1;
      return run;
    },
    updateAutomationRun: (
      _id: string,
      changes: Partial<BuddyAutomationRun> & { nextRunAt?: string }
    ) => {
      recordedNextRunAt = changes.nextRunAt ?? recordedNextRunAt;
      run = { ...run, ...changes };
      return run;
    },
    getAutomation: () => definition,
    getAutomationRun: () => run,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    now: () => now,
    pollIntervalMs: 60_000,
    createConversation: async () => ({
      conversationId: 'conversation-startup-catch-up',
      async runTurn() {
        turns += 1;
        return 'caught up';
      },
      stop() {},
      finish() {},
    }),
  });

  scheduler.start();
  for (let attempt = 0; attempt < 20 && run.status !== 'complete'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  scheduler.stop();

  assert.equal(claims, 1);
  assert.equal(turns, 1);
  assert.equal(run.status, 'complete');
  assert.equal(recordedNextRunAt, '2026-01-01T01:01:00.000Z');
});

test('scheduler health records poll failures, isolates a bad claim, and reports recovery', async () => {
  const first = automation({ id: 'automation-bad' });
  const second = automation({ id: 'automation-good' });
  const polledAt = new Date('2026-01-01T01:00:00.000Z');
  let due = [first, second];
  let goodRun: BuddyAutomationRun = {
    id: 'run-good',
    automation_id: second.id,
    scheduled_for: second.next_run_at!,
    idempotency_key: `${second.id}:${second.next_run_at}`,
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    tokens_used: 0,
    cost_usd: 0,
    policy: second.policy,
    outcome: null,
    error: null,
    claimed_at: polledAt.toISOString(),
    started_at: null,
    ended_at: null,
    claim_token: null,
    claim_expires_at: null,
  };
  const store = {
    listDueAutomations: () => due,
    claimAutomationRun: (id: string) => {
      if (id === first.id) throw new Error('database busy');
      return goodRun;
    },
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      goodRun = { ...goodRun, ...changes };
      return goodRun;
    },
    getAutomation: () => second,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    now: () => polledAt,
    logger: { warn() {}, error() {} },
    createConversation: async () => ({
      conversationId: 'conversation-good',
      runTurn: async () => 'complete',
      stop() {},
      finish() {},
    }),
  });

  await scheduler.poll();
  for (let attempt = 0; attempt < 20 && goodRun.status !== 'complete'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(goodRun.status, 'complete', 'one bad claim must not starve later due work');
  assert.deepEqual(scheduler.health(), {
    running: false,
    pollIntervalMs: 30_000,
    activeRunIds: [],
    degradedRuns: [],
    catchUpPolicy: 'coalesce',
    lastPollAt: polledAt.toISOString(),
    lastSuccessfulPollAt: null,
    lastFailedPollAt: polledAt.toISOString(),
    lastPollError: 'Could not claim automation automation-bad: database busy',
    consecutivePollFailures: 1,
    lastPollDueCount: 2,
    lastPollOldestDueAt: first.next_run_at,
  });

  due = [];
  await scheduler.poll();
  assert.equal(scheduler.health().lastSuccessfulPollAt, polledAt.toISOString());
  assert.equal(scheduler.health().lastPollError, null);
  assert.equal(scheduler.health().consecutivePollFailures, 0);
});

test('scheduler durably fails and advances a run when provider startup fails', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'buddy-scheduler-provider-start-'));
  const databasePath = join(directory, 'buddies.sqlite');
  const store = new BuddiesStore(databasePath);
  try {
    const workspace = store.createWorkspace({
      name: 'Workspace',
      rootPath: join(directory, 'workspace'),
    });
    const buddy = store.createBuddy({
      project: workspace.id,
      name: 'Lead',
      role: 'Own outcomes',
    });
    const definition = store.createAutomation({
      buddy: buddy.id,
      workspace: workspace.id,
      name: 'Provider failure proof',
      scheduleKind: 'interval',
      scheduleExpression: '60',
      jobKind: 'prompt',
      jobPayload: { prompt: 'Check state.' },
      nextRunAt: '2026-07-28T01:00:00.000Z',
    });
    const scheduler = new BuddyScheduler({
      store: store as unknown as BuddiesStorePort,
      now: () => new Date('2026-07-28T01:00:00.000Z'),
      logger: { warn() {}, error() {} },
      createConversation: async () => {
        throw new Error('provider executable unavailable');
      },
    });

    await scheduler.poll();
    let failed: BuddyAutomationRun | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      [failed] = store.listAutomationRuns(definition.id, { limit: 1 });
      if (failed?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.conversation_id, null);
    assert.equal(failed?.error, 'provider executable unavailable');
    assert.ok(failed?.ended_at, 'provider startup failure must be terminal and timestamped');
    assert.equal(store.getAutomation(definition.id).next_run_at, '2026-07-28T01:01:00.000Z');
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduler fails and advances a run interrupted by process restart', async () => {
  const definition = automation();
  const now = new Date('2026-01-01T01:00:00.000Z');
  let run: BuddyAutomationRun = {
    id: 'run-interrupted',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:interrupted',
    status: 'running',
    conversation_id: 'old-conversation',
    iteration: 1,
    outcome: null,
    error: null,
    claimed_at: definition.next_run_at!,
    started_at: definition.next_run_at!,
    ended_at: null,
  };
  let recordedNextRunAt: string | undefined;
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => run,
    updateAutomationRun: (
      _id: string,
      changes: Partial<BuddyAutomationRun> & { nextRunAt?: string }
    ) => {
      recordedNextRunAt = changes.nextRunAt;
      run = { ...run, ...changes };
      return run;
    },
    getAutomation: () => definition,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    now: () => now,
    createConversation: async () => {
      throw new Error('recovered runs must not create a second conversation');
    },
  });

  await scheduler.poll();

  assert.equal(run.status, 'failed');
  assert.equal(run.error, 'Automation interrupted by scheduler restart');
  assert.equal(recordedNextRunAt, '2026-01-01T01:01:00.000Z');
});

test('scheduler cancellation stops the active conversation and preserves cancelled state', async () => {
  const definition = automation({ job_kind: 'prompt', job_payload: { prompt: 'Review now' } });
  let run: BuddyAutomationRun = {
    id: 'run-cancel',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:cancel',
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    outcome: null,
    error: null,
    claimed_at: definition.next_run_at!,
    started_at: null,
    ended_at: null,
  };
  let rejectTurn: ((error: Error) => void) | null = null;
  let releaseDrain: (() => void) | null = null;
  const drain = new Promise<void>((resolve) => {
    releaseDrain = resolve;
  });
  let stopped = 0;
  const finishes: string[] = [];
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => run,
    getAutomationRun: () => run,
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      run = { ...run, ...changes };
      return run;
    },
    getAutomation: () => definition,
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    now: () => new Date(definition.next_run_at!),
    createConversation: async () => ({
      conversationId: 'conversation-cancel',
      runTurn: () =>
        new Promise<string>((_resolve, reject) => {
          rejectTurn = reject;
        }),
      stop() {
        stopped += 1;
      },
      async stopAndDrain() {
        stopped += 1;
        rejectTurn?.(new Error('provider stopped'));
        await drain;
      },
      finish(status) {
        finishes.push(status);
      },
    }),
  });

  await scheduler.poll();
  for (let attempt = 0; attempt < 20 && run.status !== 'running'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(scheduler.health().activeRunIds, [run.id]);
  scheduler.pause();
  assert.equal(scheduler.health().running, false);
  assert.deepEqual(scheduler.health().activeRunIds, [run.id]);
  assert.equal(run.status, 'running');
  assert.equal(stopped, 0);
  const cancellation = scheduler.cancel(run.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    run.status,
    'cancel_requested',
    'authority is revoked while durable exclusion remains until provider close is acknowledged'
  );
  assert.deepEqual(scheduler.health().activeRunIds, [run.id]);
  releaseDrain?.();
  assert.equal((await cancellation).status, 'cancelled');
  assert.equal(run.status, 'cancelled');
  assert.equal(stopped, 1);
  assert.deepEqual(finishes, ['cancelled']);
  assert.deepEqual(scheduler.health().activeRunIds, []);
});

test('terminal persistence failure keeps local ownership and exposes degraded health', async () => {
  const definition = automation({ job_kind: 'prompt', job_payload: { prompt: 'Review now' } });
  let run: BuddyAutomationRun = {
    id: 'run-terminal-write-failure',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:terminal-write-failure',
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    outcome: null,
    error: null,
    claimed_at: definition.next_run_at!,
    started_at: null,
    ended_at: null,
    claim_token: 'claim-terminal-write-failure',
    claim_expires_at: '2099-01-01T00:00:00.000Z',
  };
  const finishes: string[] = [];
  let due = true;
  let terminalWrites = 0;
  const store = {
    listDueAutomations: () => (due ? [definition] : []),
    claimAutomationRun: () => ({ ...run, claim_acquired: true }),
    getAutomationRun: () => run,
    getAutomation: () => definition,
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      if (changes.status === 'complete' && terminalWrites++ === 0) {
        throw new Error('database is read-only');
      }
      run = { ...run, ...changes };
      return run;
    },
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    logger: { warn() {}, error() {} },
    createConversation: async () => ({
      conversationId: 'conversation-terminal-write-failure',
      runTurn: async () => 'finished output',
      stop() {},
      finish(status) {
        finishes.push(status);
      },
    }),
  });

  await scheduler.poll();
  for (
    let attempt = 0;
    attempt < 20 && scheduler.health().degradedRuns.length === 0;
    attempt += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(run.status, 'running');
  assert.deepEqual(scheduler.health().activeRunIds, [run.id]);
  assert.deepEqual(scheduler.health().degradedRuns, [
    { runId: run.id, error: 'database is read-only' },
  ]);
  assert.deepEqual(
    finishes,
    [],
    'a transcript must not report completion without durable terminal state'
  );

  due = false;
  await scheduler.poll();
  assert.equal(run.status, 'complete');
  assert.deepEqual(scheduler.health().activeRunIds, []);
  assert.deepEqual(scheduler.health().degradedRuns, []);
  assert.deepEqual(finishes, ['complete']);
});

test('cancellation during conversation creation terminalizes a late conversation', async () => {
  const definition = automation();
  let run: BuddyAutomationRun = {
    id: 'run-cancel-creation',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: 'automation-1:cancel-creation',
    status: 'claimed',
    conversation_id: null,
    iteration: 0,
    tokens_used: 0,
    cost_usd: 0,
    policy: definition.policy,
    outcome: null,
    error: null,
    claimed_at: definition.next_run_at!,
    started_at: null,
    ended_at: null,
    claim_token: 'claim-cancel-creation',
    claim_expires_at: '2099-01-01T00:00:00.000Z',
  };
  let resolveCreation:
    | ((conversation: {
        conversationId: string;
        runTurn(prompt: string): Promise<string>;
        stop(): void;
        finish(status: 'complete' | 'failed' | 'cancelled'): void;
      }) => void)
    | null = null;
  const lateFinishes: string[] = [];
  let lateStops = 0;
  const store = {
    listDueAutomations: () => [definition],
    claimAutomationRun: () => ({ ...run, claim_acquired: true }),
    getAutomationRun: () => run,
    getAutomation: () => definition,
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      run = { ...run, ...changes };
      return run;
    },
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    createConversation: () =>
      new Promise((resolve) => {
        resolveCreation = resolve;
      }),
  });

  await scheduler.poll();
  assert.deepEqual(scheduler.health().activeRunIds, [run.id]);
  assert.equal((await scheduler.cancel(run.id)).status, 'cancelled');
  resolveCreation?.({
    conversationId: 'late-conversation',
    runTurn: async () => 'must not run',
    stop() {
      lateStops += 1;
    },
    finish(status) {
      lateFinishes.push(status);
    },
  });
  for (let attempt = 0; attempt < 20 && lateFinishes.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(run.status, 'cancelled');
  assert.deepEqual(lateFinishes, ['cancelled']);
  assert.equal(lateStops, 1);
  assert.deepEqual(scheduler.health().activeRunIds, []);
});

test('scheduler interrupts an expired run without creating a replacement executor', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'buddy-scheduler-restart-'));
  const databasePath = join(directory, 'buddies.sqlite');
  let store = new BuddiesStore(databasePath);
  try {
    const workspace = store.createWorkspace({
      name: 'Workspace',
      rootPath: join(directory, 'workspace'),
    });
    const buddy = store.createBuddy({
      project: workspace.id,
      name: 'Lead',
      role: 'Own outcomes',
    });
    const definition = store.createAutomation({
      buddy: buddy.id,
      workspace: workspace.id,
      name: 'Restart proof',
      scheduleKind: 'interval',
      scheduleExpression: '60',
      jobKind: 'prompt',
      jobPayload: { prompt: 'Check state.' },
      nextRunAt: '2026-07-28T00:00:00.000Z',
    });
    const claimed = store.claimAutomationRun(definition.id, {
      scheduledFor: definition.next_run_at!,
    });
    store.updateAutomationRun(claimed.id, {
      status: 'running',
      conversationId: 'conversation-before-restart',
      claimToken: claimed.claim_token,
    });
    store.db
      .prepare('UPDATE buddy_automation_runs SET claim_expires_at = ? WHERE id = ?')
      .run('2026-07-28T00:59:00.000Z', claimed.id);
    store.close();

    store = new BuddiesStore(databasePath);
    let recoveryConversations = 0;
    let schedulerNow = new Date('2026-07-28T01:00:00.000Z');
    const scheduler = new BuddyScheduler({
      store: store as unknown as BuddiesStorePort,
      now: () => schedulerNow,
      createConversation: async () => {
        recoveryConversations += 1;
        return {
          conversationId: 'conversation-after-restart',
          runTurn: async () => 'Recovered after the expired executor lease.',
          stop() {},
          finish() {},
        };
      },
    });
    await scheduler.poll();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (store.getAutomationRun(claimed.id)?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const recovered = store.getAutomationRun(claimed.id);
    assert.equal(recoveryConversations, 0);
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.conversation_id, 'conversation-before-restart');
    assert.match(recovered.error ?? '', /executor lease expired/);
    assert.equal(store.getAutomation(definition.id).next_run_at, '2026-07-28T01:01:00.000Z');

    schedulerNow = new Date('2026-07-28T01:01:00.000Z');
    await scheduler.poll();
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const runs = store.listAutomationRuns(definition.id);
      if (
        runs.some((candidate) => candidate.id !== claimed.id && candidate.status === 'complete')
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const runs = store.listAutomationRuns(definition.id);
    assert.equal(recoveryConversations, 1, 'the next occurrence starts once, not the expired one');
    assert.equal(runs.length, 2);
    assert.equal(store.getAutomationRun(claimed.id)?.status, 'failed');
    assert.ok(
      runs.some((candidate) => candidate.id !== claimed.id && candidate.status === 'complete')
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('startup recovery terminalizes disabled manual and cancellation-requested runs without replay', () => {
  const disabled = automation({ enabled: false, next_run_at: '2099-01-01T00:00:00.000Z' });
  const cancelling = automation({
    id: 'automation-cancelling',
    enabled: false,
    next_run_at: '2099-01-01T00:00:00.000Z',
  });
  const runs = [
    {
      id: 'run-disabled-manual',
      automation_id: disabled.id,
      scheduled_for: '2026-08-24T00:00:00.000Z',
      idempotency_key: `${disabled.id}:manual:2026-08-24T00:00:00.000Z`,
      status: 'running' as const,
      conversation_id: 'conversation-disabled',
      iteration: 1,
      outcome: null,
      error: null,
      claimed_at: '2026-08-24T00:00:00.000Z',
      started_at: '2026-08-24T00:00:01.000Z',
      ended_at: null,
      claim_token: 'disabled-token',
      claim_expires_at: '2099-01-01T00:00:00.000Z',
    },
    {
      id: 'run-cancel-requested',
      automation_id: cancelling.id,
      scheduled_for: '2026-08-24T00:00:00.000Z',
      idempotency_key: `${cancelling.id}:manual:2026-08-24T00:00:00.000Z`,
      status: 'cancel_requested' as const,
      conversation_id: 'conversation-cancelling',
      iteration: 0,
      outcome: null,
      error: 'Automation cancellation requested',
      claimed_at: '2026-08-24T00:00:00.000Z',
      started_at: '2026-08-24T00:00:01.000Z',
      ended_at: null,
      claim_token: 'cancelling-token',
      claim_expires_at: '2099-01-01T00:00:00.000Z',
    },
  ];
  let conversations = 0;
  const writes: Array<{ id: string; status: string; claimToken?: string }> = [];
  const definitions = new Map([
    [disabled.id, disabled],
    [cancelling.id, cancelling],
  ]);
  const store = {
    listNonterminalAutomationRuns: () => runs,
    listDueAutomations: () => [],
    getAutomation: (id: string) => definitions.get(id) ?? null,
    updateAutomationRun: (
      id: string,
      changes: Partial<BuddyAutomationRun> & { claimToken?: string }
    ) => {
      writes.push({ id, status: changes.status ?? '', claimToken: changes.claimToken });
      const run = runs.find((candidate) => candidate.id === id)!;
      Object.assign(run, changes);
      return run;
    },
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    createConversation: async () => {
      conversations += 1;
      throw new Error('recovery must not replay');
    },
  });

  scheduler.start();
  scheduler.pause();

  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[1].status, 'cancelled');
  assert.deepEqual(writes, [
    { id: runs[0].id, status: 'failed', claimToken: 'disabled-token' },
    { id: runs[1].id, status: 'cancelled', claimToken: 'cancelling-token' },
  ]);
  assert.equal(conversations, 0);
});

test('a recovered cancellation retains ownership and retries a failed terminal write', async () => {
  const definition = automation({ enabled: false });
  let run = {
    id: 'run-recovered-cancel-retry',
    automation_id: definition.id,
    scheduled_for: definition.next_run_at!,
    idempotency_key: `${definition.id}:manual:recovered`,
    status: 'cancel_requested' as const,
    conversation_id: null,
    iteration: 0,
    outcome: null,
    error: 'Automation cancellation requested',
    claimed_at: definition.next_run_at!,
    started_at: null,
    ended_at: null,
    claim_token: 'recovered-cancel-token',
    claim_expires_at: '2099-01-01T00:00:00.000Z',
  } as BuddyAutomationRun;
  let terminalAttempts = 0;
  const store = {
    getAutomationRun: () => run,
    getAutomation: () => definition,
    listDueAutomations: () => [],
    updateAutomationRun: (_id: string, changes: Partial<BuddyAutomationRun>) => {
      if (changes.status === 'cancelled' && terminalAttempts++ === 0) {
        throw new Error('database temporarily busy');
      }
      run = { ...run, ...changes };
      return run;
    },
  } as unknown as BuddiesStorePort;
  const scheduler = new BuddyScheduler({
    store,
    logger: { warn() {}, error() {} },
    createConversation: async () => {
      throw new Error('recovered cancellation must not create a conversation');
    },
  });

  assert.equal((await scheduler.cancel(run.id)).status, 'cancel_requested');
  assert.deepEqual(scheduler.health().activeRunIds, [run.id]);
  assert.deepEqual(scheduler.health().degradedRuns, [
    { runId: run.id, error: 'database temporarily busy' },
  ]);

  await scheduler.poll();
  assert.equal(run.status, 'cancelled');
  assert.deepEqual(scheduler.health().activeRunIds, []);
  assert.deepEqual(scheduler.health().degradedRuns, []);
});
