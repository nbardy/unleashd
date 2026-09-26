# T19 S3 — client-state rewrite compiles, tests pass

Branch `refactor/client-state` (worktree `.claude/worktrees/lane-client-state`), not pushed or merged.
Commits: 3ac6c51 merge origin/lean/integration (f6f629b; two trivial import-path conflicts),
d125387 call sites, dac1721 tests, 18fbe37 docs.

**Atoms exported from client/src/atoms: 65 → 19** (+1 swarm grouping in `swarm/swarm-workers.ts`).
Base: connectionAtom, rowsAtom, transcriptFamily, streamFamily, commandsAtom, prefsAtom, seenAtom,
archivedBuddyIdsAtom, buddySidebarOverviewAtom, resource cache, outbox, restart recovery. Derived:
rowFamily, listIndexAtom (+ `listField`), groupsFamily, commandFor, unreadFamily, childRowsFamily,
buddySidebarAtom.

**Lines:** client/src/atoms 3,307 → 2,988 (6d8e9e5 → HEAD). Diff 6d8e9e5..HEAD over client/src+test+bench
(this includes the integration merge): +2,303 / −2,470.

Done:
- ~34 components and hooks moved onto the new atoms mechanically. The route owns the active id (Sidebar uses `useMatch`).
- The tail refresh lives in `useConversationBodies`: `bodiesStep(transcript, row.messageCount)` returns load, refresh or none. The WS spine never fetches bodies.
- One swarm grouping atom over `listIndex.workersByProject`.
- Tests rewritten (pending-creations, summary-history-refresh, protocol-skew, buddy-archive, buddy-sidebar, restore-on-load, isolation, background, links, queue, groups, bench), and `stream-frame-validation.test.ts` added. They share one fixture, `test/fixtures/client-store.ts`.
- The isolation test caught a regression. Chat checked "any conversations?" by reading `order`, so re-sorting other chats re-rendered it. It now reads `idSet`.
- docs/client-state.md rewritten (atom tables and rules). The AGENTS.md hard rules and Link rule use the new names. Stale names were fixed in mobile-view-tree, ws-contract-surprises and architecture.

**Benchmark** (1,200 conversations, 136 mounted atoms; median / p95 ms; p95 is noisy on a loaded machine):
| event | median | p95 | atoms changed | groups replaced |
|---|---:|---:|---:|---:|
| status flip | 0.273 (before 0.285) | 2.160 | 0.7 | 0 |
| queue patch | 0.009 | 0.080 | 0.0 | 0 |
| poller batch, 1 row | 0.466 | 3.368 | 2.8 | 0 |
| message + activity | 0.319 | 3.670 | 2.5 | 0 |
| stream frame, open chat | 0.014 | 0.313 | 2.0 | 1 |

**Checks** (clean tree = HEAD 18fbe37): pnpm typecheck OK · test:client 140/140 · test:server 252/252 ·
check-client-invariants 8/8 · vite build OK.

Notes: `childRowsFamily` is one small derived atom beyond the design table; it serves the sub-agent panel on both shells.
Following the throttle message, I did not run `cargo clean`.
