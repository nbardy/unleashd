# HANDOFF — Direct Reports (Sub-Buddies) — Unleashd

*Date: 2026-08-20 · Branch: `mobile-fixes-and-audit-2026-08-18` · Status: design corrected, not yet coded*

## 1. TL;DR

* **Sub-buddy == direct report.** One `buddies` type, one hierarchy
  (`buddy_relationships(manager|reports_to)`), one hide rule
  (`overview.topLevel = employees.filter(!managerId)`), one UI section (`Team: N`). What
  is new is *who may hire*, not what gets created. Ops are named
  `buddy.hire_direct_report` / `buddy.retire_direct_report`.
* **The gate is a column, not a list.** `buddies.hire_quota` (schema v12, default `0`) is
  the capability, the quota, and the depth rule at once. Leaving an op out of
  `DEFAULT_DELEGATED_BUDDY_OPERATIONS` gates nothing — that allowlist is default-open for
  ordinary conversations (see design §2).
* **Hire provisions identity.** `soul` is a required argument; the txn writes
  `profiles/<slug>/BUDDY_SOUL.md` + `profiles/<slug>/memory/`. Without them the report's
  first `buddy.remember` throws.
* **Retire never deletes the manager edge** — the hide rule is `!managerId`, so deleting it
  would promote the retiree into the directory. `overview` filters archived instead.

## 2. Where things stand (disk)

| File | Role |
|---|---|
| `product/PLANNING_SUB_BUDDIES.md` | Product intent + locked decisions |
| `agent_notes/2026-08-19_sub-buddies-design.md` | Implementation spec, incl. the four verified traps |
| This file | Handoff |
| `docs/reviews/2026-08-18-open-product-decisions.md` | Prior open decisions — the hiring item is superseded here |

`product/*.md` is now tracked (`.gitignore` keeps `product/**` scratch ignored but
un-ignores markdown). Unrelated client WIP on this branch stays unstaged.

## 3. Corrections against the first draft

The 2026-08-19 draft was reviewed against the code on 2026-08-20 and was wrong in five
places. Do not reintroduce them:

| Draft claimed | Reality |
|---|---|
| Excluding from `DEFAULT_DELEGATED_BUDDY_OPERATIONS` gates hiring | `allowedOperations` is optional and unset for normal conversations, so every tool is registered (`operations.ts:277`, `mcp-config.ts`, `mcp-server.ts:100`). Gate must live in the store. |
| Sub gets its own `BUDDY_SOUL.md` + memory for free | `createBuddyFromBuilder` writes `soul_path: null, memory_path: null` (`store.js:891`); `buddy.remember` then throws (`store.js:3300`). |
| "No migration, no store change" | `@nbardy/buddies` is a vendored tarball from `~/git/buddies`; every helper is a cross-repo release + `pnpm vendor:buddies` + provenance bump. |
| `retire='archived'` shows as dimmed today | `listBuddies()` has no status filter (`store.js:1086`) and the client drops status (`buddies-shaping.ts:84`), so retire is currently invisible and still counted. |
| Quota via `manager edges … status='active'`, plus a `sha256` fingerprint | `buddy_relationships` has no status column; and `UNIQUE(project_id, slug)` already gives idempotency — reactivating an archived report replaces the fingerprint entirely. |

## 4. UI today (shipped)

Directory shows `topLevel` only; reports are reachable solely via the manager's `Team: N`
pills (`BuddiesDashboard.tsx:126`, `BuddyDetailMobile.tsx:378`). A report's detail is the
full Buddy detail — `currentWork`, owned projects/todos, conversations, memory, reviews,
`BuddyAutomationsTab`. So counts, pending work, and history are already visible; only the
hiring path is missing.

## 5. Remaining work (in order)

0. **Vendor** (`~/git/buddies`): schema v12 `hire_quota`; `hireDirectReport` /
   `retireDirectReport`; `overview()` excludes archived from `employees` while `team[]`
   keeps them with status. Then `pnpm vendor:buddies` + provenance bump here.
1. **Server**: two ops in `operations.ts` + `BuddiesStorePort` + MCP registration
   (in-process only, no model-facing HTTP route); `hire_quota` on the profile route;
   briefing lines in `integration.ts`.
2. **Client**: read reports from `overview.employees[].team` and delete the
   relationship-derived `deriveBuddyDirectReports` list; `Team: N` counts active; archived
   dimmed.
3. **Tests**: `server/test/buddy-direct-reports.test.ts` — the eight cases in design §8,
   each guarding one trap.
4. **Trial**: Lead hires `data-engineer` in EventMap; it owns 3 scraper projects and runs
   one `loop` automation fanning out sub-agents.

## 6. How to resume

```bash
# vendor first — the store change is a release, not an edit
cd ~/git/buddies && $EDITOR src/store.js   # v12 + two helpers + overview filter
node --test && pnpm pack
cd ~/git/unleashd && pnpm vendor:buddies   # updates tgz + provenance

pnpm test:server                           # buddy-lifecycle-e2e must stay green
```

## 7. Open call

Whether the first hire in a workspace should route through `request_human_approval`. The
lean default is no — `hire_quota` is already an explicit Owner grant, and the Owner can
pause or archive any report. Flip only if hiring turns out to need per-instance review.

## 8. Known gap, tracked separately

There is no way to wake an existing conversation on a schedule: every tick calls
`createConversation` (`scheduler.ts:273`), and `job_kind: loop` iterates back-to-back with
no delay. The fix is a `conversation_id` binding on `buddy_automations` plus a scheduler
resume path. Independent of hiring — do not smuggle it in.
