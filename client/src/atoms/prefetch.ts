import { loadConversationDetails } from './actions';
import { connectionAtom, listIndexAtom, loadCompleteOf, transcriptFamily } from './conversations';
import { type Resource, isResourceCached, loadResource } from './resources';
import { jotaiStore } from './store';

// Warm conversation details before they are opened: idle only, bounded concurrency. See
// docs/client-rationale.md#prefetch.

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

/** Run warm jobs PREFETCH_CONCURRENCY at a time; a failed warm is a non-event. */
async function drain(jobs: readonly (() => Promise<unknown>)[]): Promise<void> {
  const queue = jobs.slice();
  const workers = Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      // A warm request that fails has no UI to report to; the lazy load on
      // open reports the failure to the user.
      await job().catch(() => {});
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
    const cold = jotaiStore
      .get(listIndexAtom)
      .inbox.ids.slice(0, PREFETCH_CONVERSATION_LIMIT)
      .filter((id) => jotaiStore.get(transcriptFamily(id)).tag === 'absent');
    // loadConversationDetails already dedupes in flight and is epoch-guarded
    // against reconnect, so a prefetch that collides with the user opening
    // the same conversation joins that request rather than racing it.
    if (cold.length > 0) void drain(cold.map((id) => () => loadConversationDetails(id)));
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
  const loadComplete = () => loadCompleteOf(jotaiStore.get(connectionAtom).server);
  let wasComplete = loadComplete();
  if (wasComplete) prefetchRecentConversationDetails();
  return jotaiStore.sub(connectionAtom, () => {
    const complete = loadComplete();
    const became = complete && !wasComplete;
    wasComplete = complete;
    if (became) prefetchRecentConversationDetails();
  });
}

/**
 * Warm keyed resources the user is likely to open next — e.g. every channel
 * in the rail — so the first visit renders from cache like a revisit does.
 * Keys already cached are skipped (a mount revalidates them anyway), and
 * loadResource joins any in-flight request for the same key.
 */
export function warmResources(resources: readonly Resource<unknown>[]): void {
  scheduleIdle(() => {
    const cold = resources.filter((resource) => !isResourceCached(resource.key));
    if (cold.length > 0) void drain(cold.map((resource) => () => loadResource(resource)));
  });
}
