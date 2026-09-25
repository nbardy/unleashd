import type { BuddyContext, ConversationKind } from '@unleashd/shared';
import { isBuddyKind } from '@unleashd/shared';
import type { BuddyOverview, BuddyOverviewEmployee, BuddyProject, WorkStatus } from './types';

/** Up to two initials for an avatar: "Pixel Bot", "pixel_bot" and "pixel-bot" all give "PB". */
export function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

export type TaskStatusView = {
  glyph: string;
  label: string;
  tone: 'idle' | 'active' | 'blocked' | 'done';
};

/** One table for every surface that names a Task status (chips, @ menu, work cards). */
export const TASK_STATUS: Readonly<Record<WorkStatus, TaskStatusView>> = {
  backlog: { glyph: '○', label: 'Backlog', tone: 'idle' },
  ready: { glyph: '○', label: 'Ready', tone: 'idle' },
  in_progress: { glyph: '◐', label: 'In progress', tone: 'active' },
  review: { glyph: '◑', label: 'In review', tone: 'active' },
  blocked: { glyph: '■', label: 'Blocked', tone: 'blocked' },
  done: { glyph: '✓', label: 'Done', tone: 'done' },
  cancelled: { glyph: '✕', label: 'Cancelled', tone: 'idle' },
};

function isWorkStatus(status: string): status is WorkStatus {
  return Object.hasOwn(TASK_STATUS, status);
}

/**
 * A channel Task's status arrives as an open string from the store. A status
 * this client does not know yet is shown verbatim (never relabelled as a
 * known one), with a neutral glyph.
 */
export function taskStatusView(status: string): TaskStatusView {
  return isWorkStatus(status) ? TASK_STATUS[status] : { glyph: '•', label: status, tone: 'idle' };
}

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
export function selectDirectoryEmployees(
  overview: BuddyOverview | null | undefined
): BuddyOverviewEmployee[] {
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

/**
 * Apply the directory search without changing the server-owned ordering.
 * Names, roles, statuses, workspaces, and report names are all useful ways
 * to find a Buddy from the directory page.
 */
export function filterDirectoryEmployees(
  employees: BuddyOverviewEmployee[],
  query: string
): BuddyOverviewEmployee[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return employees;
  return employees.filter((employee) => {
    const haystack = [
      employee.buddy.name,
      employee.buddy.role,
      employee.buddy.status,
      ...employee.workspaces.map((workspace) => workspace.name),
      ...employee.team.map((member) => `${member.name} ${member.role}`),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function buddyCardMetrics(employee: BuddyOverviewEmployee) {
  return {
    team: employee.team.filter((member) => member.status !== 'archived').length,
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
