# Branch audit + "new conversations slow / stuck on Starting…" — 2026-09-25

Multi-agent audit (5 area auditors, every bug adversarially re-verified) of all
branches, worktrees, the dirty tree and the submodule, prompted by worry that
two agents were doing conflicting perf / frontend-state work.

## What was committed and pushed

| Where | Commit | What |
|---|---|---|
| vendor/agent-cli-tool `feat/session-title-event` | 6c12aec, 2674d8c | cursor `thinking` records → progress (grok-4.7 turns failed on step 1); live MCP test argv. Pushed with the 2 previously unpushed commits (b2bba38, bcc33cc). |
| `feat/channels-project-view-2026-09-22` | 5d72683 | biome reflow only; biome now ignores `agent_notes` |
| same | 9c8d6c9 | Cursor memory-review rung + reply gate, agent-cli bump, catalog; fixed the Cursor project-dir leak; 3 stale tests updated |
| `feat/execution-selection-2026-09-24` (worktree `~/git/unleashd-exec`) | 00557ac | idle WIP snapshot, first push of this branch (it had no remote) |
| `feat/mailing-lists-2026-09-21` | — | pushed its 1 local commit (already contained in the channels branch) |

Verified on the commit (tree == HEAD apart from agent_notes): server 460/460
(6 live-skipped), client 155/155, the 6 invariant gates, `pnpm typecheck`,
submodule 260/260.

Left uncommitted on purpose: 15 `agent_notes` evidence files that a repo-wide
`pnpm format` reflowed. Their JSON parses identical to HEAD. Committing them
would invalidate the sha256 of `reproduce-evidence.ts` recorded in
`2026-09-15-lean-review/source-snapshot.json`. Restore them with
`git checkout -- agent_notes/` (a safety hook blocks agents from doing it).

## Did the two agents conflict?

- On the **main tree**, yes, but live and benign. A second session committed
  dcd8856 (channels move to server push; the Mailbox channel reader deleted)
  and 89cd357 while this audit was reading the same files. Nothing was lost.
- **Real conflict: `feat/execution-selection-2026-09-24` vs the channels branch.**
  - e4254ce refactors the Mailbox channel section that dcd8856 deleted, and
    adds `useChannelLists` (5s poll) plus `useRefetchWhenRepliesLand`.
  - `git merge-tree` shows conflicts in ChannelBrowser.tsx, channel-data.ts,
    ChannelsMobile.tsx and BuddyMessages.* .
  - Worse, some of the 5s polling merges in **without a conflict marker**. It
    would silently undo the push design.
  - **Rebase that branch onto the channels branch, resolving toward HEAD:** no
    BuddyListsSection/PostAuthor, `CHANNEL_BACKSTOP_MS`, and a required
    `ChannelMember.execution`.
  - Its design doc (fdcc8a3, D7/D9/D10) plans against already-shipped
    `mentionConfigs` and thread seats. Mark those decisions superseded before
    anyone runs waves 3–4.
- `feat/conversation-done-on-record` and `feat/mailing-lists` are fully
  contained in HEAD.
- **Tooling race:** `pnpm typecheck`/build does `rmSync('shared/dist')` first.
  Two agents typechecking at once produce ~100 false `TS2307 Cannot find
  module '@unleashd/shared'` errors (reproduced during this audit). An agent
  can "fix" healthy code over this. Fix: build into `dist.next` and swap it in
  with a rename.

## Why new conversations are slow / stuck (confirmed, not fixed yet)

There is no single deadlock. The recent perf/startup commits (426cde0, 5c9aa90,
e1752df, 362640f) add no new race on the creation path. Several causes stack,
most impactful first:

1. **Backend event loop stalls (HIGH).**
   - Measured: a trivial `GET /api/audit` took p50 0.5–0.8s, p90 1.2–5.1s and
     max 9.8s. Vite on the same machine answered in 1.6ms, so the stall is in
     the backend.
   - Cause: `server/src/adapters/loader.ts:611` `pollForChanges` fully
     re-parses every external, still-growing transcript on the main thread
     every 5s (examples: 120MB, 15MB). It then broadcasts a full
     ~400–500KB `ConversationData` for each one.
   - Every `create_conversation` frame queues behind this.
   - Cheapest fix: make the poller broadcast `summarizeConversation` +
     `summaries: true`, like `reresolveParentIds` does.
   - Real fix: incremental tail-parse from the last byte offset, or move
     parsing off the main thread.
2. **A reload during startup rejects the first message (HIGH).**
   - `shutdown.ts:193` / `conversation-websocket.ts:111`: commands waiting on
     `initialLoadComplete` are not counted in `activeWorkCount`.
   - When another agent saves server source during boot (14–20s, ~135s under
     load), the backend reaches idle at `markReady`, exits for the reload, and
     rejects the queued `queue_message` with `server_draining`. A second full
     startup follows.
   - With many agents editing server code, this is common.
   - Fix: call `beginCommand` before `await initialLoadComplete`.
3. **A config index miss reads every record (MEDIUM).**
   - After startup, a `findBySession` miss (config-store.ts:229) scans all
     7,841 config records (42MB, ~3.2s just to read and JSON-parse). It can
     happen up to 3× per new external session.
   - Fix: after the startup scope, treat an index miss as the answer.
4. **`execSync` blocks the backend (LOW).**
   - `/api/oompa-swarm-context` (server.ts:586) runs `oompa status/info` via
     `execSync`, 8s timeout ×2, blocking the whole backend. It is called before
     creating a swarm conversation.
   - Fixed on `fix/async-swarm-commands-2026-09-25`: `server/src/swarm/commands.ts`
     runs `oompa` and `git` through async `execFile` (no shell), the two oompa
     commands run concurrently, and `/api/read-file` no longer reads synchronously.
     `lifecycle/system-ports.ts` keeps `execSync`; it runs only at startup.
     Still synchronous on a request path: `http/usage-routes.ts` scans every
     Claude/Codex transcript with `readdirSync`/`readFileSync`.
5. **Half-open sockets (refuted as a bug, but a gap).**
   - A frame sent on a dead socket is dropped. A half-open socket after sleep
     only recovers on the next reconnect, and there is no server ping/pong.
   - Adding a 15–30s ping with `terminate()` closes that gap.

The error journal holds none of this: slow or stuck creation never reaches it.

## Other verified bugs (smaller)

- **Task-filtered channel feed** (`/api/buddies/posts?…`) is not refreshed by
  `channel_changed`, so mention replies can take up to 30s there
  (`client/src/atoms/resources.ts` `invalidateChannelResources`). 89cd357 fixed
  the rail and the gate notice, but not this feed.
- **Resumed channel seat catch-up** (`channel-responder.ts:404`): the seat
  receives only the delta, even when an audience change replaced the provider
  session. The Buddy then answers without the thread root. Fix: key
  `seenThrough` by `{sessionId, postId}`.
- **agent-cli stop waits on the probe:** `stop()` does not kill the Cursor
  required-MCP startup probe, so a stopped turn can sit in "stopping" for up to
  30s (`execute.ts:292`). Fix: an AbortSignal for the probe.
- **Recovered conversation ordering:** a conversation recovered with an
  undispatched first message streams events before its summary broadcast
  (`session-loader.ts:343`). Low impact.
- **Unbisectable commit:** 11b97c6 does not compile on its own (41e4b75 repairs
  it). Use `git bisect skip` there.
- **Resource cache LRU:** `resources.ts:92` skips the LRU bump when an entry
  is unchanged, so warmed-but-stable keys age out early. Minor.

## Leftovers

- `.muse/worktrees/*` (3 detached HEADs): formatter changes only, on
  already-pushed commits. Safe to remove.
- 2 old stashes on main: superseded work.
- `~/git/unleashd-exec/server/tsconfig.tests.tmp.json`: an untracked temp file.
- `~/.cursor/projects`: 7 leaked `…unleashd-memory-review-…` dirs from before
  the 9c8d6c9 fix are still there, and one holds Buddy memory output. There are
  also 11 `$TMPDIR/unleashd-cursor-mcp/<digest>` plugin dirs holding control
  tokens in 0600 files.

## Update: speed fixes landed (same day)

Each fix was built in an isolated worktree, reviewed adversarially by a
separate agent, cherry-picked, and re-verified on the commit in a clean
worktree. At 57b3e93: typecheck OK, server 475/475 (6 live-skipped), client
162/162, invariant gates 6/6.

| Commit | Fix | Measured |
|---|---|---|
| 776db89 | config index miss no longer scans every record after startup | ~3s scan ×up to 4 per new session → 0 |
| c22ff4a | swarm routes run `oompa` / `git` async and in parallel | up to 16s frozen backend → 0 blocked |
| c54221e | `channel_changed` refreshes the Task-filtered feed; LRU bump on unchanged refresh | 30s → push |
| f87f80c + c1c9be3 | commands parked on the startup barrier count as active work (a reload no longer rejects the first message); WS liveness pings, hardened so our own stall or a draining send never kills a live peer | — |
| c21b131 + 57b3e93 | poller resumes growing Claude transcripts from their byte offset and broadcasts summaries; closed chats keep their history and refetch when opened | 120MB file: 1.1–1.3s/poll → 11–20ms; max loop stall 233ms → 12ms |
| a79bbca | permessage-deflate + HTTP compression (after the auth gate), immutable hashed assets, `buddyContext` dropped from the wire | init 2.40MB → 178KB on the wire |
| b319102 + 893d45c | kind read once (no zod parse per access), activity sort key computed once, App no longer re-renders per event; restore-on-load keyed on the saved chat's arrival | derived atoms 295ms → 30ms per event (loaded host) |

Review-caught bugs fixed before landing: restore-on-load never firing when the
saved chat hydrated in a later batch; liveness terminating healthy clients
during a stall (the first regression test passed WITHOUT the fix, because the
client shared the server's event loop; it now runs in a child process and
stalls in the check phase right after a ping); reopened external chats
flashing "Loading…".

Resolved conflict: d382234 (another session) restored the Mailbox channel
reader that dcd8856 deleted. That is correct: it is the only place the owner
posts AS a Buddy. It uses the push design (30s backstop), not 5s polling.

### Still open (measured, not yet fixed)

- **Mobile chat test gap.** The mobile chat render fix landed as 6ef0ad3 +
  2d4ba51: one frozen markdown processor per flavor and a pinned 30-group
  mobile window. The streaming reply renders uncached; the cache is capped at
  600 entries and 1M source chars.
  - Its streaming test calls `renderMarkdownLive` directly, so it would not
    catch a caller switching back to the cached renderer.
  - Replace it with an integration test: grow `streamingContentAtom`, then
    render `VirtualizedGroup` / `AssistantResponseRow` with
    `isLive`/`isLiveTurn` true, and assert the cache stats did not change.
  - The mobile window has no test.
- **Poller discovery.** Every 5s it walks about 7.7k files and 4.4k dirs:
  - The Muse walk visits about 1,079 `subagent/` dirs and polls 291
    `.msp-view-v1` cache files as sessions (`collectMuseSessionFiles`,
    `adapters/jsonl.ts:1984`).
  - The per-file stats are sequential (`loader.ts:540`).
- **Startup.** `mergeSessionMessages` key building costs 1.1s at startup
  (`session-history.ts:36`).
- **Other providers.** Codex, Cursor and Muse transcripts still get a full
  re-parse per change; only Claude resumes from a byte offset.
- **`/api/usage`.** It scans every transcript with sync fs on a request path.
- **Sidebar / Gallery.** They subscribe to the full conversation array
  (AGENTS.md wants id lists + per-id atoms); their grouping lives in component
  `useMemo`s.
- **Tests.** The flaky `buddy-coordination` "real creation boundary" test
  fails intermittently under load.

## Update: execution-selection branch merged

`feat/execution-selection-2026-09-24` was replayed onto the channels branch as
f090910, 439d28b, 6a60615 and 02c48c8, then reviewed.

- **The design doc** is kept. D3/D7/D8/D9/D10 are marked superseded by the
  shipped channel work.
- **The Mailbox composer removal** in e4254ce is dropped: d382234 restored the
  composer. Its polling is dropped too.
- **The helper consolidation** is kept.
- **The dead delegation/review dispatch chain** is deleted.
- **Status and availability** now have one mechanism each: a single
  initials/TASK_STATUS table and a single availability set atom.

Verified on 02c48c8: typecheck OK, server 488/488 (6 live-skipped), client
172/172, gates 6/6, `vite build` OK. The original branch remains on origin;
its local worktree and branch are removed.

Still open from the doc, not scheduled:
- seed the mention chip from the seat config;
- typed TurnFailure (D11);
- harness facts in agent-cli (D12).
