/**
 * client/src/components/buddies/buddy-tabs.ts
 *
 * Employee sections are URL segments, not component state.
 *
 * Both shells used to hold the active tab in `useState`, so `/automations` was
 * never a location: Back left the buddy entirely instead of returning to the
 * previous tab, the tab could not be linked or bookmarked, and a reload always
 * dropped the user back on the default tab. The tab now lives at
 * `/buddies/:buddyId/:tab` and the tab strip is a set of real anchors.
 *
 * Pure and CSS-free so `client/src/mobile/*` may import it (gate G3).
 */
import type { EmployeeTab } from './types';

export const EMPLOYEE_TABS = ['work', 'conversations', 'memory', 'automations'] as const;

export const EMPLOYEE_TAB_LABELS: Record<EmployeeTab, string> = {
  work: 'Work',
  conversations: 'Conversations',
  memory: 'Memory',
  automations: 'Automations',
};

/** Mobile tab strip is horizontally cramped — shorter labels, same routes. */
export const EMPLOYEE_TAB_LABELS_SHORT: Record<EmployeeTab, string> = {
  work: 'Work',
  conversations: 'Chats',
  memory: 'Memory',
  automations: 'Autos',
};

/**
 * κ: URL segment → canonical tab. Returns null for an absent or unknown
 * segment so the caller redirects to a canonical URL, rather than silently
 * rendering some default under a URL that claims something else.
 */
export function parseEmployeeTab(segment: string | undefined): EmployeeTab | null {
  return EMPLOYEE_TABS.includes(segment as EmployeeTab) ? (segment as EmployeeTab) : null;
}

export function buddyTabPath(buddyId: string, tab: EmployeeTab): string {
  return `/buddies/${encodeURIComponent(buddyId)}/${tab}`;
}

export function conversationPath(conversationId: string): string {
  return `/chat/${encodeURIComponent(conversationId)}`;
}
