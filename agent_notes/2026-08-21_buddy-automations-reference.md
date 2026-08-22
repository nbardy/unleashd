# Buddy automations — the system as actually built

**Date:** 2026-08-21 · **Status:** reference, reverse-engineered from source · **Owner:** Buddies Lead
**Why this exists:** the Owner asked "what is `job_kind`? what are jobs? is that the cron
system?" — and nothing in `docs/`, `product/`, or `agent_notes/` answered it. Four separate
sessions have now re-derived this. Written down so nobody derives it a fifth time.

---

## 1. There is no job system

There is **one** feature: *buddy automations*. "Job" is not a queue entry, a worker task, or a
separate subsystem. **A job is the work payload of an automation**, and `job_kind` is the shape
of that payload. There is no `jobs` table.

Each automation row carries two **independent** axes:

```
buddy_automations
  schedule_kind  IN ('cron','interval')            -- WHEN it fires
  schedule_expression, timezone
  job_kind       IN ('prompt','sequence','loop')   -- WHAT it does when it fires
  job_payload    TEXT (JSON; shape depends on job_kind)
```

So cron is **half of one axis** — one of two ways to express *when*. It is the schedule, not the
system. `interval` is the other: a positive number of seconds.

Constants: `AUTOMATION_SCHEDULE_KINDS` / `AUTOMATION_JOB_KINDS`, `store.js:38-39`.
Table: `store.js:400-418`.

## 2. The three job kinds

| `job_kind` | payload | behaviour |
|---|---|---|
| `prompt` | `{prompt}` | One prompt, one turn. `iteration = 1`. |
| `sequence` | `{prompts:[...]}` | A **fixed list**, in order, all in ONE conversation. Refuses upfront if `prompts.length > policy.max_iterations`. |
| `loop` | `{prompt, termination:{condition, max_iterations, max_duration_seconds}}` | Re-sends the same prompt with the goal appended, up to `max_iterations`, until the Buddy replies `{"buddyAutomation":{"done":true}}`. |

`sequence` is "do these N things." `loop` is "keep going until this condition is met."

Payload validation per kind: `store.js:#validateAutomationDefinition` (~`:4358`).

## 3. Execution model

An **in-process poller inside the unleashd server**. Not OS crontab. Not an external queue.

```
server.ts:483   new BuddyScheduler({...})
scheduler.ts:171  start() -> setInterval(() => this.poll(), pollIntervalMs)
scheduler.ts:221  poll() -> store.listDueAutomations(now)
                  -> claim -> createConversation -> run the job arm -> update run row
```

Consequences worth knowing:

* **If the server is not running, nothing fires.** There is no catch-up daemon and no backfill.
* Double-firing across connections is prevented by a `UNIQUE` idempotency key on
  `buddy_automation_runs`, not by a lock.
* The `loop` arm (`scheduler.ts:335-363`) drives iteration **outside** the `-p` process and
  reuses **one conversation** across iterations (`runBeforeDeadline(conversation, ...)` at
  `:344`). This is the correct inversion — orchestration outside, `-p` as the atomic unit.
* Across **scheduled runs**, however, `scheduler.ts:273` calls `createConversation` fresh. There
  is no resume. Continuity between runs depends entirely on `buddy.remember`.

## 4. Tables

| table | role |
|---|---|
| `buddy_automations` | the definition (schedule + job) |
| `buddy_automation_runs` | one row per firing; `status`, `iteration`, `outcome`, `conversation_id` |
| `buddy_automation_policies` | budget per automation |
| `buddy_automation_run_policies` | budget **snapshotted at claim time**, plus `tokens_used` / `cost_usd` counters |

The run-policy snapshot is deliberate: editing an automation cannot retroactively widen a run
already in flight.

Defaults (`store.js:95-99`): `max_runtime_seconds` 600, `max_iterations` **10**,
`max_tokens` 50_000, `allowed_operations` `["buddy.get_current_work"]`.

## 5. What automations are allowed to do

`AUTOMATION_ALLOWED_OPERATIONS`, `store.js:77-92` — 14 operations, including `buddy.delegate`,
`buddy.request_review`, `buddy.submit_review`, `buddy.complete_assignment`.

`hire_direct_report` / `retire_direct_report` are **deliberately excluded**: a scheduled run can
never hire. See `PLANNING_SUB_BUDDIES.md` §3.

## 6. Live state (2026-08-21) — the machinery is unexercised

Queried read-only against `~/.buddies/buddies.sqlite`:

| | |
|---|---|
| Automations | **10**, of which **9 disabled**. Only "Nightly portfolio report" (Portfolio Historian, `0 22 * * *`) is enabled. |
| `job_kind` | **10/10 `prompt`.** Zero `sequence`, zero `loop` have ever been created. |
| `schedule_kind` | **10/10 `cron`.** `interval` has never been used. |
| Runs, all time | 22 — 20 complete, 1 failed, 1 cancelled |
| `tokens_used` / `cost_usd` across all 22 runs | **0 and 0.0** |

Two things follow, and both matter:

1. **`loop` is shipped in code but has never run in production.** Any plan that leans on it is
   leaning on tested-but-unexercised machinery. Treat the first real loop as a trial.
2. **The spend counters are never written.** The columns exist with `CHECK` constraints and stay
   at zero. This is the tracked item "`max_tokens`/`max_cost_usd` are validated, persisted, and
   never read" — now confirmed at the data level, not just by reading code. A funded manager
   will reasonably believe spend is capped. It is not.

## 7. Known defects in this area

* **`parseAutomationCompletion` silently swallows malformed output.** `scheduler.ts:34-35`
  returns `done:false` when the JSON does not parse. A Buddy that genuinely finished but
  formatted badly is treated as unfinished: it redoes the work, burns iterations, and eventually
  fails the run. This is the silent fallback the house rules forbid (T4) — it should be a typed
  error.
* **Iteration exhaustion is an error, not a checkpoint.** `scheduler.ts:364` throws
  `Automation loop did not satisfy its termination condition after N iterations`. Combined with
  the hard cap of 10 (`store.js:4423`, and `MIN(10,...)` in the v7 backfill at `:631`), a goal
  loop over a real backlog is guaranteed to fail rather than pause.
* **`done` is self-reported and unverified.** `scheduler.ts:359` trusts a bare boolean. Unlike
  `complete_assignment`, no evidence is required.
* **Paused Buddies' automations still fire.** `listDueAutomations` does not join `buddies` or
  require `status='active'`. Tracked in the security-fixes lane.
