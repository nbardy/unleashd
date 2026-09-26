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
 * Last activity of a conversation row: its last message, or its creation when
 * empty. The server derives `activityAt` once (epoch ms), so list views never
 * parse dates per comparison (that cost ~50ms per sort of 1,100 rows before
 * 2026-09-25).
 */
export function getConversationLastActivity(row: { activityAt: number }): Date {
  return new Date(row.activityAt);
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
