# Incident 2026-08-20 — "draining active turns" + whole dev runtime dying

Diagnosis only. No fix applied. Two **independent** bugs that formed one causal
chain; the user experienced them as a single "hot reload is broken" event.

## TL;DR

1. **Bug A (server):** `reloading` is an absorbing state in the shutdown
   controller. Before `0d7ec84` there was no timeout on the drain, so a reload
   triggered while any provider turn was live wedged the server **permanently**,
   rejecting every mutation with `Backend reload is draining active turns`.
2. **Bug B (watcher):** `tools/watch-server.mjs` treats *any* backend exit it
   did not itself orchestrate as fatal — **including a clean `exit(0)` from a
   manual `kill`** — and tears down the entire dev runtime via
   `concurrently --kill-others-on-fail`.
3. **The chain:** Bug A wedged the server → the user ran `kill` to recover →
   Bug B turned that graceful shutdown into a full-stack teardown requiring
   `pnpm dev:replace`.

Bug B is **not** a regression from the recent changes. It is long-standing and
is currently pinned in place by a test that asserts it is correct.

## Evidence / timeline (all times KST, +0900)

| Time | Event |
|---|---|
| 03:25:23 | `2ca9011` committed. `waitForDrain` has **no** force timeout — infinite wait. |
| 03:27:02 | Backend running 3 active turns (`attempt_state_changed … running`). |
| ~03:27:03 | `SIGTERM — stopping active turns and shutting down` — external, targeted signal. |
| 03:27:04.7 | Turns interrupted, `terminalCause: server_restart`; provider children exit 143. |
| 03:27:04 | Prior session transcript `9b20189d…`, user message: **"i did kill and restart"**. |
| — | Backend exits **cleanly, code 0**. |
| — | `[server-watch] Backend exited unexpectedly with code 0; stopping dev runtime` → `exitCode=1`. |
| — | `concurrently` `--kill-others-on-fail` SIGTERMs `shared-esm`, `shared-cjs`, `cli`, `client`. |
| 03:34:24 | `0d7ec84` committed (**during this investigation**) — adds the 8s force-drain. |

The SIGTERM was delivered to the **backend PID alone**: the backend is spawned
without `detached` (`tools/watch-server.mjs:321`), so any process-*group* signal
would have hit the watcher too and set its `stopping` flag — which would have
suppressed the "exited unexpectedly" branch. It did not. Combined with the
user's own message, the source is settled: a manual `kill` (default SIGTERM).

## Bug A — `reloading` is an absorbing state

`server/src/lifecycle/shutdown.ts`

```
ShutdownState = 'starting' | 'idle' | 'reloading' | 'shutting_down' | 'exiting'
```

Transitions: `starting → idle` (`completeStartup`), `starting|idle → reloading`
(`handleReload`), `* → shutting_down`, `* → exiting`.

**There is no transition back to `idle`.** Once a dev-reload IPC arrives, the
only exit from `reloading` is process death. Admission is gated on it:

```ts
const startupCreation = state === 'starting' && options?.allowDuringStartup === true;
if (state !== 'idle' && !startupCreation) return null;   // shutdown.ts:140-141
```

`null` → WS `command_rejected {code:'server_draining'}`
(`transport/conversation-websocket.ts:112-125`) and HTTP 503
(`server.ts:262-282`). Note `allowDuringStartup` covers `starting` but **not**
`reloading`, which is why *creation* is the visible casualty.

Verified empirically against the real controller (scenarios run, harness deleted):

```
state after startup: idle   | createAllowed: true
state after reload IPC: reloading | createAllowed: false
  t=1000..7000ms  state=reloading createAllowed=false exits=0
  after ~8.6s: state=exiting exits=1 turnsInterrupted=1
completeStartup() recovers to idle? false
```

Design intent was explicit — `agent_notes/2026-07-29_buddy-profiles-and-safe-backend-reload.md`
lists under **Deliberate non-goals**: *"No reload timeout: long-running turns are
more important than immediate backend replacement during development."*
That non-goal is the bug. It was introduced in `29ce9ac`, which deleted the
`drainTimeoutMs`/`forceTimeout` pair that `32bc0a0` and `5e13355` had.

Because this user runs a fleet of Buddies **that edit `server/src` from inside
the app**, `activeWorkCount()` is essentially never zero when a reload fires.
That makes the wedge the normal case, not an edge case.

## Bug B — the watcher escalates any un-orchestrated exit to fatal

`tools/watch-server.mjs:332-411`. The close handler restarts only when
`reloadPending` is true. Otherwise:

```js
stopping = true;
consoleError(`[server-watch] Backend exited unexpectedly${signal ? … : ` with code ${code ?? 1}`}; stopping dev runtime`);
proc.exitCode = code && code > 0 ? code : 1;   // clean exit 0 → 1
```

`isQuickBuildFailure` requires `code !== 0`, so a graceful `exit(0)` skips the
recovery path entirely and lands here. A developer typing `kill <backend-pid>`
— the obvious workaround for Bug A — therefore kills `shared-esm`, `shared-cjs`,
`cli` and `client` too.

`tools/watch-server.test.mjs:545` currently **asserts this behaviour is
correct** (`assert.equal(s.stopping, true, 'SIGKILL should be fatal')`), so a
fix must revise that test deliberately.

## What `0d7ec84` fixed, and what it did not

Fixed: `waitForDrain` now arms an 8s `forceExitTimeout` that interrupts live
turns and exits, so the wedge self-heals instead of lasting forever.

Not fixed:

1. **`exiting` has no watchdog.** `exitOnce()` calls `clearTimers()` *before*
   awaiting `ports.flushState()` (`shutdown.ts:80-98`), which is
   `persistedServerState.flushUIStateSync(); await turnAttemptJournal.flush()`.
   If that promise never settles the process sits in `exiting` with **no timer
   left alive**, emitting the identical "draining" message forever. The 8s guard
   explicitly excludes `exiting`.
2. **`reloading` still rejects `create_conversation`,** so every server-source
   save yields a guaranteed multi-second window where "New conversation" fails.
3. **Reload during `starting` strands the hydration barrier.** `handleReload`
   accepts `starting` (`shutdown.ts:151`). Then `markReady()` → `completeStartup()`
   returns false (state is no longer `starting`), so `server.ts:485`
   `resolveInitialLoad()` is never called and `conversation_load_complete` is
   never broadcast. Every non-create WS command then awaits `initialLoadComplete`
   (`conversation-websocket.ts:103`) for the remaining life of that process, and
   the client's load spinner never clears. Severity is bounded by the fact that
   the process is on its way out (dropping `startupPending` usually lets the
   drain reach zero and exit), but connected clients hang for that whole window
   and the same early-return exists on the `abortStartup` path
   (`startup.ts:56-59`), which also never resolves the barrier.
4. **The 8s constant is hardcoded**, ignoring the injected
   `options.forceExitGraceMs` (`HOT_RELOAD_FORCE_EXIT_GRACE_MS`, default 3000).
   Not injectable → not testable by the existing fixture. It is currently 100%
   uncovered.
5. **`forceExitTimeout` is single-slotted and clobbered.** `handleShutdown`
   (`shutdown.ts:175-176`) calls `waitForDrain(...)` (which assigns the 8s timer)
   then immediately overwrites the handle with the `forceExitGraceMs` timer. The
   8s handle leaks and can never be cleared by `clearTimers()`/`dispose()`.
6. **Client has no time-based retry.** Recovery runs only on a new socket epoch
   (`preparePendingCreationForReconnect`, called solely from `handleInit`,
   `client/src/atoms/actions.ts:332`). While the socket stays open against a
   wedged server, the error stays on screen indefinitely. (The upload path did
   get a one-shot 1.2s retry in `usePendingAttachments.ts`; creation did not.)

## Why the window is so wide on this machine

The reload window is not milliseconds here — the replacement server takes a long
time to reach `idle`, and `handleReload` accepts `starting`, so saves during that
window restart the whole cycle.

Measured on this machine (warm cache):

| Quantity | Value |
|---|---|
| Discoverable session sources | 7,389 (claude 3,799 · codex 2,459 · muse 670 · cursor 461) |
| Bytes parsed in Phase 2 (newest 500 files) | 596 MB |
| Session cache `~/.agent-viewer/session-cache-v1` | 405 MB / 6,200 entries |
| Durable config records | 5,106 (5,075 active) |
| Records hit by the **serial** recovery loop | 4,585 |
| Full `ConversationConfigStore.list()` | ~240 ms |

Two structural costs, both independent of this incident but worth fixing:

- `progressive-loader.ts:45-50` hydrates **serially** (`for … await ports.hydrate`),
  and `onProgress` is awaited *inside* the parser worker (`loader.ts:401`), so all
  16 concurrent parse workers stall behind it.
- `session-loader.ts:213-256` `recoverConversationsWithoutTranscripts` is a fully
  serial `for … of` over ~4,585 records doing ~3 record reads each, **with no
  try/catch** — any throw aborts the entire load and routes to
  `handleStartupFailure()` → exit 1.
- **Quadratic:** `hydrate` calls `configStore.findBySession` per discovered
  session (`session-loader.ts:109`); on an index miss it falls back to a full
  `list()` (`config-store.ts:153-162`). Every session created since the last
  restart costs one ~240 ms full scan, serially — `O(new × total)`.

## Most likely cause of a *persistent* (not 8s-bounded) error

`exitOnce()` clears its timers **before** awaiting the flush:

```ts
82    state = 'exiting';
83    clearTimers();                     // ← both timers gone, unconditionally
90    exitPromise = Promise.resolve(pendingFlush)….then(() => ports.exit(code));
```

`flushState` is `persistedServerState.flushUIStateSync(); await turnAttemptJournal.flush()`
(`server.ts:412-415`), and `flush()` is `runExclusive(async () => undefined)`
(`turn-attempt-journal.ts:364-366`) — it queues behind every in-flight journal
operation. If any of those never settles, the process stays **alive in `exiting`
with no timers armed and no retry**, and `beginMutation()` returns `null`
forever. The watcher cannot rescue it either: it sends the reload IPC once
(`watch-server.mjs:434`) and only respawns on the child's exit event, which never
arrives. This is the one path that reproduces the symptom *indefinitely* even
after `0d7ec84`.

A related latent fragility: in the force-drain callback, `interrupt()` runs
*before* `activeMutations = 0` / `clearTimers()` / `exitOnce()`
(`shutdown.ts:120-125`). If `interrupt` ever throws, the one-shot timer is spent
and the counters are never reset, wedging `reloading` permanently. Both current
throw sites are defended today, so this is ordering to fix, not an active bug.

## Test gaps

- `tools/watch-server.test.mjs` is **not in any npm script**. `test:dev-supervisor`
  runs `dev-supervisor`, `local-domain`, `watch-runtime-readiness`,
  `watch-snapshot` — not `watch-server`. Its 6 tests pass but never run in CI.
- No test asserts the controller leaves `reloading` when work does **not** drain.
- No test bounds `exiting` / covers a hung `flushState`.
- No test covers the reload IPC handshake end-to-end (`RELOAD_MESSAGE` does not
  appear in the watcher test file).
- No test asserts `beginMutation({allowDuringStartup:true})` is refused in
  `reloading` — the actual user-visible symptom.

## Operational hazards found while investigating

- `~/.claude/settings.json` `permissions.allow` includes `Bash(pkill:*)`,
  `Bash(xargs kill:*)`, `Bash(xargs -r kill)`, `Bash(xargs -r kill -9)`,
  `Bash(lsof:*)`. Any agent in this repo can signal processes without a prompt.
- `test/api.test.js:44` spawns the API test server with argv **identical** to the
  dev backend (`node --import tsx src/server.ts`). `pkill -f "tsx src/server.ts"`
  cannot tell them apart. Prior transcripts show agents running exactly that
  pattern (`0a2a23f8…` 2026-08-18, `0003b7ca…` 2026-08-18).
- `runs/440bc2ca/started.json` holds `pid: 4735` from 2026-03-12 with no
  `stopped.json`. `server/src/swarm/routes.ts:168` liveness-checks with a bare
  `process.kill(pid, 0)`, which cannot detect PID recycling; a "stop swarm" click
  would send that PID a targeted SIGTERM.
- This repo is being committed to by **concurrent agent sessions**. `0d7ec84`
  landed mid-investigation. Re-read git state before drawing conclusions from it.

## Suggested fix order (not applied)

1. **Watcher: stop escalating an un-orchestrated exit to fatal.** Treat a clean
   `exit(0)` as restartable — respawn instead of killing the runtime. This is the
   fix that would have prevented the visible incident. Revise
   `watch-server.test.mjs:545` deliberately, and wire the file into `pnpm test`
   (`test:dev-supervisor` currently omits it).
2. **Server: bound `exiting`.** Move `clearTimers()` after the flush settles, or
   arm an independent hard-exit watchdog before awaiting, so a hung
   `turnAttemptJournal.flush()` cannot wedge the process permanently.
3. **Server: fix the force-drain plumbing.** Derive the grace from
   `options.forceExitGraceMs` instead of the hardcoded `8000`; stop clobbering
   `forceExitTimeout` in `handleShutdown:175-176`; reorder the force-drain body so
   the counter resets and `exitOnce()` precede `interrupt()`. Then add the missing
   test: *work never drains → controller still exits*.
4. **Server: never strand `initialLoadComplete`.** Either refuse `handleReload`
   while `starting`, or resolve the barrier on both early-return paths
   (`startup.ts:56-59` and `61-64`).
5. **Admit `create_conversation` during `reloading`.** It mints a fresh UUID and
   durable record that cannot collide with hydration — the same argument that
   already justifies `allowDuringStartup` (`5d79890`). This removes the visible
   symptom outright.
6. **Startup cost.** Parallelize hydration, add try/catch around the serial
   recovery loop, and index `findBySession` to kill the `O(new × total)` scan.
   Shorter startup shrinks every reload window.
7. **Client.** Add a bounded time-based retry for `server_draining`, not just the
   `handleInit` socket-epoch retry, so a wedged-then-recovered server heals
   without a manual reload.

## Guardrails worth adding regardless

- Give the dev backend a distinguishing argv marker at `watch-server.mjs:321` so
  `pkill -f "tsx src/server.ts"` cannot hit both it and `test/api.test.js:44`.
- Age out / start-time-verify `runs/*/started.json` PIDs before
  `server/src/swarm/routes.ts:176` sends them a signal.

---

# Resolution (branch `fix/reload-drain-and-watcher-teardown`)

Landed on top of `0d7ec84`. Server tests 190 (189 pass / 0 fail), tools tests 28/28,
`tsc -p server/tsconfig.json --noEmit` clean.

## Fixed

1. **Watcher no longer escalates an un-orchestrated exit to fatal.**
   `tools/watch-server.mjs` — the close handler is now a thin dispatcher over four
   variants (`watcher_stop`, `reload_replace`, `quick_failure`, `unexpected_exit`),
   one handler each. A clean `exit(0)` or any signal after a healthy uptime is a
   **restart**, bounded by `unexpectedExitStreak` (escalates after 3 lives that
   never reach `HEALTHY_UPTIME_MS`). A signal is never routed to the "likely a
   syntax error" path. This is the fix that would have prevented the incident.
2. **`exiting` is bounded.** `shutdown.ts` arms a `flushGraceMs` watchdog *after*
   `clearTimers()`, so a hung `turnAttemptJournal.flush()` can no longer strand the
   process alive-but-refusing-everything.
3. **Force-drain plumbing.** `reloadDrainGraceMs` and `flushGraceMs` are explicit
   injected options (was: hardcoded `8000`). `handleShutdown` no longer arms a
   second timer over `waitForDrain`'s handle — that leak is gone. Force-drain
   resets its counters *before* `interrupt()` and wraps it, so a broadcast failure
   cannot skip `exitOnce()` and wedge `reloading`.
4. **Startup barrier never strands.** `runServerStartup(...).finally(resolveInitialLoad)`
   covers all three terminal outcomes; the barrier now means "startup is no longer
   in progress". Waiters resume and get a typed rejection instead of hanging.
5. **Recovery is fault-isolated per record.** `session-loader.ts` — one unreadable
   durable record no longer propagates to `handleStartupFailure()` and exits.
6. **`tools/watch-server.test.mjs` is wired into `pnpm test`** (it existed but no
   script ran it).

## Tests added / revised

- `tools/watch-server.test.mjs`: revised `kill -9` (was `assert.equal(s.stopping,
  true, 'SIGKILL should be fatal')` — deliberately inverted, with rationale);
  added "healthy backend exiting 0 is restarted, not fatal" and "a backend that
  never stays up escalates instead of restarting forever".
- `server/test/shutdown.test.ts`: added "a reload whose work never drains still
  exits after the grace" (the liveness case every prior test avoided by making the
  work go away), "a state flush that never settles still exits the process", and
  "shutdown force-exits on the shutdown grace, not the reload grace".
- `server/test/session-loader-hydration.test.ts`: added "one unrecoverable record
  does not abort the whole startup hydration". Verified falsifiable — it fails when
  the try/catch is removed.

## Deliberately NOT done

- **Admitting `create_conversation` during `reloading`.** Listed as an option in the
  diagnosis, rejected on reflection: creation can dispatch an initial message, which
  starts a provider turn in a process already committed to dying — it would either
  extend the drain or be force-interrupted seconds later. `allowDuringStartup` is
  justified because that process is coming *up*. The symptom is instead handled by
  bounding the window (fixes 1-3) plus the client's existing retry on reconnect.
- **The `O(new × total)` `findBySession` rescan** (`config-store.ts:153-162`). A
  naive memo does not help: `hydrate` writes a record per session, so any
  write-invalidated cache is invalidated on every iteration. The real fix is a live
  in-memory binding→conversationId index updated (not invalidated) on write/delete/
  rekey. That is a refactor of the authoritative persistence layer where a missed
  invalidation duplicates conversations, so it does not belong in an incident fix.
  Startup latency is unchanged by this branch.
