# Sprint Handoff — Direct Reports (Sub-Buddies)

*Date: 2026-08-20 · Branch: `mobile-fixes-and-audit-2026-08-18` · Prepared by: Buddies Development Lead*
*Tracked in Buddy project state: 10 projects, 56 todos, workspace `unleashd`*

## 1. One-paragraph status

The direct-reports design has been through three passes and is now **verified against source** —
the third pass ran four independent code reviews that found the feature *unimplementable as
written in three places and dead on arrival in a fourth*. All corrections are committed
(`0d7ec84`). **No implementation has landed in unleashd.** A large body of store work exists in
`~/git/buddies` but is unreviewed and uncommitted. The sprint's critical path is one review;
three lanes are blocked behind it.

## 2. What is actually done

| | Evidence |
|---|---|
| Design corrected and committed | `0d7ec84`, design doc md5 `41e0766f81adcf67df062968355dcc77` |
| Work broken into lanes | 10 Buddy projects, 56 todos, audit row per creation |
| Threat model made honest | design §10 — the prior "hire_quota bounds spoofing" claim is withdrawn |

## 3. What is NOT done

Repo-wide search for `hire_quota|hireDirectReport|retireDirectReport` outside markdown:
**0 matches in unleashd.** Server, client, and tests are untouched.
`server/test/buddy-direct-reports.test.ts` does not exist.

## 4. Sprint scope — seven lanes

Ordered by dependency, not by size.

| # | Lane | Todos | Status | Blocked by |
|---|---|---|---|---|
| 1 | **Verify and land the store layer** | 9 | ready | — **critical path** |
| 2 | Document the `-p` orchestration constraint | 3 | ready | — parallel |
| 3 | Security fixes direct reports depend on | 4 | ready | — parallel |
| 4 | Vendoring: remote → submodule | 3 | ready | Owner decision |
| 5 | Server layer: ops, allowlist sum, profile route | 6 | backlog | lane 1 |
| 6 | Client layer: delete `deriveBuddyHierarchy` | 7 | backlog | lane 1 |
| 7 | Test suite: 16 cases, one fixture | 7 | backlog | lanes 1, 5 |

**Out of sprint, deliberately:** AI-OS as workflow layer; work-graph (task-to-task links + team
membership); the design §14 deferred backlog. All three are filed and all three say
"not until direct reports lands."

## 5. The critical path, in detail

`~/git/buddies` is at `fc7751a` ("B1-B6 …") with **1,321 uncommitted lines** across
`store.js`, `index.d.ts`, `test/v1.test.js`, at **schema 13 where the design specifies 12**.
The vendored copy in unleashd is stale — source md5 `baba453c` vs vendored `53f1afc5`.

Nobody has checked that code against the design. Verify on five specific points, each a trap
the design documents:

1. **§5.1** visibility derived from the *pair*, not the row — otherwise archiving a *manager*
   makes its still-active reports invisible and unreachable while their automations keep firing
2. **§7.5** `countHeldDirectReports` uses `UNION`, not `UNION ALL` — else the quota double-counts
   and disagrees with the UI badge
3. **§8.1** quota assert in the `vacant`/`reactivatable` handlers, **absent** from `held` — else
   an idempotent replay throws once the Owner lowers the quota
4. **§8.4** slug regex asserted *before* any filesystem work — `slugify("...")` returns `""`, and
   the post-commit `rename` would then target the `profiles/` directory itself
5. **§9.3** `held`/`reactivatable` verify and re-materialize a missing soul file — the window
   between `COMMIT` and `rename` is silent and permanent otherwise

Then: `node --test` green, commit locally, `pnpm vendor:buddies`, confirm `sourceDirty:false`
and vendored md5 == source md5.

## 6. The six blockers (why the design was rewritten)

| | Blocker |
|---|---|
| B1 | `updateBuddy` cannot write `hire_quota` — silently discarded, HTTP 200, **every hire refuses forever** |
| B2 | Reactivate nests a transaction; on `node:sqlite` `updateBuddy`'s catch **rolls back its caller** |
| B3 | `reassignOpenWorkTo` unimplementable — nothing can change `owned_projects.buddy_id` |
| B4 | Quota read sits outside the transaction — two processes both pass `0 < 1` |
| B5 | No `busy_timeout` — concurrent hire surfaces raw `database is locked` |
| B6 | The *second pass's own fix* broke idempotent replay — seats are consumed by transitions, not calls |

## 7. Needs Owner action (agents cannot do these)

1. **Create the sprint.** `createSprint` exists (`store.js:2185`) but there is **no HTTP route and
   no Buddy operation** for it. The `sprint` field on project ops only resolves an existing
   sprint, so it is currently dead. Sprint assignment is blocked on this — attempting it returns
   `sprint not found`.
2. **Decide vendoring.** `~/git/buddies` has no git remote — that is *why* unleashd vendors a
   tarball rather than a pointer. Push it and the submodule pattern becomes available, dropping
   the repack step from every store change.
3. **Provision the Lead's `soul_path`/`memory_path`.** Both are `null`, so `buddy.remember`
   throws `Buddy has no configured memory path`. Nothing from the design session persists into
   Buddy memory. This is design §4's trap, live, on the Lead itself.

## 8. Operating constraint the sprint must respect

**Buddy turns run as `claude -p`, which exits when the turn's final message lands.** The
`Workflow` tool has no blocking option, so its in-process agents are *always* killed at turn
end — this cost two full workflow runs. Use blocking `Agent` calls (proven: four agents,
~6.5 min, full structured results), or orchestrate from outside the process.

Two CLI traps that cost real time:

* spawned sessions need `--model` pinned — the bare default was credit-exhausted while
  unleashd's own spawns worked, because `agent-cli` always passes `--model`
* `--add-dir <directories...>` is **variadic** and silently swallows a trailing positional
  prompt; symptom is a session that starts `(idle — send a prompt to start)`

## 9. Environment warning

Concurrent agent sessions are actively mutating both repos; the working tree changed three times
during one session. `rtk` serves stale git state — an early read showed `HEAD 3b7027f / schema 11`
where uncached git showed `fc7751a / schema 13`.
**Verify with `/usr/bin/git` before trusting anything.**

## 10. First moves

1. Lane 1 review — one blocking agent, the five checkpoints in §5
2. In parallel, lanes 2 and 3 — neither waits on anything, and lane 2 prevents the next agent
   losing a day to the `-p` trap
3. Answer the three Owner items in §7 — the first two change how later lanes execute
