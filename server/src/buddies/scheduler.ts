import { randomUUID } from 'node:crypto';
import type { BuddiesStorePort, BuddyAutomation, BuddyAutomationRun } from './contract';

export interface BuddyAutomationConversation {
  conversationId: string;
  runTurn(prompt: string): Promise<string>;
  stop(): void;
  stopAndDrain?(): Promise<void>;
  finish(status: 'complete' | 'failed' | 'cancelled'): void;
}

export interface BuddySchedulerOptions {
  store: BuddiesStorePort;
  createConversation(
    automation: BuddyAutomation,
    run: BuddyAutomationRun
  ): Promise<BuddyAutomationConversation>;
  pollIntervalMs?: number;
  now?: () => Date;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export function parseAutomationCompletion(output: string): {
  done: boolean;
  outcome: string | null;
} {
  const trimmed = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const value = JSON.parse(trimmed) as {
      buddyAutomation?: { done?: unknown; outcome?: unknown };
    };
    if (typeof value.buddyAutomation?.done !== 'boolean') {
      return { done: false, outcome: null };
    }
    return {
      done: value.buddyAutomation.done,
      outcome:
        typeof value.buddyAutomation.outcome === 'string' ? value.buddyAutomation.outcome : null,
    };
  } catch {
    return { done: false, outcome: null };
  }
}

class BuddyAutomationCancelledError extends Error {}

const LEGACY_SAFE_POLICY = {
  max_runtime_seconds: 600,
  max_iterations: 1,
  max_tokens: 50_000,
  max_cost_usd: 2,
  allowed_operations: ['buddy.get_current_work'] as const,
};

function cronPartMatches(part: string, value: number, min: number, max: number): boolean {
  if (!/^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?$/.test(part)) return false;
  const [base, stepText] = part.split('/');
  if (!base || part.split('/').length > 2) return false;
  const step = stepText === undefined ? 1 : Number(stepText);
  if (!Number.isInteger(step) || step < 1) return false;
  let start = min;
  let end = max;
  if (base !== '*') {
    const [startText, endText] = base.split('-');
    start = Number(startText);
    end = endText === undefined ? start : Number(endText);
  }
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= min &&
    end <= max &&
    value >= start &&
    value <= end &&
    (value - start) % step === 0
  );
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => cronPartMatches(part, value, min, max));
}

function validateCronField(field: string, min: number, max: number): void {
  if (
    !field ||
    !field
      .split(',')
      .every((part) =>
        Array.from({ length: max - min + 1 }, (_unused, offset) => min + offset).some((value) =>
          cronPartMatches(part, value, min, max)
        )
      )
  ) {
    throw new Error(`Invalid cron field: ${field || '(empty)'}`);
  }
}

function zonedParts(date: Date, formatter: Intl.DateTimeFormat): number[] {
  const values = formatter.formatToParts(date).reduce<Record<string, string>>((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  const weekdays: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return [
    Number(values.minute),
    Number(values.hour),
    Number(values.day),
    Number(values.month),
    weekdays[values.weekday],
  ];
}

export function nextAutomationRunAt(automation: BuddyAutomation, after: Date): string {
  if (automation.schedule_kind === 'interval') {
    const seconds = Number(automation.schedule_expression);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('Interval automation must use positive seconds');
    }
    return new Date(after.getTime() + seconds * 1000).toISOString();
  }

  const fields = automation.schedule_expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('Cron automation must have five fields');
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ] as const;
  fields.forEach((field, index) => {
    const [min, max] = ranges[index];
    validateCronField(field, min, max);
  });
  if (fields[4] === '*' && fields[2] !== '*') {
    const maxDaysByMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const possible = maxDaysByMonth.some(
      (maxDays, monthIndex) =>
        cronFieldMatches(fields[3], monthIndex + 1, 1, 12) &&
        Array.from({ length: maxDays }, (_unused, dayIndex) => dayIndex + 1).some((day) =>
          cronFieldMatches(fields[2], day, 1, 31)
        )
    );
    if (!possible) throw new Error('Cron day-of-month cannot occur in the selected month');
  }
  // Formatter construction is comparatively expensive. Reusing one instance
  // keeps a valid-but-rare schedule scan bounded without a dependency or cache.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: automation.timezone,
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const start = new Date(after);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let offset = 0; offset < limit; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    const parts = zonedParts(candidate, formatter);
    const dayOfMonthMatches = cronFieldMatches(fields[2], parts[2], 1, 31);
    const dayOfWeekMatches = cronFieldMatches(fields[4], parts[4], 0, 6);
    const dayMatches =
      fields[2] === '*'
        ? dayOfWeekMatches
        : fields[4] === '*'
          ? dayOfMonthMatches
          : dayOfMonthMatches || dayOfWeekMatches;
    if (
      cronFieldMatches(fields[0], parts[0], 0, 59) &&
      cronFieldMatches(fields[1], parts[1], 0, 23) &&
      cronFieldMatches(fields[3], parts[3], 1, 12) &&
      dayMatches
    ) {
      return candidate.toISOString();
    }
  }
  // The one-year scan is an explicit product bound, not proof that the cron is
  // globally impossible. Keep the error honest so a future parser/library can
  // widen the supported horizon without changing validation semantics. See
  // agent_notes/2026-08-24_automation-execution-ownership-design.md.
  throw new Error('Cron has no occurrence within the supported 366-day horizon');
}

export class BuddyScheduler {
  private readonly store: BuddiesStorePort;
  private readonly createConversation: BuddySchedulerOptions['createConversation'];
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private readonly logger: Pick<Console, 'warn' | 'error'>;
  private timer: NodeJS.Timeout | null = null;
  private activeRuns = new Set<string>();
  private executionTasks = new Map<string, Promise<void>>();
  private activeConversations = new Map<string, BuddyAutomationConversation>();
  private cancelledRuns = new Set<string>();
  private cancellationControllers = new Map<string, AbortController>();
  private cancellationDrains = new Map<string, Promise<void>>();
  private degradedRuns = new Map<string, string>();
  private pendingTerminals = new Map<
    string,
    {
      changes: Parameters<BuddiesStorePort['updateAutomationRun']>[1];
      conversation: BuddyAutomationConversation | null;
      finishStatus: 'complete' | 'failed' | 'cancelled';
    }
  >();
  private lastPollAt: string | null = null;
  private lastSuccessfulPollAt: string | null = null;
  private lastFailedPollAt: string | null = null;
  private lastPollError: string | null = null;
  private consecutivePollFailures = 0;
  private lastPollDueCount = 0;
  private lastPollOldestDueAt: string | null = null;
  private startupRecoveryComplete = false;

  constructor(options: BuddySchedulerOptions) {
    this.store = options.store;
    this.createConversation = options.createConversation;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? console;
  }

  start(): void {
    if (this.timer) return;
    if (!this.startupRecoveryComplete) {
      this.startupRecoveryComplete = true;
      this.recoverInterruptedRuns();
    }
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    this.timer.unref?.();
    void this.poll();
  }

  /**
   * Stop claiming new occurrences without disturbing work already in flight.
   * Source reload uses this while the old server remains the sole owner of its
   * provider streams. Explicit shutdown uses stop() because it must terminate
   * those streams.
   */
  pause(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stop(): void {
    this.pause();
    for (const runId of this.activeRuns) void this.cancel(runId);
  }

  health() {
    return {
      running: this.timer !== null,
      pollIntervalMs: this.pollIntervalMs,
      activeRunIds: [...this.activeRuns],
      degradedRuns: [...this.degradedRuns].map(([runId, error]) => ({ runId, error })),
      catchUpPolicy: 'coalesce' as const,
      lastPollAt: this.lastPollAt,
      lastSuccessfulPollAt: this.lastSuccessfulPollAt,
      lastFailedPollAt: this.lastFailedPollAt,
      lastPollError: this.lastPollError,
      consecutivePollFailures: this.consecutivePollFailures,
      lastPollDueCount: this.lastPollDueCount,
      lastPollOldestDueAt: this.lastPollOldestDueAt,
    };
  }

  async cancel(runId: string): Promise<BuddyAutomationRun> {
    let run = this.store.getAutomationRun(runId);
    if (!run) throw new Error(`automation run not found: ${runId}`);
    if (['complete', 'failed', 'cancelled'].includes(run.status)) return run;
    // Cancellation is authority revocation first, process teardown second. The
    // durable intermediate state makes every MCP authorization check fail while
    // the old provider is still acknowledging SIGTERM. See invariant I7 in
    // agent_notes/2026-08-24_automation-execution-ownership-design.md.
    if (run.status !== 'cancel_requested') {
      run = this.store.updateAutomationRun(run.id, {
        status: 'cancel_requested',
        error: 'Automation cancellation requested',
        ...(run.claim_token ? { claimToken: run.claim_token } : {}),
      });
    }
    this.cancelledRuns.add(run.id);
    this.cancellationControllers.get(run.id)?.abort();
    const conversation = this.activeConversations.get(run.id);
    if (conversation) void this.stopAndDrain(run.id, conversation);

    const task = this.executionTasks.get(run.id);
    if (task) {
      await task;
    } else {
      // A durable nonterminal row can survive a hard crash even though this
      // process owns no provider. With no local process to acknowledge, the
      // cancellation itself is the recovery proof. Never use this branch for a
      // locally active execution task.
      const automation = this.store.getAutomation(run.automation_id);
      const nextRunAt = automation ? this.nextRunAt(automation, run) : undefined;
      const changes = {
        status: 'cancelled',
        error: 'Automation cancelled',
        ...(run.claim_token ? { claimToken: run.claim_token } : {}),
        ...(nextRunAt ? { nextRunAt } : {}),
      } satisfies Parameters<BuddiesStorePort['updateAutomationRun']>[1];
      const terminal = this.persistTerminalRun(run.id, changes);
      if (terminal) {
        this.releaseRun(run.id);
      } else {
        // No execution wrapper exists to retain ownership for a recovered row,
        // so the retry itself becomes the local owner until durable terminal
        // state lands. Otherwise one transient SQLite failure wedges
        // cancel_requested forever. See the failure alternatives in §6/I1 of
        // the ownership design note.
        this.activeRuns.add(run.id);
        this.deferTerminal(run.id, changes, null, 'cancelled');
      }
    }
    return this.store.getAutomationRun(run.id) ?? run;
  }

  async poll(): Promise<void> {
    const polledAt = this.now();
    this.lastPollAt = polledAt.toISOString();
    let due: BuddyAutomation[];
    try {
      this.retryPendingTerminals();
      due = this.store.listDueAutomations(polledAt);
      this.lastPollDueCount = due.length;
      this.lastPollOldestDueAt = due[0]?.next_run_at ?? null;
      let pollError: string | null = null;
      for (const automation of due) {
        try {
          const claimToken = randomUUID();
          const run = this.store.claimAutomationRun(automation.id, {
            scheduledFor: automation.next_run_at ?? polledAt.toISOString(),
            claimToken,
            leaseSeconds: automation.policy.max_runtime_seconds + 60,
          });
          // Older store adapters and focused test doubles predate durable claim
          // ownership. Undefined keeps that compatibility path; only an explicit
          // false means another executor owns this occurrence.
          if (run.claim_acquired === false) {
            if (run.status === 'failed' && run.error?.includes('executor lease expired')) {
              this.advanceRecoveredRun(automation, run);
            }
            continue;
          }
          if (this.activeRuns.has(run.id)) continue;
          if (run.status === 'running' && run.claim_acquired === undefined) {
            const nextRunAt = this.nextRunAt(automation, run);
            this.store.updateAutomationRun(run.id, {
              status: 'failed',
              error: 'Automation interrupted by scheduler restart',
              ...(nextRunAt ? { nextRunAt } : {}),
            });
            continue;
          }
          if (run.status !== 'claimed') continue;
          this.launchExecution(automation, run, claimToken);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          pollError = `Could not claim automation ${automation.id}: ${message}`;
          this.logger.error(`[buddies] ${pollError}`);
        }
      }
      if (pollError) {
        this.recordPollFailure(polledAt, pollError);
      } else {
        this.lastSuccessfulPollAt = polledAt.toISOString();
        this.lastPollError = null;
        this.consecutivePollFailures = 0;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.recordPollFailure(polledAt, message);
      this.logger.error(`[buddies] Scheduler poll failed: ${message}`);
    }
  }

  private recordPollFailure(at: Date, message: string): void {
    this.lastFailedPollAt = at.toISOString();
    this.lastPollError = message;
    this.consecutivePollFailures += 1;
  }

  private recoverInterruptedRuns(): void {
    // Recovery is deliberately independent of definition visibility and due
    // time: a disabled automation or a manual occurrence can still have been
    // abandoned by the prior process. Recovery terminalizes that occurrence;
    // it never adopts or replays it. See invariant I5 in
    // agent_notes/2026-08-24_automation-execution-ownership-design.md.
    const listNonterminal = this.store.listNonterminalAutomationRuns;
    if (typeof listNonterminal !== 'function') return;
    for (const run of listNonterminal.call(this.store)) {
      try {
        const automation = this.store.getAutomation(run.automation_id);
        const nextRunAt = automation ? this.nextRunAt(automation, run) : undefined;
        const finishStatus = run.status === 'cancel_requested' ? 'cancelled' : 'failed';
        const changes = {
          status: finishStatus,
          error:
            run.status === 'cancel_requested'
              ? 'Automation cancellation completed after scheduler restart'
              : 'Automation interrupted by scheduler restart',
          ...(run.claim_token ? { claimToken: run.claim_token } : {}),
          ...(nextRunAt ? { nextRunAt } : {}),
        } satisfies Parameters<BuddiesStorePort['updateAutomationRun']>[1];
        if (!this.persistTerminalRun(run.id, changes)) {
          this.activeRuns.add(run.id);
          this.deferTerminal(run.id, changes, null, finishStatus);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.degradedRuns.set(run.id, message);
        this.logger.error(`[buddies] Could not recover automation run ${run.id}: ${message}`);
      }
    }
  }

  async runNow(automationId: string): Promise<BuddyAutomationRun> {
    const automation = this.store.getAutomation(automationId);
    if (!automation) throw new Error(`automation not found: ${automationId}`);
    if (!automation.enabled) throw new Error(`automation is archived or disabled: ${automationId}`);
    const scheduledFor = this.now().toISOString();
    const claimToken = randomUUID();
    const run = this.store.claimAutomationRun(automation.id, {
      scheduledFor,
      idempotencyKey: `${automation.id}:manual:${scheduledFor}`,
      claimToken,
      leaseSeconds: automation.policy.max_runtime_seconds + 60,
    });
    if (run.claim_acquired === false) {
      if (run.status === 'failed' && run.error?.includes('executor lease expired')) {
        this.advanceRecoveredRun(automation, run);
      }
      throw new Error(`automation already has an active or unrecoverable run: ${automationId}`);
    }
    if (run.status === 'claimed' && !this.activeRuns.has(run.id)) {
      this.launchExecution(automation, run, claimToken);
    }
    return run;
  }

  private async execute(
    automation: BuddyAutomation,
    claimed: BuddyAutomationRun,
    claimToken: string
  ): Promise<void> {
    if (this.activeRuns.has(claimed.id)) return;
    this.activeRuns.add(claimed.id);
    const cancellation = new AbortController();
    this.cancellationControllers.set(claimed.id, cancellation);
    let conversation: BuddyAutomationConversation | null = null;
    const policy = claimed.policy ?? automation.policy ?? LEGACY_SAFE_POLICY;
    // One wall-clock deadline covers resolution, durable conversation creation,
    // provider startup and every iteration. Starting the clock after creation
    // made reload wait forever on a hung boundary. See
    // agent_notes/2026-08-24_automation-execution-ownership-design.md.
    const policyDeadline = Date.now() + policy.max_runtime_seconds * 1000;
    let releaseOwnership = true;
    try {
      conversation = await this.createBeforeDeadline(
        automation,
        claimed,
        policyDeadline,
        cancellation.signal
      );
      this.activeConversations.set(claimed.id, conversation);
      this.assertNotCancelled(claimed.id);
      let run = this.store.updateAutomationRun(claimed.id, {
        status: 'running',
        conversationId: conversation.conversationId,
        claimToken,
      });
      let outcome = '';
      if (automation.job_kind === 'prompt') {
        outcome = await this.runBeforeDeadline(
          conversation,
          (automation.job_payload as { prompt: string }).prompt,
          policyDeadline,
          'Automation runtime policy limit reached'
        );
        this.assertNotCancelled(claimed.id);
        run = this.store.updateAutomationRun(run.id, {
          status: 'running',
          iteration: 1,
          outcome,
          claimToken,
        });
      } else if (automation.job_kind === 'sequence') {
        const prompts = (automation.job_payload as { prompts: string[] }).prompts;
        if (prompts.length > policy.max_iterations) {
          throw new Error(
            `Automation sequence requires ${prompts.length} iterations but policy allows ${policy.max_iterations}`
          );
        }
        for (let index = 0; index < prompts.length; index += 1) {
          outcome = await this.runBeforeDeadline(
            conversation,
            prompts[index],
            policyDeadline,
            'Automation runtime policy limit reached'
          );
          this.assertNotCancelled(claimed.id);
          run = this.store.updateAutomationRun(run.id, {
            status: 'running',
            iteration: index + 1,
            outcome,
            claimToken,
          });
        }
      } else {
        const payload = automation.job_payload as {
          prompt: string;
          termination: {
            condition: string;
            max_iterations: number;
            max_duration_seconds: number;
          };
        };
        const deadline = Math.min(
          policyDeadline,
          Date.now() + payload.termination.max_duration_seconds * 1000
        );
        const maxIterations = Math.min(payload.termination.max_iterations, policy.max_iterations);
        let terminationSatisfied = false;
        for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
          if (Date.now() >= deadline) throw new Error('Automation loop duration limit reached');
          const prompt = [
            payload.prompt,
            '',
            `Termination condition: ${payload.termination.condition}`,
            'Return only JSON: {"buddyAutomation":{"done":boolean,"outcome":"brief result"}}.',
            `Iteration ${iteration} of ${maxIterations}.`,
          ].join('\n');
          outcome = await this.runBeforeDeadline(
            conversation,
            prompt,
            deadline,
            deadline === policyDeadline
              ? 'Automation runtime policy limit reached'
              : 'Automation loop duration limit reached'
          );
          this.assertNotCancelled(claimed.id);
          run = this.store.updateAutomationRun(run.id, {
            status: 'running',
            iteration,
            outcome,
            claimToken,
          });
          if (parseAutomationCompletion(outcome).done) {
            terminationSatisfied = true;
            break;
          }
        }
        if (!terminationSatisfied) {
          throw new Error(
            `Automation loop did not satisfy its termination condition after ${maxIterations} iterations`
          );
        }
      }
      const nextRunAt = this.nextRunAt(automation, claimed);
      const terminal = this.persistTerminalRun(run.id, {
        status: 'complete',
        outcome,
        claimToken,
        ...(nextRunAt ? { nextRunAt } : {}),
      });
      if (!terminal) {
        releaseOwnership = false;
        this.deferTerminal(
          run.id,
          {
            status: 'complete',
            outcome,
            claimToken,
            ...(nextRunAt ? { nextRunAt } : {}),
          },
          conversation,
          'complete'
        );
        return;
      }
      conversation.finish('complete');
    } catch (error) {
      if (error instanceof BuddyAutomationCancelledError || this.cancelledRuns.has(claimed.id)) {
        if (conversation) await this.stopAndDrain(claimed.id, conversation);
        const nextRunAt = this.nextRunAt(automation, claimed);
        const terminal = this.persistTerminalRun(claimed.id, {
          status: 'cancelled',
          error: 'Automation cancelled',
          claimToken,
          ...(nextRunAt ? { nextRunAt } : {}),
        });
        if (!terminal) {
          releaseOwnership = false;
          this.deferTerminal(
            claimed.id,
            {
              status: 'cancelled',
              error: 'Automation cancelled',
              claimToken,
              ...(nextRunAt ? { nextRunAt } : {}),
            },
            conversation,
            'cancelled'
          );
          return;
        }
        conversation?.finish('cancelled');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[buddies] Automation ${automation.id} failed: ${message}`);
      const nextRunAt = this.nextRunAt(automation, claimed);
      if (conversation) await this.stopAndDrain(claimed.id, conversation);
      const terminal = this.persistTerminalRun(claimed.id, {
        status: 'failed',
        error: message,
        claimToken,
        ...(nextRunAt ? { nextRunAt } : {}),
      });
      if (!terminal) {
        releaseOwnership = false;
        this.deferTerminal(
          claimed.id,
          {
            status: 'failed',
            error: message,
            claimToken,
            ...(nextRunAt ? { nextRunAt } : {}),
          },
          conversation,
          'failed'
        );
        return;
      }
      conversation?.finish('failed');
    } finally {
      if (releaseOwnership) this.releaseRun(claimed.id);
    }
  }

  private launchExecution(
    automation: BuddyAutomation,
    run: BuddyAutomationRun,
    claimToken: string
  ): void {
    const task = this.execute(automation, run, claimToken);
    this.executionTasks.set(run.id, task);
    // Every fire-and-forget task has an observer. execute contains expected
    // provider/store failures; this final guard prevents a secondary persistence
    // failure from becoming a process-level unhandled rejection.
    void task
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[buddies] Automation task ${run.id} escaped: ${message}`);
      })
      .finally(() => this.executionTasks.delete(run.id));
  }

  private persistTerminalRun(
    runId: string,
    changes: Parameters<BuddiesStorePort['updateAutomationRun']>[1]
  ): BuddyAutomationRun | null {
    try {
      const persisted = this.store.updateAutomationRun(runId, changes);
      this.degradedRuns.delete(runId);
      return persisted;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[buddies] Could not persist terminal automation run ${runId}: ${message}`);
      this.degradedRuns.set(runId, message);
      return null;
    }
  }

  private deferTerminal(
    runId: string,
    changes: Parameters<BuddiesStorePort['updateAutomationRun']>[1],
    conversation: BuddyAutomationConversation | null,
    finishStatus: 'complete' | 'failed' | 'cancelled'
  ): void {
    this.pendingTerminals.set(runId, { changes, conversation, finishStatus });
  }

  private retryPendingTerminals(): void {
    for (const [runId, pending] of this.pendingTerminals) {
      const terminal = this.persistTerminalRun(runId, pending.changes);
      if (!terminal) continue;
      try {
        pending.conversation?.finish(pending.finishStatus);
      } catch (error) {
        this.logger.error(
          `[buddies] Could not finish automation conversation ${runId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      this.releaseRun(runId);
    }
  }

  private stopAndDrain(runId: string, conversation: BuddyAutomationConversation): Promise<void> {
    const existing = this.cancellationDrains.get(runId);
    if (existing) return existing;
    const drain = conversation.stopAndDrain
      ? conversation.stopAndDrain()
      : Promise.resolve().then(() => conversation.stop());
    this.cancellationDrains.set(runId, drain);
    return drain;
  }

  private releaseRun(runId: string): void {
    this.activeRuns.delete(runId);
    this.activeConversations.delete(runId);
    this.cancelledRuns.delete(runId);
    this.cancellationControllers.delete(runId);
    this.cancellationDrains.delete(runId);
    this.degradedRuns.delete(runId);
    this.pendingTerminals.delete(runId);
  }

  private advanceRecoveredRun(automation: BuddyAutomation, run: BuddyAutomationRun): void {
    const nextRunAt = this.nextRunAt(automation, run);
    this.persistTerminalRun(run.id, {
      status: 'failed',
      ...(run.claim_token ? { claimToken: run.claim_token } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
    });
  }

  private async createBeforeDeadline(
    automation: BuddyAutomation,
    run: BuddyAutomationRun,
    deadline: number,
    signal: AbortSignal
  ): Promise<BuddyAutomationConversation> {
    const creation = this.createConversation(automation, run);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Automation runtime policy limit reached');
    let timeout: NodeJS.Timeout | null = null;
    let onAbort: (() => void) | null = null;
    try {
      return await Promise.race([
        creation,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Automation runtime policy limit reached')),
            remaining
          );
          timeout.unref?.();
        }),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new BuddyAutomationCancelledError());
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } catch (error) {
      // createConversation cannot currently accept AbortSignal. If the deadline
      // or cancellation wins, explicitly terminalize a later resolution so its
      // newly registered conversation cannot leak into the UI/runtime.
      void creation
        .then((lateConversation) => {
          lateConversation.finish(signal.aborted ? 'cancelled' : 'failed');
          lateConversation.stop();
        })
        .catch(() => {});
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private assertNotCancelled(runId: string): void {
    if (this.cancelledRuns.has(runId)) throw new BuddyAutomationCancelledError();
  }

  private nextRunAt(automation: BuddyAutomation, claimed: BuddyAutomationRun): string | undefined {
    // Manual runs share the single-owner exclusion but not the schedule cursor.
    // Advancing here would let a Run-now completion race a scheduled completion
    // and move next_run_at backwards or skip an occurrence. See invariant I10 in
    // agent_notes/2026-08-24_automation-execution-ownership-design.md.
    if (claimed.idempotency_key.includes(':manual:')) return undefined;
    const scheduledAt = new Date(claimed.scheduled_for);
    const now = this.now();
    const reference =
      Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < now.getTime()
        ? now
        : scheduledAt;
    try {
      return nextAutomationRunAt(automation, reference);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[buddies] Cannot schedule the next run for automation ${automation.id}: ${message}`
      );
      return undefined;
    }
  }

  private async runBeforeDeadline(
    conversation: BuddyAutomationConversation,
    prompt: string,
    deadline: number,
    timeoutMessage: string
  ): Promise<string> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(timeoutMessage);
    let timeout: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        conversation.runTurn(prompt),
        new Promise<string>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(timeoutMessage)), remaining);
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
