# AGENTS.md — Agentic Coding Guide

Index for agents. Hard rules inline; read the linked doc BEFORE working in
that area.

## Code tree map

```
shared/src/index.ts                → shared exports + WS Zod schemas/types
shared/src/conversation-config.ts   → canonical selection intent, patches, resolution
shared/src/provider-catalog.ts      → provider identities + catalog schemas
server/src/server.ts               → application composition and startup
server/src/conversations/runtime.ts → Conversation class + active turn state authority
server/src/conversations/config-{service,store}.ts → durable configuration and revisions
server/src/transport/conversation-websocket.ts → WS command routing
server/src/observability/error-journal.ts → durable grouped server/client failures
server/src/adapters/*              → registry/disk-adapter/loader: session persistence
server/src/auth/*                  → shared-secret gate (policy/gate/express)
server/src/providers/*             → thin Provider impls per CLI
vendor/agent-cli-tool/             → GIT SUBMODULE: canonical request → argv →
                                     process → unified event stream. Thin wrapper;
                                     harness differences live at its edges only.
client/src/atoms/*                 → jotai atoms, derived views, WS actions
client/src/components/{Sidebar,Chat,ConversationConfigPicker}.tsx → main desktop UI
client/src/mobile/*                → mobile view tree (second shell, same core)
client/src/atoms/ui.ts             → persisted UI prefs (local+shared partition)
```

## Hard rules (violations = rejected PR)

- Never `useAtomValue(conversationsAtom)` in components — use
  `conversationAtomFamily` / derived atoms. Streaming text goes to
  `streamingContent`/streaming atoms, never `conversations.messages` mid-stream.
- All hooks before any early `return`. New list views go in derived atoms, not
  component `useMemo`. Stable fallbacks are module constants.
- Read-only server data goes through `usePolledFetch(source, intervalMs)`,
  never a bare `fetch(...).then(setState)` inside `useEffect`. Results live in
  the keyed cache in `client/src/atoms/resources.ts`, NOT in component state,
  so a remount renders the cached value immediately and revalidates behind it —
  that is what stopped every mobile page visit from waiting on a round trip.
  The cache key is the identity of the DATA: a plain URL string, or
  `resource(key, load)` when one load fans out into several requests (thread
  `signal` into every inner `fetch`). A bare `(signal) => Promise<T>` fetcher is
  rejected by the type — with no key there is nothing to cache under, and it is
  the un-keyed form that made seven panels show the previous project's data
  after a fast switch until 2026-09-06 (SwarmDetail, SwarmAnalytics,
  UsagePanel). Keying supersedes the old abort-on-change guard: a late response
  lands on its own key, which whoever switched away is no longer reading, so
  never re-add a `data.id === currentId` check at a call site.
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
- Verify the COMMIT, not the working tree. `git` cannot stage part of a file
  non-interactively, this repo forbids stashing, and the tree routinely carries
  150+ dirty files from concurrent sessions — so a multi-file change can land
  half-applied and still verify green, because the checks read the dirty tree
  where the missing piece still exists uncommitted. 48724f4 committed
  `conversation-routes.ts` importing two symbols while the file DEFINING them
  stayed unstaged: at HEAD they had four consumers and zero definitions, and it
  passed review anyway (repaired in afbcff3). Before calling anything verified,
  either confirm `git status --porcelain` is empty (tree == HEAD, so the checks
  you ran ARE checks of the commit) or check the commit directly with
  `git grep <symbol> HEAD`. Stage file-by-file so concurrent sessions' work is
  never swept in.
- Never `git reset --hard`, `filter-branch`, `filter-repo`, or `rebase -i` on a shared branch — they orphaned 5a6cf40/79a8381 on 2026-08-20. Use `git stash` or a throwaway branch and ask. Guarded in `.claude/settings.local.json` (deny) + `~/.zshrc` wrapper.
- Prefer one integration test through a real boundary over mock-heavy units;
  never assert on TSX/CSS source text.
- Foreground Buddy deadlines must receive `TURN_MAX_RUNTIME_MS` explicitly;
  never inherit the background claim's 600-second default. Automatic expiry
  uses `max_runtime_timeout`, not `stop()` / `user_stop`. Preserve the packaged
  authority and runtime regression tests when changing timers or Buddy versions.
  History: `docs/incident-2026-09-10-buddy-chat-timeout.md` (distinct from the
  August bridge-heartbeat fix).

## Read before touching

For any Buddy model, tool or execution change, start with
[the lean core design](product/buddies/CORE_DESIGN.md). Name the concrete workflow
gap before adding a concept or controller; reuse its canonical authority and
identify what existing code the change replaces. Historical proposals are not
requirements to rebuild omitted machinery.

| Area | Doc |
|---|---|
| Buddies: core model, motivating cases, rationale and scope | `product/buddies/CORE_DESIGN.md` |
| Client state: subscriptions, mutations, perf, hook ordering | `docs/client-state.md` |
| Mobile view tree, grep gates, DeviceKind, UI-state partition | `docs/mobile-view-tree.md` |
| Mobile UI primitives, styling layers, extraction rules | `docs/mobile-ui.md` |
| Architecture: provider seam, submodule rules, lifecycle | `docs/architecture.md` |
| Auth: shared secret, bind policy, why plain-http LAN is the weak path | `docs/auth.md` |
| Per-conversation settings + pass-through pattern (7-step checklist) | `docs/pass-through-pattern.md` |
| WS contract: correlated creation/config commands, summaries, pending state | `docs/ws-contract-surprises.md` |
| Submodule commit dance + `git status` cheatsheet | `docs/git-submodule-dance.md` |
| Test strategy: useful vs overkill, lifecycle authority | `docs/test-strategy.md` |
| Error journal: capture policy, storage, inspection, acknowledgement | `docs/error-journal.md` |
| Buddy automations: ownership, budgets, capture, cancellation | `product/buddies/AUTOMATION_OWNERSHIP.md` |
| Buddy coordination: send/reply, bounded waiting, open purposes | `product/buddies/PLANNING_PRIMITIVES.md` |
| Buddy team setup and operation: readiness, preview/apply, work and returns | `product/buddies/TEAM_OPERATOR_GUIDE.md` |
| Direct reports: owner-granted staffing, relationships, retirement, threat model | `product/buddies/PLANNING_SUB_BUDDIES.md` |
| Buddy memory: dense revisions, notes, capture, recall | `product/buddies/PLANNING_MEMORY.md` |
| Memory reviewer benchmark: rerun, grade, extend, historical evidence (read before changing reviewer prompts/tools) | [Memory curation benchmark](server/test/fixtures/memory-curation/README.md) |
| New provider integration protocol | `docs/agent_client_spec.md` |

## Misc

- Inspect unresolved operational failures with `pnpm errors:list`; do not read or
  mutate the JSONL journal directly. Its configured location and capture policy
  are documented in `docs/error-journal.md`.
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
  `client/test/` is NOT covered by `tsc -b` (the app project compiles `src`
  only), so a test that passes props a component no longer accepts typechecks
  clean and fails at runtime with something unrelated-looking — a renamed
  `ConversationsTab` prop surfaced as `Cannot read properties of undefined
  (reading 'flatMap')` inside a jotai atom on 2026-09-16. Run `pnpm test:client`
  after renaming any prop a test constructs; a green typecheck proves nothing
  about the tests.

- Typecheck the client with `tsc -b`, never `tsc --noEmit`. `client/tsconfig.json`
  is a solution file (`"files": []` + project references), so plain
  `tsc --noEmit` checks ZERO files and exits 0 on a broken tree — it reported
  success on three `ReferenceError`-grade unresolved identifiers on 2026-08-20.
  `vite build` does not catch them either (esbuild strips types, no scope
  analysis). `pnpm typecheck` (dev-supervisor) runs `tsc -b`; when the
  supervisor lock is held by another session, run `pnpm -C client exec tsc -b`
  directly rather than falling back to `--noEmit`.
- Recursive `rg` output is rewritten by rtk and is NOT safe to cite. The hook
  turns directory-target searches into `rtk rg`, which substitutes tokens
  silently (`compact_memory` reads back as `n_memory`, `compactProject` as
  `nProject`) and drops line numbers. Single-FILE searches pass through intact.
  Locate with a recursive search, then re-run against the one file before you
  quote, cite `file:line`, or conclude a symbol is absent. `rtk proxy` does not
  help. Same root cause as `git diff > x.patch` capturing a hunk-less summary —
  rtk output is for reading, never for capturing or citing. See
  `agent_notes/2026-08-22_memory-implementation-handoff_buddies-development-lead.md`.
- When source is broken, `server/dist/*.js` (and `shared/dist/`) is the oracle
  for the author's prior intent — check it before git archaeology.
- The formatter is **biome** (`pnpm format`, `pnpm lint:fix`; config in
  `biome.json` — single quotes, width 100). There is no prettier config, so
  `npx prettier --write` fetches prettier with ITS defaults and reformats
  whole files (single → double quotes), burying a 20-line change in a
  700-line diff. Never reach for prettier here.
  `biome.json` ignores `vendor` wholesale. It previously ignored only
  `vendor/agent-cli-tool/manual_tests/runs`, so a root `pnpm format` reformatted
  the SUBMODULE's source — the submodule carries no formatter config of its own,
  so it inherits width-100 biome and reflows every one-line `catalog.jsonc`
  model entry. That produced a 189-line, semantically-zero submodule diff on
  2026-09-06 which then demands a commit + push inside the submodule and an
  outer pointer bump, for no behaviour change. Never format across `vendor/`.
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
- Sidebar recent-folder groups key on `folderGroupKey()`, never the raw
  `workingDirectory`. Oompa runs one worktree per iteration
  (`<repo>/.ws<swarm>-w3-i7`), so the raw key gave every iteration its own group
  header — 1,107 groups for one repo on 2026-09-06, all rendering as the same
  truncated `~/git/room-runners-aren…`. The fold is `getProjectRoot`, shared
  with the Swarm dashboard; it deliberately does NOT live in
  `normalizeFolderDirectory`, which answers "which directory did the user mean"
  and must not rewrite a worktree the user typed into its parent repo. Guard:
  `client/test/folder-grouping.test.ts`.
- A `~/.claude/projects` / `~/.cursor/projects` directory name is a LOSSY
  encoding — `/` became `-`, and Cursor also drops a leading `.`. Decoding it by
  replacing every `-` with `/` invents paths that have never existed
  (`~/git/room-runners-arena-lib/.wsf9…` came back as
  `~/git/room/runners/arena/lib/wsf9…`, 98 fabricated folders from one repo).
  Use `resolveEncodedProjectDirectory()`, which disambiguates against the
  filesystem and returns null rather than guessing. It only fires as a fallback:
  a modern Claude transcript carries an explicit `cwd`, which always wins.
- Sidebar rows are ONE line. `.done-btn` is an absolute overlay on the row's
  right edge, so anything else anchored right (`.thread-stop-btn`) sits under
  it and stops receiving clicks. Two-line rows hid this; single-line rows do
  not. Guarded by `.conversation-item:has(.thread-stop-btn):hover .done-btn`.
