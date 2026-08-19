import type { BuddyContext, ConversationKind } from '@unleashd/shared';
import { isBuddyKind } from '@unleashd/shared';
import type { BuddyOverview, BuddyOverviewEmployee, BuddyProject } from './types';

export function selectDirectoryEmployees(overview: BuddyOverview | null | undefined): BuddyOverviewEmployee[] {
  const employees = overview?.topLevel ?? [];
  if (!overview?.recentRuns?.length) return employees;
  // Most recent conversation started per buddy — map buddyId -> latest lastActiveAt
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
