# T04: server speed (SPD) report

Branch `perf/server-event-loop` is based on `lean/integration` @ ab47223. It is in worktree
`~/git/unleashd/.claude/worktrees/agent-a141a3883f44f497f`. It has not been merged or pushed, and
no server was restarted.

| # | Commit | Deliverable |
|---|---|---|
| 1 | `6f0911a` | Event-loop stall monitor, which writes to the error journal |
| 2 | `9d0a950` | Async, streamed I/O for `/api/usage`, the session usage lookup and the context meter |
| 3 | `37bb0b9` | Prebuilt (esbuild) MCP helpers in dev, with a loud fallback to tsx |
| 4 | `5849bbf` | One shared admission tick for Buddy chats waiting for a slot |

## Verification (committed tree)

`git status --porcelain` was empty, so the tree matched HEAD `5849bbf` when these checks ran.

- `pnpm typecheck` (tsc -b): passes.
- `pnpm test:server`: 498 tests, 492 pass, 0 fail, 6 skipped. The baseline before this work was
  494 tests with 488 passing. The four new tests all pass.
- `biome check` on every changed file: clean, except for `server/src/server.ts`. Its one
  organizeImports error (`owner-channel-reads` order) is already there at ab47223, and the new import
  is in sorted position.

## 1. Event-loop stall monitor (`6f0911a`)

- The new file is `server/src/observability/event-loop-stall.ts`. It is started in
  `server.ts` `initialize`, right after the console capture is installed.
- Detection uses `perf_hooks.monitorEventLoopDelay` at 10 ms resolution, read by a 100 ms JS check.
  A first version measured the drift of a 50 ms JS interval. That was dropped because a stall
  starting partway through the interval reads short by that phase, so stalls of 100–150 ms could be
  missed.
- A stall of 100 ms or more is written with `journal.capture({severity:'warn', component:'event-loop',
  context:{route}})`. The message contains the duration and the last activity noted.
- `noteActivity(label)` is two variable writes. It is called from:
  - an Express middleware placed after the auth gate (`METHOD /path`)
  - the WS command handler (`ws <type>`)
  - `timer buddy-scheduler`, `timer session-poll` and `timer buddy-chat-admission`
- Each label writes at most once a minute, and the next write summarizes the suppressed repeats.
- The doc note is the "Event-loop stalls" section in `docs/error-journal.md`.
- Measured cost:
  - `noteActivity`: about 21 ns per call.
  - Idle overhead is 23.5 ms of loop activity per 10 s against 0.54 ms without the monitor, which
    is 0.23% of one core.
  - Accuracy: 20 of 20 injected stalls of 110–130 ms were detected and all were attributed to the
    right label. The largest error in the reported duration was 25.6 ms.
- The test is `server/test/event-loop-stall.test.ts`. It uses a real journal on disk and checks that
  an idle loop records nothing, a 250 ms block produces one grouped occurrence with the route and
  duration, and a repeat inside the window is summarized rather than written again.

## 2. Async I/O on request paths (`9d0a950`)

- `usage-routes.ts`: every `readdirSync`, `statSync` and `readFileSync` is now `fs.promises`.
  Transcripts are streamed through the existing `readJsonlLines` (1 MiB chunks).
- `session-context.ts`: `cachedRead`, the harness readers and the muse and opencode walks are async.
- These functions are now async: `lookupProviderUsageForSession`, `lookupSessionContext`,
  `parseClaudeSession`, `findClaudeSessionFile` and `findCodexSessionFile`. The context-breakdown
  route awaits them.
- Each parser skips a line that does not contain its key before calling `JSON.parse`. The keys are
  `"usage"`, `token_count`, `rate_limits`, `compact_boundary`, `compacted` and `runtime.session`.
  This only drops lines that would have failed the same check after parsing, and it is most of the
  wall-time win.
- The Codex rate-limit read now streams forward and keeps the last match. The old code read
  backwards over the whole file held in memory. Both return the same event.

**Proof that the numbers did not change:** `server/test/usage-context-async-parity.test.ts`.

- Its expected values were recorded by running the test against the synchronous code at ab47223.
  It passed there before the rewrite and passes after it.
- The fixture is a real HOME with all four harness layouts:
  - a 2.8 MB Claude transcript spanning several chunks, with multi-byte characters at the chunk
    edges, no trailing newline, a CRLF line, a malformed row, a duplicate message id, a sidechain
    row and a compaction marker
  - Codex with a compaction, the zero sentinel and rate limits, plus a day directory older than
    both windows
  - opencode with a malformed file
  - muse
- It asserts the full `/api/usage` JSON, the per-session usage and the context reading.
- The recording found that the Claude `topSessions` row has always included `timestampedTokens`.
  That was kept as it was.

**Blocking time.** The fixture was generated for this measurement: 259 MB of Claude and 146 MB of
Codex. The old side ran the ab47223 copies of the same modules. The table shows the largest loop
block seen by a 1 ms probe, then wall time, median of 2 runs.

| Path | Before, block / wall | After, block / wall |
|---|---|---|
| `GET /api/usage` (cold) | 434 ms / 445 ms | 8 ms / 133 ms |
| context meter, claude (cold) | 147 ms / 147 ms | 2 ms / 50 ms |
| context meter, codex (cold) | 125 ms / 125 ms | 1 ms / 31 ms |
| session usage, claude (cold) | 146 ms / 146 ms | 1 ms / 38 ms |

The `/api/usage` response bodies were identical before and after: 126,625 bytes with the same sha1.

## 3. Prebuilt MCP helpers in dev (`37bb0b9`)

- The new file is `server/src/buddies/mcp-bundle.ts`. In dev (`NODE_ENV=development`), `server.ts`
  starts it.
- It runs `esbuild.context()` over `mcp-server`, `owner-mcp` and `memory-review-mcp`. The settings
  are `--bundle --platform=node --format=cjs --external:@nbardy/buddies`, with output to the
  gitignored `server/.mcp-bundle/*.cjs`.
- esbuild is resolved through tsx, the same way `tools/watch-server.mjs` does it.
- esbuild's own watch mode rebuilds the bundle when a source changes. It polls from esbuild's Go
  process, not from the event loop.
- The bundle state is a sum type: `not_started`, `building`, `ready` or `failed`. A rebuild keeps
  `ready` until it finishes.
- `resolveBuddyMcpLaunch` tries these in order:
  1. compiled `.js` (packaged, unchanged)
  2. `ready` bundle: plain `node <file>.cjs`
  3. tsx source. This path logs `console.warn` once per entrypoint per bundle state, which also
     lands in the error journal.
- I chose esbuild's watch inside the backend over a supervisor hook for two reasons:
  - The bundle's freshness is tied to the running backend, so a bundle left over from an earlier
    session is never trusted.
  - It works the same under `pnpm dev`, `dev:server` and a bare `watch-server.mjs`.
- Known gap: an edit only to an MCP-only source reaches the bundle within esbuild's polling delay,
  typically a second or two. A turn started inside that window runs the previous helper.
- The test is `server/test/buddy-mcp-bundle.test.ts`. It builds the real bundle, resolves the launch
  the way a turn does, and completes the MCP handshake plus `listTools` with all three helpers from
  a bare cwd.
- Measured on an idle machine: time from spawn to the MCP `initialize` response, median of 5 runs.

| Helper | tsx source | Bundle |
|---|---|---|
| mcp-server | 401 ms | 139 ms |
| owner-mcp | 465 ms | 111 ms |
| memory-review-mcp | 177 ms | 61 ms |

- Building all three bundles takes 44–90 ms.
- A second run with `TSX_DISABLE_CACHE=1` was noisy: tsx 266–318 ms against 60–141 ms for the
  bundle.
- The 2.5–4.5 s per helper recorded in 02 §2.1 was measured on the loaded live machine. Under that
  memory pressure the gap should widen, not shrink. I could not reproduce it without the live
  server.

## 4. Per-conversation admission poll (`5849bbf`)

- The change is surgical, about 30 lines in `runtime.ts`.
  - A module-level `waitForChatRunSlot(admit)` keeps a single `setInterval(1000)`. The interval
    exists only while at least one chat is waiting.
  - Waiters are retried in the order they started waiting.
  - The ticket's `poll` interval handle became `stopWaiting()`, and the two `clearInterval` sites
    now call it.
  - Nothing else in the file changed.
- I did not use wake-on-release alone. Slots are also freed by automation and coordination runs and
  by lease expiry, and this process never sees those finish. A tick is still needed as the backstop.
- Effect: N waiting chats now share 1 timer instead of N, and the timers fire in a fixed order
  rather than at unrelated phases.
- Honest limit: admission attempts are still N per second, because each waiter still calls the
  store synchronously. Cutting the SQLite work belongs to T06/T08: an off-loop store, or waking the
  line head from `finishBuddyRun`.
- The test is in `server/test/conversation-runtime.test.ts`: 3 waiting chats create exactly one
  1000 ms interval, it survives while any chat waits, and it is cleared when the last one stops. It
  would fail on the old code, which creates 3 intervals.

## Notes for T08 / T13

- `lookupSessionContext` and `lookupProviderUsageForSession` are async now. T13 will replace them
  with ingest; the parity test fixture can be reused to check that replacement.
- The only lines T04 adds to `runtime.ts` are `waitForChatRunSlot` and its import of `noteActivity`.
  The new `TurnQueue` should take over the waiter set.
