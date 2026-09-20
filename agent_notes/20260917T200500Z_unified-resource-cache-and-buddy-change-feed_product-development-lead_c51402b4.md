# Unified client resource cache + Buddy change feed — closeout

Owner thread `ca301a5f-817a-4083-a455-b5008b84dc74`, 2026-09-16 → 2026-09-17.
Branch `refactor/reduce-sprawl-2026-09-06`, uncommitted at time of writing.

## The complaint

Mobile navigation felt slow: every page visit waited on a round trip, and
desktop appeared to "prefetch" while mobile did not. Owner asked for one local
store shared by both shells, updated by push when the database changes, and
read (not fetched) as you navigate — minimal, modular, no per-case branching.

## What was actually wrong

1. `usePolledFetch` held results in component `useState`. Route change →
   unmount → data gone → remount refetched behind a spinner. 20 call sites.
2. Conversation history was lazy: `init` ships summaries, so the first open of
   each chat was a round trip. Cached after that, cold again on reload.
3. The branching the owner objected to was a symptom of (1): with un-keyed
   state, `useBuddyDetailData`, `BuddyTeamConfiguration` and
   `BuddyTaskComments` each hand-rolled "is this response for what I'm
   showing?" and `useSwarmProjects` / `useSwarmRuntimeSnapshots` each kept a
   shadow copy.
4. `useBuddyDetailData` had ZERO consumers. Desktop `BuddiesDashboard` and
   mobile `BuddyDetailMobile` each carried a private copy of the three-request
   detail assembly, plus ~80 identical lines of derived memos and actions.
5. `/api/buddies/overview` was fetched four different ways; `useProviderCatalog`
   was a 101-line hand-rolled `useSyncExternalStore` cache;
   `SwarmDetailMobile` used its own runtime URL + shape-tolerance shim.
6. The only Buddy push event was `buddy_archived`.

## What shipped

- `client/src/atoms/resources.ts` — keyed cache. `Resource<T> = {key, load}`;
  entry is a sum `idle | loading | ready | failed | stale`. Remount is free
  (stale-while-revalidate); one request per key; cross-key races are
  unrepresentable; LRU-bounded with mounted keys exempt; `invalidateResources`
  refreshes MOUNTED keys only.
- `usePolledFetch` keeps its call-site API but owns no data. A bare fetcher is
  rejected by the type; string URLs are canonicalised at one κ; the effect keys
  on the resource KEY so unstable inline sources no longer refetch every render.
  `refetch` returns a Promise (shells await it before clearing `busy`); a
  disabled hook can never refresh.
- `client/src/atoms/prefetch.ts` — warms the 12 most recent chats once load
  completes; idle-scheduled, concurrency 3, joins `loadConversationDetails`.
- `client/src/hooks/useBuddyData.ts` — `useBuddyOverview`, `useBuddyDetailData`,
  `useBuddyAutomations`, `useBuddyPage`. Both shells consume it. Desktop
  755→568 lines, mobile 494→315.
- Collapsed onto the cache: `useProviderCatalog` (101→30), `useSwarmProjects`
  (45→28, now shares the key with `SwarmsMobile`), `useSwarmRuntimeSnapshots`
  (SwarmDetailMobile now uses the desktop hook), `BuddyConvoHeader`,
  `SearchPalette`, `FilePreview` (all bare fetch-in-effect before).
- Sidebar's parallel overview type is now `Pick`s over the canonical types.
- **Server change feed** `server/src/buddies/change-feed.ts`: hooks the three
  doors writes come through (`BuddyOperationsService.execute` at outermost
  depth, `executeOwnerResource`, one Express middleware on non-GET
  `/api/buddies`), `server.ts` broadcasts one debounced `buddies_changed` per
  250ms, client maps it to `invalidateBuddyResources()`. Reads (`get_*`,
  `list_*`, `recall`) never announce.

## Bugs fixed along the way

- Invalidation amplification: re-running unmounted keys on every event would
  have turned a burst of automation runs into a request storm on a phone.
- Disabled `usePolledFetch` still refreshed on WS reconnect / `refetch()`.
- Pre-existing: `buddy-conversation-links.test.tsx` passed props
  `ConversationsTab` no longer accepts (renamed by other uncommitted work);
  `client/test/` is not covered by `tsc -b`, so it typechecked clean and failed
  at runtime as `flatMap of undefined`. Recorded in AGENTS.md.
- Dead `WorkTab.selectedWorkspaceId` prop (destructured to `_unused`).

## Evidence

- `client/test/resource-cache.test.ts` — 7 tests, each guarding a deleted
  workaround (key isolation ↔ `RoutedBuddyData`; `stale` ↔ `prevProjectsRef`;
  mounted-only invalidation; mounted-key eviction exemption).
- `server/test/buddy-change-feed.test.ts` — real `BuddiesStore` in a tmp dir:
  `get_current_work` is silent, `new_project` announces once; real Express +
  HTTP: GET and 4xx silent, 2xx POST announces.
- Client: `tsc -b` clean, biome clean on touched files, 6/6 invariant gates,
  107/107 tests, `vite build` clean. Server: `tsc --noEmit` clean; 25/25 in
  buddy-routes / memory-capture / team-permissions / resource-consistency /
  soul-conflict (these exercise the wrapped `execute` including automation
  authority re-entry).

## Not verified live, and why

The dev server (PID 77985, started 12:39) predates the server edits and is the
process this owner conversation runs through, so it was NOT restarted to watch
`buddies_changed` arrive. The feed is proven at the module and HTTP boundary;
first live observation happens on the next server start. Client-side behaviour
was not screenshot-verified either (see memory `unleashd-verify-ui-in-running-app`).

## Deliberately left

- `useTurnDiagnostics` — adaptive backoff keyed on the last response; a
  different animal from fixed-interval polling.
- Search-result fetches (query-keyed, debounced) — cacheable, little value.
- `fetchJson` vs `buddyApi` — different error semantics, not a duplicate.
- Persistence across a hard browser reload — all cache writes go through one
  function, so an IndexedDB sink is a localised add if navigation-level
  caching turns out not to be enough.

## Lessons recorded

- AGENTS.md: `client/test/` is not typechecked; run `pnpm test:client` after
  renaming any prop a test constructs.
- Memory `unleashd-never-git-stash-here`: a `stash push` on an untracked path
  creates no stash and the follow-up `pop` targets a foreign one.
