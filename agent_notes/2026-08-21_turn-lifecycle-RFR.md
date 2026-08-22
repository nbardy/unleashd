# RFR: turn lifecycle / supervisor daemon

**Date:** 2026-08-21
**Reviews:** `agent_notes/2026-08-21_turn-lifecycle-design.md`
**Status:** RESOLVED — daemon REJECTED after two cross-reviews. Superseded plan in the design doc §1. No code written, nothing committed.
**Round 1 review:** returned; findings folded into the design (§10 there). Q1 and Q3 now answered — see §6 below.
**Asked of:** repo owner + one fresh-eyes reviewer who has not touched this thread

---

## What I need from you

Not a line edit. I need the **decision** attacked. The design picks a supervisor
daemon over two cheaper options, on simplicity grounds. If that call is wrong,
now is when it is cheap to say so — steps 1–2 of the plan are pure refactors, but
step 3 is a new long-lived process and that is hard to walk back.

Please answer the five questions in §3 explicitly. "Looks good" is not useful
here.

---

## 1. The claim in one paragraph

In-flight turns die on hot reload because the reload drain grace is 8s
(`server/src/constants/timeouts.ts:20`) and provider turns are minutes long, so
force-drain (`server/src/lifecycle/shutdown.ts:133`) is the normal path. The
grace cannot simply be raised, because `reloading` is an absorbing state and the
grace is therefore a liveness guard, not a tuning knob
(`server/src/lifecycle/shutdown.ts:183-187`). The proposed fix removes the app
server from the ownership path entirely: a supervisor daemon owns provider
children and exposes a sequenced, replayable event stream, so a reload is a
reconnect.

---

## 2. Claims most likely to be WRONG — attack these first

Ranked by how much damage they do if false.

1. **"Nothing in `runtime.ts` needs a local `ChildProcess`."**
   The entire design rests on this. I audited ~20 `this.process` references and
   found only `exitCode === null` and `.once('close')` at `runtime.ts:1828`,
   `:1848`, `:2053`. **If there is a single place that needs real local process
   semantics — stdin, fds, cwd inheritance, signal nuances, `unref`, IPC — the
   seam does not cleanly go remote and the design degrades badly.** Please try to
   break this specifically.

2. **"A sequenced ring buffer makes reload lossless."**
   Unproven. Open sub-questions: how large is the buffer, what happens when it
   overflows during a slow reload, and is the ack protocol exactly-once or
   at-least-once? If it is at-least-once, does `runtime.ts`'s event handling
   tolerate a duplicated event? I have NOT checked that it is idempotent.

3. **"This is net-negative code."**
   §6 of the design lists six subsystems it deletes. I have not written the
   daemon, so I cannot yet prove the daemon is smaller than what it removes. Treat
   the deletion list as a claim, not a result.

4. **"Detach-and-adopt is the wrong primary design."**
   I rejected it for having two streaming paths. Counter-argument I find genuinely
   strong and could not fully dismiss: it reuses machinery that already works
   today (`server/src/lifecycle/file-poller.ts:69-76`,
   `server/src/swarm/runtime.ts:27-34`, `:153-157`), ships far sooner, and
   degrades to a 5s-granularity stream rather than to a dead turn. **If you think
   5s-granularity output for the reload case is acceptable, the daemon is
   probably over-engineering and you should say so.**

5. **Unverified:** whether the observed incident came from force-drain
   (`shutdown.ts:133`) or the boot recovery sweep
   (`server/src/observability/turn-attempt-journal.ts:122`). Distinguishable in
   logs — `Backend force-draining after 8000ms grace …` vs `attempt_recovered`.
   If it is mostly the latter, the diagnosis shifts.

---

## 3. Questions I want answered explicitly

**Q1.** Does anything in `runtime.ts` need a *local* `ChildProcess` beyond
liveness and close-notification? (Kills the design if yes.)

**Q2.** Is 5s-granularity output acceptable for the reload case? If yes, do
detach-and-adopt instead and skip the daemon.

**Q3.** Is `runtime.ts`'s event handling idempotent under a replayed/duplicated
event? If not, the replay protocol must be exactly-once and that is a real cost.

**Q4.** Is a second long-lived dev process acceptable operationally, given
`tools/dev-supervisor.mjs` already supervises several?

**Q5.** Should steps 1–2 (`TurnHandle` seam, `TurnState` sum) land regardless of
the daemon decision? I claim yes — they are behavior-preserving refactors that
remove hand-maintained state consistency (`runtime.ts:1812-1816`). Disagree if you
think they churn a hot file for no user-visible gain.

---

## 4. Explicitly NOT proposed

- Raising `CWV_HOT_RELOAD_DRAIN_GRACE_MS`. It re-introduces incident 2026-08-20.
  If anyone suggests this as a quick fix, that is the counter.
- Auto-retrying interrupted turns via provider session resume. CLI resume means
  "new turn on an existing transcript"; it cannot continue a turn killed
  mid-tool-call, and a killed child may have half-applied edits before SIGTERM, so
  replay is not idempotent. Defensible only as an explicit "Retry" button.
- Changing what `tools/watch-server.mjs` watches. Out of scope.

---

## 5. Context the reviewer should have

This was found because a buddy conversation editing the agent-cli submodule kept
killing itself (design §9). That gives the work an unusual property worth naming:
**the person fixing it is the person being interrupted by it**, which biases
toward over-valuing the fix. Please discount for that.

Blocked/waiting: the buddy-MCP refactor
(`agent_notes/2026-08-20_buddy-mcp-harness-boundary.md`) is sitting with four
encoders written and uncommitted in `vendor/agent-cli-tool`. It should probably
land before any of this starts, so it is not swept into an unrelated change.


---

## 6. Round 1 results (2026-08-21)

Reviewer brief: refute the load-bearing claim. Verdict **PARTIALLY REFUTED**.

**Q1 — does anything in `runtime.ts` need a LOCAL `ChildProcess`?**
**Answered: no.** Independently re-derived — 19 real `this.process` references
(3 grep hits were `this.processQueue(`), split as 6 writes / 10 presence checks /
3 capture-then-liveness-and-close. Only `.exitCode` (`:1822`, `:1843`, `:2048`)
and `.once('close')` (`:1828`, `:1848`, `:2053`). No stdin, fd, `.pid`, `.kill()`,
`unref`/`ref`, IPC, `.connected`, `.spawnargs`, or `.signalCode`. `this.process`
never escapes the file — external callers go through `hasActiveProcess()`
(`shutdown.ts:61`, `session-loader.ts:356`, `:418`). `UnifiedAgentEvent` is fully
JSON-serialisable (`runtime-types.ts:95-107`).

Two attacks were attempted and both failed: stdin delivery is written and
`end()`ed synchronously at spawn (`process-runner.ts:54-57`) and no harness uses
`stdin: 'pipe'`; and a non-parent process CAN signal a detached child's group, so
`process.kill(-pid)` still works from a daemon and cannot reach the daemon itself.

**But the audit targeted the wrong surface.** Locality lives in the SPAWN
OPTIONS, not the handle. Three gaps, all folded into the design:
- `isAlive(): boolean` cannot be synchronous across a boundary → `alive(): Promise<boolean>`, or dropped (design §5a).
- `env` is inherited implicitly and must become explicit request data. `process-runner.ts` has **no env handling at all** — verified — so the uncommitted opencode MCP encoder's `env` output is currently discarded (design §5a-bis).
- `debugRawEvents` writes to the spawner's stderr (`execute.ts:83`, `:92`, `:101`, `:121`); under a daemon that lands in daemon logs. Observability regression only.

**Q3 — is the event handling idempotent under replay?**
**Answered: NO.** `runtime.ts:1272` does `currentMsg.content += event.text` and
re-broadcasts. At-least-once replay duplicates assistant text server-side and on
the wire. Replay must be exactly-once or seq-gated at the consumer.

**Bonus finding — Q2's fallback is more expensive than the RFR claimed.**
Detach-and-adopt does NOT work via `unref()` alone. `execute.ts:242-243` always
supplies stdout/stderr callbacks, so `process-runner.ts:51` always spawns with
piped stdio; the app server owns that pipe and the child dies of SIGPIPE when it
exits. Verified empirically (parent exits t=0.5s → child dead by t=3s, work
incomplete; file-backed stdio → ran to completion). Detach-and-adopt additionally
needs file-backed stdio plus JSONL re-parsing from disk. This *strengthens* the
case for the daemon.

**Also found:** "reload is lossless" is false for buddy turns — `delegate` and
`request_review` `fetch()` the app server with no retry (`mcp-server.ts:201`,
`:229-230`). See design §7.3.

### Still open after round 1

- **Q2** (is 5s granularity acceptable / is the daemon over-engineering) — now
  harder to answer yes, since the cheap option turned out not to be cheap.
- **Q4** (second long-lived dev process, operationally) — untouched.
- **Q5** (should steps 1–2 land regardless) — untouched.
- Whether `tools/dev-supervisor.mjs` injects env the daemon would also need.
- Whether `createAsyncQueue` is bounded — bears on ring-buffer overflow.


---

## 7. Round 2 results + resolution (2026-08-21)

Reviewer brief: attack the decision, not the prose. Verdict: **reject the
daemon**; do the deferred-transition fix instead. Accepted — design §1 rewritten.

**Q2 — is 5s granularity acceptable / is the daemon over-engineering?**
**Answered: yes, it is acceptable; yes, the daemon is over-engineering.** The
comparison I framed was "live token stream vs 5s chunks." The real baseline is
"5s chunks vs the turn is dead and its whole process tree killed." This is also a
dev-only path. Two caveats the reviewer raised against their own argument, both
still unverified: provider transcripts flush at message boundaries, so real
granularity is the provider's cadence rather than 5s; and `EXTERNAL_GRACE_MS`
(`timeouts.ts:9`) is 30s, so "turn finished" is detected late.

**Q4 — second long-lived dev process, operationally?**
**Answered: no.** `dev-supervisor.mjs:423-425` SIGKILLs process groups on
`dev:replace` and `:685-690` spawns children as group leaders, so a supervised
daemon dies to the documented recovery command — the exact case where a daemon
loses every turn. Escaping the group makes it unmanaged, which
`assertDevPortsAvailable` explicitly warns about (`:307-323`), and its port would
be invisible to the fixed `DEV_PORTS_BY_TASK` table (`:45-49`).

**Q5 — should steps 1–2 land regardless?**
**Answered: step 1 yes, step 2 no.** The `TurnState` sum is missing a `draining`
variant — verified at `runtime.ts:1477-1481` vs `:935`, and depended on by the
conjunctive guard at `:1987`, `hasActiveProcess()` at `:2258`, `shutdown.ts:61`,
and `session-loader.ts:418`. As specified it is a behaviour change to a hot file,
not a refactor.

### Reviewer conflict, adjudicated

The two reviews **disagreed** on the cost of detach-and-adopt. Round 1: `unref()`
is insufficient because stdio is always piped and the child takes SIGPIPE. Round
2: it is cheap — `unref()`, stop killing, make the sweep pid-aware.

Settled empirically, reproducing agent-cli's real spawn shape: **piped stdio →
the child died with the parent and never completed its work; file-backed stdio →
ran to completion.** Round 1 is correct. Detach-and-adopt requires redirecting
stdio to files plus re-parsing JSONL from disk, and should not be scheduled as a
cheap change. Design §4b updated.

### What I got wrong

The deferred-transition fix was raised earlier in this thread and then discarded
in favour of the daemon. Discarding it was the error, and both the "net-negative
code" and "two streaming paths" arguments used to justify that were wrong on the
facts. The RFR asked reviewers to discount for the author being the person the
bug interrupts; that discount was warranted.
