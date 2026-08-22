# HANDOFF — Direct Reports (Sub-Buddies) — Unleashd

*Date: 2026-08-20 · Branch: `mobile-fixes-and-audit-2026-08-18` · Status: design third pass, not yet coded*

## 1. TL;DR

* **Sub-buddy == direct report.** One `buddies` type, one hierarchy, one directory rule, one UI
  section. What is new is *who may hire*. Ops: `buddy.hire_direct_report` /
  `buddy.retire_direct_report`.
* **`hire_quota` is a budget, not a gate.** Schema v12, default `0`. It makes hiring legible and
  audited. It is **not** a security boundary — a Buddy has a shell and four write paths to the
  column. The doc says so plainly now; the previous draft claimed otherwise and was wrong.
* **Hire provisions identity.** `soul` is required; the txn writes
  `profiles/<slug>/BUDDY_SOUL.md` + `profiles/<slug>/memory/`. Without them `buddy.remember`
  throws.
* **Retire never deletes the manager edge** — the rule is `!managerId`, so deleting it would
  promote the retiree into the directory. `overview` filters archived instead, deriving
  visibility from the *pair* so archiving a manager cannot orphan an active report.

## 2. Third-pass review — six blockers, do not skip

Four independent code reviews ran against the corrected design on 2026-08-20. The feature was
**unimplementable as written in three places and dead on arrival in a fourth**:

| # | Blocker | Why it matters |
|---|---|---|
| B1 | `updateBuddy` cannot write `hire_quota` — fixed option list, silently discarded | Every Buddy stays at 0; **every hire refuses forever**, HTTP 200, no diagnostic |
| B2 | Reactivate nests a transaction; the store is `node:sqlite` (no savepoints) and `updateBuddy`'s catch **rolls back its caller** | Real error is masked by "no transaction is active" |
| B3 | `reassignOpenWorkTo` is unimplementable — nothing can change `owned_projects.buddy_id` | Retire-with-open-work has no path |
| B4 | Quota read sits outside the transaction | Two processes both pass `0 < 1`; quota overrun |
| B5 | No `busy_timeout` is ever set | Concurrent hire surfaces raw `database is locked` |
| B6 | The **second pass's own fix** ("QUOTA FIRST, ALWAYS") breaks idempotent replay when the Owner lowers quota below headcount | Seats are consumed by transitions, not by calls |

Plus: `slugify` returns `""` for `"..."`, making the post-commit `rename` target `profiles/`
itself; the archived filter as drafted **reintroduces the vanishing act** when a *manager* is
archived; the crash window between `COMMIT` and `rename` is silent and permanent (re-hire takes
the replay arm and never repairs); and the client plan **does not compile** — neither caller of
`deriveBuddyDirectReports` has an overview payload.

All are addressed in the design. See design §1 for the blocker table and §9.3, §8.4, §5.1, §12.

## 3. Where things stand (disk)

| File | Role |
|---|---|
| `product/PLANNING_SUB_BUDDIES.md` | Product intent + locked decisions + threat model |
| `agent_notes/2026-08-19_sub-buddies-design.md` | Implementation spec — blockers, traps, ops, 16 tests |
| This file | Handoff |

Nothing is implemented. Repo-wide search for
`hire_quota|hireDirectReport|retireDirectReport|hire_direct_report|retire_direct_report`
excluding markdown returns **0 matches**. `~/git/buddies` is clean at `3b7027f`; both source and
vendored `store.js` are `CURRENT_SCHEMA_VERSION = 11`.

## 4. Remaining work (in order)

0. **Vendor** (`~/git/buddies`) — a release, not an edit. Store prerequisites first (re-entrant
   `#tx`, `busy_timeout`, `hireQuota` on `updateBuddy`, `reassignOwnedProject`), then schema v12
   (column + `CHECK` + partial unique indexes + backfill), then the two helpers, the `overview`
   employment sum + pair-derived archived filter, and the scheduler status filter. Then
   `pnpm vendor:buddies` + provenance bump here.
1. **Server** — two ops + MCP registration; `allowedOperations` becomes a required sum;
   `hire_quota` on the profile route; stop spreading `enabled` from `req.body`; fix the
   delegate/review gates to use the canonical edge and exclude archived; briefing lines.
2. **Client** — serve `team` on `GET /api/buddies/:id`; delete `deriveBuddyHierarchy` whole;
   archived filter into `buddyCardMetrics`; gate the badge on `metrics.team > 0` to avoid a new
   "0 team" regression.
3. **Tests** — `server/test/buddy-direct-reports.test.ts`, 16 cases on one fixture.
4. **Trial** — Lead hires `data-engineer` in EventMap.

## 5. How to resume

```bash
# vendor first — the store change is a release, not an edit
cd ~/git/buddies && $EDITOR src/store.js
node --test && pnpm pack
cd ~/git/unleashd && pnpm vendor:buddies   # updates tgz + provenance

pnpm test:server                           # buddy-lifecycle-e2e must stay green
```

## 6. Open call

Whether the first hire in a workspace should route through `request_human_approval`. The lean
default is no — `hire_quota` is already an explicit Owner grant and the Owner can pause or
archive any report. Flip only if hiring turns out to need per-instance review.

## 7. Deliberately out of scope

Real capability containment (OS-level uid separation + per-caller identity on
`/api/buddies/*`); cumulative automation budgets (`max_tokens`/`max_cost_usd` are validated,
persisted, and **never read**); per-report resource caps; and waking an existing conversation on
a schedule. All tracked in design §14 — do not smuggle them in.
