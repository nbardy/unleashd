import type { Express } from 'express';

// =============================================================================
// Buddy change feed — "the Buddy database changed", as one signal.
//
// The client keeps every Buddy view in a keyed cache and refreshes it from a
// single entry point (`invalidateBuddyResources`). Until this feed existed it
// only learned about `buddy_archived`; every other write — a project updated
// from a Buddy's MCP tool, a note remembered by an automation, a profile saved
// from Settings — sat unseen until the panel's next poll tick.
//
// Writes reach the store by three doors, and each is hooked here rather than
// at the store (which lives in the vendored @nbardy/buddies package):
//   1. BuddyOperationsService.execute — Buddy MCP tools, the scheduler,
//      delegations, and the routes that delegate to it.
//   2. executeOwnerResource — owner MCP tools (new_project, update_profile …).
//   3. Direct owner routes under /api/buddies — one Express middleware.
//
// server.ts subscribes once and broadcasts a debounced `buddies_changed`.
// =============================================================================

const listeners = new Set<() => void>();

export function notifyBuddiesChanged(): void {
  for (const listener of listeners) listener();
}

export function onBuddiesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads must not announce themselves: a Buddy polling its inbox would
 * otherwise make every open Buddy panel refetch. Operation names are a closed
 * union whose read members all carry a `get_` / `list_` prefix (plus `recall`).
 */
export function isReadOnlyBuddyOperation(name: string): boolean {
  return (
    /^(buddy\.)?(get_|list_)/.test(name) || name === 'buddy.recall' || name === 'buddy.search_posts'
  );
}

/**
 * Door 3. Registered BEFORE the Buddy routes so it can attach a `finish`
 * listener and hand off; a successful non-GET under /api/buddies is a write.
 */
export function registerBuddyMutationFeed(app: Express): void {
  app.use('/api/buddies', (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.once('finish', () => {
        if (response.statusCode < 300) notifyBuddiesChanged();
      });
    }
    next();
  });
}
