import { useSyncExternalStore } from 'react';

// One 30 s clock for every "3m ago" label. Eight components each ran their
// own setInterval and re-rendered their whole tree to refresh the labels;
// memoized rows then never refreshed at all, because the parent's tick did not
// reach them. Now the component that prints the label subscribes, and every
// label on screen advances on the same beat. The interval runs only while
// something is subscribed.

const TICK_MS = 30_000;

let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(() => {
      tick += 1;
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const readTick = () => tick;

/**
 * Re-render every 30 s. Call it in the component that renders a relative
 * time (`formatTimeAgo`), not in a parent: a memoized child does not re-render
 * with its parent. Returns the tick count, for a memo that must depend on it.
 */
export function useTimeTick(): number {
  return useSyncExternalStore(subscribe, readTick, readTick);
}
