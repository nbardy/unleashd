# Client state patterns

The state atoms and derived conversation views live in
[atoms/conversations.ts](../client/src/atoms/conversations.ts). Components call
exported actions; all `jotaiStore.set` calls stay inside `client/src/atoms/`.

## Subscriptions

| UI needs | Subscribe to |
|---|---|
| One server conversation | `conversationAtomFamily(id)` |
| A sorted or filtered collection | A derived view in `atoms/conversations.ts` |
| Conversation IDs | `allConversationIdsAtom` or a derived ID list such as `chatConversationIdsAtom` |
| Chat response blocks, including live text | `chatMessageGroupsAtomFamily(id)` |
| Live text for one conversation | `streamingAtomFamily(id)` |
| Pending creation or config command | `pendingCreationAtomFamily(id)` or `pendingConfigCommandAtomFamily(id)` |
| Whether full history is hydrated | `conversationDetailsLoadedAtomFamily(id)` |
| Persisted UI preference | A per-field atom from `atoms/ui.ts` |
| Any read-only server view (Buddy panels, swarm runs, catalog, git log) | `usePolledFetch` over the keyed cache in `atoms/resources.ts` |
| Buddy directory / detail / automations | `useBuddyOverview`, `useBuddyDetailData`, `useBuddyAutomations` in `hooks/useBuddyData.ts` — both shells |
| A Buddy page's derived model + `talk` / open-project actions | `useBuddyPage` in `hooks/useBuddyData.ts` — the shells only render |

Never call `useAtomValue(conversationsAtom)` in a component. For lists, subscribe
the parent to the appropriate derived ID view and have each row subscribe to its
own conversation. Structural sharing preserves unaffected conversation objects;
`React.memo` can then skip rows whose props and selected conversation are unchanged.

Keep sorting, filtering, and grouping in derived atoms, not component `useMemo`:

```ts
// client/src/atoms/conversations.ts
export const runningConversationIdsAtom = atom((get) =>
  get(allConversationsAtom)
    .filter((conversation) => conversation.isRunning)
    .map((conversation) => conversation.id)
);
```

Collection atoms recompute on every message, status and queue event, over every
conversation (1,100+ in real use), so their per-item work must be cheap:

- Sort by recency with `sortByActivityDesc` / `conversationActivityMs` from
  `utils/time.ts`, never `getConversationLastActivity` inside a comparator. That
  parsed two dates per comparison (~22k per sort, measured 2026-09-25); the
  helper computes one key per conversation snapshot and caches it in a WeakMap.
- The kind accessors (`getConversationKind`, `isBuddyConversation`,
  `getBuddyContext`) read `conversation.kind` directly; the wire schema already
  validated it. Do not re-add a zod parse on that read path
  (`client/test/buddy-builder-kind.test.ts` trips if you do).
- A component that only needs "are there any conversations" subscribes to
  `hasConversationsAtom`, not `allConversationsAtom` — the array is a new
  reference on every event and re-renders the subscriber each time.

## Mutations and state ownership

These are separate atoms, not fields of one combined state object:

- `conversationsAtom`: `Map<string, Conversation>` of server snapshots.
- `streamingContentAtom`: `Map<string, string>` of transient live text.
- `pendingCreationsAtom`: client-owned creation commands, separate from conversations.
- `pendingConfigCommandsAtom`: pending revision-checked config writes and errors.
- `restartRecoveryAtomFamily`: per-conversation local mirror of the accepted
  in-flight message and server queue, retained only for optional restart replay.

Use [mutate](../client/src/atoms/mutate.ts) for partial collection updates inside
atom modules; scalar or complete replacements can use `jotaiStore.set` there.
Add a separate atom for new high-frequency state and document its clearing or
commit boundary. Do not put it into each authoritative conversation entry.

Restart recovery is deliberately client-owned. Non-empty `queue_updated`
snapshots are mirrored under `restartRecovery:{conversationId}` in localStorage;
an empty queue does not erase them because that is also what a replacement
server reports after losing its runtime queue. A successful `message_complete`,
an observed non-restart terminal attempt, explicit dismissal, or conversation
deletion clears the mirror. The UI only offers replay when diagnostics prove a
newer attempt ended with `server_restart`, then resubmits the former current
message before its queued successors through acknowledged queue commands.

[actions.ts](../client/src/atoms/actions.ts) owns the single WebSocket message
spine. Creation and config actions live in
[pending-creations.ts](../client/src/atoms/pending-creations.ts) and
[config-actions.ts](../client/src/atoms/config-actions.ts). Pending commands do
not fabricate `Conversation` stubs or overwrite authoritative config optimistically.
See [WS contract notes](ws-contract-surprises.md) for replay and reconciliation.

## Streaming and hydration boundaries

`chunk` events accumulate in a buffer outside React state. The animation-frame
flush writes only `streamingContentAtom`; the chat renders that alongside the
conversation snapshot. Never append individual chunks to `conversation.messages`.

`message_complete` flushes buffered chunks synchronously. When `status` says
streaming ended, its handler flushes pending chunks and clears transient text.
Committed message content comes from authoritative `conversations_updated`
snapshots, not by copying the transient buffer into the conversation on status.

Summary snapshots contain previews rather than complete transcripts. Detail
loading uses `loadConversationDetails` and tracks hydrated IDs in
`conversationDetailsLoadedAtom`. Preserve loaded messages when a summary batch
arrives; the existing detail-loader guards stale requests and reconnect epochs.

## Server resources: one keyed local store

Conversations arrive over the WebSocket and live in `conversationsAtom`. Every
OTHER read-only server view — Buddy panels, swarm runs, git log, usage — goes
through the keyed cache in
[atoms/resources.ts](../client/src/atoms/resources.ts), read via
`usePolledFetch`. Desktop and mobile share it; there is no second mechanism.

A `Resource<T>` is `{ key, load(signal) }`. The key is the identity of the
DATA, not of the component asking:

```ts
usePolledFetch<Overview>('/api/buddies/overview', 30_000);        // URL is the key
usePolledFetch(resource(`buddy-detail:${buddyId}`, load), 0);     // multi-request load
```

Why this and not component `useState`:

- **Remount is free.** A cached key renders immediately and revalidates behind
  the scenes. `loading` is the state only when there is genuinely nothing to
  show, so navigation never blanks — the mobile "every page makes me wait" symptom.
- **One request per key.** Two panels on the same key share one fetch.
- **Cross-key races are unrepresentable.** A late response for buddy A lands on
  buddy A's key; a component showing buddy B reads B's entry and cannot see it.
  This replaced three hand-rolled "is this response mine?" guards
  (`RoutedBuddyData` in `useBuddyDetailData`, `live.data.key === result.key` in
  `BuddyTeamConfiguration`, `data.cursor === cursor` in `BuddyTaskComments`).
  Do not add a fourth — put the varying input in the key instead.
- **The effect keys on the KEY, not the source object**, so an unstable inline
  resource no longer refetches every render.

The cache entry is a sum, not `{data, loading, error}`, and `usePolledFetch`
hands the same sum to the view (`PolledState` in
[hooks/usePolledFetch.ts](../client/src/hooks/usePolledFetch.ts)), with the
value as `data` on every variant:

| Variant | Meaning | The view shows |
|---|---|---|
| `idle` | no resource requested (disabled / null source) | nothing |
| `loading` | first load, nothing cached | its loading state |
| `ready` | value in hand | `data` |
| `failed` | failed with nothing cached | its failure, in place of the page |
| `stale` | failed refresh over a value we still hold | `data`, and the failure as a notice |

`error` exists only on `failed` and `stale`, so reading it means naming which
one. Render the page from `data`; replace it only on `failed`. Until 2026-09-25
the hook flattened this to `{data, loading, error}`, one `error` field for both
failures, and views that tested `error` before `data` threw away pages they
held: on 2026-09-24 one "Failed to fetch" on a slow server replaced a loaded
Buddy page on the phone with "Could not load buddy", and the desktop directory
(one failed Sidebar poll of the shared overview key), team settings, swarm
reviews and the mobile Automations tab blanked the same way. A stale page says
so quietly (`MobileRefreshNotice` on mobile, a "Could not refresh" line under
the heading on the desktop Buddy page). Guarded by
`client/test/failed-refresh-keeps-page.test.tsx`.

`stale` is also why `useSwarmProjects` no longer keeps a `prevProjectsRef`
shadow copy: retaining the last-known value across a failed refresh is the
cache's job, and the error is still reported rather than silently swallowed.

A successful refresh is **structurally shared** with the value it replaces
(`settledEntry` in resources.ts): an equal answer writes nothing, so no
subscriber re-renders, and a changed answer keeps the identity of every part
that did not change. Array elements pair by `id` when they have one, because a
"latest 50" window shifts every index on each new post. Until 2026-09-25 every
poll handed React a fresh tree, and an open channel re-rendered all 50 rows
and re-parsed their markdown every few seconds with nothing new. Keep derived
values keyed on `data` identity (`useMemo(..., [feed.data])`, `memo` on heavy
leaves such as `ChannelMarkdown`) so the sharing reaches the DOM.

A channel feed pages back by keyset (`useChannelFeed` in
components/buddies/channel-data.ts). It reads the newest page until the reader
nears the top, then reads `from=<oldest loaded post>` down to the newest, so
the window grows at the bottom and never slides. Re-reading the newest page
after paging back would push the oldest post out above the reader on every new
post and leave a gap between the pages. The switch to the new key is seeded
(`seedResource`) with the posts already held plus the fetched page, so it
renders without the loader and revalidates behind it. Until 2026-09-25 the view
read the newest 50 posts and nothing older was reachable.

Every Buddy read model is declared once in
[hooks/useBuddyData.ts](../client/src/hooks/useBuddyData.ts) and consumed by
both shells. `BuddiesDashboard` (desktop) and `BuddyDetailMobile` used to each
carry a private copy of the three-request detail assembly plus generation
counters; the Sidebar, SearchPalette, BuddiesMobile and BuddiesDashboard each
fetched `/api/buddies/overview` their own way. Now they share one key each.
The same applies to `useProviderCatalog` (was a hand-rolled
`useSyncExternalStore` cache) and `useSwarmRuntimeSnapshots` (SwarmDetailMobile
now uses the desktop hook rather than its own URL). If you add a Buddy read,
add it there — not as a `fetch` in a component.

`useBuddyPage` goes one step further: the ~80 lines of memos, `talk` and
`openProjectConversation` that both shells derived from the detail bundle live
there once. The shell passes its own `openConversation` (mobile threads route
state through it) and renders what comes back.

Push invalidation (`invalidateResources`) refreshes MOUNTED keys only. A remount
always revalidates, so touching retained-but-unmounted keys would only turn a
burst of WS events into a request storm against every cached Buddy.

Keys are retained up to a bound (LRU, mounted keys exempt) so a long-lived PWA
session cannot grow without limit, and the per-key atom is removed on eviction.

### Prefetching and push invalidation

`init` ships conversation SUMMARIES, so the first open of each chat costs a
round trip. [atoms/prefetch.ts](../client/src/atoms/prefetch.ts) warms the most
recent chats once the server reports its load complete — idle-scheduled and
concurrency-bounded, because a burst of parallel GETs from a phone is slower
than a lazy load. It reuses `loadConversationDetails`, so a warm request that
collides with the user opening that chat joins it rather than racing it.

`invalidateResources(predicate)` re-runs the loaders for matching MOUNTED keys
in place, so subscribed panels update with no spinner. `invalidateBuddyResources()`
is the named predicate for Buddy data. It fires from the WS spine on
`buddies_changed` — the server's debounced change feed
(`server/src/buddies/change-feed.ts`), which announces every Buddy-store write
whether it came from an owner route, an owner MCP tool, a Buddy's MCP tool or
the scheduler — and on create/delete of a Buddy-context conversation, which the
client already knows about. `channel_changed {listId}` is the precise one:
`invalidateChannelResources` refreshes only keys under
`/api/buddies/lists/<listId>/` (posts, threads, who is replying) plus the
channel list, whose rows count and sort by every post, and any mounted
Task-filtered feed (`/api/buddies/posts?…`, cross-channel, so `listId` cannot
select it), so channel views poll
just as a 30 s backstop (`CHANNEL_BACKSTOP_MS`). An invalidation
that lands while that key's load is in flight marks it to load once more when
it settles, because the running request may have read the server before the
change. **Add new push refreshes here, not at call sites** — that is the whole
reason the cache is keyed centrally.

## Assistant response model

`Message` records are provider transcript fragments. The derived
`chatMessageGroupsAtomFamily` projects consecutive assistant records into one
`AssistantResponse`: ordered content/tool parts, original records, and full
`copyText`. The response is one virtual item, one message container, one heading,
and one Copy action. User or system records end it; completion metadata and
interactive widgets do not. Every prose part remains visible. Consecutive tools
collapse within the response and preserve their full inputs.

Desktop chat, worker chat panes and mobile consume this same projection. Live
embedded tool lines and hydrated separate tool records normalize to the same
part types. The projection never rewrites persisted records or commits stream
buffers into the conversation snapshot.

## Rendering markdown and long threads

Chat (desktop and mobile) and channel text render through
[utils/markdown-pipeline.ts](../client/src/utils/markdown-pipeline.ts), never
react-markdown's `<Markdown>` component. `<Markdown>` builds and freezes a new
unified processor on every render, re-running every plugin attacher; opening a
1,099-message conversation on mobile blocked the main thread 1,321ms (4x CPU,
2026-09-25), ~391ms of it `freeze()`. Declare a `defineMarkdownFlavor(...)` as a
module constant, take the pipeline from `useMarkdownPipeline(flavor)` and call
`renderMarkdownCached(pipeline, text, components)` for settled text. Finished
hast trees sit in an LRU keyed by pipeline and text, bounded by entry count AND
total source characters, so remounted rows skip parse and highlighting. The
message a streaming turn is still growing MUST use `renderMarkdownLive` instead:
each animation-frame flush is a new string, and caching those retained a tree
per prefix (334MB heap for one 18KB reply, 2026-09-25) and evicted every settled
tree. The response row that knows the turn is live picks the renderer for its
last part. The pipeline turns raw HTML into text and applies the URL policy
before a tree is cached. Cached trees are shared, so never mutate a `node`
passed to a component override — outside production builds they are
deep-frozen, so a mutation throws. `client/test/markdown-pipeline.test.tsx`
keeps the output byte-identical to `<Markdown>` and guards both cache bounds.

Desktop virtualizes the message list. Mobile keeps a flat scroller for iOS
momentum and mounts groups from a pinned first index: the newest 30 when the
conversation opens, 30 more per "Show earlier" (keeping the reader's distance
from the bottom). New groups append below without unmounting the top one — a
count-from-the-end window did, which shifted content above the reader on Safari
(no scroll anchoring).

## Persisted UI state

[atoms/ui.ts](../client/src/atoms/ui.ts) holds device-local preferences and
NEW-badge seen indexes in `localStorage`; none of it syncs. Subscribe to
per-field atoms and mutate through exported actions, never the slice atoms.
Facts about a conversation belong on the conversation, not here: done/hidden is
`conversation.done`, owned by the server record and changed with
`set_conversation_done`. See [mobile view tree](mobile-view-tree.md) for the
fields and why the synced blob was retired.

## Hook ordering and stable values

All hooks must run before any early return. Guard unavailable data inside a hook
callback, then return a loading/empty state after the hooks. Keep fallback arrays,
objects, and sets as module constants so missing data does not allocate a new
subscription value every render.

Before committing, check per-conversation subscriptions, derived collection
views, isolated streaming state, stable fallbacks, and hook order. Run
`pnpm check:client-invariants` plus the relevant client checks from
[test strategy](test-strategy.md).
