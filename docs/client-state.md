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
| Live text for one conversation | `streamingAtomFamily(id)` |
| Pending creation or config command | `pendingCreationAtomFamily(id)` or `pendingConfigCommandAtomFamily(id)` |
| Whether full history is hydrated | `conversationDetailsLoadedAtomFamily(id)` |
| Persisted UI preference | A per-field atom from `atoms/ui.ts` |

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

## Mutations and state ownership

These are separate atoms, not fields of one combined state object:

- `conversationsAtom`: `Map<string, Conversation>` of server snapshots.
- `streamingContentAtom`: `Map<string, string>` of transient live text.
- `pendingCreationsAtom`: client-owned creation commands, separate from conversations.
- `pendingConfigCommandsAtom`: pending revision-checked config writes and errors.

Use [mutate](../client/src/atoms/mutate.ts) for partial collection updates inside
atom modules; scalar or complete replacements can use `jotaiStore.set` there.
Add a separate atom for new high-frequency state and document its clearing or
commit boundary. Do not put it into each authoritative conversation entry.

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

## Persisted UI state

[atoms/ui.ts](../client/src/atoms/ui.ts) separates local and shared preferences.
Local fields persist via `atomWithStorage` under `unleashd-ui-local`; shared fields
debounce-POST to `/api/ui-state`, gated until server hydration. Subscribe to
per-field atoms and mutate through exported actions, never the slice atoms.
See [mobile view tree](mobile-view-tree.md) for the field partition and migration.

## Hook ordering and stable values

All hooks must run before any early return. Guard unavailable data inside a hook
callback, then return a loading/empty state after the hooks. Keep fallback arrays,
objects, and sets as module constants so missing data does not allocate a new
subscription value every render.

Before committing, check per-conversation subscriptions, derived collection
views, isolated streaming state, stable fallbacks, and hook order. Run
`pnpm check:client-invariants` plus the relevant client checks from
[test strategy](test-strategy.md).
