import { loadConversationDetails } from './actions';
import {
  chatConversationIdsAtom,
  conversationDetailsLoadedAtom,
  conversationLoadCompleteAtom,
} from './conversations';
import { jotaiStore } from './store';

// =============================================================================
// Prefetch — warm what the user is about to open, before they open it.
//
// `init` ships conversation SUMMARIES, so the first visit to each chat costs a
// round trip for its history. That is fine on desktop over loopback and very
// much not fine on a phone over the LAN, where it is the whole "why is opening
// a conversation slow" complaint. The data is small and already on the machine;
// the only reason to wait for it is that nobody asked early.
//
// Two rules keep this from making things worse:
//   - Idle only. Prefetch must never compete with the view actually on screen.
//   - Bounded concurrency. A burst of parallel GETs from a phone is slower
//     than a lazy load, not faster.
// =============================================================================

/**
 * How many of the most recent chats to warm. The chat inbox renders 50; the
 * ones a person actually flips between live at the top of that list.
 */
const PREFETCH_CONVERSATION_LIMIT = 12;
/** Parallel warm requests. Above this a phone's connection is the bottleneck. */
const PREFETCH_CONCURRENCY = 3;

type IdleScheduler = (callback: () => void) => void;

const scheduleIdle: IdleScheduler = (callback) => {
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (idle) idle(callback);
  else setTimeout(callback, 300);
};

async function drain(ids: string[]): Promise<void> {
  const queue = ids.slice();
  const workers = Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      // loadConversationDetails already dedupes in flight and is epoch-guarded
      // against reconnect, so a prefetch that collides with the user opening
      // the same conversation joins that request rather than racing it.
      await loadConversationDetails(id).catch(() => {
        // A warm request that fails is a non-event: the lazy load on open
        // reports the failure to the user, and this one has no UI to report to.
      });
    }
  });
  await Promise.all(workers);
}

/**
 * Warm history for the most recent chats. Safe to call repeatedly — already
 * hydrated conversations are skipped before any request is made.
 */
export function prefetchRecentConversationDetails(): void {
  scheduleIdle(() => {
    const loaded = jotaiStore.get(conversationDetailsLoadedAtom);
    const cold = jotaiStore
      .get(chatConversationIdsAtom)
      .slice(0, PREFETCH_CONVERSATION_LIMIT)
      .filter((id) => !loaded.has(id));
    if (cold.length > 0) void drain(cold);
  });
}

/**
 * Warm on every transition into "server finished loading conversations".
 *
 * Subscribing here rather than calling from the WS handler keeps
 * actions.ts -> prefetch.ts out of the import graph (prefetch already depends
 * on actions for the loader), and means reconnect re-warms for free.
 */
export function startConversationPrefetch(): () => void {
  let wasComplete = jotaiStore.get(conversationLoadCompleteAtom);
  if (wasComplete) prefetchRecentConversationDetails();
  return jotaiStore.sub(conversationLoadCompleteAtom, () => {
    const complete = jotaiStore.get(conversationLoadCompleteAtom);
    const became = complete && !wasComplete;
    wasComplete = complete;
    if (became) prefetchRecentConversationDetails();
  });
}
