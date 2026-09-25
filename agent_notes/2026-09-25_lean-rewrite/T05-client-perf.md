# T05: client speed (SPD)

## v2: rebased onto lean/integration f6cc2ca (use this branch)

`perf/client-render-v2`, cut from `lean/integration` @ f6cc2ca, with the four
commits re-applied by cherry-pick. Not merged and not pushed.

| # | v2 SHA | Original | Commit |
|---|---|---|---|
| 1 | `25170a9` | d0bab0b | perf(client): a conversation event costs what it changed |
| 2 | `321b583` | 48e9f2c | perf(client): a streaming frame rebuilds only the last message group |
| 3 | `b9734ae` | 6423978 | perf(client): lazy-load every route; desktop and mobile trees in separate chunks |
| 4 | `4db9a1c` | 72c4303 | refactor(client): one time-ago tick, one home-path helper, one swarm grouping |

**How the conflicts were resolved** (all in commit 1; commits 2–4 applied cleanly):
- **Merge feature (8c9fcfa) stays deleted.**
  - `actions.ts`: the delete handler calls only `forgetConversationAtoms`; the
    `mergeChild*` family removals are gone.
  - `Sidebar.tsx`: no merge mode, merge selection, `providerSupportsFork`,
    merge checkmark or merge classes. The row's `onSelect` just navigates.
  - The `isMergeChild` field is removed from the list index entry, from the
    folder-row and Builder filters in `buddy-sidebar.ts`, and from
    `galleryConversationsAtom`.
  - `client/src` contains no reference to `mergeAtoms`, `mergeMode`,
    `mergeChild`, `mergeParent`, `MergeModal`, `MergeProgress`,
    `createMergeConversations` or `merge_child_status`.
- **Integration's behaviour is kept.** The Done button is still always
  rendered, disabled with "Reconnecting to the server" while disconnected
  (`onDone === null`), and calls `setConversationDone`. The row class is
  still a plain `conversation-item` / `conversation-item active`.
- **The atom restructuring is kept unchanged.**

**Verification**, run on the committed tree (HEAD `4db9a1c`, 0 dirty files before and after):

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | exit 0 |
| `pnpm --dir shared run build` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test:server` | exit 0: 497 tests, 491 pass, 0 fail, 6 skipped |
| `pnpm test:client` | exit 0: 177 tests, 177 pass, 0 fail |
| `bash tools/check-client-invariants.sh` | all 6 gates pass |

Environment note: the rebase bumps the `vendor/agent-cli-tool` submodule to
b9c819f, which ships no `dist/`. `pnpm typecheck` (the server's `McpServerSpec.kind`)
and `test:server` (63 files: `Cannot find module …/agent-cli/dist/index.js`)
fail until you run `pnpm --dir vendor/agent-cli-tool build`. That is a
worktree setup step, not a code change: after building, everything above
passes.

**`vite build` (v2)**, with the baseline built from lean/integration f6cc2ca in the same way:

| chunk | f6cc2ca | v2 |
|---|---:|---:|
| entry `main-*.js` | 1,116.67 kB (gzip 328.37) | **420.10 kB (gzip 129.53)** |
| entry `main-*.css` | 290.00 kB (gzip 44.36) | 14.47 kB (gzip 3.29) |
| Chat / ShellDesktop / ChatMobile / ShellMobile | (all in main) | 89.53 / 52.58 / 40.67 / 2.23 kB |

**Event benchmark (v2)**, `client/bench/conversation-event.bench.ts`: 1,200
conversations, a sidebar and an open Chat mounted, and a 600-record open chat.
The "base" column is the same harness on f6cc2ca.

| event | base median (p95) ms | v2 median (p95) ms | atoms changed, base → v2 | open-chat groups replaced, base → v2 |
|---|---:|---:|---:|---:|
| status flip, another conversation | 1.383 (1.736) | 0.201 (0.278) | 8.0 → 0.7 | 0 → 0 |
| queue_updated, another conversation | 1.160 (1.448) | 0.058 (0.075) | 8.0 → 0.0 | 0 → 0 |
| poller batch, 1 summary | 1.201 (1.511) | 0.343 (0.427) | 9.0 → 2.8 | 0 → 0 |
| message, another conversation | 0.995 (1.250) | 0.252 (0.284) | 8.0 → 1.8 | 0 → 0 |
| stream frame, open chat | 0.534 (0.678) | 0.014 (0.019) | 2.0 → 2.0 | 300 → 1 |

Everything below describes the original branch (`perf/client-render`, based on
ab47223). The design, the tests and the notes carry over to v2 unchanged.

Branch `perf/client-render`, cut from `lean/integration` @ ab47223, in worktree
`~/git/unleashd/.claude/worktrees/agent-a2030956fe54e9653`. Not merged and not pushed.

| # | Commit | What changed |
|---|---|---|
| 1 | `d0bab0b` | perf(client): a conversation event costs what it changed |
| 2 | `48e9f2c` | perf(client): a streaming frame rebuilds only the last message group |
| 3 | `6423978` | perf(client): lazy-load every route; desktop and mobile trees in separate chunks |
| 4 | `72c4303` | refactor(client): one time-ago tick, one home-path helper, one swarm grouping |

Only client code, client tests and docs changed (`AGENTS.md` CSS note,
`docs/client-state.md`, `docs/architecture.md`, `docs/mobile-view-tree.md`).
The Conversation wire schema is untouched.

## Verification (run on a clean tree, so the tree equals HEAD 72c4303)

- `pnpm typecheck` (tsc -b for shared, server, client and agent-cli): exit 0.
- `pnpm test:client`: 177 tests, 177 passed, 0 failed. The baseline had 172; five are new.
- `bash tools/check-client-invariants.sh`: all six gates pass (G1–G6).
- `biome check` on the touched files: only the existing diagnostics remain
  (`noVoidTypeReturn` in the `handleMessage` dispatcher, `useSemanticElements`
  in Chat.tsx, `organizeImports` in BuddyDetailProfileEditor).

## 1. Per-event passes (d0bab0b)

**Cause.** Every per-id atom read the whole `conversationsAtom` map, so each
one recomputed on every event. About ten collection views re-ran over all
conversations and returned new arrays and Sets:
- `allConversationsAtom` (filter and sort)
- the ids list and the available-id Set
- three Buddy-sidebar atoms, each building its own id Set
- the running counts
- the Sidebar's four `useMemo` passes, which parsed a date for every row
- the Gallery sort, which parsed dates inside the comparator
- `childConversationsAtomFamily`, which returned a new array every time
- `workersByProjectAtom`

**Fix.**
- **Per-id records.** `keyedAtoms` in `atoms/structural.ts` gives each
  conversation its own primitive atom, and a write sets only the ids it
  touched. `conversationsAtom` still reads as a map and can be written as a
  whole map (writes diff by identity), so tests and `init` work unchanged.
  Streaming text is keyed per conversation the same way.
- **One list index.** `atoms/conversation-index.ts` keeps one entry per
  conversation, holding only the fields views filter, group and sort on. It
  also keeps one newest-first list, updated incrementally:
  - it rebuilds entries only for touched ids;
  - it keeps an entry whose fields are unchanged;
  - it moves a changed entry by binary search.

  Queue, sub-agent and streaming events therefore never touch the list.
- **Stable views.** Every collection view is a `stableAtom(read, equals)`,
  which returns the previous value when the new one is equal. Sidebar
  grouping (`sidebarFolderViewAtom`), the gallery list, the Buddy sidebar
  projects and groups, the running counts, the inbox and recent directories
  all moved from components into these atoms. Sidebar rows
  (`SidebarConversationRow`) and gallery cards (`GalleryCard`) are memoized
  and subscribe per id.
- **Writes name their ids.** `putConversations`, `removeConversations` and
  `updateConversation(id, recipe)` replace `mutate()` over the whole map.
  `markConversationDetailsLoaded` writes only when an id is new. The
  per-event `console.log` calls in the WS spine are gone.

**Test.** `client/test/conversation-event-isolation.test.tsx`:
1. Renders the real `<Chat id=B>` and records every atom it reads, using a
   recording store proxy rather than a hand-written list.
2. Drives events for A through `handleMessage`: queue, sub-agent, stream
   chunks, message, status, and a poller summary batch.
3. Fails if any atom Chat(B) reads changes value, which would re-render it.
4. Fails if any atom labelled `…:<B>` recomputes.
5. Fails if a queue, sub-agent or stream event recomputes any collection view.

A control test checks that an event for B does change `chatMessageGroups:B`.
I confirmed the test catches regressions with two mutations, each reverted
afterwards:
- a per-id atom reading the map again: fails with "recomputed conversationView:B";
- the child list rebuilt from the map: fails with "changed childConversations:B, which re-renders Chat for B".

**Measurement.** `client/bench/conversation-event.bench.ts` holds 1,200
synthetic conversations, with a desktop sidebar and an open Chat mounted
(every atom those components read is subscribed). The open chat has 600
records. The "before" column comes from the same harness run against the
`lean/integration` tree, subscribing to its atoms plus its Sidebar `useMemo`
chain. Neither column counts React render time, so the real gain is larger.
Machine: this Mac, node 24.3.

| event | before median (p95) ms | after median (p95) ms | subscribed atoms changed, before → after |
|---|---:|---:|---:|
| status flip, another conversation | 1.383 (1.820) | 0.209 (0.525) | 8.0 → 0.7 |
| queue_updated, another conversation | 1.148 (1.309) | 0.061 (0.319) | 8.0 → 0.0 |
| poller batch, 1 summary | 1.165 (1.426) | 0.357 (0.531) | 9.0 → 2.8 |
| message, another conversation | 0.952 (1.075) | 0.245 (0.360) | 8.0 → 1.8 |
| stream frame, open chat | 0.526 (0.568) | 0.014 (0.020) | 2.0 → 2.0 |

"Changed" counts subscribed atoms whose value changed, and each one is a
component that re-renders. Before, Chat re-rendered on every event for any
conversation, because `childConversationsAtomFamily` returned a new array each
time. After, the remaining changes are the rows and views an event really
moves: a reordered folder group, the row for the conversation itself, and
running counts.

## 2. Streaming (48e9f2c)

- Settled groups depend only on the records array and the swarm prefix. An
  appended record, or a grown last response, regroups from the last group
  (`regroupChatMessages`).
- `withStreamingTail` rebuilds only the last group with the live text. Every
  earlier group is the same object, so `VirtualizedGroup` (memoized on group
  identity) skips it.
- `isLiveTurn` goes to the last group only, so a turn starting or ending no
  longer re-renders the list.
- The initial scroll offset is estimated once, when the virtualizer asks for
  it, instead of by a memo that re-summed every group on each frame.
- Bench: a stream frame took 0.53 ms before and 0.014 ms after. Groups
  replaced per frame went from **300 → 1** (600-record chat).
- Tests: group identity is checked across frames. The incremental regroup is
  compared with a full pass (`deepEqual`) for every prefix of 25 random
  transcripts, and a replaced earlier record falls back to a full pass.

## 3. Code-splitting (6423978)

`vite build` output:

| chunk | before | after |
|---|---:|---:|
| entry `main-*.js` | 1,123.75 kB (gzip 330.48) | **421.75 kB (gzip 129.97)** |
| entry `main-*.css` | 294.71 kB (gzip 45.20) | 14.56 kB (gzip 3.34) |
| KaTeX / highlight.js (already lazy) | 266 / 174 kB | 266 / 174 kB (unchanged) |
| largest route chunks | — | Chat 91.8 kB, BuddyProjectExecution 62.7 kB, ShellDesktop 55.1 kB, ChatMobile 41.7 kB |

After commit 4 the entry chunk is 421.85 kB.

What the entry chunk holds now (source bytes, from a sourcemap build):
react-dom 533 KB, react-router 347 KB, zod 146 KB, `client/src/atoms`
112 KB, jotai, immer, and the shared schemas. No view code is left in it
beyond App.tsx and the channel-unread title hook.

**Changes.**
- Every shell and route is a `React.lazy` chunk, through `lazyNamed` in
  App.tsx. The Suspense boundaries sit inside the shell, so navigating never
  blanks the sidebar or tab bar.
- After first render, the device's own route chunks are preloaded when the
  browser is idle.
- `ChannelsIndex` moved to its own module, because both trees route
  `/channels` to it. In headless Chrome the desktop now loads **zero mobile
  chunks** and the phone loads **zero desktop chunks**.
- **`/robot` deleted.** No client, server, tools or docs file links to it;
  only a historical note in `product/mobile/PLANNING_MOBILE.md` mentions it.
  `RobotLoader.tsx` and its CSS are removed.
- A `vite:preloadError` handler reloads the page once, so a tab opened before
  a rebuild recovers instead of failing a navigation.

**CSS order: a behaviour risk I found and neutralised.**
- Component CSS now loads with its chunk, **after** the entry stylesheets
  (`index.css`, `App.css`, `BuddyDetail.css`, `ui/controls.css`). A component
  rule of equal specificity therefore beats an entry rule, which is the
  reverse of the old single-bundle order.
- I scanned every TSX className for elements that mix classes from different
  stylesheets. The only real clash: `.chat-config-options .provider-option` /
  `.model-option` (and `.selected`) in Chat.css repeat properties of
  `.ui-choice.ui-choice` at the same specificity. Those declarations always
  lost to controls.css, so they were dead.
- I removed them, which keeps today's look. The AGENTS.md CSS bullet now
  records the new order.

## 4. Duplicates (72c4303)

| duplicate | copies | now |
|---|---:|---|
| 30 s time-ago tick | 8 (Sidebar, Gallery, Chat, SwarmDashboard, SwarmDetail, SwarmsMobile, SwarmDetailMobile, ConversationListMobile) | `hooks/useTimeTick.ts` |
| home-path regex `/^\/Users\/[^/]+/ → '~'` | 18 sites in 14 files | `shortenHomePath()` in `utils/directories.ts` |
| swarm regroup by project root, promoted workers excluded | 6 (SwarmDashboard, SwarmsMobile, SwarmAnalytics, SwarmAnalyticsMobile, SwarmDetail, SwarmDetailMobile) | `swarmWorkersByProjectAtom` / `swarmWorkersForProjectAtomFamily` |

- `useTimeTick` is one shared clock (`useSyncExternalStore`). The interval
  runs only while something subscribes.
- The component that prints a time label now subscribes itself. This fixed a
  latent bug: the mobile chat list ticked the list, but its memoized rows
  never refreshed their "3m ago".
- BuddiesDashboard's `'~/git/'` variant shortens paths differently, so I left
  it alone.

## Screenshots

- The dev server is not reachable: nothing is listening on 7489 or 7499, so
  `pnpm screenshots` could not run against real data. I did not start a
  backend, because it would open the live `~/.agent-viewer` and `~/.buddies`
  data.
- Instead, I served the built `client/dist` from before (lean/integration)
  and after, with no backend, in headless Chrome through
  `tools/lib/headless-chrome.mjs`. That covers 8 routes: desktop `/`,
  `/buddies`, `/workers`, `/done`, and phone `/`, `/buddies`, `/search`,
  `/workers`.
- On every route, before and after render identical text, and the crash
  fallback appears on none.
- Five screenshots are byte-identical. The other three differ only by a
  blinking caret or a tab-bar transition frame (checked by eye).
- The images are in the session scratchpad (`shots-before/`, `shots-after/`).
  This is an empty-state check, not a real-data review.

## Open or not done

- **Bulk seen-marking.** `markConversationsSeenBulk` still runs on every
  `conversations_updated`. It costs about the batch size now, and rows read
  per-id seen atoms, so it no longer re-renders the list. But the report's
  bug stands: the NEW badge never shows for external updates. That is a
  product decision, so I left it.
- **Zod parsing.** `safeParseServerMessage` still does a full Zod parse of
  every WS message, including `chunk` (§6.2 #11). This was not in T05's list.
- **One O(n) step per event.** Each conversation write still copies the map
  (a native `Map` clone, about tens of µs at 1,200 conversations). A change
  that moves list fields still runs one pass over precomputed entries in
  each mounted view. Neither parses dates, runs regexes or builds strings.
- **Tie order.** Conversations with identical last-activity timestamps keep
  the order they arrived in, instead of being re-sorted on every event.
- **Needs a real-data check.** No test or screenshot has exercised these
  changes with real data yet, because no dev server was available. Take one
  real-data screenshot pass (`pnpm screenshots`) after the T16 merge.
