# PLANNING_SUB_BUDDIES.md — Direct Reports (Sub-Buddies)

*Date: 2026-08-20 · Status: planned — not yet coded · Owner: Buddies Lead*
*Companion: `agent_notes/2026-08-19_sub-buddies-design.md` (implementation spec)*

## 1. Goal

A Buddy with an Owner-granted hiring budget can **hire** and **retire** its own direct
reports: real `buddies` rows with their own `BUDDY_SOUL.md`, `memory/`, `owned_projects`,
and automations — hidden from the directory, reachable only under their manager's
`Team: N`, and free to fan out ephemeral **sub-agents** for parallel work.

Example: Lead hires a `data-engineer`, which owns one `owned_project` per scraper and
spawns sub-agents to implement them.

## 2. The one naming decision

**`Sub-buddy` and `direct report` are the same thing.** There is one hierarchy
(`buddy_relationships(manager|reports_to)`), one hide rule (`overview.topLevel`), one UI
section (`Team: N`). Code, docs, ops, and UI all say **direct report**; "sub-buddy" is
retired as a term except as a gloss on first use.

Ops are therefore `buddy.hire_direct_report` / `buddy.retire_direct_report`, not
`create_sub_buddy`. What changes is *who may hire* — Owner-only today, budgeted managers
tomorrow — not what gets created.

| | ephemeral sub-agent | direct report (sub-buddy) |
|---|---|---|
| Lifetime | one turn | until retired |
| Identity | none | `buddyId`, soul, memory |
| Owns work | no | `owned_projects`, todos, automations |
| Created by | any Buddy, freely | manager with hiring budget > 0 |

## 3. Decisions (locked)

| Topic | Decision |
|---|---|
| **Authority** | New `buddies.hire_quota INTEGER NOT NULL DEFAULT 0` (schema v12). `0` = cannot hire. Owner sets it per Buddy in the UI. This single column is the capability gate, the quota, **and** the depth rule — a hired report inherits `hire_quota = 0`, so reports cannot hire without a deliberate Owner grant. |
| **Identity** | `soul` markdown is a **required** argument to hire. The txn writes `profiles/<slug>/BUDDY_SOUL.md` + `profiles/<slug>/memory/` in the home workspace and stores both paths. A report born without them cannot remember (`buddy.remember` throws) — see design §3. |
| **Hide rule** | Unchanged: `overview.topLevel = employees.filter(!managerId)`. Reports never become directory cards. |
| **Retire** | `status='archived'`. **Never deletes the manager edge** — the hide rule is `!managerId`, so deleting the edge would pop the retiree into the directory. `overview.employees` now excludes archived instead. |
| **Retire + open work** | Refused while the report has open `owned_projects`, unless `reassignOpenWorkTo` names the manager. No silent orphaning. |
| **Re-hire** | Hiring a name that matches an archived report **reactivates that report** — same `buddyId`, memory intact. Solves slug reuse (`UNIQUE(project_id, slug)`) and doubles as the idempotency rule; no fingerprint table. |
| **Workspaces** | Home + every additional workspace must already be assigned to the manager. A manager cannot place a report somewhere it cannot go itself. |
| **Automations** | `hire`/`retire` are deliberately **not** added to the store's `AUTOMATION_ALLOWED_OPERATIONS`. Scheduled runs can never hire. |
| **Surface** | Two ops, in-process only. No new WS contract, no new UI section, no new hierarchy model. |

## 4. UX (no new sections)

* Directory: unchanged — `topLevel` only.
* Manager detail: existing `Team: N` + report pills. `Team: N` counts **active** reports;
  archived ones render dimmed below, so a manager can see and reactivate who it retired.
* Report detail: ordinary Buddy detail + a `Manager → Report` breadcrumb.
* Owner-only control: hiring budget field on the profile editor (`hire_quota`), defaulting
  to `0` for every existing Buddy.

## 5. Phases

0. **Vendor** — `@nbardy/buddies` is a tarball built from `~/git/buddies`. Schema v12,
   `hireDirectReport`/`retireDirectReport`, and the `overview` archived filter land there
   first, then `pnpm vendor:buddies` + provenance bump. This is a release, not an edit.
1. **Server** — two ops in `operations.ts` + MCP registration + `hire_quota` on the
   profile route.
2. **Client** — read reports from `overview.employees[].team` (which already carries
   `status`) and delete the duplicate relationship-derived list; dim archived.
3. **Tests** — default-deny, hide-rule survival across retire, memory actually writable,
   re-hire keeps memory, automations rejected.
4. **Trial** — Lead hires `data-engineer` in EventMap; it owns 3 scraper projects and runs
   one `loop` automation that fans out sub-agents.

## 6. Known gap, not in scope

"Wake the *same* conversation every hour" is not supported and `job_kind: loop` is not it —
`loop` iterates back-to-back with no delay, and every scheduled tick creates a fresh
conversation. Supporting it means binding an automation to a `conversation_id` and having
the scheduler resume rather than create. Tracked separately; it is orthogonal to hiring.

## 7. Why this was gated before

The `2026-07-28` program froze structural mutation (`new_buddy`, reporting-line changes)
as Owner-only until one closure loop was proven end to end. It now is. What reopens it is
not "the gate was wrong" but that the gate now has a home: `hire_quota` makes hiring an
explicit, budgeted, per-Buddy grant instead of an ambient capability.
