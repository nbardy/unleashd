import { randomUUID } from 'node:crypto';
import type { BuddiesStorePort, BuddyAutomation, BuddyAutomationRun } from './contract';

export interface BuddyAutomationConversation {
  conversationId: string;
  runTurn(prompt: string): Promise<string>;
  stop(): void;
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

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => {
    const [base, stepText] = part.split('/');
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
  });
}

function zonedParts(date: Date, timezone: string): number[] {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    minute: 'numeric',
    hour: 'numeric',
    day: 'numeric',
    month: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
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
  const start = new Date(after);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const limit = 366 * 24 * 60;
  for (let offset = 0; offset < limit; offset += 1) {
    const candidate = new Date(start.getTime() + offset * 60_000);
    const parts = zonedParts(candidate, automation.timezone);
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
  throw new Error('No cron occurrence found in the next year');
}

export class BuddyScheduler {
  private readonly store: BuddiesStorePort;
  private readonly createConversation: BuddySchedulerOptions['createConversation'];
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private readonly logger: Pick<Console, 'warn' | 'error'>;
  private timer: NodeJS.Timeout | null = null;
  private activeRuns = new Set<string>();
  private activeConversations = new Map<string, BuddyAutomationConversation>();
  private cancelledRuns = new Set<string>();
  private lastPollAt: string | null = null;
  private lastSuccessfulPollAt: string | null = null;
  private lastFailedPollAt: string | null = null;
  private lastPollError: string | null = null;
  private consecutivePollFailures = 0;
  private lastPollDueCount = 0;
  private lastPollOldestDueAt: string | null = null;

  constructor(options: BuddySchedulerOptions) {
    this.store = options.store;
    this.createConversation = options.createConversation;
    this.pollIntervalMs = options.pollIntervalMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? console;
  }

  start(): void {
    if (this.timer) return;
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

  cancel(runId: string): BuddyAutomationRun {
    const run = this.store.getAutomationRun(runId);
    if (!run) throw new Error(`automation run not found: ${runId}`);
    if (['complete', 'failed', 'cancelled'].includes(run.status)) return run;
    this.cancelledRuns.add(run.id);
    const conversation = this.activeConversations.get(run.id);
    conversation?.stop();
    conversation?.finish('cancelled');
    const automation = this.store.getAutomation(run.automation_id);
    const nextRunAt = automation ? this.nextRunAt(automation, run) : undefined;
    return this.store.updateAutomationRun(run.id, {
      status: 'cancelled',
      error: 'Automation cancelled',
      ...(run.claim_token ? { claimToken: run.claim_token } : {}),
      ...(nextRunAt ? { nextRunAt } : {}),
    });
  }

  async poll(): Promise<void> {
    const polledAt = this.now();
    this.lastPollAt = polledAt.toISOString();
    let due: BuddyAutomation[];
    try {
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
          if (run.claim_acquired === false) continue;
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
          void this.execute(automation, run, claimToken);
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

  async runNow(automationId: string): Promise<BuddyAutomationRun> {
    const automation = this.store.getAutomation(automationId);
    if (!automation) throw new Error(`automation not found: ${automationId}`);
    const scheduledFor = this.now().toISOString();
    const claimToken = randomUUID();
    const run = this.store.claimAutomationRun(automation.id, {
      scheduledFor,
      idempotencyKey: `${automation.id}:manual:${scheduledFor}`,
      claimToken,
      leaseSeconds: automation.policy.max_runtime_seconds + 60,
    });
    if (run.claim_acquired !== false && run.status === 'claimed' && !this.activeRuns.has(run.id)) {
      void this.execute(automation, run, claimToken);
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
    let conversation: BuddyAutomationConversation | null = null;
    try {
      conversation = await this.createConversation(automation, claimed);
      this.activeConversations.set(claimed.id, conversation);
      this.assertNotCancelled(claimed.id);
      let run = this.store.updateAutomationRun(claimed.id, {
        status: 'running',
        conversationId: conversation.conversationId,
        claimToken,
      });
      const policy = run.policy ?? automation.policy ?? LEGACY_SAFE_POLICY;
      const policyDeadline = Date.now() + policy.max_runtime_seconds * 1000;
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
      this.store.updateAutomationRun(run.id, {
        status: 'complete',
        outcome,
        claimToken,
        ...(nextRunAt ? { nextRunAt } : {}),
      });
      conversation.finish('complete');
    } catch (error) {
      if (error instanceof BuddyAutomationCancelledError || this.cancelledRuns.has(claimed.id)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[buddies] Automation ${automation.id} failed: ${message}`);
      const nextRunAt = this.nextRunAt(automation, claimed);
      this.store.updateAutomationRun(claimed.id, {
        status: 'failed',
        error: message,
        claimToken,
        ...(nextRunAt ? { nextRunAt } : {}),
      });
      conversation?.finish('failed');
      conversation?.stop();
    } finally {
      this.activeRuns.delete(claimed.id);
      this.activeConversations.delete(claimed.id);
      this.cancelledRuns.delete(claimed.id);
    }
  }

  private assertNotCancelled(runId: string): void {
    if (this.cancelledRuns.has(runId)) throw new BuddyAutomationCancelledError();
  }

  private nextRunAt(automation: BuddyAutomation, claimed: BuddyAutomationRun): string | undefined {
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
