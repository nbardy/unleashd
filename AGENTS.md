# AGENTS.md — Agentic Coding Guide

Index for agents. Hard rules inline; read the linked doc BEFORE working in
that area.

## Code tree map

```
shared/src/index.ts                → Zod schemas, types, per-provider helpers
server/src/server.ts               → Conversation class + WS router (state authority)
server/src/adapters/*              → registry/disk-adapter/loader: session persistence
server/src/auth/*                  → shared-secret gate (policy/gate/express)
server/src/providers/*             → thin Provider impls per CLI
vendor/agent-cli-tool/             → GIT SUBMODULE: canonical request → argv →
                                     process → unified event stream. Thin wrapper;
                                     harness differences live at its edges only.
client/src/atoms/*                 → jotai atoms, derived views, WS actions
client/src/components/{Sidebar,Chat,ProviderModelPicker}.tsx → main desktop UI
client/src/mobile/*                → mobile view tree (second shell, same core)
client/src/atoms/ui.ts             → persisted UI prefs (local+shared partition)
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
- Auth gate stays FIRST in the Express chain and the WS stays `noServer` +
  explicit `upgrade` handler. `new WebSocketServer({ server })` accepts every
  upgrade before app code runs and republishes the whole command channel.
  Same for the Vite dev server: Connect middleware never sees `upgrade`, so
  the HMR socket needs its own `prependListener('upgrade')` gate.
- Provider-bespoke values (effort levels etc.) pass through verbatim as
  `z.string()`; no shared enums, no value translation, server-side defaults.
- Submodule commits: commit + push INSIDE `vendor/agent-cli-tool` first, then
  bump the outer pointer. Never push main unless the user asks.
- Never `git reset --hard`, `filter-branch`, `filter-repo`, or `rebase -i` on a shared branch — they orphaned 5a6cf40/79a8381 on 2026-08-20. Use `git stash` or a throwaway branch and ask. Guarded in `.claude/settings.local.json` (deny) + `~/.zshrc` wrapper.
- Prefer one integration test through a real boundary over mock-heavy units;
  never assert on TSX/CSS source text.

## Read before touching

| Area | Doc |
|---|---|
| Client state: subscriptions, mutations, perf, hook ordering | `docs/client-state.md` |
| Mobile view tree, grep gates, DeviceKind, UI-state partition | `docs/mobile-view-tree.md` |
| Mobile UI primitives, styling layers, extraction rules | `docs/mobile-ui.md` |
| Architecture: provider seam, submodule rules, lifecycle | `docs/architecture.md` |
| Auth: shared secret, bind policy, why plain-http LAN is the weak path | `docs/auth.md` |
| Per-conversation settings + pass-through pattern (7-step checklist) | `docs/pass-through-pattern.md` |
| WS contract surprises (`conversation_created` reused for updates, optimistic stubs) | `docs/ws-contract-surprises.md` |
| Submodule commit dance + `git status` cheatsheet | `docs/git-submodule-dance.md` |
| Test strategy: useful vs overkill, lifecycle authority | `docs/test-strategy.md` |
| New provider integration protocol | `docs/agent_client_spec.md` |

## Misc

- Adding a provider: harness (submodule) + `server/src/providers/{name}.ts` +
  `ProviderSchema` in shared + registry entry + disk adapter if persisted.
- Buddy sections are ROUTES, not tab state: `/buddies/:buddyId/:tab` with
  `/buddies/:buddyId` redirecting onto the default tab. Tab segments and labels
  live in `client/src/components/buddies/buddy-tabs.ts` (pure, mobile-safe).
  Tab strips are `<Link>`s so Back returns to the previous tab instead of
  leaving the buddy, and a tab survives reload.
- Any "open this conversation" affordance must be a `<Link to={/chat/:id}>`
  AND availability-checked against `allConversationIdsAtom`. Deleting a
  conversation only terminalises its buddy link row, and an automation run
  keeps its `conversation_id` forever — navigating to a thread the client no
  longer holds hits `Chat.tsx`'s `navigate('/')` bounce, which reads to the
  user as "Open took me to the conversation list." Guarded by
  `client/test/buddy-conversation-links.test.tsx`. A button is still correct
  where the click CREATES the thread (`talk()`, the Buddy Builder, delegate /
  review, find-or-create on a project) — there is no id to put in an href yet.
- Client component tests are `.tsx` under `client/test/` and render through
  `react-dom/server` + `MemoryRouter` (no jsdom). They need
  `--tsconfig client/tsconfig.app.json` or JSX compiles with the classic
  runtime and every component throws `ReferenceError: React is not defined`.
  `pnpm test:client` passes it. See `docs/test-strategy.md`.

- Typecheck the client with `tsc -b`, never `tsc --noEmit`. `client/tsconfig.json`
  is a solution file (`"files": []` + project references), so plain
  `tsc --noEmit` checks ZERO files and exits 0 on a broken tree — it reported
  success on three `ReferenceError`-grade unresolved identifiers on 2026-08-20.
  `vite build` does not catch them either (esbuild strips types, no scope
  analysis). `pnpm typecheck` (dev-supervisor) runs `tsc -b`; when the
  supervisor lock is held by another session, run `pnpm -C client exec tsc -b`
  directly rather than falling back to `--noEmit`.
- When source is broken, `server/dist/*.js` (and `shared/dist/`) is the oracle
  for the author's prior intent — check it before git archaeology.
- The formatter is **biome** (`pnpm format`, `pnpm lint:fix`; config in
  `biome.json` — single quotes, width 100). There is no prettier config, so
  `npx prettier --write` fetches prettier with ITS defaults and reformats
  whole files (single → double quotes), burying a 20-line change in a
  700-line diff. Never reach for prettier here.
- CSS is global (plain `.css` imports, no modules), so one class defined in
  two files silently fights over the cascade — import order picks the winner.
  Prefix component classes with the component (`.chat-config-summary`, not
  `.config-summary` — that one is SwarmDetail's, with `flex-direction:
  column`). Genuinely shared primitives (`.empty-state`, `.provider-badge`)
  live once in `client/src/App.css`. Gate G6 in
  `tools/check-client-invariants.sh` fails on any cross-file duplicate.
- Callbacks handed to a library are called with the library's arity, not
  yours. `handleFilesUpload` goes straight into react-dropzone's `onDrop`,
  which invokes it as `(acceptedFiles, fileRejections, event)` — a defaulted
  second parameter silently receives `fileRejections`, and `tsc` allows it
  because a 1-arg function fits a 3-arg slot. Keep such callbacks unary and
  put the extra state in a helper (`uploadFilesWithDrainRetry`).
- Sidebar rows are ONE line. `.done-btn` is an absolute overlay on the row's
  right edge, so anything else anchored right (`.thread-stop-btn`) sits under
  it and stops receiving clicks. Two-line rows hid this; single-line rows do
  not. Guarded by `.conversation-item:has(.thread-stop-btn):hover .done-btn`.
