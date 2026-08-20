import type { BuddyContext, ConversationKind } from '@unleashd/shared';
import { isBuddyKind } from '@unleashd/shared';
import type { BuddyOverview, BuddyOverviewEmployee, BuddyProject } from './types';

/**
 * Directory cards, most recently active buddy first.
 *
 * Two properties of `overview.recentRuns` shape the result and are easy to
 * misread as bugs:
 *
 * 1. `recentRuns` is WINDOWED. The store drops any conversation whose
 *    `last_active_at` is older than `recentSince`, which defaults to 7 days
 *    (@nbardy/buddies store.js). Every buddy quiet for longer than the window
 *    scores 0 and lands in the tail — so this does not merely float recent
 *    buddies to the top, it replaces the server's hierarchy ordering outright.
 *    The name tiebreak below is what keeps that tail stable instead of letting
 *    it shuffle on every poll. Widen it by passing `?recentSince=` to
 *    `/api/buddies/overview` (server/src/buddies/routes.ts) if the tail matters.
 *
 * 2. `lastActiveAt` is last ACTIVITY, not conversation start. It is the only
 *    per-buddy timestamp this payload exposes, so a long-running old thread
 *    outranks a freshly started one. Ordering by start would need `created_at`
 *    plumbed through the overview payload.
 *
 * Sorts a copy: `overview.topLevel` is shared with the sidebar and mobile.
 */
export function selectDirectoryEmployees(overview: BuddyOverview | null | undefined): BuddyOverviewEmployee[] {
  const employees = overview?.topLevel ?? [];
  if (!overview?.recentRuns?.length) return employees;
  const latestByBuddy = new Map<string, number>();
  for (const run of overview.recentRuns) {
    const t = new Date(run.lastActiveAt).getTime();
    if (!Number.isFinite(t)) continue;
    const existing = latestByBuddy.get(run.buddyId);
    if (existing === undefined || t > existing) latestByBuddy.set(run.buddyId, t);
  }
  if (latestByBuddy.size === 0) return employees;
  return [...employees].sort((a, b) => {
    const aTime = latestByBuddy.get(a.buddy.id) ?? 0;
    const bTime = latestByBuddy.get(b.buddy.id) ?? 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.buddy.name.localeCompare(b.buddy.name);
  });
}

export function buddyCardMetrics(employee: BuddyOverviewEmployee) {
  return {
    team: employee.team.length,
    open: employee.currentWork.open,
    active: employee.currentWork.active,
    blocked: employee.currentWork.blocked,
  };
}

export function effectiveSwarmDebugPrefix(
  buddyContext: BuddyContext | null | undefined,
  swarmDebugPrefix: string | null | undefined,
  kind?: ConversationKind | null
): string | null {
  // Kind is canonical when present; legacy buddyContext fallback keeps old payloads working.
  if (kind && isBuddyKind(kind)) return null;
  return buddyContext ? null : (swarmDebugPrefix ?? null);
}

export function buddyProjectTodoProgress(project: Pick<BuddyProject, 'todos'>) {
  const relevantTodos = project.todos.filter((todo) => todo.status !== 'cancelled');
  return {
    done: relevantTodos.filter((todo) => todo.status === 'done').length,
    total: relevantTodos.length,
  };
}
