# T20 slice D: swarm views, one tree

Branch `refactor/t20-swarm`, worktree `.claude/worktrees/lane-t20-swarm`. Commit **f9d80ed** (on 486a2d3). Not merged or pushed.

Checks were run with a clean tree, so they checked the commit itself: `pnpm typecheck` passed, `pnpm test:client` passed 170/170, and `tools/check-client-invariants.sh` passed all 8 gates.

## Lines

| | Before | After |
|---|---|---|
| View TSX | Desktop 2,200 (Dashboard 218, Detail 1,157, Analytics 635, ConvoPrefix 190) + mobile 1,204 (SwarmsMobile 170, SwarmDetailMobile 443, SwarmAnalyticsMobile 416, MobileSwarmPrefix 175) = **3,404** | SwarmPage 53, Dashboard 110, Detail 533, DetailPanels 345, Analytics 440, ConvoPrefix 178 = **1,659** |
| Helper TS | swarmUtils 12 + swarmWorkerVisibility 42, plus six regroup copies inside the views | swarm-groups.ts 206 (one regroup) |
| Swarm CSS | 145 + 945 + 595 + 271 + mobile-swarm 384 = **2,340** | SwarmPage 123 + Dashboard 48 + Detail 414 + Analytics 276 + ConvoPrefix 292 = **1,153** |
| Client CSS total (G8) | 14,704 | 13,522 (ceiling lowered to match) |

## Shape

- There is one view per screen: `SwarmDashboard`, `SwarmDetail`, `SwarmAnalytics` and `SwarmConvoPrefix`. Each takes `layout: 'wide' | 'narrow'` (`SwarmLayout` in `SwarmPage.tsx`). App.tsx's route table passes it: desktop gets `wide`, mobile gets `narrow`. No swarm view calls `useDeviceKind`.
- Device differences are `Record<SwarmLayout, …>` lookups, not branches:
  - `WORKER_VIEWS`: wide shows the roster plus two transcript panes; narrow shows exec groups as a list of links.
  - `DEFAULT_TAB`: wide opens on runs, narrow on workers.
  - `TIMELINES`: wide shows the time-axis chart with a hover tooltip; narrow shows cycle chips with a `<dialog>` bottom sheet.
  - `NEW_SWARM`: the "+ New" sheet appears on narrow only.
  - `BACK`: wide links back to the gallery; narrow has no back link because the dashboard is a tab root there.
  - `START_EXPANDED`: the prefix card starts open on wide and closed on narrow.
- `SwarmPage` is the shared frame: back link, title, subtitle and actions. Classes are prefixed `swarm-*` and every size uses a token.
- `swarm-groups.ts` is the one regroup:
  - `buildProjectCards`
  - `groupExecWorkers`: pairs each review/fix with the nearest exec in the same swarmId, with an optional run filter.
  - `runningFromSnapshot`
  - `getWorkerVisibilitySummary`
  - `listAnalyticsProjects`
- New test: `client/test/swarm-groups.test.ts`. It uses a real-shaped fixture (two runs, execs, a review, a fix, an orphan review from another run) and catches:
  - a review paired across runs
  - a run filter that is ignored
  - runtime status ignored when ordering
  - a disk-only project dropped or overriding a project that has rows
- `swarm/mobile/` is deleted, along with `swarmUtils.ts` and `swarmWorkerVisibility.ts`. `SWARM_PAGE_LOADERS` has 3 entries instead of 6.
- `index.ts` still exports `SwarmConvoPrefix` (bound to wide) and `MobileSwarmPrefix` (bound to narrow). This keeps Chat.tsx, VirtualizedMessageList and ConversationView unchanged, since other lanes own them. Follow-up: once those lanes land, pass `layout` at the call sites and export the view alone.
- Two small moves outside the swarm views:
  - `.mobile-chats { min-width: 0 }` moved from `mobile-swarm.css` to `mobile/styles/mobile.css`, because ConversationListMobile uses it.
  - Stale comments were updated in `docs/client-state.md` and in the parser headers.

## Feature differences (union kept, noted per tree)

**Gained on mobile.** These were desktop-only:
- the Run Overview tab: run picker, summary stats, per-worker table, review log with expandable output
- the Recent Commits and Swarm Config panels, including prompt-file expansion
- the analytics legend, run tabs with progress and date, and the per-run worker model
- runtime-snapshot counts on dashboard cards. SwarmsMobile used to pass `null` for the runtime.
- run scoping in the worker list. Workers now filter to the selected or live run, like desktop; before, mobile listed every run mixed together.
- the prefix card's Available Configs and worker table

**Gained on desktop.** These were mobile-only:
- the "N reviews paired" list, message snippet and verdict text, available in the narrow worker view
- the analytics "Finished … · duration" line
- a visible load error in analytics
- the tap-to-inspect sheet, which stays narrow-only

**Kept on one tree only, by design:**
- "+ New" swarm sheet: mobile only. Desktop starts swarms from its sidebar.
- Hover tooltip on timeline spans: desktop only. Touch has no hover, so narrow gets the tap sheet instead.
- Side-by-side transcript panes: desktop only. On narrow each worker is a `<Link>` to `/chat/:id` carrying the mobile origin state.

**Changed or removed:**
- The desktop ⓘ hover tooltip and the roster's Running/Idle/Duration block became the page subtitle (workers, sessions, exec/review/fix counts, started ago) plus the running badge ("N running · M idle").
- The dashboard's "Open Swarm →" button: the whole card is now a `<Link>` with an "Open →" affordance.
- The dashboard title is "Swarms" on both trees. Desktop used to say "Swarm Dashboard".
- Analytics without a picked run shows the newest run. Desktop used to show the first run in server order.
- Dead code removed: `shortModelName(null)` (it always returned null), the unused `onWorkerClick` and the unused `swarmIds`/`accentColor` in analytics.
- SwarmAnalyticsMobile's bare `fetch` in `useEffect` is gone. Both layouts now use the keyed `resource` cache, and the per-run review fetches run in parallel.

Not screenshotted: the task said not to start any server. The pixel diff of `/workers*` on phone and desktop via `pnpm screenshots --baseline` is still to do.
