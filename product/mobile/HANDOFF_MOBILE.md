# HANDOFF — Mobile PWA (unleashd) → Muse eng team

_Date: 2026-08-10. State: Phases 0-3 + 6-partial implemented, reviewed, re-reviewed, verified on disk. Phases 4-5 (deploy + service worker) NOT started — they are the remaining work._

## 0. Addendum (2026-08-10, follow-up session) — smoke test done, follow-ups closed, one critical server fix

- **Runtime smoke test: PASSED** (in-browser at 375×812 against the live server + freshly built client). Chats list renders live data with streaming updates, Swarms renders (empty state correct), Search UI renders both sections, tab bar + safe-area correct. Buddies and deep-history Search returned 500 — diagnosed as the **stale running server**, not the new code: the current build returns 200 on `/api/search`, `/api/buddies/overview`, `/api/providers` (verified on an isolated instance, `PORT=7777` + `UNLEASHD_DATA_DIR` sandbox).
- **CRITICAL fix landed (`8b09f54`): the server build could not boot.** `providers/catalog.ts` and `providers/opencode.ts` used `import.meta` inside CJS-compiled code; Node 24's module-syntax detection classifies the emitted file as ESM → `exports is not defined in ES module scope` at require time. The live server only runs because it predates the catalog-unification commit — **without this fix, the first restart (or the launchd deploy in Phase 4) would crash-loop.** Fix: `__dirname` in catalog.ts (with a regression-guard comment), opencode.ts migrated onto the unified `loadProviderModels`. Restart the live server on the new build at the next convenient moment; Buddies + deep Search on mobile start working at that point.
- **Follow-up closed (`fd01a78`, `33c5c4b`):** desktop `useSwarmRuntimeSnapshots` + `useSwarmProjects` migrated onto `usePolledFetch` (now with a `PolledSource` fetcher variant for multi-URL cycles); public signatures unchanged; visibility pause + reconnect refetch now apply on desktop too.
- **Follow-up closed (`568bf06`):** katex/highlight bundle split — one shared `utils/lazyMarkdownPlugins.ts` loader for both shells; entry JS 1,325→877 kB (−34%), katex (266 kB), highlight (174 kB) and their CSS are now async chunks; KaTeX fonts verified.
- Verification at close: client `tsc -b` clean, all 3 invariant gates pass, client + server builds green, isolated server boots.
- Note: a parallel session is evolving the mobile IA (MainScreen hub removal → Chats-as-home); its uncommitted work was left untouched and is not part of the commits above. There is also a second review-track handoff at `docs/reviews/2026-08-10-mobile-review-handoff.md`.

---

## 1. Where things stand

**Branch:** everything is merged to `main` (`0e8f381` merge, `851ea5e` fixes, plus 3 earlier mobile commits). The `/tmp/mobile-pwa-v1.bundle` artifact is obsolete — do not apply it; it carries a pre-split `AGENTS.md` that would conflict.

**Uncommitted tail on disk (coherent, verified, needs a commit):** `buddy-review-message.ts` + `structured-message-segments.ts` moved `components/` → `utils/` (old paths left as re-export shims), `MessageRow.tsx` re-pointed, `check-client-invariants.sh` updated, small `mobile/index.ts` / `search.ts` cleanups, docs. Gates and tsc pass WITH this tail; commit it as-is.

**Verification actually run on the current tree (2026-08-10):**

| Check | Result |
|---|---|
| `npx tsc -b` (client, incl. shared refs) | clean (was 31 errors pre-review) |
| `bash tools/check-client-invariants.sh` | G1/G2/G3 all PASS |
| `pnpm --filter @unleashd/client build` (vite prod) | builds in ~2.7s |
| Rendered-app smoke test on a phone/simulator | **NOT done — do this first** |

## 2. What this is (60-second architecture)

Two view trees over one shared core — mobile is NOT a fork. Read `product/PLANNING_MOBILE.md` (v2.1, the authoritative plan) and the "Mobile view tree" section of `AGENTS.md` before touching anything.

- One `jotaiStore`, one WS socket, one `handleMessage` spine (`client/src/atoms/actions.ts`) shared by both trees. **Never mount a second WS bridge or write a second message handler.**
- Device dispatch is two thin δ's in `client/src/App.tsx`: `SHELLS[device]` picks `ShellDesktop` (Sidebar + ConfigDropdown + merge mode) or `ShellMobile` (bottom tabs); a `ROUTES` table of element factories picks the leaf per route. `DeviceKind = 'mobile'|'desktop'`, computed once per page load (sticky), typed throw if `matchMedia` is missing. Leaf components never re-ask "is mobile".
- Mobile may import `atoms/*`, `hooks/*`, `utils/*`, `shared/*`, `components/buddies/{api,types,ui-contract,buddies-shaping}` — never other `components/*.tsx`. Enforced by `tools/check-client-invariants.sh` (run via `pnpm check:client-invariants`).
- State rules: partial updates of collection atoms via `mutate()` (`atoms/mutate.ts` — hand-rolled jotai-immer, do not add the dep); streaming text goes to `streamingContentAtom` and merges at render; lists subscribe per-ID (`allConversationIdsAtom` + `conversationAtomFamily`), never `conversationsAtom`.
- UI prefs: `stores/uiStore.ts` `partitionUiState` splits 4 server-synced fields from 7 device-local fields; local slice persists to `localStorage['unleashd-ui-local']` (written unconditionally; only the server POST waits on the `hydrated` gate).

## 3. Review history you should know about

The initial multi-worker implementation had 9 blockers, all since fixed and re-verified on disk. The two worth remembering because they were invisible to tooling:

1. **Mobile routes were wired to local `null`-returning stubs** while the real components sat finished in `client/src/mobile/` — compiled cleanly, rendered blank. Fixed: `App.tsx:91-99` imports the real components; `/search` route added (`App.tsx:110`).
2. **`ProviderModelPickerMobile` shadowed `patch`** so config changes sent a function reference over the wire. Fixed via `applyPatch` rename.

Others (all fixed): `mutate()` type signature (`PrimitiveAtom`+`Draft`), hand-rolled patch union in `BuddyDetailMobile` (now imports `ConversationConfigPatch`), missing type imports in desktop `SwarmAnalytics`, string-vs-Date in `SwarmAnalyticsMobile`, localStorage write trapped behind the `hydrated` gate (now unconditional), `usePolledFetch` doc overclaim (corrected).

Confirmed-good under review (don't re-litigate): `handleMessage` extraction preserved all six legacy behaviors (chunk flush, status flush, optimistic rollback via `authoritativeConversation`, init reconciliation, seen-marking, idempotent `conversation_created`); `atomFamily.remove` cleanup on delete covers every id-keyed family; `ChatMobile`/`ConversationListMobile`/`ComposerMobile` follow all §7 patterns.

## 4. Remaining work (in order)

1. **Smoke test on a real phone** — nobody has rendered this on a device yet. Fastest loop: `pnpm build && node server/dist/server.js`, then Safari on iPhone via LAN, or desktop browser at ≤768px width (device kind is sticky per page load — reload after resizing).
2. **Phase 4 — deploy** (PLANNING_MOBILE.md §9-10): `tailscale serve --bg --https=443 http://127.0.0.1:7489`, launchd agent, `caffeinate`, verify `https://<machine>.<tailnet>.ts.net` + `wss://` + `isSecureContext===true` from iPhone cellular. Do NOT use `tailscale funnel`. No auth code in unleashd — Tailscale is the boundary.
3. **Phase 5 — service worker** (only after Phase 4; SW registration throws on non-secure origins): vite-plugin-pwa or manual `sw.js` with `skipWaiting`/`clientsClaim`; exclude `/api/*` + `/ws` from precache; `express.static` `maxAge:'1y',immutable` for assets.
4. **Follow-ups (small, filed intentionally):**
   - Migrate desktop `useSwarmRuntimeSnapshots` + `useSwarmProjects` onto `hooks/usePolledFetch.ts` (they still poll hidden tabs; the helper — visibility pause + WS-reconnect refetch — is built and proven by the mobile swarm views).
   - Bundle is one 1.3 MB chunk: mobile `MessageRow` lazy-loads katex/highlight but desktop `Chat` imports them statically, defeating the split. Lazy-load on desktop too (or manualChunks).
   - `mobileSearchResultsAtom` derives from `allConversationsAtom` — accepted exception (full-text search needs all conversations) but it re-filters on any streaming update while Search is mounted. Fine at current scale; documented here so it's a decision, not an accident.
5. **Post-v1 (planned, don't start mid-phase):** remove zustand — fold `uiStore`/`settingsStore` into jotai (`atomWithStorage` local slice, debounced-POST effect shared slice); `partitionUiState` is the migration map. Also planned: minimal untyped ESLint flat config (react-hooks rules + path-scoped no-restricted-* replacing the grep gates). Both specced in PLANNING_MOBILE.md §4/§12/§13.

## 5. Ground rules that bite (violations found in the wild during this build)

- **Verification means compile + render, not greps.** The blank-screen stub bug passed every grep gate and tsc. Run `npx tsc -b`, the gate script, AND open the app before calling anything done.
- `conversation_created` is reused for updates; handlers must stay idempotent. `command_rejected` carries `authoritativeConversation` for rollback — any new optimistic write needs a schema-complete stub AND rollback handling.
- Every hook before any early return (React crash class; will be machine-enforced once ESLint lands).
- No new libraries without reading PLANNING_MOBILE.md §13 — the jotai-immer / tanstack-query / DIY-router debates are settled there.

## 6. Doc map

| Doc | What's in it |
|---|---|
| `product/PLANNING_MOBILE.md` (v2.1) | The plan — architecture, phases, library resolutions (§13), all locked decisions |
| `AGENTS.md` + `docs/*.md` | Agent quick-reference; deep dives split into docs/ (architecture, client-state, mobile-view-tree, ws-contract-surprises, pass-through-pattern, test-strategy) |
| `tools/check-client-invariants.sh` | The three grep gates (G1 atoms-only writes, G2 no raw buddyContext in mobile, G3 no desktop-component imports) |
| This file | Status + handoff |
