import { ProviderCatalogSchema } from '@unleashd/shared';
import type { ProviderCatalog } from '@unleashd/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

type CatalogSnapshot = {
  catalog: ProviderCatalog | null;
  error: Error | null;
  promise: Promise<ProviderCatalog> | null;
};

const snapshot: CatalogSnapshot = {
  catalog: null,
  error: null,
  promise: null,
};
const listeners = new Set<() => void>();
let activeController: AbortController | null = null;
let snapshotVersion = 0;

function publish(): void {
  snapshotVersion += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshotVersion(): number {
  return snapshotVersion;
}

async function fetchCatalog(signal: AbortSignal): Promise<ProviderCatalog> {
  const response = await fetch('/api/provider-catalog', { signal });
  if (!response.ok) throw new Error(`Failed to load provider catalog (HTTP ${response.status})`);
  return ProviderCatalogSchema.parse(await response.json());
}

function loadCatalog(force = false): Promise<ProviderCatalog> {
  if (!force && snapshot.catalog) return Promise.resolve(snapshot.catalog);
  if (!force && snapshot.promise) return snapshot.promise;

  if (force) activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  const request = fetchCatalog(controller.signal)
    .then((catalog) => {
      // Revision is the cache identity. Equal revisions retain the stable object
      // reference so every picker does not re-render after a retry/refetch.
      if (snapshot.catalog?.revision !== catalog.revision) snapshot.catalog = catalog;
      snapshot.error = null;
      return snapshot.catalog;
    })
    .catch((error: unknown) => {
      if ((error as Error).name !== 'AbortError') snapshot.error = error as Error;
      throw error;
    })
    .finally(() => {
      if (snapshot.promise === request) snapshot.promise = null;
      if (activeController === controller) activeController = null;
      publish();
    });
  snapshot.promise = request;
  publish();
  return request;
}

export interface ProviderCatalogState {
  catalog: ProviderCatalog | null;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Shared catalog resource for every configuration surface. The module cache
 * deduplicates requests. A forced retry aborts the stale in-flight request.
 */
export function useProviderCatalog(): ProviderCatalogState {
  // React rechecks this version after subscribing. That closes the window where
  // another picker can finish the shared request between this component's
  // render and effect, otherwise the catalog sits cached until an unrelated
  // state change (such as closing the modal) happens to re-render it.
  useSyncExternalStore(subscribe, getSnapshotVersion, getSnapshotVersion);

  useEffect(() => {
    void loadCatalog(false).catch(() => {});
  }, []);

  const retry = useCallback(() => {
    void loadCatalog(true).catch(() => {});
  }, []);

  return {
    catalog: snapshot.catalog,
    isLoading: snapshot.promise !== null,
    error: snapshot.error,
    retry,
  };
}
