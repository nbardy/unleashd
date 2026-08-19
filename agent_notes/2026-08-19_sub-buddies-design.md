# 2026-08-19 Direct Reports (Sub-Buddies) — Implementation Spec

**Status:** design, not yet coded · **Companion:** `product/PLANNING_SUB_BUDDIES.md`
**Terminology:** `sub-buddy == direct report`. One hierarchy
(`buddy_relationships(manager|reports_to)`), one hide rule (`overview.topLevel`), one UI
section (`Team: N`). Ops are named `hire_direct_report` / `retire_direct_report`.

A first draft of this doc claimed "no migration, no store change, reuse the existing
allowlist." Every one of those was wrong against the code; §2–§6 record why, because each
is a trap the next reader would fall into again.

## 1. Where the code actually lives

`@nbardy/buddies` is **not** in this repo. It is a vendored tarball
(`vendor/nbardy-buddies-0.1.0.tgz`, provenance `sourceCommit 3b7027f`) built from
`~/git/buddies` by `tools/vendor-buddies.mjs` (`pnpm vendor:buddies`). Every store change
below is a commit in that repo, a repack, and a provenance bump in this one — the same
discipline as the `vendor/agent-cli-tool` submodule. Plan it as phase 0, not as a detail.

Store paths in this doc are `@nbardy/buddies src/store.js`.

## 2. Trap: the operation allowlist is default-**open**

`BuddyOperationContext.allowedOperations` is optional. `operations.ts:277` only enforces
it when present, and `mcp-config.ts buddyCodexMcpArgs` never passes `--allowed-operation`
for an ordinary Buddy conversation — so it is `undefined` and `mcp-server.ts:100`
registers *every* tool. `DEFAULT_DELEGATED_BUDDY_OPERATIONS` (`operations.ts:216`)
constrains only delegated child conversations.

Therefore "just leave hire out of `DEFAULT_DELEGATED_BUDDY_OPERATIONS`" grants hiring to
every top-level Buddy in every normal conversation. The capability must be **per-Buddy
state checked inside the operation**, which is what `hire_quota` is.

Corollary: the same reasoning applies to any future privileged op. Adding a name to a list
that defaults open is not a gate.

## 3. Trap: a Buddy created the Builder way has no soul and no memory

`createBuddyFromBuilder` writes `soul_path: null, memory_path: null` (`store.js:891`).
Consequences for such a Buddy:

* briefing renders `(No Buddy soul has been configured.)` (`integration.ts:225`)
* `readBuddyMemory` silently returns `{summary:"", recentJournal:[]}` (`store.js:2120`)
* the **first `buddy.remember` throws** `Buddy has no configured memory path`
  (`store.js:3300`)

Persistent memory is the entire difference between a direct report and an ephemeral
sub-agent, so hire must provision both. `createBuddy` already accepts workspace-relative
`soulPath`/`memoryPath` (`store.js:765`) and the shipped convention is
`profiles/<slug>/BUDDY_SOUL.md` + `profiles/<slug>/memory`
(`scripts/initialize-growth-lead.js:24,128`).

`soul` is a **required** string argument on hire. The manager is an LLM; it can author the
soul inline. (This is why the hire path does *not* reuse the Builder conversation: the only
things Builder adds are soul authoring and conversation-keyed idempotency, and an inline
`soul` plus the reactivation rule in §5 cover both — without making hire asynchronous or
nesting a builder conversation inside an agent turn.)

## 4. Trap: the hide rule is `!managerId`, so deleting the edge *un-hides*

`overview()` derives `managerByReport` from `buddy_relationships` and returns
`topLevel: employees.filter((item) => !item.managerId)` (`store.js:2668`). A retire that
tidies up the manager edge would make the retiree managerless — i.e. promote it into the
directory. **Retire never touches relationships.**

Related: `listBuddies()` has no status filter (`store.js:1086`), so archived Buddies
currently stay in `employees`, in `topLevel`, and in `team[]`. Retire is therefore
invisible today. Fix in `overview()`:

```js
const employees = buddies
  .filter((buddy) => buddy.status !== "archived")
  .map(employee);
// buddyById still built from all buddies, so team[] keeps archived
// entries with their status — the manager can see and reactivate them.
```

Note the behaviour change: an existing archived *top-level* Buddy also drops out of the
directory. That is the intended fix, but call it out in the vendor changelog.

## 5. Schema v12 and the two store helpers

```sql
ALTER TABLE buddies ADD COLUMN hire_quota INTEGER NOT NULL DEFAULT 0;
PRAGMA user_version = 12;  -- CURRENT_SCHEMA_VERSION 11 -> 12
```

One column is the capability gate, the quota, and the depth rule at once: a hired report
is created with `hire_quota = 0`, so it cannot hire unless the Owner deliberately grants
it. There is no separate "depth == 1" assertion to get wrong. (The first draft's
`count manager edges … WHERE status='active'` was also unimplementable —
`buddy_relationships` has no status column; the count must join `buddies`.)

### `hireDirectReport({ managerBuddy, name, role, soul, workspace, additionalWorkspaces, provider, model, reasoningEffort })`

```
manager = requireBuddy(managerBuddy); assert manager.status === 'active'
assert workspace and every additionalWorkspace ∈ listBuddyWorkspaces(manager.id)
slug = slugify(name)
existing = getBuddy(slug, workspace)
  ├─ archived AND managed by manager -> REACTIVATE (see below), return
  ├─ active   AND managed by manager -> replay: return it unchanged
  └─ otherwise                       -> 409 (name taken in this workspace)
assert countActiveDirectReports(manager.id) < manager.hire_quota   -- 0 => always fails
soulPath = `profiles/${slug}/BUDDY_SOUL.md`; memoryPath = `profiles/${slug}/memory`
write those files with flag 'wx' + mkdir memory      -- BEFORE the txn; unlink on rollback
BEGIN IMMEDIATE
  INSERT buddies(..., project_id = workspace, soul_path, memory_path, hire_quota = 0)
  INSERT buddy_projects for workspace + additionalWorkspaces (deduped)
  setBuddyRelationship({from: manager, to: sub, kind: 'manager'})   -- ON CONFLICT DO NOTHING
  recordAuditEvent('buddy.hire_direct_report')
COMMIT   -- on failure: ROLLBACK and remove profiles/<slug>/
```

Reactivation is the whole idempotency story: `UNIQUE(project_id, slug)` already prevents
duplicates, so no fingerprint column and no `buddy_builder_creations` analogue. Reactivate
= `updateBuddy(sub, {status: 'active', role})` + re-assert the manager edge + audit; memory
and soul survive, which is the behaviour you want when re-hiring a role. (`updateBuddy`
cannot change `slug` — another reason not to release the slug on retire.)

### `retireDirectReport({ managerBuddy, subBuddy, reason, reassignOpenWorkTo })`

```
assert sub is a direct report of manager (manager edge in either direction)
open = listBuddyOwnedProjects({buddy: sub})            -- excludes closed by default
if open.length and !reassignOpenWorkTo -> throw 409 with the open project slugs
if reassignOpenWorkTo: assert it === manager.id, reassign those projects
disable sub's buddy_automations (enabled = 0, next_run_at = NULL)
cancel sub's pending/active buddy_delegations and draft buddy_reviews
UPDATE buddies SET status='archived'                   -- relationships untouched (§4)
recordAuditEvent('buddy.retire_direct_report', {reason})
```

## 6. Server surface

Two entries in `BuddyOperationName` / `BuddyOperationInputSchemas` / `BuddiesStorePort`,
dispatched by `BuddyOperationsService.execute`, registered by `createBuddyMcpServer` like
any other op. Both are gated by `hire_quota` in the store helper, so the gate holds no
matter which caller reaches it.

* **Not** added to the store's `AUTOMATION_ALLOWED_OPERATIONS` (`store.js:57`, enforced at
  `store.js:3479`) — scheduled runs can never hire, and `assertAutomationOperationAllowed`
  rejects it for free.
* **Not** added to `DEFAULT_DELEGATED_BUDDY_OPERATIONS` — belt and braces; the real gate is
  §2/§5.
* **No model-facing HTTP route.** `delegate` needs `--api-base` because dispatch spawns a
  conversation; hire does not, so it runs in-process where `--buddy` is server-set. Owner
  hire/retire goes through the existing profile/relationship routes.
* Honest limitation: every `/api/buddies/*` route sits behind only the shared-secret gate
  with no per-Buddy caller identity, and a Buddy has a shell. So any Owner route we add is
  reachable by a Buddy that reads the secret. `hire_quota` defaulting to `0` is what bounds
  that: spoofing only lets you hire on behalf of a Buddy the Owner already funded, and the
  result is an audited row under that manager.
* Briefing (`integration.ts`): one line for a report — `You are a direct report of <Manager>
  (<role>).` One line for a funded manager — `You may hire N more direct reports.`

## 7. Client

`overview.employees[].team` already carries `{id, name, role, status}` (`store.js:2616`).
`deriveBuddyDirectReports` (`buddies-shaping.ts:84`) recomputes the same fact from raw
relationships and **drops status**, which is why "archived renders dimmed" was false.

Read `team` from the overview projection and delete the relationship-derived list — a
net-negative change that also makes retire visible. `Team: N` counts
`status === 'active'`; archived reports render dimmed underneath.
`selectDirectoryEmployees` and `check-client-invariants.sh` are unchanged.

## 8. Tests (`server/test/buddy-direct-reports.test.ts`)

Each one guards a specific finding above; none of them mirror the schema.

1. Buddy with default `hire_quota = 0` calling hire → refused. *(§2 — the gate is real.)*
2. Funded manager hires → `overview.topLevel` length unchanged, manager's `team` contains
   the report. *(hide rule.)*
3. Newly hired report's first `buddy.remember` writes to `profiles/<slug>/memory` and
   `readBuddyMemory` reads it back. *(§3 — would throw under the first draft.)*
4. Retire with an open owned project → refused with the project slug; with
   `reassignOpenWorkTo` → manager owns it.
5. After retire: report absent from `employees`/`topLevel`, present in manager's `team`
   with `status: 'archived'`, **manager edge still present**. *(§4 — the un-hide hazard.)*
6. Re-hire the retired name → same `buddyId`, memory intact, status active.
7. Hired report cannot itself hire (inherits `hire_quota = 0`). *(depth, via capability.)*
8. `setAutomation` with `allowed_operations: ['buddy.hire_direct_report']` → rejected by
   the store enum.

## 9. Out of scope

Interval-repeat inside one conversation. `job_kind: loop` iterates back-to-back with no
delay (`scheduler.ts:333-368`) and every tick calls `createConversation`
(`scheduler.ts:273`), so there is no way to wake an existing thread on a schedule. The fix
shape is a `conversation_id` binding on `buddy_automations` plus a scheduler resume path;
it is independent of hiring and should not be smuggled into this change.
