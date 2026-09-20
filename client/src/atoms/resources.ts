import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { jotaiStore } from './store';

// =============================================================================
// Keyed resource cache — the one local store behind every read-only HTTP view.
//
// Before this module every `usePolledFetch` call site held its result in
// component `useState`, so a route change unmounted the data and the next
// mount refetched from zero behind a spinner. On mobile that is the whole
// "every page I open makes me wait" experience: the bytes were already on the
// device a moment ago and got thrown away by React, not by the server.
//
// State lives here instead, keyed by request. Three properties follow:
//
//   1. Remount is free. A cached key renders immediately and revalidates in
//      the background (stale-while-revalidate), so navigation never blanks.
//   2. Cross-key races are unrepresentable. A late response for buddy A
//      writes to buddy A's entry; a component now showing buddy B reads B's
//      entry and cannot see it. Call sites used to hand-roll this check
//      ("is this response for what I'm displaying?") three different ways.
//   3. Push invalidation has exactly one entry point. `invalidateResources`
//      re-runs the loaders for live keys; nothing else has to be taught.
// =============================================================================

/**
 * Canonical request: a stable cache key plus a loader.
 *
 * The key is the identity of the DATA, not of the React tree asking for it.
 * Two components requesting the same key share one entry and one in-flight
 * request.
 */
export interface Resource<T> {
  readonly key: string;
  readonly load: (signal: AbortSignal) => Promise<T>;
}

/**
 * What the cache knows about one key.
 *
 * `stale` is the reason this is a sum rather than `{data, loading, error}`:
 * a failed refresh over a value we already hold is a distinct state from a
 * failure with nothing to show, and collapsing them is what forced
 * `useSwarmProjects` to keep its own `prevProjectsRef` shadow copy.
 */
export type ResourceEntry<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; value: T; fetchedAt: number }
  | { kind: 'failed'; error: Error }
  | { kind: 'stale'; value: T; fetchedAt: number; error: Error };

/** Stable references — a fresh object here would re-render every subscriber. */
export const IDLE_ENTRY: ResourceEntry<never> = Object.freeze({ kind: 'idle' });
const LOADING_ENTRY: ResourceEntry<never> = Object.freeze({ kind: 'loading' });

/**
 * Unmounted keys retained for instant back-navigation. Mounted keys are never
 * evicted, so this bounds a long-lived PWA session without ever pulling data
 * out from under a visible view.
 */
const RETAINED_KEY_LIMIT = 300;

const resourceCacheAtom = atom(new Map<string, ResourceEntry<unknown>>());

/**
 * Subscribe to one key. Per-key atoms mean a Buddy panel re-renders when its
 * own request settles and never when an unrelated one does.
 */
export const resourceAtomFamily = atomFamily((key: string) =>
  atom((get): ResourceEntry<unknown> => get(resourceCacheAtom).get(key) ?? LOADING_ENTRY)
);

/** Loaders by key, so invalidation can re-run a request it never saw created. */
const loaders = new Map<string, Resource<unknown>>();
/** One request per key; a second caller joins the first rather than racing it. */
const inFlight = new Map<string, { promise: Promise<void>; controller: AbortController }>();
/** Mounted-subscriber counts — eviction and push invalidation both consult this. */
const mounted = new Map<string, number>();

function writeEntry(key: string, entry: ResourceEntry<unknown>): void {
  const cache = jotaiStore.get(resourceCacheAtom);
  const next = new Map(cache);
  // Delete-then-set moves the key to the Map's most-recent end, which is what
  // makes plain insertion order an LRU.
  next.delete(key);
  next.set(key, entry);
  evictRetained(next);
  jotaiStore.set(resourceCacheAtom, next);
}

function evictRetained(cache: Map<string, ResourceEntry<unknown>>): void {
  if (cache.size <= RETAINED_KEY_LIMIT) return;
  for (const key of cache.keys()) {
    if (cache.size <= RETAINED_KEY_LIMIT) return;
    if (mounted.get(key)) continue;
    if (inFlight.has(key)) continue;
    cache.delete(key);
    loaders.delete(key);
    // jotai-family memoizes per-key atoms forever; drop ours with the entry.
    resourceAtomFamily.remove(key);
  }
}

/**
 * A rejected load keeps any value we already had. Provenance is in the
 * variant (`stale` carries both), never a silent fall back to the old value.
 */
function failureEntry(
  previous: ResourceEntry<unknown> | undefined,
  error: Error
): ResourceEntry<unknown> {
  if (previous?.kind === 'ready' || previous?.kind === 'stale') {
    return { kind: 'stale', value: previous.value, fetchedAt: previous.fetchedAt, error };
  }
  return { kind: 'failed', error };
}

function normalizeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Fetch `resource` into the cache. Concurrent calls for the same key share one
 * request. Resolves when the entry has settled; the value is read from the
 * store, not returned, so every consumer sees the same snapshot.
 */
export function loadResource<T>(resource: Resource<T>): Promise<void> {
  loaders.set(resource.key, resource as Resource<unknown>);

  const existing = inFlight.get(resource.key);
  if (existing) return existing.promise;

  const current = jotaiStore.get(resourceCacheAtom).get(resource.key);
  // A first load shows `loading`; a refresh keeps the cached value on screen.
  if (!current) writeEntry(resource.key, LOADING_ENTRY);

  const controller = new AbortController();
  const promise = resource
    .load(controller.signal)
    .then((value) => {
      if (controller.signal.aborted) return;
      writeEntry(resource.key, { kind: 'ready', value, fetchedAt: Date.now() });
    })
    .catch((cause) => {
      const error = normalizeError(cause);
      if (controller.signal.aborted || error.name === 'AbortError') return;
      writeEntry(
        resource.key,
        failureEntry(jotaiStore.get(resourceCacheAtom).get(resource.key), error)
      );
    })
    .finally(() => {
      if (inFlight.get(resource.key)?.promise === promise) inFlight.delete(resource.key);
    });

  inFlight.set(resource.key, { promise, controller });
  return promise;
}

/**
 * Re-run the loader for every MOUNTED key the predicate selects.
 *
 * This is the hook for "the database changed" pushes: a server event maps to
 * one call here instead of to twenty call sites. Entries are refreshed in
 * place, so a subscribed view updates without flashing a spinner.
 *
 * Unmounted keys are deliberately left alone. A remount always revalidates
 * (stale-while-revalidate), so refreshing them here buys nothing — and a
 * burst of events against a few hundred retained Buddy keys, three requests
 * each, is exactly the request storm a phone cannot afford.
 */
export function invalidateResources(matches: (key: string) => boolean): void {
  for (const key of mounted.keys()) {
    const resource = loaders.get(key);
    if (resource && matches(key)) void loadResource(resource);
  }
}

/**
 * "The Buddy database changed" — refresh every cached Buddy view in place.
 *
 * One call site instead of twenty: subscribed panels update without a spinner,
 * and cached-but-unmounted keys stay correct for the next visit. Buddy keys are
 * either the request URL (`/api/buddies/...`) or an explicit `buddy-` prefix
 * for the multi-request loads that have no single URL.
 */
export const invalidateBuddyResources = (): void =>
  invalidateResources((key) => key.startsWith('/api/buddies') || key.startsWith('buddy-'));

/**
 * Drop cached data outright. For sign-out / hard reset only: unlike
 * invalidation this leaves subscribers with no value to show.
 */
export function clearResourceCache(): void {
  for (const { controller } of inFlight.values()) controller.abort();
  inFlight.clear();
  for (const key of jotaiStore.get(resourceCacheAtom).keys()) resourceAtomFamily.remove(key);
  loaders.clear();
  jotaiStore.set(resourceCacheAtom, new Map());
}

/** Called by usePolledFetch only; keeps mounted keys out of the eviction sweep. */
export function retainResourceKey(key: string): () => void {
  mounted.set(key, (mounted.get(key) ?? 0) + 1);
  return () => {
    const next = (mounted.get(key) ?? 1) - 1;
    if (next <= 0) mounted.delete(key);
    else mounted.set(key, next);
  };
}

/** Test seam: inspect cache size without exporting the atom itself. */
export const resourceCacheSize = (): number => jotaiStore.get(resourceCacheAtom).size;
