# PLANNING_MOBILE.md — v2.1

Mobile PWA for unleashd: two view trees over one shared core.
Replanned from scratch after 4 fresh Muse reviews of v1 (2026-08-07).
v2.1 (2026-08-10): shell-dispatch fix, uiStore localStorage persistence, DeviceKind
cleanup, library resolutions (§13), post-v1 zustand removal.

_Status: planned, not yet coded. Every claim below is cited to file:line._

---

## 1. Goal

Use unleashd from a phone (PWA, Add to Home Screen) to:
- read + reply in **Chats**
- monitor + steer **Swarms**
- browse **Buddies** (directory + per-buddy detail)
- **Search** across conversations

while the Mac runs headless (clamshell on AC, launchd) and Tailscale is the only network boundary.

**Not in v1:** native apps, auth code in unleashd, desktop `Chat`/`Sidebar` refactor, VPS, self-hosted Tailscale control plane, multi-host buddy DB, **merge mode on mobile** (merge stays desktop-shell behavior — `ShellDesktop` owns the `mergeMode` ternary, `ShellMobile` never renders it), **zustand removal** (post-v1 phase, see §4/§13), **any new libraries** (no tanstack-query, no RR data APIs, no `jotai-immer` dep — see §13), voice (deferred: client Mic→STT→text prompt — CLIs' native voice is UI-only and unreachable from headless harnesses, `codex -p`/`muse exec` are text-in).

---

## 2. Decisions (locked)

| Topic | Decision | Why |
|---|---|---|
| Client | **PWA in the same React app** (no second SPA, no native) | One codebase, one `jotaiStore` (`atoms/store.ts:14`), one WS socket. |
| Host | **Mac headless** via launchd (`pnpm build` → `node server/dist/server.js`), clamshell on AC + `caffeinate` | Zero migration; `~/.buddies/buddies.sqlite` stays put. |
| Network | **Tailscale free tier** + `tailscale serve` for TLS (see §9) | Free for 1 user, handles NAT/roaming. Binding alone is not enough for PWA (see §9). |
| Server bind | `UNLEASHD_HOST=<tailscale-ip>` **is not sufficient** — use `tailscale serve --bg --https=443 http://127.0.0.1:7489` and expose `https://<machine>.<tailnet>.ts.net` (SecureContext). `server/src/network.ts:7` accepts any trimmed host; `server/src/server.ts:72` is plain `http.createServer`. |
| Architecture | **Two view trees over one core** (see §3) — reuse `atoms/*`, `hooks/*`, `utils/*`, `shared/*`, `components/buddies/{api,types,ui-contract}.ts`; never import desktop `components/*.tsx` or their CSS | Core is already decoupled; desktop components are 1k-line view trees — reuse would couple. |
| Routes | **Same URLs, one `Routes` via `RouteTable` (`ROUTES` array + `AppRoutes` `ROUTES.map` single δ)** — no `/m/*` prefix (SPA fallback `server/src/lifecycle/static-client.ts:6` would serve either, but `App.tsx:89-98` has no `/m/*` route; prefix would need a second router) | Deep links stay canonical (`/chat/:id`, `/buddies/:buddyId`, `/workers/detail`). |
| Device kind | **Sum type `DeviceKind = 'mobile'|'desktop'`** at the shell, not `boolean`. Computed **once per page load** (sticky, not resize-reactive). | `CLAUDE.md: T1` — anonymous `true⊕false` leaks `if(isMobile)` downstream. Live resize-swap would unmount the tree mid-session (composer drafts lost); phones don't become desktops. |
| State libs | **jotai canonical; zustand frozen for v1, removed post-v1; immer fused via local `mutate()` helper — no `jotai-immer` dep** | One state model long-term; the helper is 3 dependency-free lines with identical ergonomics, and keeps every atom one uniform kind (no "which flavor?" question). See §13. |
| Router | **react-router v7 declarative only** — no data APIs (`createBrowserRouter`/loaders), no hand-rolled router | WS-push owns data (loaders would be a second authority fighting jotai); nested layout routes + `<Outlet/>` (shells, §3) are exactly where DIY routers stop being 200 lines. See §13. |

---

## 3. Architecture — the one real shape

```
shared/  (Conversation, Message, SubAgent, ConversationKind, BuddyContext)  ─┐
client/src/atoms/*  (conversations, actions, config-actions,                │
                     pending-creations, mergeAtoms, detail-loader, store)   ├── shared core
client/src/hooks/*  (useWebSocket + generic hooks)                           │   (reuse verbatim)
client/src/utils/*  (fuzzyMatch, time, swarmUtils, …)                       │
client/src/components/buddies/{api,types,ui-contract}.ts                    ┘
         │
         ▼
App.tsx  =  <Provider store={jotaiStore}>           // atoms/store.ts:14, single instance
             <BrowserRouter>
               <UseWebSocketBridge/>  ───────────── // App.tsx:27 hoisted (see §5)
               <UseRestoreOnLoad/>    ───────────── // App.tsx:43 hoisted, now DeviceKind-aware
               <AppRoutes device={device}/>          // single δ — RouteTable owns dispatch (see below)
             </BrowserRouter>
           </Provider>

  // RouteTable — element FACTORIES, not ComponentType. ComponentType silently drops
  // props: `desktop: Gallery` for "/done" compiles (filter is optional) and renders
  // the wrong view. Factories make "/done" → <Gallery filter="done"/> expressible.
  type RouteDef = { path: string; desktop: () => ReactElement; mobile: () => ReactElement };
  const ROUTES: RouteDef[] = [
    { path: "/",                 desktop: () => <Gallery/>,               mobile: () => <MainScreen/> }, // MainScreen = hub (Chats/Swarms/Buddies/Search)
    { path: "/chat/:id",        desktop: () => <Chat/>,                  mobile: () => <ChatMobile/> },
    { path: "/buddies",         desktop: () => <BuddiesDashboard/>,      mobile: () => <BuddiesMobile/> },
    { path: "/buddies/:buddyId",desktop: () => <BuddiesDashboard/>,      mobile: () => <BuddyDetailMobile/> },
    { path: "/workers",         desktop: () => <SwarmDashboard/>,        mobile: () => <SwarmsMobile/> },
    { path: "/workers/detail",  desktop: () => <SwarmDetail/>,           mobile: () => <SwarmDetailMobile/> },
    { path: "/workers/analytics",desktop: () => <SwarmAnalytics/>,       mobile: () => <SwarmAnalyticsMobile/> },
    { path: "/done",            desktop: () => <Gallery filter="done"/>, mobile: () => <ConversationListMobile/> }, // App.tsx:91
  ];

  // The device δ selects a SHELL, then a leaf. Shells own their chrome:
  //   ShellDesktop = today's AppLayout minus the hoisted hooks — Sidebar + top-bar
  //                  ConfigDropdown + the mergeMode ? <MergeModal/> : <Outlet/> switch.
  //                  (Without this, the RouteTable refactor silently drops all desktop chrome.)
  //   ShellMobile  = bottom tab bar around <Outlet/>. Never renders merge mode (Not in v1).
  const SHELLS: Record<DeviceKind, ComponentType> = { desktop: ShellDesktop, mobile: ShellMobile };

  function AppRoutes({ device }: { device: DeviceKind }) {
    const Shell = SHELLS[device];                                       // δ #1 — shell
    const pick = (r: RouteDef) => device === 'mobile' ? r.mobile() : r.desktop(); // δ #2 — leaf
    return (
      <Routes>
        <Route path="/robot" element={<RobotLoader/>} />
        <Route element={<Shell/>}>
          {ROUTES.map(r => <Route key={r.path} path={r.path} element={pick(r)} />)}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }
```

**Rules (from CLAUDE.md one-clean-path):**

- Canonical types own branching (`T1`): `DeviceKind = 'mobile'|'desktop'`, `MobileSearchState = {kind:'idle'}|{kind:'searching',query:string}`, `RelationshipKind` — not `boolean`/`''` sentinels.
- One thin dispatcher `δ` — `AppRoutes`'s `ROUTES.map` line — selects the handler; every handler (`Chat`/`ChatMobile` etc.) has zero structural branching (`D1/D2`). Add a route = add a row, not a new ternary.
- No silent fallbacks (`T4/R3`): `matchMedia` missing → **typed throw in κ** (no `'unknown'` variant — every target browser has `matchMedia`; a speculative variant forces dead handling into every δ); `unknown` WS protocol → `Error`, not `ws`; missing `last_active_at` → `Presence<Date>` not `?? 0`.
- Hoist `useWebSocketBridge` **and** `useRestoreOnLoad` + `initSettings()` above the switch — one socket (`sendFnAtom`/`wsStatusAtom` `atoms/conversations.ts:66,61`), one restore nav, one settings init. Two bridges would double-connect and fight over `sendFnAtom`.

### Device kind (the only new sum type at the shell)

```ts
// client/src/mobile/hooks/useDeviceKind.ts
export type DeviceKind = 'mobile' | 'desktop';
// κ: matchMedia('(max-width: 768px)') → DeviceKind. Evaluated ONCE at module load
// (sticky per page load, not resize-reactive): a live swap would remount the whole
// tree mid-session and lose component-local state (composer drafts). A desktop
// window resized to phone width keeps the desktop tree until reload — acceptable.
// matchMedia missing → typed throw (T4), never a silent desktop default.
export function useDeviceKind(): DeviceKind { ... }
```

`App.tsx` then: `const device = useDeviceKind();` — the single dispatch point. Mobile and desktop handlers never re-ask `isMobile`.

---

## 4. Data model

### Shared (no new wire schema)

Mobile consumes the same canonical wire types: `Conversation` (`shared/src/index.ts:560-660`), `Message` (`:424`), `SubAgent` (`:448`), `QueuedMessage` (`:465`), `ConversationConfig` (`shared/src/conversation-config.ts`), `ConversationKind` (`buddy|buddy_builder|general`), `BuddyOverview`/`EmployeeRecord`/`Buddy` (`components/buddies/types.ts`), `ConversationLink.kind` (`conversation|review|automation`), worker fields (`isWorker`/`swarmId`/`workerId`/`workerRole`, server-computed from the first-user `[oompa]` tag).

### New client-side (mobile view state only)

| Atom / type | Home | Kind |
|---|---|---|
| `DeviceKind` | `mobile/hooks/useDeviceKind.ts` | `type DeviceKind='mobile'\|'desktop'` — shell state |
| `MobileSearchState` | `mobile/atoms/search.ts` | `type MobileSearchState={kind:'idle'}\|{kind:'searching',query:string}` — never `atom<string>('')` (`T2`) |
| `mobileSearchResultsAtom` | `mobile/atoms/search.ts` | derived: `get(MobileSearchState).kind==='idle' ? get(allConversationsAtom) : filter(allConversationsAtom, query)` via `utils/fuzzyMatch.ts:28` over `workingDirectory` + last-message preview/id (Conversation has no `title`). Keeps canonical `atoms/conversations.ts` clean — device-specific view state does not pollute the shared core. |

Ephemeral UI (composer draft, picker open) stays as component-local `useState` — consistent with existing desktop local state and `CLAUDE.md`.

### UI state fork — what is shared vs device-local

`stores/uiStore.ts:70-262` syncs one `UIState` (`shared/src/index.ts:928-940`, **11 fields**) via `POST /api/ui-state:251` (500ms debounce) with `hydrated:77` gate. Two concurrent clients (phone + desktop) currently race on `activeConversationId` — last writer wins. For v1, **partition, don't split the schema**:

- **Single store, documented partition + sync guard (no schema change)** — keep `UIStateSchema` but add pure `partitionUiState(u)=>{shared,local}` where `shared={doneConversations,promotedWorkers,lastSeenMessageIndex,lastWorkingDirectory}` (4) and `local={activeConversationId,galleryExpandedProjects,galleryCollapsedProjects,showTempSessions,showDoneConversations,showWorkerConversations,sidebarViewMode}` (7). `syncToServer` only POSTs `shared`; `hydrateFromServer:211` only merges `shared` (preserves URL-derived `activeConversationId`). Phone never mutates desktop-local fields; desktop never mutates mobile search tab. Server `PersistedServerState:115` already tolerates partial via spread+defaults — no migration.
- **The local slice MUST get localStorage persistence — this does not exist today.** `uiStore` has no `persist` middleware and no localStorage writes (only comments about external crash-recovery keys); its state is in-memory + server-hydrated. Removing `activeConversationId` from the server POST without adding persistence silently breaks desktop restore-on-load (`App.tsx:54-57` would read a stale/never-updated value after every reload). Three surgical changes — do NOT adopt zustand `persist` middleware (it fights the hand-rolled `hydrated:77` gate):
  1. `syncToServer` POSTs only `partitionUiState(state).shared`.
  2. The same debounced path also writes `partitionUiState(state).local` to `localStorage['unleashd-ui-local']` — piggyback the existing 500ms timer, no new timer.
  3. Store init reads that blob (Zod `UIStateSchema.partial()` parse; discard whole blob on failure — no silent half-merge) **before** `hydrateFromServer` runs.
- Note the coupling: the `DeviceKind`-aware `useRestoreOnLoad` (§5 #1) reads `uiStore.activeConversationId` — the restore change and this partition change interact and must land in the same phase (both Phase 0).

**Post-v1 (now planned, not speculative): remove zustand entirely.** Fold `uiStore` + `settingsStore` into jotai — `atomWithStorage` for the local slice (subsumes step 2-3 above natively), a small debounced-POST effect for the shared slice. Kills the dual-active-id wart (`Chat.tsx:327-342`), the `hydrated` gate, and the second state model in one refactor. Sequenced after mobile v1 so it doesn't churn the same files mid-plan; the `partitionUiState` boundaries defined here become the migration map. See §13.

`stores/settingsStore.ts:236` (`colorPalette`/`customPalettes`) stays shared, server-synced — no device fork.

### Compaction — data model at large (leave-alone vs fix-now)

- **Leave flat:** `Conversation:560-660` (30 fields, `isWorker/swarmId/...:594-608`, `kind:631` + legacy `buddyContext:634/purpose:636`) — normalizing to `Base⊕KindSpecific` needs a WS version bump + loader migration; mobile filters via `getConversationKind()` already, no win for v1.
- **Fix now (core boundary, no wire change):** ban raw `.buddyContext/.purpose` reads in new mobile code — read only via `getConversationKind/matchConversationKind/buddyContextFromKind` (`conversation-kind.ts:52-136`). Enforce by grep lint. Makes `components/buddies/buddies-shaping.ts` extraction a `δ` not an `if(context)` ladder.
- **Keep hybrid search:** default client `fuzzyMatch:28` over `workingDirectory`+preview (instant, offline after `init`); `SearchMobile` optionally fetches `GET /api/search?q=` (`server/src/http/search-routes.ts:27`, full history, `filterDirectory`) for deep queries. Dispatcher on `MobileSearchState.kind` selects source.
- **Leave `isWorker` boolean** — promoting to a `WorkerKind` variant couples orthogonal axes (buddy vs execution origin); keep server nulling `swarm*` when `!isWorker` (`runtime.ts:580`) and guard with `isWorker` on client.

### Load boundaries a mobile component must respect

- **Transcript vs summary:** gate on `conversationDetailsLoadedAtomFamily(id)` (`atoms/conversations.ts:82-84`). List renders from `init` summary; chat-open lazily calls `loadConversationDetails(id)` (`atoms/actions.ts:94`) over HTTP, shows loading.
- **Streaming:** append only to `streamingContentAtom` (`:58`); flush into `conversationsAtom` on `status(isStreaming=false)` (`actions.ts:532`) / `message_complete`. Mobile `ChatMobile` merges `streamingAtomFamily(id)` at render time — never writes `messages` mid-stream.
- **Dual active id:** `Chat.tsx:327-342` sets both `activeConversationIdAtom` (`atoms/conversations.ts:60`) and `uiStore.activeConversationId` (`stores/uiStore.ts:81`) on open; cleanup clears only the jotai atom, keeps zustand truth (preserve `uiStore:77 hydrated` gate, `hydrateFromServer:211` URL-derived preservation, and `syncToServer:230` debounce). Also replicate `markMessagesSeen` plumbing (`actions.ts:512`, `VirtualizedMessageList` observer) — not just `setActiveId`.
- **Optimistic rollback:** on `command_rejected` with `authoritativeConversation`, apply that snapshot or phantom pendings stick. Reuse the same `handleMessage` handling in `atoms/actions.ts:392`.

---

## 5. What to refactor FIRST (ordered, small — all additive except the hoist)

1. **Hoist the bridge + restore + settings to `App`; rename `AppLayout` → `ShellDesktop`** — extract `useWebSocketBridge` (`App.tsx:27-38`, 12 lines, dep only `url`) and `useRestoreOnLoad` (`:43-61`) and `initSettings()` (`:67`) from `AppLayout` to `App` above `AppRoutes`. What remains of `AppLayout` (`:78-104` — Sidebar + top-bar ConfigDropdown + `mergeMode` ternary) IS `ShellDesktop`, with `<Outlet/>` where `<Routes>` was. Not new code — a rename plus hook removal. Preserve `/robot` outside the table. Single socket/store; `useRestoreOnLoad` becomes `DeviceKind`-aware (desktop restores `"/"→/chat/:id`, mobile keeps `MainScreen` hub) — lands with the §4 partition (same phase, coupled via `activeConversationId`).
2. **Fix WS URL for TLS** — `App.tsx:28` `ws://${location.host}/ws` → `κ(location.protocol)` → `ws://` for `http:`, `wss://` for `https:`, typed `Error` otherwise (exhaustive, `D3`). Required before any `https://` test; otherwise mixed-content blocks.
3. **Add `useDeviceKind`** — `client/src/mobile/hooks/useDeviceKind.ts` as above, with exhaustive unknown handling.
4. **Add `mobile/atoms/search.ts`** — `MobileSearchState` + `mobileSearchResultsAtom` as above (searches `workingDirectory` + preview, not `title`). **Requires `AGENTS.md` amendment** — current `116` says "all collection views in `conversations.ts`"; add exception: device-specific views live in `mobile/atoms/` to keep the canonical core clean. `mobile/atoms/search.ts → atoms/conversations.ts` (allowed); core never imports mobile.
5. **Extract buddies shaping** — relationship→manager/directReports (`BuddiesDashboard.tsx:100-126`), filter/sort (`:261-304`, `:283-304`), and `BuddyContext` for `talk()` (`:319-343`) out of the 938-line `BuddiesDashboard.tsx` into **`client/src/components/buddies/buddies-shaping.ts`** (co-located with `api.ts:1`/`types.ts`/`ui-contract.ts:1` — not `mobile/domain/`). Desktop may adopt it later; mobile imports from `components/buddies/*` without ever importing a desktop component. Enforce with lint: ban raw `.buddyContext` reads (use `getConversationKind`).
6. **Export swarm parsers to `utils/`** — move `SwarmConvoPrefix.tsx:10-71` trio to `utils/swarmConvoParsers.ts` (or extend `utils/swarmUtils.ts:24`) and `SwarmAnalytics.tsx:128-222` timeline + `:421-447` stats to `utils/swarmAnalyticsParsers.ts`. Desktop re-imports from `utils/`; mobile imports from `utils/` — never from `components/*.tsx` (avoids CSS side-effect import).
7. **UI state partition guard + localStorage persistence** — add `partitionUiState` pure `κ` in `stores/uiStore.ts`, make `syncToServer` POST only the `shared` slice, AND add the localStorage write/read for the `local` slice (§4 steps 1-3 — the persistence leg is mandatory, not optional). No `UIStateSchema` change for v1.
8. **Add `mutate()` helper** — 3 lines in `atoms/actions.ts` (or `atoms/mutate.ts`): `const mutate = <T>(a, recipe) => jotaiStore.set(a, produce(jotaiStore.get(a), recipe))`. Collapses the `jotaiStore.set(x, produce(jotaiStore.get(x), …))` pattern repeated dozens of times across `actions.ts`/`pending-creations.ts`. This is our hand-rolled `jotai-immer` — deliberately NOT the dependency (§13): identical ergonomics, all atoms stay one uniform kind.
9. **Extract `handleMessage` case bodies into named handlers** — several cases run 30-70 lines inline (`init`, `conversations_updated`, `merge_child_status`). `CLAUDE.md: D1`: dispatcher stays thin (`case 'chunk': return handleChunk(data)`), work lives in handlers. Matters now because `handleMessage` becomes the single shared spine for both trees.
10. **Fix the `atomFamily` leak** — `conversationAtomFamily`/`streamingAtomFamily`/etc. memoize per-ID atoms forever; deleted conversations each leak one. `jotai-family` supports `.remove(id)` — call it for all families in the `conversation_deleted` handler. Trivial on desktop, relevant on a long-lived installed PWA.
11. **Do NOT touch** `Chat.tsx` / `Sidebar.tsx` / `VirtualizedMessageList.tsx` — their size is why we build a separate tree.

Paths unified: `mobile/hooks/useDeviceKind.ts` (not `mobile/useIsMobile.ts`). Note: `SubAgentPanel.tsx:158` links to stale `/swarms/project` — dead link, matches no `App.tsx:89-98` route; remove or retarget to `/workers/detail`.

---

## 6. File structure — new `client/src/mobile/`

```
client/src/mobile/
  hooks/
    useDeviceKind.ts            // DeviceKind sum type + matchMedia κ
  atoms/
    search.ts                   // MobileSearchState + mobileSearchResultsAtom (fuzzyMatch) — AGENTS.md exception, see §4/§8
  components/
    ShellMobile.tsx             // bottom tab bar layout wrapper (<Outlet/>) — persistent chrome, not a route
                                // (desktop counterpart: components/ShellDesktop.tsx = renamed AppLayout, §5 #1 — NOT under mobile/)
    MainScreen.tsx              // full-screen menu hub at "/" ("Chats","Swarms","Buddies","Search")
    MessageRow.tsx              // per-role message row (markdown + review cards + subagents)
    ComposerMobile.tsx          // input + send/stop/queue (via atoms/actions.ts)
    ProviderModelPickerMobile.tsx // reasoning/effort passthrough, minimal
    EmptyState.tsx
  conversations/
    ConversationListMobile.tsx  // inbox — one ListItem per conversation (per-ID subscriptions)
    ChatMobile.tsx              // thread + streaming merge + header dropdowns
  swarms/
    SwarmsMobile.tsx            // project cards (workersByProjectAtom + useSwarmProjects)
    SwarmDetailMobile.tsx       // stacked worker list (single-pane, no side-by-side)
  buddies/
    BuddiesMobile.tsx           // directory (BuddyOverview)
    BuddyDetailMobile.tsx       // per-buddy tabs (work / conversations / memory / automations)
  search/
    SearchMobile.tsx            // search page (uses mobileSearchResultsAtom or /api/search?q=)
  styles/
    mobile.css                  // tokens + dvh/safe-area layout (or co-located per-component)
  // New shared extractions (outside mobile/, reused by both trees):
  // components/buddies/buddies-shaping.ts, utils/swarmConvoParsers.ts, utils/swarmAnalyticsParsers.ts
```

Mobile imports `atoms/*`, `hooks/*`, `utils/*`, `shared/*`, `components/buddies/{api,types,ui-contract,buddies-shaping}.ts` — never another `components/*.tsx` (parsers now in `utils/`, not `components/`). Swarm pure logic (exec-group builder, `extractVerdict`, `shortModelName`, `buildSwarmDebugPrefix`, `sendSwarmSignal`, `getWorkerVisibilitySummary`) is reused as logic with rebuilt DOM.

---

## 7. Patterns (every mobile component)

1. **One bridge, one store, one router** — `jotaiStore` (`atoms/store.ts:14`) is the single instance; `sendFnAtom`/`wsStatusAtom` singletons. Never mount a second bridge.
2. **Per-ID subscriptions in lists** — `useAtomValue(conversationAtomFamily(id))` / `streamingAtomFamily(id)` / `workerIdsAtom` — never `useAtomValue(conversationsAtom)` in a list (`AGENTS.md: Red flag`).
3. **Derived views in atoms** — `AGENTS.md:116` / `conversations.ts:119-128` `ADDING A NEW VIEW` — but device-specific views live in `mobile/atoms/` to keep the canonical core clean.
4. **Streaming discipline** — `chunkBuffer` → `streamingContentAtom` → flush on `status:532`/`message_complete`; merge at render, never during stream.
5. **`conversation_created` is reused for updates** — handlers idempotent (`removePendingConversation` guarded).
6. **Rejection → authoritative rebroadcast** — `command_rejected` carries `authoritativeConversation`; roll back optimistic writes.
7. **WS URL via `κ(protocol)`** — exhaustive mapping, no silent default.
8. **Live swarms need polling — via one shared `usePolledFetch(url, ms)` helper (Phase 2)** — migrate `useSwarmRuntimeSnapshots` (`hooks/useSwarmRuntimeSnapshots.ts:19`, `10s`) + `useSwarmProjects` (`:15`, `15s`, staggered) + `useProviderCatalog` onto it; keep the `30s` time-ago tick (`SwarmDashboard:67`). The helper adds the two mobile-critical behaviors the hand-rolled hooks lack: **pause/resume on `visibilitychange`** (a backgrounded PWA keeps `setInterval` firing until iOS suspends it) and **immediate refetch on WS reconnect** (post-drain, don't wait out the interval). NOT tanstack-query — three hooks don't justify a second data paradigm next to the WS (§13). `useProviderCatalog:11` is singleton; the other two are per-instance (single mount keeps polling single).
9. **Layout: `100dvh` + `env(safe-area-inset-*)`, not `100vh+overflow:hidden`** (`App.css:15-26` is desktop-only).

---

## 8. Reuse inventory (cited)

### Reuse as-is — already decoupled (no component import)

`atoms/conversations.ts` (all derived atoms incl. `allConversationsAtom` `conversationAtomFamily` `streamingAtomFamily` `workersByProjectAtom`; `workerProjectRootsAtom:177`/`workerIdsAtom:182` are intentionally dead — mobile is their first consumer), `atoms/store.ts` (`jotaiStore`), `atoms/actions.ts` (`queueMessage`/`interruptAndSend`/`stop`/`setActiveConversationId`/`endConversation`/`clearQueue`/`loadConversationDetails`), `atoms/config-actions.ts` (`setConversationConfig`), `atoms/pending-creations.ts` (`createConversation`), `hooks/useWebSocket.ts` (device-agnostic), `hooks/useSwarm*`/`useProviderCatalog`/`useFolderFilter`/`useLocalStorage` (generic), `utils/fuzzyMatch.ts:28`/`time.ts`/`swarmUtils.ts`/`swarmWorkerVisibility.ts`/`subAgents.ts`, `shared/src/*` (wire schemas + `isBuddyConversation`/`getBuddyContext` helpers), `components/buddies/api.ts:1` (`buddyApi`/`asArray`) + `types.ts` + `ui-contract.ts:1` (`buddyCardMetrics` etc.), `buddy-review-message.ts` (pure parser) + `structured-message-segments.ts`.

### Reuse as logic (extract then rebuild JSX)

Buddies shaping (relationship/manager + filter/sort + `BuddyContext`, `BuddiesDashboard:100-343` → `components/buddies/buddies-shaping.ts`; ban raw `.buddyContext` reads), `SwarmDetail` exec-group builder + `extractVerdict`/`shortModelName`/`buildSwarmDebugPrefix`/`sendSwarmSignal`, `SwarmAnalytics` stats aggregation + timeline span builder (with `isEstimated` disclaimer, now in `utils/swarmAnalyticsParsers.ts`), `SwarmConvoPrefix` 3 parsers (now in `utils/swarmConvoParsers.ts`).

### Rebuild (presentation — do NOT import)

`Chat.tsx` / `Sidebar.tsx` / `BuddiesDashboard.tsx` / `SwarmDetail.tsx` / `SwarmAnalytics.tsx` rendering + all per-component CSS, `VirtualizedMessageList.tsx` (evaluate flat list vs reuse), `Gallery.tsx` / `SearchPalette.tsx` / `ConfigDropdown.tsx` / `PromptPalette.tsx`.

### Dead (ignore)

`deleteConversation`/`sendMessage`/`stopConversation`/`getQueue` (`actions.ts`) — no desktop consumers; mobile may use `stopConversation`.

---

## 9. PWA + deploy (the part v1 got half-wrong)

### PWA gaps (all missing today — zero infra)

- No `manifest.webmanifest`, no `192/512` icons, no `apple-touch-icon`, `title` is `"client"` (`client/index.html:1-13`), no `manifest`/`theme-color`/`apple-mobile-web-app-capable`/`viewport-fit=cover` meta, no `vite-plugin-pwa`/`workbox` (`client/vite.config.ts`, `client/package.json` clean).

### What PWA needs and when

SW, `beforeinstallprompt`, and push all require **SecureContext** (`https://` + valid cert or `http://localhost`). The server is plain `http.createServer` (`server/src/server.ts:72`); binding `UNLEASHD_HOST=<tailscale-ip>` alone serves `http://100.x:7489` — not secure, SW will refuse.

**Deploy for PWA is therefore `tailscale serve`, not just binding:**

```bash
# one-time on the Mac (after Tailscale on Mac + iPhone, same tailnet):
tailscale serve --bg --https=443 http://127.0.0.1:7489
# canonical URL becomes:
https://<machine>.<tailnet>.ts.net   # Tailscale-issued cert, MagicDNS
```

The app still listens on `127.0.0.1:7489` (no `UNLEASHD_HOST` change needed when using `tailscale serve`); `UNLEASHD_HOST=<tailscale-ip>` is an alternative isolation mode but not the PWA path. Either way, **no auth code in unleashd for v1** — Tailscale is the auth boundary. A future public tunnel would front with Cloudflare Access.

**Required PWA artifacts (split — link early, SW later):**

1. `client/public/manifest.webmanifest` + `192`/`512` icons + `apple-touch-icon` link — add `<link rel="manifest" href="/manifest.webmanifest">` in Phase 0 (file without link does nothing; needs `content-type: application/manifest+json`)
2. `index.html` meta in Phase 0: `theme-color`, `apple-mobile-web-app-capable` (plus deprecated `mobile-web-app-capable` alias), `apple-mobile-web-app-status-bar-style`, correct `<title>` (`"client"` → `"Unleashd"`), `viewport-fit=cover`
3. Layout hardening in Phase 0: `100dvh`/`svh`, `env(safe-area-inset-*)`, collapse desktop fixed sidebar (separate tree already does this) — or `ChatMobile` renders broken on iPhone despite working logic
4. Hardcode **no** mixed-content: `wss://` under `https://` (fix in §5#2)
5. Service worker (`vite-plugin-pwa` + Workbox **or** manual `sw.js` with `skipWaiting`/`clientsClaim`) + `beforeinstallprompt` handling + `navigator.standalone` check — **Phase 5 only**, after `https://` from Phase 4 (SW `register` throws `SecurityError` on `http://100.x`). Exclude `/api/*` and `/ws` from precache; set `express.static` with `maxAge:'1y',immutable:true` for `assets/*` once precaching.

Add-to-Home-Screen → installed standalone app. Push (iOS 16.4+, installed-only) and voice Mic→STT are post-PWA stretches.

### Launchd (headless Mac)

`pnpm build` → `node server/dist/server.js` under a launchd agent (survives reboot, no terminal). Keep AC power + `caffeinate` so clamshell doesn't suspend. Verify `https://<magicDNS>/api/audit` + `wss://<magicDNS>/ws` from iPhone before marking deploy done.

---

## 10. Phasing (corrected — TLS before SW, layout early)

| Phase | Scope | Acceptance |
|---|---|---|
| **0 — Shell** | Hoist bridge+restore+settings, `AppLayout`→`ShellDesktop` rename (§5 #1), `wss` fix (#2), `useDeviceKind` (#3), `mobile/atoms/search.ts` (#4), buddies-shaping extraction + parser exports to `utils/` (#5-6), UI state partition **+ localStorage persistence** (#7), `mutate()` helper (#8), `handleMessage` handler extraction (#9), `atomFamily.remove` on delete (#10), `100dvh`/safe-area + manifest *link* + `index.html` meta (`theme-color`/`viewport-fit=cover`/`title`) | `https://` WS connects, shell δ + leaf δ are the only device dispatch (Sidebar/ConfigDropdown/MergeModal intact on desktop), `/robot` preserved, `/done` renders `filter="done"`, desktop restore-on-load survives reload with server sync of `activeConversationId` removed, search atoms compile, no second bridge, no `http://100.x` mixed-content |
| **1 — Chats** | `ConversationListMobile` + `ChatMobile` (start **flat list**, not virtualized — iOS momentum-scroll friction; revisit Phase 6) + `ComposerMobile` + streaming merge + dual-active-id (jotai + zustand, `markMessagesSeen` + `loadConversationDetails` gating) + **lazy-load katex/highlight rehype plugins** (dynamic import in message renderer — heaviest chunk, cellular first-paint) | Open a chat on iPhone, stream a reply, send/stop/queue, seen badges correct, shell first-paint doesn't ship katex |
| **2 — Search + Swarms** | `SearchMobile` (client `mobileSearchResultsAtom` + optional `GET /api/search?q=` hybrid, `MobileSearchState` dispatch) + `SwarmsMobile` + `SwarmDetailMobile` (stacked single-pane; reuse exec-group logic) + **`usePolledFetch` helper** (§7 #8: visibilitychange pause, reconnect refetch; migrate the 3 polling hooks; `10s`/`15s` staggered, `30s` time-ago tick) | Search finds by `workingDirectory`/preview; `/api/search` finds full history; swarms show running/idle live; tap → worker list; backgrounded PWA stops polling |
| **3 — Buddies** | `BuddiesMobile` (directory via `GET /api/buddies/overview`) + `BuddyDetailMobile` (work/conversations/memory/automations tabs via `components/buddies/{api,types,ui-contract,buddies-shaping}.ts`, reads only via `getConversationKind`) | Browse buddies, open a buddy chat via `BuddyContext`, edit `provider/model/effort` (pass-through, no translation) |
| **4 — Deploy** | `tailscale serve --bg --https=443 http://127.0.0.1:7489` (MagicDNS `https://`), `tailscale serve status --json` check, launchd agent, `caffeinate`, verify `https://` + `wss://` + `GET /api/audit` on iPhone cellular (do **not** use `tailscale funnel` — public internet) | `https://<machine>.<tailnet>.ts.net` loads off-LAN, WS `wss` connects, `isSecureContext===true` |
| **5 — PWA SW** | `manifest.webmanifest` icons `192`/`512` + SW (`vite-plugin-pwa`/Workbox **or** manual, `skipWaiting`/`clientsClaim`, exclude `/api/*`+`/ws`), `beforeinstallprompt` + offline shell (verified on `https://` from Phase 4; `express.static` with `maxAge:'1y'` for `assets/*`) | Add to Home Screen installs, standalone launch, offline shell renders, no `SecurityError` |
| **6 — Polish** | `SwarmAnalytics` mobile (tap-to-inspect, not hover `SwarmAnalytics:234`), revisit flat-list vs virtualization for long threads, push (iOS 16.4+ installed-only), Mic→STT | Analytics readable; optional |
| **Post-v1 — Zustand removal** | Fold `uiStore` + `settingsStore` into jotai: `atomWithStorage` for the local slice, debounced-POST effect for the shared slice (§4). Kills dual-active-id (`Chat.tsx:327-342`), `hydrated` gate, second state model; `partitionUiState` boundaries are the migration map. Drop `zustand` from `package.json`. | One state library; `activeConversationId` has one home; restore-on-load + server sync of shared prefs still work |

Voice STT after 6. Native apps never.

---

## 11. Caveats

1. **No auth in unleashd** — only network-locality (`server/src/network.ts:1`). Tailscale is the gate; a public tunnel needs an auth proxy (Cloudflare Access) first.
2. **Broadcast to all clients** — server `broadcast()` fans every `ServerMessage` to every WS; client filters by `conversationId`. Mobile gets all 19 `ServerMessage` kinds for free by reusing the shared `handleMessage` (`atoms/actions.ts:292`) through the hoisted bridge — the rule is the inverse: **never create a second message handler**.
3. **`conversation_created` reused for updates** — idempotent handlers; `command_rejected` carries `authoritativeConversation` for rollback.
4. **No `GET /api/conversations` list** — listing is WS `init` + `conversations_updated`; mobile depends on `handleMessage` `init` snapshot.
5. **Draining/reload** — server `shutdownController` (`server.ts:232`) returns 503/`command_rejected server_draining`; WS drops — client must reconnect (existing `useWebSocket:56` 2s retry) and await `conversation_load_complete`.
6. **Some buddies HTTP shapes are `unknown` server-side** — trust client `types.ts`; add Zod parse in `buddies/api.ts` to catch drift.

---

## 12. Docs to update alongside code

- `AGENTS.md` — "Mobile view tree" section: mobile imports `atoms/*`/`hooks/*`/`utils/*`/`shared/*`/`components/buddies/{api,types,ui-contract,buddies-shaping}.ts` only; single-bridge rule; `DeviceKind` is the only shell sum type; `mobileSearchStateAtom` lives in `mobile/atoms/` (device-specific view, not canonical `conversations.ts` — note the `AGENTS.md:116` exception and why). Also document `partitionUiState` shared-vs-local rule (+ localStorage key `unleashd-ui-local`), the ban on raw `.buddyContext` reads, the mutation rule (**partial updates of collection atoms go through `mutate()`; scalar/full-replace sets stay plain `jotaiStore.set`** — current code already conforms: 20 produce sites, rest are scalars/snapshot replacement), and the never-a-second-`handleMessage` rule; fix stale `SubAgentPanel:158` `/swarms/project` link.
- **Adopt ESLint (flat config), minimal and untyped — decided 2026-08-10** (client currently has no linter; `tsc -b` already gates types, so run ESLint WITHOUT typed linting — type-aware rules are the slow part and redundant with tsc). One `client/eslint.config.js`, one `lint` script, wired into CI alongside `check:catalog`. Ruleset is deliberately tiny:
  1. `eslint-plugin-react-hooks`: `rules-of-hooks` (error) — mechanizes the AGENTS.md "React hook ordering" section (hooks after early returns); `exhaustive-deps` (warn, not error — this codebase has deliberate dep choices).
  2. Override `files: ['src/**']`, `ignores: ['src/atoms/**']` → `no-restricted-properties` banning `jotaiStore.set` (components call actions, never write atoms).
  3. Override `files: ['src/mobile/**']` → `no-restricted-properties` banning `.buddyContext`/`.purpose` reads (use `getConversationKind`), + `no-restricted-imports` banning `**/components/*` except `components/buddies/*`.
  All three gates are stock ESLint rules with per-directory overrides — zero custom plugins. Escape hatch: `eslint-disable-next-line` with a justification comment. (Considered Biome/oxlint for speed; ESLint chosen because `no-restricted-properties`/`no-restricted-imports` with path-scoped overrides are exactly the gate mechanism needed and battle-tested there; at this repo size untyped ESLint runs in seconds. Revisit only if lint time actually hurts.)
- `server/src/lifecycle/static-client.ts:6` — note `app.get('*')` is `GET` only and Express 4 vs 5 `/*splat` difference; add `maxAge` for PWA assets when SW lands.

---

## 13. Library resolutions (locked 2026-08-10)

Assessed during the v2.1 review. Net: **zero new libraries, zero replaced libraries in v1; one removal post-v1.**

| Library | Verdict | Rationale |
|---|---|---|
| **jotai** (+`jotai-family`) | **Keep — load-bearing.** | The perf model (per-ID `atomFamily` pruning, `streamingContentAtom` separation, derived views) is jotai's design used as intended. Its dependency graph ≈ reagent/cursor-style reactivity already (atoms = reactions, `atomFamily(id)` = cursors) — reimplementing would rebuild the hard part (lazy glitch-free recomputation, invalidation ordering, `useSyncExternalStore` integration) for zero delta. One fix: `.remove(id)` on delete (§5 #10). |
| **immer** | **Keep.** | Not a state manager — a pure utility computing new immutable values with structural sharing, which is exactly what makes `atomFamily`/`React.memo` pruning work. Fused with jotai via the local `mutate()` helper (§5 #8). |
| **`jotai-immer`** | **Do not add.** | Real official lib (`atomWithImmer`); we hand-roll its 3 lines instead. The dep would bifurcate the atom vocabulary (immer-flavored vs plain writes across ~40 call sites) for identical call-site ergonomics. |
| **zustand** | **Frozen v1, removed post-v1.** | Same role as jotai (client state manager) — the redundancy behind the dual-active-id wart. Post-v1 phase in §10; `partitionUiState` is the migration map. |
| **react-router v7** | **Keep, declarative mode only.** | Uses ~10% of the API — the *right* 10% for WS-push: data arrives via `init`+broadcasts into jotai, so RR data APIs (loaders/`createBrowserRouter`) would be a second data authority fighting the store. Don't roll our own: the mobile shells use nested layout routes + `<Outlet/>`, precisely where DIY routers stop being 200 lines. |
| **tanstack-query** | **Do not add.** | Three polling hooks don't justify a second data paradigm beside the WS. The two real gaps (visibility pause, reconnect refetch) fit in `usePolledFetch` (§7 #8). |
| **@tanstack/react-virtual** | **Keep (desktop).** | Mobile threads start flat (Phase 1); revisit in Phase 6 only if long threads demand it. |
| **react-markdown + katex + highlight.js** | **Keep, lazy-load the heavy plugins.** | Heaviest chunk; dynamic-import katex/highlight rehype plugins in the message renderer so mobile shell first-paint doesn't pay for math typesetting (Phase 1). |

Standing rule: a microlib is justified only when a dependency is unstable, huge, or fighting the architecture. None apply here — hand-rolling the router or store would swap maintained code for owned bugs at the same API surface.
