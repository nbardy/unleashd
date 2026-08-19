# PLANNING_SUB_BUDDIES.md — Direct Reports (Sub-Buddies)

*Date: 2026-08-20 · Status: planned, third pass — not yet coded · Owner: Buddies Lead*
*Companion: `agent_notes/2026-08-19_sub-buddies-design.md` (implementation spec)*

## 1. Goal

A Buddy with an Owner-granted hiring budget can **hire** and **retire** its own direct
reports: real `buddies` rows with their own `BUDDY_SOUL.md`, `memory/`, `owned_projects`, and
automations — hidden from the directory, reachable only under their manager, and free to fan
out ephemeral **sub-agents** for parallel work.

Example: Lead hires a `data-engineer`, which owns one `owned_project` per scraper and spawns
sub-agents to implement them.

## 2. The one naming decision

**`Sub-buddy` and `direct report` are the same thing.** One hierarchy, one directory rule, one
UI section. Code, docs, ops, and UI all say **direct report**; "sub-buddy" is retired as a term
except as a gloss on first use.

Ops are therefore `buddy.hire_direct_report` / `buddy.retire_direct_report`. What changes is
*who may hire* — Owner-only today, budgeted managers tomorrow — not what gets created.

Note the shipped UI does **not** currently say "Team: N" (earlier drafts of this doc claimed it
did). Directory cards say lowercase `team`; mobile detail says `N sub-buddies`. Renaming those
to match this vocabulary is part of the client phase.

| | ephemeral sub-agent | direct report (sub-buddy) |
|---|---|---|
| Lifetime | one turn | until retired |
| Identity | none | `buddyId`, soul, memory |
| Owns work | no | `owned_projects`, todos, automations |
| Created by | any Buddy, freely | manager with hiring budget > 0 |

## 3. Decisions (locked)

| Topic | Decision |
|---|---|
| **Authority** | New `buddies.hire_quota INTEGER NOT NULL DEFAULT 0 CHECK (>= 0)` (schema v12). `0` = cannot hire. Owner sets it per Buddy. It is the capability *and* the quota — but see **Threat model** below: it is a budget and audit record, **not a security boundary**. |
| **Quota semantics** | A **concurrent headcount ceiling**, not a lifetime budget: retiring frees the seat. Every non-`archived` report holds a seat, so `paused` counts. Creating and reactivating consume a seat; an idempotent replay of an existing report does not. |
| **Not a depth rule** | A hired report inherits `hire_quota = 0`, which is a safe default. The Owner may deliberately fund a second level. No depth assertion is added. |
| **Identity** | `soul` markdown is a **required** argument to hire. The txn writes `profiles/<slug>/BUDDY_SOUL.md` + `profiles/<slug>/memory/`. A report born without them cannot remember (`buddy.remember` throws) — design §4. |
| **Directory rule** | Same set, better type: `overview` gains `employment: {kind:'top_level'} \| {kind:'direct_report', managerId}`, built at the source, and `managerId` is deleted in the same release. Directory membership stops being a null check. |
| **One manager** | Enforced by a **partial unique index** in v12, not by an application assertion, plus normalizing the redundant `reports_to` encoding away on write. The migration backfills existing violations (keep earliest, audit the rest). |
| **Retire** | `status='archived'`. **Never deletes the manager edge** — the rule is `!managerId`, so deleting the edge would pop the retiree into the directory. `overview` filters archived instead, deriving visibility from the *pair* so archiving a manager cannot orphan an active report. |
| **Retire + open work** | Refused while the report has open `owned_projects`, unless `reassignOpenWorkTo` names the manager **and** the manager belongs to that project's workspace. No silent orphaning, no cross-workspace corruption. |
| **Re-hire** | Hiring a name matching an archived report **reactivates it** — same `buddyId`, memory intact. Solves slug reuse and doubles as the idempotency rule; no fingerprint table. Reactivation does **not** re-enable automations. |
| **Workspaces** | Home + every additional workspace must already be assigned to the manager. |
| **Automations** | `hire`/`retire` are deliberately **not** in the store's `AUTOMATION_ALLOWED_OPERATIONS`. Scheduled runs can never hire. |
| **Surface** | Two ops, in-process only. No new WS contract, no new hierarchy model. |

## 4. Threat model — say this plainly

`hire_quota` is **not** a capability gate. A Buddy has a shell as the user, and there are four
reachable write paths to the column (the profile route, the SQLite file, a re-exec'd MCP
entrypoint, and the ungated relationships route). The shared secret does not bound this: on a
loopback bind with no token the auth policy is literally open, and the token file is readable
by every agent the server launches.

The honest claim, which is still a real one:

> A Buddy with a shell can already do anything its user can, including hiring itself.
> `hire_quota` makes the **sanctioned** path budgeted, legible, and audited. The marginal risk
> of this feature at `hire_quota = 0` is approximately zero, because the escalation it would
> grant is already available.

Real containment needs OS-level uid separation plus per-caller identity on `/api/buddies/*`.
That is tracked separately and this feature does not make it worse.

## 5. UX

* Directory: unchanged — top-level only.
* Manager detail: the existing team section counts **non-archived** reports (matching the
  quota, so badge and quota never disagree); archived ones render dimmed below, so a manager
  can see and reactivate who it retired.
* Report detail: ordinary Buddy detail + a `Manager → Report` breadcrumb.
* Owner-only control: hiring budget field on the profile editor, defaulting to `0`.

## 6. Phases

0. **Vendor** (`~/git/buddies`) — this is a release, not an edit. Schema v12; the store
   prerequisites (re-entrant transaction helper, `busy_timeout`, `hireQuota` on `updateBuddy`,
   a `reassignOwnedProject` primitive); `hireDirectReport`/`retireDirectReport`; the `overview`
   employment sum and archived filter; the scheduler status filter. Then `pnpm vendor:buddies`
   + provenance bump.
1. **Server** — two ops + MCP registration; make `allowedOperations` a required sum rather than
   an optional list; `hire_quota` on the profile route; fix the automation `enabled` spread;
   the delegate/review gates; briefing lines.
2. **Client** — serve `team` on `GET /api/buddies/:id`, delete `deriveBuddyHierarchy` whole,
   move the archived filter into `buddyCardMetrics`, fix the "0 team" badge regression.
3. **Tests** — 16 cases, one fixture, real sqlite + real tmpdir.
4. **Trial** — Lead hires `data-engineer` in EventMap; it owns 3 scraper projects and runs one
   `loop` automation that fans out sub-agents.

## 7. Known gaps, tracked separately

* **Waking the *same* conversation on a schedule** is unsupported, and `job_kind: loop` is not
  it. Needs a `conversation_id` binding plus a scheduler resume path. Orthogonal to hiring.
* **`max_tokens` / `max_cost_usd` are validated, persisted, and never enforced.** The two
  budgets that *are* enforced are per-run, not cumulative. A funded manager will reasonably
  believe spend is capped; it is not. Enforce or delete.
* **Nothing caps** automations per buddy, outbound delegations, delegation depth, or
  `profiles/` disk. Quota bounds headcount only.

## 8. Why this was gated before

The `2026-07-28` program froze structural mutation as Owner-only until one closure loop was
proven end to end. It now is. What reopens it is not "the gate was wrong" but that hiring
becomes an explicit, budgeted, audited per-Buddy grant instead of an ambient capability —
with no pretence that the budget is a security boundary.
