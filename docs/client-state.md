# Client state patterns

(Moved out of AGENTS.md to keep startup context small.)

## Writing state subscriptions

**Before subscribing to any store, identify what you need:**

### Single conversation by ID → `conversationAtomFamily`
```ts
const conv = useAtomValue(conversationAtomFamily(id));
```

### A list of conversations (sorted, filtered, grouped) → `allConversationsAtom` / `derived atoms`

**Option A — simple, re-renders all items on any structural change:**
```ts
const list = useAtomValue(allConversationsAtom);
// then apply UI-state filters inline with useMemo
```

**Option B — per-item subscriptions, true subtree pruning (use for large lists):**
```ts
// Parent: only re-renders when list membership/order changes
const ids = useAtomValue(allConversationIdsAtom);
return ids.map(id => <Item key={id} id={id} />);

// Item: React.memo + per-ID selector = only re-renders when THIS conv changes
const Item = React.memo(function Item({ id }: { id: string }) {
  const conv = useAtomValue(conversationAtomFamily(id));
  ...
});
```
Why it works: `conversations.get(otherId)` returns the same reference when a different
conversation changes. React.memo sees no prop change → skips render. This is structural
sharing doing real work — no library required.

### Active streaming text → `streamingAtomFamily`
```ts
const text = useAtomValue(streamingAtomFamily(id));
// merge with conversation.messages at render time, not in the store
```

### Persisted UI state → `atoms/ui.ts`
```ts
const pref = useAtomValue(yourPreferenceAtom);   // per-field derived atom
setYourPreference(value);                        // plain exported action fn
```
Local fields persist via `atomWithStorage('unleashd-ui-local')`; shared fields
debounce-POST to `/api/ui-state` (gated until WS-init hydration). Subscribe to
the per-field atoms, never the slice atoms; mutate only via the action
functions (G1: `jotaiStore.set` stays inside `atoms/`).

**Red flag:** if you wrote `useAtomValue(conversationsAtom)` — stop.
That subscribes to every structural event across all conversations.
Use one of the patterns above instead.

---

## Writing state mutations

### Structural update (new message, status change, queue, conversation added/deleted)
→ update `conversationsAtom.conversations`
→ `derived atoms` recomputes automatically via subscribe

### Chunk / streaming update
→ update `conversationsAtom.streamingContent` ONLY
→ never update `conversations.messages` during streaming
→ flush streamingContent → conversations in `status(isStreaming=false)` handler

### High-frequency state you're adding (>10Hz)
→ add a new `Map<string, T>` to `conversationsAtom` (like `streamingContent`)
→ never add it to `conversations` entries
→ document the flush boundary (when does it merge into `conversations`?)

---

## Adding a new collection view

All sorted/filtered lists of conversations go in `derived atoms.ts` — not in component `useMemo`.

```ts
// client/src/atoms/conversations.ts

export const yourViewAtom = atom((get) => {
  const all = get(conversationsAtom);
  // ... compute your view
});
```

Then in the component: `useAtomValue(yourViewAtom)`.

---

## React hook ordering

ALL hooks must appear before any early `return` statement.
Hooks after early returns crash React when the condition flips (null → non-null).

```ts
// GOOD (the BAD version early-returns before useMemo — crashes when conv flips)
function Chat() {
  const conv = useAtomValue(conversationAtomFamily(id));
  const x = useMemo(() => {
    if (!conv) return null;          // guard inside memo, not a return
    return compute(conv);
  }, [conv]);
  if (!conv) return <Loading />;     // early return AFTER all hooks
}
```

---

## Performance checklist before committing

- [ ] No `useAtomValue(conversationsAtom)` in new components
- [ ] New list/sorted/filtered views added to `derived atoms.ts`, not component `useMemo`
- [ ] High-frequency updates go to `streamingContent` or a dedicated Map, not `conversations`
- [ ] Stable fallback references are module-level constants, not inline `[]` or `{}`
- [ ] No hooks after early returns
