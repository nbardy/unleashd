# 2026-09-24 — dev restart simplification and repo cleanup

Started from a client crash (`Cannot read properties of undefined (reading
'kind')` in `authorKey`) and ended as a pass to delete slop. Roughly 29k lines
removed, ~700 added.

## The incident

The channel view crashed because the backend served the Buddies v32 post shape
(`fromBuddyId`, no `author`) after v33 was vendored. The client code was right;
the server was stale. Two causes, both fixed below:

1. The dev watcher watched a hand-written root list (`server/src`,
   `shared/dist`, `vendor/agent-cli-tool/dist`). The vendored package lives in
   `node_modules/.pnpm/@nbardy+buddies…`, so the upgrade never requested a reload.
2. A backend started 01:31 outlived a supervisor replacement at 16:16 and kept
   the port. Nothing made a backend exit when its parent died. (Inferred from
   process start times; the orphan had died before it could be inspected.)

A first "fix" defaulted missing authors to "Unknown" (ad1aab5). That hid the
real bug and was reverted (3781865). Lesson: a missing required field is a
boundary problem; parse at the fetch (e6852ee), never default in rendering.

## What changed

| Commit | Change |
|---|---|
| e6852ee | Channel posts, threads and the owner post result have Zod schemas in `shared/src/buddy-channel-posts.ts`; every client fetch parses through them. A wrong shape shows as the pane's refresh error. |
| 24f7a49 | `tools/watch-server.mjs` rewritten (~760 → ~220 lines, three modules → one). The backend reports every loaded file via Node's `WATCH_REPORT_DEPENDENCIES` protocol; one recursive `fs.watch` is filtered against that set. One esbuild bundle check (~60ms, also catches missing exports) gates every swap. Unrequested exits restart with backoff to 30s, never fatal. `shutdown.ts` treats IPC `disconnect` as SIGTERM, so no orphans. |
| 966c8cc | `tools/dev-supervisor.mjs` 793 → ~290 lines. Dev tasks claim a plain lock (`{pid, childPgid}`, same file/fields as before) and refuse dev ports held by anything else (lsof first: a 127.0.0.1 bind probe misses vite's IPv6 listener). `--replace` SIGTERMs the owner, then SIGKILLs its recorded child group. Build/typecheck take no lock. Unused flags removed. |
| 540c0ae | The watch baseline digest is read synchronously when a file is reported (an async read let an edit become the baseline). Tests wait 300ms after boot: macOS drops writes in the first ms of a recursive watch stream (measured 1/10 at 0ms). |
| cc58816 | Comment at the reload authority: a source reload never interrupts a running turn, because agents develop Unleashd from inside Unleashd. |
| 53ebcd3, 92175ea | Deleted docs `docs/README.md` already called superseded, plus the old watcher's plan/review. `subagent_ui_contract.md` is current and is now indexed. |
| 6fd5299 | Raw memory-curation benchmark runs untracked and ignored (`docs/benchmarks/*/*/*/`); files remain on disk and in history. The runbook says new runs stay local. |
| 8202d1f | 52 CSS selectors for classes nothing renders. |
| 51ebce7 | Deleted the unwired real-email adapter `server/src/buddies/mailbox.ts`. Unleashd does not send real email. |

Verification: real-process tests for the watcher (package change, identical
rewrite, broken build, external kill) and supervisor (live/dead lock, child
group kill on replace, held port); a shutdown test that a backend exits when
its runner disconnects; each regression test was checked to fail with its fix
removed. The real server was run in isolation (port 7599, temp HOME/data/
BUDDIES_HOME): touching the Buddies package reloaded it, and SIGKILLing the
runner took the backend down. `pnpm typecheck` ran end to end beside a live
dev runtime.

## Decisions (and why)

- **Reloads still wait for running turns, with no deadline.** Bounding the wait
  (pause admission + hand queued messages to the next process) was designed and
  dropped: `TURN_MAX_RUNTIME_MS` is 24h, so the "bound" is a day; turns start
  from 8 entry points; multi-turn automation runs would deadlock a gate; and the
  handoff would have to serialize owner-input provenance, which `runtime.ts`
  deliberately never persists. A visible "update pending / Restart now" banner
  was also dropped: it adds code, and the incident was a reload never being
  requested, which the derived watch set fixes.
- **No TLA+.** With the handoff dropped, the remaining protocol is small; a
  real-process test proves more and cannot drift.
- **`shared` still loads from `dist/cjs` in dev.** The server is CommonJS; loading
  shared source would mix module systems. The derived watch set covers dist.

## Not done / open

- **Live runtime still runs the old watcher and supervisor** until
  `pnpm dev:replace` (interrupts running Buddy turns). That replace is the
  first real run of the new `dev` path; the dev ports were busy all session.
- <a id="open-mention-replies-as-durable-buddy-runs"></a>**Mention replies as
  durable Buddy runs (proposal, awaiting owner decisions).** `channel-responder.ts`
  launches replies from in-memory state (`chains`, `active`, `untilIdle`, a
  `buddy-turn-complete` listener). Proposal: enqueue each mention with
  `enqueueBuddyRun({ inputKind: 'channel_mention', inputKey:
  'mention:<postId>:<buddyId>', inputId: postId, conversationId:
  channelConversationId(...), policy: { prompt, reply: { listId, threadRootId } } })`
  — no package schema change (input kind is free text, policy is JSON, keys are
  idempotent). The executor runs it like a schedule (`policy.prompt`) and posts
  the reply on finish with the existing `mention-reply:` key; "replying…" reads
  live runs. Deletes ~130 lines from the responder, adds ~30–40 to the executor.
  Owner decisions needed: (1) mentions run as foreground owner turns, bypassing
  background-membership holds and `settleHumanThreadDelivery`'s refusal of
  automated input; (2) on hard-restart interruption, post a visible "interrupted,
  mention again" reply (recommended) vs auto-retry (risks repeated side effects).
- **Email ledger in the Buddies package** (`src/mailbox.js`, mail effect tables)
  is the other half of the deleted adapter; removing it is a change in
  `~/git/buddies` plus a re-vendor.
- **More dead CSS** likely hides behind broad runtime-built prefixes (`buddy-`,
  `status-`, `message-`); each generation site needs a manual audit.
- **Further LoC cuts need consolidation, not deletion.** An esbuild reachability
  pass found only two unreached source files. The big targets are live:
  `runtime.ts` (3.3k), `operations.ts` (2.3k), `jsonl.ts` (2.2k).
- ad1aab5 swept three untracked `product/buddies/2026-09-22_completion_*.md`
  drafts into a commit via `git add -A`; left committed.
