import type { Run } from '@unleashd/buddies-core';
import type { BuddiesCore } from './core';

/**
 * Schedules only enqueue: `dueSchedules` turns every due slot into one `schedule` run (missed
 * slots collapse into one) and advances the schedule, in one indexed transaction. The runner
 * executes those runs like any other. This replaces scheduler.ts: its cron math (now the crate's,
 * with IANA timezones), its second, legacy automation executor with its own leases, and the 1 s
 * tick that polled both.
 */
export async function enqueueDueSchedules(
  core: BuddiesCore,
  now: Date = new Date()
): Promise<Run[]> {
  return core.dueSchedules(now.toISOString());
}
