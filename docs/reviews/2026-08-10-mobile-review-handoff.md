# Handoff — Mobile PWA v1 review + AGENTS.md restructure (2026-08-10)

## RESOLUTION (2026-08-11) — all items closed except one

The muse session read this doc and fixed its own issues (commits `837931d`,
`35f0bee`, `f036172`); the review session then independently verified each fix:

- **Issue 1 (slim AGENTS.md)** — restored at 58 lines; 7-step checklist moved
  into `docs/pass-through-pattern.md`. Verified on disk.
- **Issue 2 (G3 gate holes)** — rewritten as a path-resolving node script.
  Adversarially verified: a planted `import ... from '../components/Chat'` in
  `mobile/index.ts` (the exact hole) is now caught; gate fails as intended.
- **Issue 3 (alias)** — `MobileSearchStateAtom` removed; zero rg hits.
- **Issue 4 (BuddyDetail split)** — tabs split into sibling files
  (`BuddyDetail{ProfileEditor,AutomationsTab,MemoryTab,...}.tsx`); main file
  down to ~18K.
- **Issue 5 (stale link)** — `/swarms/project` gone; zero rg hits.
- **Follow-up 3 (runtime verification)** — done in-browser at 375×812:
  `/` (913 convos), `/search` (live filtering, 207 matches), `/buddies`,
  `/workers`, `/chat/:id` (streaming indicator, composer) all render with
  live data. Exactly one `WebSocket connected` per page load (single-bridge
  invariant holds); WS init 2001 conversations + live `conversations_updated`
  pushes. Only console errors were transient dev-server-restart blips.
- **Follow-up 4 (CI)** — `pnpm check:client-invariants` runs in
  `.github/workflows/publish.yml`. `tsc --noEmit` exit 0, all 3 gates PASS at
  final verification.

**Follow-up 8 closed (2026-08-13):** uiStore folded into jotai
`client/src/atoms/ui.ts` — `atomWithStorage` on the same `unleashd-ui-local`
key/blob (old data loads as-is), per-field derived atoms, plain action
functions (G1 holds), debounced `/api/ui-state` POST with the hydration gate.
zustand remains only for `stores/settingsStore.ts` (separate scope).
Runtime-verified: restore-on-load, localStorage round-trip, POST 200s, no
console errors. Nothing from this handoff remains open.

---

Context: mobile v1 was built by a muse-spark-1.2 session while a parallel
Claude session reviewed the work and restructured AGENTS.md. This doc is the
single list of issues found and follow-up work. Read top to bottom before
touching AGENTS.md or the mobile tree.

## Review verdict (as of mid-build)

Quality was **good, not slop**. At review time: `npx tsc --noEmit` clean, all
3 grep gates pass, App.tsx stub-swap clean, `useDeviceKind` exactly to spec
(sum type, typed throw, sticky cache), and `BuddyDetailMobile.tsx` imports
only through the sanctioned seams (`components/buddies/{api,types,ui-contract,
buddies-shaping}`) with zero desktop-component imports and zero raw
`.buddyContext` reads. Re-run both checks after the session finishes — more
files changed after this review (`atoms/mutate.ts`, `stores/uiStore.ts`,
`components/SwarmAnalytics.tsx`).

## Issue 1 — AGENTS.md slim index was clobbered (restore it)

The review session pruned AGENTS.md 23.5K → 20K, then rewrote it as a
58-line / 3.2K index after moving every prose section into docs/. The muse
session then overwrote AGENTS.md with its pre-slim 410-line copy (a
concurrent-write clobber, not a decision — byte-identical to the old version).

Current state: the 410-line AGENTS.md AND the split docs both exist, i.e. the
content is fully duplicated. The docs/ files are canonical:

- `docs/client-state.md` — subscriptions, mutations, collection views, hook
  ordering, perf checklist
- `docs/mobile-view-tree.md` — mobile section (grep gates, DeviceKind,
  UI-state partition, single-bridge rules)
- `docs/architecture.md` — provider seam, submodule core rules, lifecycle
- `docs/pass-through-pattern.md` — pass-through rules + anti-patterns
- `docs/ws-contract-surprises.md`, `docs/git-submodule-dance.md`,
  `docs/test-strategy.md`

**Action (after the muse session ends):** replace AGENTS.md with the slim
index in the Appendix below. Before doing so, diff the current AGENTS.md
mobile section against `docs/mobile-view-tree.md` and port any NEW content
muse added after the split. One special case: the "Adding a per-conversation
setting (quick checklist)" 7-step list currently lives ONLY in AGENTS.md —
move it into `docs/pass-through-pattern.md` (which references it) before
slimming, or it is lost.

**Convention going forward:** AGENTS.md is a ~60-line index (hard rules +
read-before-touching table). Deep-dives go in docs/ with one table row. The
32K muse subagent limit means AGENTS.md itself must stay under ~21K expanded
(~11K harness overhead) — the old 410-line file was being silently truncated
mid-file in subagent contexts.

## Issue 2 — G3 grep gate has holes (tools/check-client-invariants.sh)

G3 (no desktop-component imports in mobile/) excludes `from '../components`
to allow mobile's own `mobile/components/` dir — but for a file at `mobile/`
root (e.g. `mobile/index.ts`), `../components` resolves to the DESKTOP
`client/src/components/`. Such an import slips through the gate.

Fix: stop pattern-matching relative-import text. Resolve each import against
the importing file's dir and fail if the resolved path is under
`client/src/components/` and not `client/src/components/buddies/`. A ~15-line
node script is more robust than grep -v chains.

Also: the gate silently allowlists `components/buddy-review-message` and
`components/structured-message-segments`, but the documented rule
(docs/mobile-view-tree.md "What mobile may import") says buddies/ is the ONLY
exception. Either add the two parsers to the doc with the pure-logic
justification, or move them to `utils/` and drop the allowlist lines. Gate
and doc must agree.

## Issue 3 — spec-compliance artifact in mobile/atoms/search.ts

`export const MobileSearchStateAtom = mobileSearchStateAtom;` (line ~14) is a
duplicate export created to satisfy a spec name literally. Delete the alias,
keep `mobileSearchStateAtom`, fix any importers.

## Issue 4 — BuddyDetailMobile.tsx size (1,034 lines)

Structured (main component + WorkTab/ConversationsTab/MemoryTab/
AutomationsTab/BuddyProfileEditor) but the main component is ~400 lines
before tabs. Not urgent; split the tab components into sibling files the next
time anyone touches this screen, before it becomes a monolith.

## Issue 5 — stale link in desktop SubAgentPanel

`client/src/components/SubAgentPanel.tsx:158` links to `/swarms/project`, a
dead route (noted by muse itself in its AGENTS.md mobile section). Retarget
to `/workers/detail` or remove. Verify mobile didn't copy the stale path.

## Follow-up work (in rough priority order)

1. Restore slim AGENTS.md per Issue 1 (after muse finishes; port new deltas).
2. Fix G3 gate holes + reconcile gate-vs-doc allowlist (Issue 2).
3. Runtime verification: the review was static only (tsc + greps). Load the
   app at ≤768px, walk `/`, `/chat`, `/buddies/:id`, `/swarms`, `/search`;
   verify one WS bridge (network tab: exactly one socket), composer draft
   survives navigation, search filters live.
4. Wire `pnpm check:client-invariants` into CI / pre-commit so the gates run
   without anyone remembering to.
5. Delete the `MobileSearchStateAtom` alias (Issue 3).
6. Fix `/swarms/project` stale link (Issue 5).
7. Split BuddyDetailMobile tabs into files (Issue 4, opportunistic).
8. Post-v1 (from PLANNING_MOBILE.md §4): fold the uiStore shared/local
   partition into jotai `atomWithStorage`.
9. Commit strategy: mobile work + AGENTS.md/docs restructure are entangled in
   one dirty tree. Commit mobile first (muse's work), then the docs
   restructure, so each is revertable separately. Do not push without asking.

## Appendix — slim AGENTS.md to restore

```markdown
# AGENTS.md — Agentic Coding Guide

Index for agents. Hard rules inline; read the linked doc BEFORE working in
that area.

## Code tree map

```
shared/src/index.ts                → Zod schemas, types, per-provider helpers
server/src/server.ts               → Conversation class + WS router (state authority)
server/src/adapters/*              → registry/disk-adapter/loader: session persistence
server/src/providers/*             → thin Provider impls per CLI
vendor/agent-cli-tool/             → GIT SUBMODULE: canonical request → argv →
                                     process → unified event stream. Thin wrapper;
                                     harness differences live at its edges only.
client/src/atoms/*                 → jotai atoms, derived views, WS actions
client/src/components/{Sidebar,Chat,ProviderModelPicker}.tsx → main desktop UI
client/src/mobile/*                → mobile view tree (second shell, same core)
client/src/stores/uiStore.ts       → persisted UI prefs
```

## Hard rules (violations = rejected PR)

- Never `useAtomValue(conversationsAtom)` in components — use
  `conversationAtomFamily` / derived atoms. Streaming text goes to
  `streamingContent`/streaming atoms, never `conversations.messages` mid-stream.
- All hooks before any early `return`. New list views go in derived atoms, not
  component `useMemo`. Stable fallbacks are module constants.
- `jotaiStore.set` only inside `client/src/atoms/` (via `mutate()` for partial
  updates). Mobile never imports `components/*` except `components/buddies/`.
  Gates: `bash tools/check-client-invariants.sh`.
- One WS bridge (`App.tsx`), one `handleMessage` spine — never a second.
- Provider-bespoke values (effort levels etc.) pass through verbatim as
  `z.string()`; no shared enums, no value translation, server-side defaults.
- Submodule commits: commit + push INSIDE `vendor/agent-cli-tool` first, then
  bump the outer pointer. Never push main unless the user asks.
- Prefer one integration test through a real boundary over mock-heavy units;
  never assert on TSX/CSS source text.

## Read before touching

| Area | Doc |
|---|---|
| Client state: subscriptions, mutations, perf, hook ordering | `docs/client-state.md` |
| Mobile view tree, grep gates, DeviceKind, UI-state partition | `docs/mobile-view-tree.md` |
| Architecture: provider seam, submodule rules, lifecycle | `docs/architecture.md` |
| Per-conversation settings + pass-through pattern (7-step checklist) | `docs/pass-through-pattern.md` |
| WS contract surprises (`conversation_created` reused for updates, optimistic stubs) | `docs/ws-contract-surprises.md` |
| Submodule commit dance + `git status` cheatsheet | `docs/git-submodule-dance.md` |
| Test strategy: useful vs overkill, lifecycle authority | `docs/test-strategy.md` |
| New provider integration protocol | `docs/agent_client_spec.md` |

## Misc

- Adding a provider: harness (submodule) + `server/src/providers/{name}.ts` +
  `ProviderSchema` in shared + registry entry + disk adapter if persisted.
- When source is broken, `server/dist/*.js` (and `shared/dist/`) is the oracle
  for the author's prior intent — check it before git archaeology.
```
