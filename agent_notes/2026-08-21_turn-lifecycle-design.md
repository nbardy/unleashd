# Turn lifecycle: stop losing in-flight turns on hot reload

**Date:** 2026-08-21
**Status:** design proposed, NOT implemented, NOT accepted — see the companion RFR
**Decision owner:** repo owner
**Companion:** `agent_notes/2026-08-21_turn-lifecycle-RFR.md`

---

## 1. Decision (REVERSED after review round 2 — see §10)

**Do NOT build a supervisor daemon.** The original decision here was to move
provider execution into a daemon. Cross-review overturned it: the central
simplicity argument did not survive audit (§10). Superseded plan:

1. **Defer the `reloading` state transition** — wait for turns to go idle
   *before* entering `reloading`, instead of entering it and waiting inside.
   ~30 lines across `tools/watch-server.mjs` and `server/src/lifecycle/shutdown.ts`.
   This dissolves the constraint everything else was working around, and it
   implements the intent already written at `tools/watch-server.mjs:39-48`.
2. **Drop `child: ChildProcess` from the execution seam** (§5a). Stands on its
   own merits; genuinely local change.
3. **Optionally**, detach-and-adopt as a durability tail for the cases (1) cannot
   cover — bounded outer deadline, SIGINT, crash. Correctly costed in §4b: it is
   NOT just `unref()`.
4. **Shelve the daemon.** If revisited, the process-group, socket-auth and
   contract-skew objections in §10 are entry requirements, not follow-ups.

The rest of this document is preserved as written, with corrections marked
inline, so the reasoning that led to the wrong call stays auditable.

---

## 2. Symptom and verified mechanism

The UI pill reads `Interrupted by restart · <duration> · Provider output <age> · Server restarted`.

Every claim below was verified by reading the cited line on 2026-08-21.

| Step | Evidence |
|---|---|
| Pill string | `client/src/utils/turn-diagnostics.ts:205` |
| `server_restart` → `'restart'` | `client/src/utils/turn-diagnostics.ts:131-132` |
| Tooltip `Server restarted` | `client/src/utils/turn-diagnostics.ts:167` |
| Reload waits, then force-drains | `server/src/lifecycle/shutdown.ts:125`, `:133` |
| Force-drain stops each turn | `server/src/lifecycle/shutdown.ts:87` `conversation.stop('server_restart')` |
| Grace = **8s**, env-overridable | `server/src/constants/timeouts.ts:20` `HOT_RELOAD_DRAIN_GRACE_MS` |
| Every turn spawns detached | `server/src/conversations/runtime.ts:735` `detached: true` |
| Kill is whole process GROUP | `vendor/agent-cli-tool/src/execute.ts:316` `process.kill(-child.pid, …)` |
| Boot sweeps non-terminal attempts | `server/src/observability/turn-attempt-journal.ts:122`, `:135` |

**The turn in the reported incident ran 1m 1s.** A provider turn essentially
never completes inside the 8s grace, so force-drain is the normal path, not an
edge case.

Note the combination at `runtime.ts:735` + `execute.ts:316`: because the spawn is
detached and the kill targets the negative pid, restart tears down the CLI **and
its entire descendant tree**. `child.unref()` is never called
(`vendor/agent-cli-tool/src/process-runner.ts:48-52`), so `detached` here buys a
process group, not backgrounding. Restart is therefore strictly MORE destructive
than a plain `child.kill()` would be.

---

## 3. What already exists (why this feels like it should already work)

It is not true that nothing was built for this. The doctrine and most of the
mechanism are present — the conversation restart path just opts out of them.

| Capability | Location | State |
|---|---|---|
| "Disk poller rehydrates sessions/history across restarts" | `server/src/conversations/runtime.ts:616-618` | documented doctrine |
| Adopt an externally-run session and stream it in | `server/src/lifecycle/file-poller.ts:69-76`, `:98-100` | **built, working** |
| `isProcessAlive(pid)` via `process.kill(pid, 0)` | `server/src/swarm/runtime.ts:27-34` | **built** |
| Persist pid → probe → derive `isLive` | `server/src/swarm/runtime.ts:153-157` | **built, swarms only** |
| Provider session resume on the NEXT turn | `server/src/conversations/runtime.ts:689`, `:732` | **built** |

So swarms get adopted; conversations get killed. The poller's adoption logic can
never fire for a conversation because we guarantee nothing survives to adopt.

---

## 4. Why the two cheaper fixes are wrong

### 4a. Do NOT just raise the grace

`CWV_HOT_RELOAD_DRAIN_GRACE_MS=1800000` looks like a free win. It is a trap, and
`server/src/lifecycle/shutdown.ts:183-187` says why:

> `reloading` is terminal — there is no path back to `idle`, so every mutation is
> refused until this process exits. That makes the grace below a liveness
> requirement, not an optimisation: without it a long provider turn wedges
> conversation creation indefinitely (incident 2026-08-20).

Raising the grace trades turn-death for app-wedging and re-introduces the
incident the guard was added for. **The 8s is not a miscalibration.** The real
constraint one level up is that `reloading` is an absorbing state.

### 4b. Detach-and-adopt is two paths for one concern

Persist `{conversationId, sessionId, pid, attemptId}`, `unref()` the child, probe
on boot, let the poller stream the result. Cheap, and it leans on machinery that
already exists (§3).

Rejected as the primary design because it yields **two** streaming paths — live
turns via the event iterator, adopted turns via the poller at
`FILE_POLL_INTERVAL_MS = 5_000` (`server/src/constants/timeouts.ts:53`). That is
the same concern implemented twice, and reconstruction-by-inference (pid probe +
transcript growth) is fallback-shaped.

**Corrected in review round 1 — this option is MORE expensive than stated.**
`unref()` alone does not save the turn. `executeCommand` always supplies
`onStdout`/`onStderr` (`vendor/agent-cli-tool/src/execute.ts:242-243`), so
`useCallbacks` is always true and `process-runner.ts:51` always spawns with
`stdio: ['pipe','pipe','pipe']`. The child's stdout pipe is owned by the app
server; when that server exits the child takes SIGPIPE and dies. Verified
empirically by the reviewer: detached + `unref()` + piped stdout, parent exits at
t=0.5s → child dead by t=3s with the work incomplete; the same child with
file-backed stdio ran to completion.

So detach-and-adopt additionally requires redirecting stdio to files and
re-parsing JSONL from disk. That is materially more than "reuses machinery that
already exists."

**Re-verified independently 2026-08-21 (round 2), because the two reviewers
disagreed on this exact point.** Reproduced with agent-cli's real spawn shape
(`detached: true`, `stdio: ['pipe','pipe','pipe']`, a stdout callback attached,
`unref()`, parent exits at t=0.5s while the child has 3s of work left):

- **piped stdio → child never completed**; it died with the parent.
- **identical child with file-backed stdio → ran to completion.**

Reviewer 2's proposed "just `unref()`, stop killing, make the sweep pid-aware" is
therefore incomplete. The stdio redirect is mandatory, not optional. This is the
one substantive point on which the two reviews conflicted, and the empirical
result settles it in reviewer 1's favour.

Keep it in the back pocket for the one case a daemon cannot cover: daemon crash
or SIGKILL (§7).

---

## 5. The design

### 5a. The seam already exists

`ExecuteCommandHandle` (`vendor/agent-cli-tool/src/runtime-types.ts:117-124`) is
already almost right. Drop `child: ChildProcess` and both a local and a remote
implementation satisfy it:

```ts
export interface TurnHandle {
  readonly turnId: string;
  readonly events: AsyncIterable<UnifiedAgentEvent>;
  readonly sessionId: Promise<string>;
  readonly completed: Promise<ExecuteCommandCompletion>;
  readonly stop: (signal?: NodeJS.Signals) => void;
  readonly exited: Promise<void>;          // replaces proc.once('close')
  readonly alive: () => Promise<boolean>;  // replaces proc.exitCode === null
}
```

**Corrected in review round 1.** `isAlive(): boolean` was originally declared
synchronous. `proc.exitCode === null` is a synchronous local field read and has no
synchronous remote equivalent, so it must return a promise (or a daemon-pushed,
therefore stale, cache). Severity is low — all three call sites
(`runtime.ts:1822`, `:1843`, `:2048`) sit inside `setTimeout` callbacks — but
"crosses a process boundary trivially" was wrong as written.

Simplification worth considering: `alive` could be **dropped entirely**. Each site
only guards a SIGKILL escalation whose timer is already cleared by the close
handler, and a SIGKILL to an already-dead pid raises ESRCH, which
`vendor/agent-cli-tool/src/execute.ts:317` already swallows. The counter-argument
is pid reuse: an unconditional kill on a recycled pid signals an unrelated
process. The existing `exitCode` check narrows that window, so dropping it is a
real (if small) safety trade, not a free win.

**This is viable because nothing in `runtime.ts` needs a local `ChildProcess`.**
Audited 2026-08-21: across ~20 `this.process` references, only two capabilities
are used —

- `proc.exitCode === null` (liveness), and
- `proc.once('close', …)` at `runtime.ts:1828`, `:1848`, `:2053`.

Every other reference is a presence check. Both capabilities cross a process
boundary trivially. One interface, two implementations, one consumer: dev uses
the daemon, prod uses in-process, and `runtime.ts` never branches on which.

### 5a-bis. `env` must become explicit request data (found in review round 1)

`vendor/agent-cli-tool/src/process-runner.ts:48-52` passes `cwd`, `detached` and
`stdio` to `spawn` — and **no `env`**. The child therefore silently inherits the
spawning process's entire `process.env`: provider credentials, `PATH`, everything.
`resolve.ts:31` likewise shells `which` in the spawner's env and caches per
spawner lifetime.

Under a daemon the spawn site is the daemon, so every environment dependency must
be promoted to explicit data on the request. This is not hypothetical — it
collides with in-flight work. `vendor/agent-cli-tool/src/harnesses/opencode.ts`
(uncommitted) states the constraint in its own comment:

> "which is why this encoder returns `env` and not `args`, and why the caller
> (unleashd) could never implement this itself: only the spawn site can set env."

and returns `{ env: { OPENCODE_CONFIG_CONTENT: … } }`. Verified 2026-08-21:
`process-runner.ts` contains **no env handling whatsoever**, so that encoder's
output is currently dropped on the floor. `CommandSpec.env` must be plumbed
through `build.ts` → `execute.ts` → `process-runner.ts` (MERGED over the inherited
env, never replacing it) before either the opencode encoder or the daemon can
work. See `agent_notes/2026-08-20_buddy-mcp-harness-boundary.md` §4.

### 5b. Collapse turn state into a sum

`this.process` / `this.isRunning` / `this.isStreaming` are three fields held
consistent by hand; `runtime.ts:1812-1816` documents an atomicity fight between
them. That is accidental optionality.

```ts
type TurnState =
  | { kind: 'idle' }
  | { kind: 'queued';    attemptId: string }
  | { kind: 'running';   attemptId: string; handle: TurnHandle }
  | { kind: 'streaming'; attemptId: string; handle: TurnHandle }
  | { kind: 'stopping';  attemptId: string; handle: TurnHandle };
```

`if (this.process || this.isRunning)` — repeated at `runtime.ts:678`, `:1552`,
`:1742`, `:2231` — collapses to `state.kind !== 'idle'`.

**INCOMPLETE — do not implement as written (round 2).** The variant set above is
missing a sixth state that is load-bearing today: *turn complete from the user's
perspective, child still exiting.* `runtime.ts:1477-1481` clears `isRunning` and
`isStreaming` immediately on `turn.complete` ("clear busy state now instead of
waiting for child-process teardown") while `this.process` stays non-null until
`:935`. Verified. That `(process !== null, isRunning === false)` pair is depended
on by at least four sites, including `_handleTurnTimeout`'s **conjunctive** guard
`if (!this.process || !this.isRunning) return;` (`runtime.ts:1987`),
`hasActiveProcess()` (`:2258`) which the shutdown drain counts
(`shutdown.ts:61`), and the poller gate at `session-loader.ts:418`.

Collapsing it into `running`/`streaming` changes drain and queue semantics;
collapsing it into `idle` breaks the spawn guard. The sum needs a `draining`
variant plus an explicit wire projection for `isRunning`/`isStreaming`
(`runtime.ts:2135-2136`). Until that is derived from the real states, this step is
a design change to a hot file, not a behaviour-preserving refactor.

### 5c. The daemon

Owns every child. Contains no app code — only agent-cli. Three operations:

- start a turn → `turnId`
- subscribe to a turn's events **from a sequence number**
- stop a turn

The per-turn **sequenced ring buffer** is the whole trick: on reconnect the
replacement app server replays from its last acked seq. That is what makes a
reload lossless *while keeping live streaming*. No adoption, no pid probing, no
transcript-growth inference, no reconstruction by guessing.

**The replay MUST be exactly-once, or seq-gated at the consumer (review round
1).** The consumer is not idempotent: `server/src/conversations/runtime.ts:1272`
does `currentMsg.content += event.text` — a pure append — and then re-broadcasts
the chunk to clients. An at-least-once replay therefore duplicates assistant text
both server-side and on the wire. This was listed as unchecked in the RFR; it has
now been checked and it fails. Cheapest correct fix is a monotonic seq on each
event with the consumer discarding `seq <= lastApplied`; that also makes the
buffer-overflow case detectable (gap in seq) rather than silent.

---

## 6. What this deletes

The simplicity case. All of the following become unreachable, not
better-handled:

- `HOT_RELOAD_DRAIN_GRACE_MS` (`server/src/constants/timeouts.ts:20`) and the
  force-drain path (`server/src/lifecycle/shutdown.ts:123-141`)
- the absorbing `reloading` state (`server/src/lifecycle/shutdown.ts:176-194`) —
  reload becomes: close sockets, exit
- the `server_restart` terminal cause and `interrupt()`-on-restart
  (`server/src/conversations/runtime.ts:1806`)
- the boot-time recovery sweep for conversations
  (`server/src/observability/turn-attempt-journal.ts:116-137`)
- the external-activity heuristic for conversations
  (`server/src/lifecycle/file-poller.ts:69-91`) — the poller reverts to its real
  job, detecting external CLI edits
- `detached: true` + the process-group kill (`server/src/conversations/runtime.ts:735`,
  `vendor/agent-cli-tool/src/execute.ts:316`) — the daemon owns lifetime, so a
  plain kill suffices

"Interrupted by restart" stops being a state the system can reach.

---

## 7. Limitations — stated, not hidden

1. **agent-cli edits still kill turns.** The daemon depends on agent-cli, so
   changing it needs a daemon restart. Make that explicit and manual
   (`pnpm dev:daemon:restart`), NOT watched. `server/src` edits — the large
   majority — stop killing turns. This limitation is exactly today's situation,
   narrowed.
2. **The daemon needs supervision.** `tools/dev-supervisor.mjs` already
   supervises processes; it becomes another task.
3. **"Reload is lossless" is FALSE for buddy turns (review round 1).** A buddy
   turn's MCP server (`server/src/buddies/mcp-config.ts:29-44` →
   `mcp-server.ts`) is a grandchild that mostly talks to SQLite directly and so
   survives a reload. But `delegate` and `request_review` `fetch()` the app
   server (`mcp-server.ts:201`, `:229-230`) with **no retry**, so during the
   reload window they get ECONNREFUSED and surface as tool errors. The motivating
   incident in §9 is itself a buddy conversation, so this is the common case, not
   an exotic one. Either those calls need retry-with-backoff, or the daemon must
   hold the socket, or "lossless" must be stated more narrowly.
4. **A daemon crash still loses turns.** Rare — it holds almost no logic. This is
   the only place §4b would still add value, as a later optional layer.
5. **Unverified:** whether the reported incident came from the force-drain path
   (`shutdown.ts:133`) or the boot recovery sweep
   (`turn-attempt-journal.ts:122`). They are distinguishable in logs:
   `Backend force-draining after 8000ms grace …` vs `attempt_recovered`.

---

## 8. Sequencing (SUPERSEDED — see §1 and §10)

Original plan was: TurnHandle seam → TurnState sum → daemon → delete §6. Steps 3
and 4 are withdrawn, and step 2 is blocked on the missing `draining` variant
(§5b). What survives:

1. **Defer the `reloading` transition.** Fixes the reported incident. No new
   process, no degradation — the dev server already runs stale code until the old
   process exits, so waiting longer costs nothing the developer can observe.
   Needs a bounded outer deadline to avoid a busy server never reloading.
2. **Drop `child` from the seam** (§5a) — independently worthwhile.
3. `TurnState` sum only after the variant set is corrected (§5b).
4. Detach-and-adopt only if (1) proves insufficient, and costed per §4b.

---

## 9. How this was found

A buddy conversation editing `vendor/agent-cli-tool/src/**` kept killing itself.
Chain, confirmed by mtime:

1. edit `src/harnesses/opencode.ts` — `00:13:16`
2. `tsc --watch` (`tools/dev-supervisor.mjs:578`) rebuilds
   `dist/harnesses/opencode.js` — `00:13:17`, one second later
3. `tools/watch-server.mjs:17` watches `vendor/agent-cli-tool/dist`
4. reload → 8s grace → force-drain kills the turn doing the editing

Same fingerprint on the prior interruption: `claude.ts` src `23:35:34` → dist
`23:35:35`. Editing the agent-cli submodule from inside an unleashd buddy
conversation kills that conversation.


---

## 10. Review log

**Round 1 — 2026-08-21, fresh-eyes adversarial review of the load-bearing claim.**
Verdict: PARTIALLY REFUTED. The narrow claim (nothing in `runtime.ts` needs a
local `ChildProcess`) SURVIVED independent re-derivation — 19 real `this.process`
references, no stdin/fd/IPC/pid use, and `this.process` never escapes the file
(external callers use `hasActiveProcess()`). Attacks on stdin delivery and on
process-group kill semantics both failed; a non-parent CAN signal `-pid`, and the
group kill cannot reach the daemon.

But the audit had targeted the wrong surface: **the locality lives in the spawn
options, not in the handle.** Three gaps folded in above — async `alive` (§5a),
explicit `env` (§5a-bis), and non-idempotent replay (§5c) — plus a corrected cost
for the rejected alternative (§4b) and a corrected losslessness claim (§7.3).
None collapse the design; all belong in it before step 3.

Reviewer's unverified items, still open: whether `tools/dev-supervisor.mjs`
injects env the daemon would also need, and whether `createAsyncQueue` is bounded
(bears on ring-buffer overflow).


**Round 2 — 2026-08-21, fresh-eyes architecture cross-review of the decision.**
Verdict: **REJECT THE DAEMON.** Findings verified independently before acceptance:

- **The "net-negative code" claim is false.** Of the six deletions in §6, four
  survive a daemon. Two verified directly: `server_restart` is an **on-disk JSONL
  format value** hard-matched by the journal replay parser
  (`turn-attempt-journal.ts:638`, `:646`), so removing it makes historical
  journals unparseable; and the boot sweep keys on
  `originServerBootId !== serverBootId` (`:122`), so under a daemon — where turns
  routinely outlive a boot id — it would mark *still-running* turns
  `interrupted`/`server_restart` on every reload. The fix would reproduce the
  reported symptom.
- **The "two streaming paths" objection was backwards.** The adopted-turn path is
  not hypothetical: `session-loader.ts:418-426` already replaces `existing.messages`
  wholesale from the on-disk transcript and `:451` forces `isRunning` when external
  activity is present. Verified. That path already exists and already runs, so
  detach-and-adopt adds **zero** streaming paths while the daemon adds one. The
  design rejected the option with fewer paths on the grounds that it had more.
- **The constraint in §4a is dissolvable cheaply**, by moving the wait to the
  other side of the state transition rather than lengthening it. This was
  considered and discarded earlier in the thread; discarding it was the error.
- Further objections accepted without independent verification: `pnpm dev:replace`
  SIGKILLs process groups and would kill a supervised daemon
  (`dev-supervisor.mjs:423-425`, `:685-690`); a daemon socket carrying
  `{prompt, cwd, yolo:true}` is a new unauthenticated local surface against the
  doctrine in `docs/auth.md:16-21`; and app/daemon **contract** skew fails
  silently, a bug class the current architecture cannot produce.
- Reviewer answered **Q2 yes** (5s granularity is acceptable; the real baseline is
  not "live stream" but "the turn is dead and its process tree killed") and
  **Q3 no** (confirming round 1), while noting the seq-gate fix is ~5 lines.

The reviewer also flagged the bias the RFR asked to be checked for: the person
fixing this is the person being interrupted by it, and the artifact reached for a
permanent architectural guarantee against a dev-loop annoyance. That reads as
correct.
