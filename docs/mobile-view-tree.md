# Mobile view tree (PWA)

(Moved out of AGENTS.md to keep startup context small.)

## Mobile view tree (PWA) — two view trees over one core

Mobile is a second view tree over the same shared core, not a fork. One `jotaiStore` (`atoms/store.ts:14`), one WS socket, one `handleMessage` spine.

### What mobile may import

```
atoms/*, hooks/*, utils/*, shared/*, components/buddies/{api,types,ui-contract,buddies-shaping}.ts
```

Never import another `components/*.tsx` or its CSS. Swarm parsers were moved to `utils/swarmConvoParsers.ts` / `utils/swarmAnalyticsParsers.ts` precisely so mobile can reuse logic without pulling desktop view trees. `components/buddies/*` is the one allowed exception — its `buddies-shaping.ts` is pure shaping (no JSX/CSS side-effects) co-located with `api.ts`/`types.ts`/`ui-contract.ts`.

Grep gates (run `pnpm check:client-invariants` / `bash tools/check-client-invariants.sh`):
- **G1** — `jotaiStore.set` only inside `client/src/atoms/` (`mutate()` wraps it there). Components call actions.
- **G2** — no raw `.buddyContext` / `.purpose` reads in `client/src/mobile/` — use `getConversationKind` / `matchConversationKind` / `buddyContextFromKind` (`shared/src/conversation-kind.ts`).
- **G3** — no `components/` imports in `mobile/` except `components/buddies/` (see above).

### DeviceKind — the only sum type at the shell

```ts
// client/src/mobile/hooks/useDeviceKind.ts
export type DeviceKind = 'mobile' | 'desktop';
export function useDeviceKind(): DeviceKind { /* sticky per page load */ }
```

`T1`: `'mobile'|'desktop'` not `boolean isMobile` — anonymous `true⊕false` leaks `if(isMobile)` downstream. Computed once at module load via `matchMedia('(max-width: 768px)')` and cached for the page load (`sticky`, not resize-reactive — live swap would remount the tree and lose composer drafts). `matchMedia` missing → typed `throw` (`T4`, no silent desktop default). Single dispatch point is `App.tsx: const device = useDeviceKind()` → `SHELLS[device]` (δ #1) → `pick(r)` leaf factory (δ #2). Leaf handlers never re-ask `isMobile`.

### Where device-specific view state lives

`docs/client-state.md: Adding a new collection view` says "all collection views in `derived atoms.ts`". **Exception:** device-specific derived views live in `mobile/atoms/`, not `conversations.ts`, to keep the canonical core clean. Canonical example:

```ts
// client/src/mobile/atoms/search.ts
export type MobileSearchState = { kind: 'idle' } | { kind: 'searching'; query: string };
export const mobileSearchStateAtom = atom<MobileSearchState>({ kind: 'idle' });
export const mobileSearchResultsAtom = atom((get) => get(mobileSearchStateAtom).kind === 'idle'
  ? get(allConversationsAtom)
  : filter(allConversationsAtom, query) /* via utils/fuzzyMatch */);
```

`T2`: `MobileSearchState` sum type, never `atom<string>('')` sentinel. `mobile/atoms/search.ts → atoms/conversations.ts` is allowed; core never imports mobile.

### UI state partition

`atoms/ui.ts` holds the shared/local partition (folded from the former
zustand `stores/uiStore.ts` — the post-v1 `atomWithStorage` migration from
`PLANNING_MOBILE.md` §4 is done):

- **shared** (debounced POST to `POST /api/ui-state`, gated until WS-init hydration) — `{ doneConversations, promotedWorkers, lastSeenMessageIndex, lastWorkingDirectory }` (4)
- **local** (`atomWithStorage` under `localStorage['unleashd-ui-local']`, same blob shape as v1 so old data loads as-is) — `{ activeConversationId, galleryExpandedProjects, galleryCollapsedProjects, showTempSessions, showDoneConversations, showWorkerConversations, sidebarViewMode }` (7)

Storage reads go through `UIStateSchema.partial().safeParse` (discard whole
blob on failure — no silent half-merge). Subscribe via per-field derived atoms
(`savedActiveConversationIdAtom`, `promotedWorkersAtom`, ...); mutate only via
exported action functions. Phone never mutates desktop-local fields. The
persisted `savedActiveConversationIdAtom` is distinct from the ephemeral
routing `activeConversationIdAtom` in `conversations.ts` (dual-active-id).

### Mutation rule

Partial updates of collection atoms go through `mutate()` (`atoms/mutate.ts` / `atoms/actions.ts`):

```ts
const mutate = <T>(a, recipe) => jotaiStore.set(a, produce(jotaiStore.get(a), recipe));
```

Scalar / full-replace sets stay plain `jotaiStore.set`. Current code already conforms: ~20 produce sites use `mutate()`, rest are scalars/snapshot replacements. Keeps every atom one uniform kind (no `jotai-immer` dep).

### Single-bridge + single-handler rules

- **Single bridge:** only `App.tsx` `AppInner` mounts `useWebSocketBridge` (hoisted above `AppRoutes`). Never mount a second bridge in `mobile/` — it would double-connect and fight over `sendFnAtom`/`wsStatusAtom`.
- **Never a second `handleMessage`:** the WS-push → `handleMessage` (`atoms/actions.ts`) dispatcher is the single shared spine. Mobile consumes it through the hoisted bridge; no mobile file defines its own handler.

### Stale link note

`client/src/components/SubAgentPanel.tsx:158` previously linked to `/swarms/project` — dead link matching no `App.tsx` route. Retarget to `/workers/detail` or remove; do not copy the stale path into mobile.

---
