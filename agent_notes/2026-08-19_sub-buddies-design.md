# 2026-08-19 Direct Reports (Sub-Buddies) — Unified Design — Final

**Date:** 2026-08-19 · **Status:** Design — not yet coded — **Unified: `sub-buddy == directReport`**
**Companion:** `product/PLANNING_SUB_BUDDIES.md`
**Context:** `buddy_relationships(manager|reports_to)` + `overview.topLevel = filter(!managerId)` (`store.js:2668`, `ui-contract.ts:6`) already hides reports under `Team: N`. Sub-buddies are that — Owner-built today, Parent-hirable tomorrow.

## 1. Surface (minimal)

Two ops only, same `BuddyOperationsService` + `BuddiesStorePort` + `buddies:operations` Zod surface as `delegate`/`request_review`:

* `buddy.create_sub_buddy { name, role, workspaceId, additionalWorkspaceIds?, provider?, model?, reasoningEffort? } → {buddy, workspaces}`
* `buddy.retire_sub_buddy { subBuddyId, reason? } → buddy` (`status='archived'`)

No `parent_buddy_id` FK, no new table, no new UI section — `create` writes the same `buddies`+`buddy_projects`+`manager` edge the Builder does, in one txn.

## 2. Data model — no migration

Current `buddies(id, project_id FK→projects, slug, name, role, status, soul_path, memory_path, provider, model, reasoning_effort, …) UNIQUE(project_id, slug)`

New helper `createSubBuddy` (in `src/store.js` — mirrors `createBuddyFromBuilder` atomicity):

```
BEGIN IMMEDIATE
  assert parent.status='active' && workspaceId ∈ listBuddyWorkspaces(parentId)
  assert count manager edges parent→* with status='active' < 12
  assert directReports depth ==1 (parent has no manager) else 403
  slug = slugify(name); assert UNIQUE(project_id=workspaceId, slug)
  fingerprint = sha256(parentId:name:workspaceId)
  if fingerprint exists for this parentNameWorkspace → replay / 409 if different slug
  INSERT buddies(id, project_id=workspaceId, slug, name, role, status='active', …)
  INSERT buddy_projects for workspaceId + additionalWorkspaceIds (deduped)
  INSERT buddy_relationships(id, from=parent, to=sub, kind='manager') ON CONFLICT DO NOTHING
           + reciprocal ('reports_to') for dedup path already in store
  audit 'buddy.create_sub_buddy'
COMMIT
```

`retireSubBuddy(subId, byId)` — assert `byId` is parent (`manager` edge) or owner (`buddy.project_id` owner), `UPDATE buddies SET status='archived'`, disable its `buddy_automations`, cancel its active `buddy_delegations`/`buddy_reviews` via existing `updateDelegation` path, audit `buddy.retire_sub_buddy`.

Idempotency: same `fingerprint` → replay `getBuddy`; same `(parent,workspace)`+different `name` → new row (different fingerprint); same `name`+`workspace`+different `role` but same fingerprint base → 409 unless `replay`.

## 3. API layer

```
POST   /api/buddies/:buddyId/sub-buddies              {name,role,workspaceId,additionalWorkspaceIds?,provider?,model?,reasoningEffort?}
POST   /api/buddies/:buddyId/sub-buddies/:subId/retire {reason?}
GET    /api/buddies/:buddyId              → includes directReports (no new field — reuse relationships)
GET    /api/buddies/overview?includeSubBuddies=false  default false (topLevel only)
```

Validation mirrors `routes.ts:349 isDirectReport` — `workspaceId` must be on parent, caller is `BuddyContext(buddyId)` or Owner HTTP, duplicate slug under same workspace → 409, quota → 429, depth → 403. Detail and health reuse `listAutomations`/`listAutomationRuns` (`buddy_id=subId`).

## 4. Tool / MCP injection

Same layer as every Buddy op — `server/src/buddies/operations.ts` (`BuddyOperationInputSchemas`), `server/src/buddies/contract.ts` ( `BuddiesStorePort`), `server/src/buddies/integration.ts` (briefing), `server/src/buddies/mcp-server.ts` (`createBuddyMcpServer` registers tools per conversation):

* `BuddyContext {buddyId: parentId, workspaceId, allowedOperations}` — `create_sub_buddy` **not** in `DEFAULT_DELEGATED_BUDDY_OPERATIONS`; parent must explicitly grant it (like `set_automation`). Automation runs likewise respect `assertAutomationOperationAllowed`.
* `mcp-server.ts` adds `registerTool('buddy_create_sub_buddy'/'buddy_retire_sub_buddy')` via `BuddyOperationsService.execute` — same `ToolServer` wrapper as `delegate`.
* First-turn briefing for sub-buddy (via `integration.ts` `getBuddyContext`) adds one line within 40k budget: `You are a direct report (sub-buddy) of <Parent name> (<role>); own scoped projects and fan out via sub-agents (swarm) in one automation loop/sequence.`
* Conversations remain ordinary Unleashd conversations with typed `buddyContext` + `kind='buddy'` — scheduler’s `createConversation(automation, run)` creates one `automation` conversation per tick (prompt/sequence/loop inside one run) as today; sub-buddy’s runs have `buddy_id=subId`.

No new WS contract — `conversation_created` reused for updates as documented.

## 5. Client & simplifies

* Reuse `deriveBuddyHierarchy` / `Team: N` + `mobile-buddy-reports` — no new `deriveSubBuddies` or `buddy-sub-buddies` section. `archived` dimmed via existing status style.
* `ui-contract.selectDirectoryEmployees` stays `topLevel`. Overview debug flag only.
* `check-client-invariants.sh` G1/G2/G3 unchanged.

## 6. Automations (reuse)

No new scheduler — reuse shipped `buddy_automations(schedule_kind=cron|interval, job_kind=prompt|sequence|loop, job_payload, enabled, next_run_at)` + `BuddyScheduler` poll 30s + `claimAutomationRun` lease `max_runtime_seconds+60`:

* Cron per-tick = new `automation` conversation. To “interval-repeat in same thread” use `job_kind: loop` (`prompt + termination{condition,max_iterations,max_duration_seconds}`) — Buddy outputs `{buddyAutomation:{done:true}}` (`parseAutomationCompletion`) to stop. `sequence` is fixed `prompts[]` in one conversation (guard `len <= max_iterations`). Sub-buddy’s automation is just a normal row with `buddy_id=subId, workspace_id=subWorkspace`.
* `BuddyAutomationsTab.tsx` already shows `scheduleKind/scheduleExpression/jobKind` + run list; reuse for sub-buddy detail.

## 7. Tests

* `server/test/buddy-sub-buddy.test.ts` — create sub (still `topLevel==1`), `GET /:parent` shows directReports contains sub, quota 12 hit, idempotent replay, depth 1 guard, retire archives + disables automations + cancels active delegations.
* Extend `buddy-routes` + `buddy-lifecycle-e2e:245` stays green.

## 8. Rollout (4 commits)

1. `createSubBuddy`/`retireSubBuddy` helpers + unit tests (no migration).
2. Ops + routes + MCP `createBuddyMcpServer` tools + allowedOperations gate.
3. One-line briefing + `store.getBuddyContext` parent note.
4. Trial `data-engineer` (Lead→sub, sub owns 3 scrapers, loop `max_iterations=3` in one conversation).

## 9. Reflection

Kept FK out — `parent_buddy_id` would duplicate the `manager` edge and need a second hide rule. Reused the one hierarchy, one list, one txn style (`createBuddyFromBuilder`) and one scheduler. Two ops are the only new surface; everything else is an assignment + relationship the system already proves.
