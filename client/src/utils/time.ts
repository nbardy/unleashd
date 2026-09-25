/**
 * Format a Date as a relative time string ("just now", "3m ago", "2h ago", "5d ago").
 * Pure function — no hooks, no side effects.
 */
export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Returns minutes elapsed since the given date.
 * Used to drive the exponential color-fade on sidebar time-ago labels.
 */
export function getMinutesElapsed(date: Date): number {
  return (Date.now() - date.getTime()) / 60_000;
}

/**
 * Get the timestamp of the last message in a conversation's messages array.
 * Returns undefined if there are no messages or no timestamp.
 */
export function getLastMessageTime(messages: { timestamp?: Date | string }[]): Date | undefined {
  if (messages.length === 0) return undefined;
  const last = messages[messages.length - 1];
  return last.timestamp ? new Date(last.timestamp) : undefined;
}

/**
 * Return the last activity timestamp for a conversation.
 *
 * For active conversations with messages, this is the timestamp of the last
 * message. For brand-new stubs (no messages yet), fall back to `createdAt` so
 * they still participate in recency sorting/grouping and age labels.
 */
export function getConversationLastActivity(conversation: {
  messages: { timestamp?: Date | string }[];
  createdAt: Date | string;
}): Date {
  return getLastMessageTime(conversation.messages) ?? new Date(conversation.createdAt);
}

type ActivitySource = Parameters<typeof getConversationLastActivity>[0];
const activityMsCache = new WeakMap<ActivitySource, number>();

/**
 * `getConversationLastActivity(c).getTime()`, computed once per conversation
 * SNAPSHOT. Sound because conversation objects in the store are immutable immer
 * snapshots: any change (new message, status, queue) yields a new object, so a
 * stale entry is unreachable and the WeakMap lets it go.
 *
 * Why it exists: recency sorts called `getConversationLastActivity` inside the
 * comparator, i.e. two `new Date(iso)` parses per comparison — ~22k parses and
 * ~50ms per sort of 1,100 conversations, re-run on every message/status/queue
 * event (measured 2026-09-25). Sort with `sortByActivityDesc` instead.
 */
export function conversationActivityMs(conversation: ActivitySource): number {
  const cached = activityMsCache.get(conversation);
  if (cached !== undefined) return cached;
  const ms = getConversationLastActivity(conversation).getTime();
  activityMsCache.set(conversation, ms);
  return ms;
}

/** Newest-first by last activity; one key lookup per item (decorate-sort-undecorate). */
export function sortByActivityDesc<T extends ActivitySource>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ item, ms: conversationActivityMs(item) }))
    .sort((a, b) => b.ms - a.ms)
    .map(({ item }) => item);
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * Examples: "30s", "5m", "2h 30m", "1d 4h"
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}
