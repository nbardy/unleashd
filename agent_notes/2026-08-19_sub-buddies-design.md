# 2026-08-19 Direct Reports (Sub-Buddies) — Implementation Spec

**Status:** design, third pass, not yet coded · **Companion:** `product/buddies/PLANNING_SUB_BUDDIES.md`
**Terminology:** `sub-buddy == direct report`. One hierarchy
(`buddy_relationships`), one directory rule (`overview.topLevel`), one UI section. Ops are
named `hire_direct_report` / `retire_direct_report`.

## 0. Revision history — why this doc keeps getting longer

| Pass | Date | What it got wrong |
|---|---|---|
| 1 | 08-19 | "No migration, no store change, reuse the existing allowlist." All three false. |
| 2 | 08-20 | Reactivate overran the quota; `paused` held no seat; FS write straddled the commit; multi-manager was representable; `hire_quota` was called a depth rule. |
| 3 | 08-20 | **This pass.** Four independent code reviews found the feature *unimplementable as written* in three places and *dead on arrival* in a fourth. See §1. |

Every correction below is anchored to source. Where a line number is given it was re-verified
in this pass; the second pass shipped three wrong ones (`store.js:2616`, `store.js:765`,
`initialize-growth-lead.js:128`) and they are corrected inline.

## 1. Blockers found in the third pass — read this before anything else

These are not polish. Each one means "the feature does not work if you build what the last
draft said."

| # | Blocker | Evidence |
|---|---|---|
| B1 | **`hire_quota` is unwritable — the feature ships dead.** The Owner sets quota via the profile route → `routes.ts:259` → `updateBuddy`. `updateBuddy` destructures a fixed option list (`store.js:1012-1022`) and its `UPDATE` names those columns only (`:1051-1054`). `{hireQuota: 3}` is **silently discarded**: HTTP 200, quota still 0, every hire refuses forever, no diagnostic. | `store.js:1012`, `routes.ts:259` |
| B2 | **Reactivate nests a transaction and the inner rollback destroys the outer one.** The store uses `node:sqlite` (`store.js:15`), **not** better-sqlite3 — no `db.transaction()`, no savepoint helper. `updateBuddy` self-`BEGIN`s (`:1048`) and its catch `ROLLBACK`s (`:1080`). Called inside hire's `BEGIN IMMEDIATE`, `BEGIN` throws *"cannot start a transaction within a transaction"*, **its catch rolls back the caller's transaction**, and hire's own `ROLLBACK` then throws *"no transaction is active"* — masking the real error. `createBuddy` (`:799`/`:830`) is identical. | verified by execution |
| B3 | **`reassignOpenWorkTo` is unimplementable.** Nothing in the store can change `owned_projects.buddy_id`: `updateProject` has an explicit column list without it (`:2057-2094`); `upsertBuddyProject` actively throws *"external key belongs to another Buddy"* (`:1946-1948`); `newProject` inserts once and never updates. | `store.js:2057`, `:1946` |
| B4 | **The quota read is outside the transaction, so `BEGIN IMMEDIATE` does not prevent overrun.** Two MCP processes both read `0 < 1`, both insert. `BEGIN IMMEDIATE` serialises *writes*, not a decision made on a stale read. The store's own comment above `createBuddyFromBuilder` (`:836-840`) warns these sequences "can race across MCP processes". | `store.js:836` |
| B5 | **No `busy_timeout` is ever set.** `store.js:126-129` sets `foreign_keys` and `journal_mode` only. SQLite's default is 0, so under WAL the second concurrent writer gets `SQLITE_BUSY` **immediately**. `createBuddyFromBuilder` survives this only via its fingerprint-replay catch (`:941-954`) — which pass 2 deleted as unnecessary. | `store.js:126` |
| B6 | **The second pass's own `§5.1` fix was wrong.** "QUOTA FIRST, ALWAYS" placed unconditionally before target resolution breaks the **replay** path: if the Owner lowers `hire_quota` below current headcount (explicitly permitted), an idempotent replay of an existing report now throws. Seats are consumed by *state transitions*, not by every call. | §5.3 |

## 2. Where the code actually lives

`@nbardy/buddies` is **not** in this repo. It is a vendored tarball
(`vendor/nbardy-buddies-0.1.0.tgz`, provenance `sourceCommit 3b7027f`) built from
`~/git/buddies` by `tools/vendor-buddies.mjs` (`pnpm vendor:buddies`). Every store change is a
commit there, a repack, and a provenance bump here — the same discipline as the
`vendor/agent-cli-tool` submodule. Plan it as phase 0.

`~/git/buddies/src/store.js` is currently **byte-identical** to
`node_modules/@nbardy/buddies/src/store.js`, so no source drift confounds the line numbers
here. The store runs on `node:sqlite` (`DatabaseSync`), which matters for B2.

There is exactly **one consumer** of this package, at version `0.1.0`. There is no external
compatibility budget to protect; breaking projection changes are cheap and should be taken
whole rather than staged across releases.

## 3. Trap: the operation allowlist is default-**open**

`BuddyOperationContext.allowedOperations` is optional (`operations.ts:11`) and `execute` only
enforces it when present (`operations.ts:276-281`). `mcp-config.ts:71` pushes
`--allowed-operation` only from `context.allowedBuddyOperations ?? []`, which is set **only**
for delegations and reviews (`routes.ts:408`, `:522`, `:582`). For an ordinary Buddy
conversation it is `undefined`, so `mcp-server.ts:100` registers **every** tool.

Therefore "just leave hire out of `DEFAULT_DELEGATED_BUDDY_OPERATIONS`" grants hiring to every
top-level Buddy in every normal conversation.

**Corollary the second pass missed:** `resolveDelegatedBuddyOperations` (`operations.ts:235-248`)
accepts *any* operation name the caller supplies as long as `complete_assignment` is present.
So excluding hire from the default list is not even "belt and braces" — the default list is
only a default. §3's own lesson ("adding a name to a list that defaults open is not a gate")
applies to itself.

**The right structural fix** — and it is one type change, in the same release:

```ts
// operations.ts:9 — required, not optional
operations: { kind: 'unrestricted' } | { kind: 'restricted'; ops: BuddyOperationName[] }
```

That makes hire safe by construction and so is privileged operation #3. Per-op state columns
do not scale. **This is in scope**; see phase 1.

## 4. Trap: a Buddy created the Builder way has no soul and no memory

`createBuddyFromBuilder` writes `soulPath: null, memoryPath: null` (`store.js:891-892`) — it
does not even accept those parameters (signature `:841-853`). Consequences:

* briefing renders `(No Buddy soul has been configured.)` (`integration.ts:225`)
* `readBuddyMemory` silently returns `{summary:"", recentJournal:[]}` (`store.js:2120-2121`)
* **every** `buddy.remember` throws `Buddy has no configured memory path` (`store.js:3300`,
  reached from `remember()` at `:2150`) — not just the first, as pass 2 said

Persistent memory is the entire difference between a direct report and an ephemeral sub-agent,
so hire must provision both. `createBuddy` (**`store.js:768`**, not 765) accepts
workspace-relative `soulPath`/`memoryPath` (`:774-775`, resolved via `#projectPath` at
`:790-791`), and the shipped convention is `profiles/<slug>/BUDDY_SOUL.md` +
`profiles/<slug>/memory` (`scripts/initialize-growth-lead.js:24` **and `:25`**, not 128).

`soul` is a **required** string argument on hire. The manager is an LLM; it can author the soul
inline. This is why hire does not reuse the Builder conversation: the only things Builder adds
are soul authoring and conversation-keyed idempotency, and an inline `soul` plus the
reactivation rule in §7 cover both without making hire asynchronous.

## 5. Trap: the directory rule is `!managerId`, so deleting the edge *un-hides*

`overview()` derives `managerByReport` from `buddy_relationships` and returns
`topLevel: employees.filter((item) => !item.managerId)` (`store.js:2668`). A retire that tidies
up the manager edge would make the retiree managerless — i.e. promote it into the directory.
**Retire never touches relationships.** That is not a workaround: an archived report *is* still
historically that manager's report.

`listBuddies()` has no status filter (`store.js:1086`), so archived Buddies currently stay in
`employees`, `topLevel`, and `team[]`. Retire is invisible today.

### 5.1 The archived filter, done correctly

The naive fix — `buddies.filter(b => b.status !== 'archived').map(employee)` — **reintroduces
the vanishing act it was written to prevent**, because `managerByReport` is built from all
relationships (`:2583-2601`) and is not filtered:

```
Owner funds Lead (quota 2) → Lead hires data-engineer (active)
→ Owner archives Lead via the profile route (archiving is not exclusive to retire)
⇒ Lead gone from employees: its card and its team[] are gone
⇒ data-engineer is in employees but has managerId = lead, so it fails !managerId
⇒ an ACTIVE report is now invisible in the entire overview and unreachable
   — while its automations keep firing.
```

Visibility must be derived from the **pair**, not the row: drop management edges whose manager
is not in the visible set, so an orphaned report falls back to top-level. Test 8.

`recentRuns` is also built by iterating `buddies` directly (`store.js:2643`), not the filtered
`employees`, so archived reports keep surfacing in the feed. Filter it. Test 9.

Behaviour change to call out in the vendor changelog: an existing archived *top-level* Buddy
also drops out of the directory. That is intended.

### 5.2 Build the sum at the source, and delete `managerId`

`managerId: string | null` does two jobs — "who manages this" and "does this appear in the
directory" — and the second is carried by `null`, i.e. by the *absence* of a row. That is
accidental optionality (house rule T2) and it is the origin of every awkward thing above.

A `directory_visible` column would be worse: a second source of truth for something the graph
already knows. The fix is the **projection's type**. And it must be built at the source, not
re-derived from a nullable local — `employment: managerId ? {...} : {...}` would add a type
while keeping the null check one line up.

Replace `managerByReport: Map<id, managerId>` (`store.js:2596-2597`) with:

```js
// seeded top_level for every buddy, overwritten by the (filtered) pair loop
employmentByBuddy: Map<id, {kind:'top_level'} | {kind:'direct_report', managerId}>
```

`employee()` reads it; `topLevel` filters `kind === 'top_level'`. **`managerId` is deleted in
the same bump** — single consumer, version 0.1.0, and the release is already breaking. Staging
it "for one release" buys nothing and leaves the null check alive.

Client mirrors that must change with it: `types.ts:141` (`Buddy.manager_id?: string | null`),
`types.ts:200` (`EmployeeRecord.manager`), `types.ts:163-175` (`BuddyOverviewEmployee`).

## 6. Schema v12

`#migrate()` (`store.js:153`) is a fall-through ladder — `if (version === N) { …; version = N+1 }`.
v12 needs its own block, a `version = 12` assignment, and `CURRENT_SCHEMA_VERSION` bumped at
`store.js:74`. Both prior `ADD COLUMN` migrations guard with `PRAGMA table_info` into a `Set`
first (`:645-653`, `:673-681`); follow that precedent even though `user_version` is
transactional — diverging from the file's only two examples in a vendored release is a
reviewer trap.

```sql
ALTER TABLE buddies ADD COLUMN hire_quota INTEGER NOT NULL DEFAULT 0 CHECK (hire_quota >= 0);

-- §8.3: make the one-manager rule a constraint, not an assertion
CREATE UNIQUE INDEX buddy_one_manager_fwd ON buddy_relationships(to_buddy_id)   WHERE kind = 'manager';
CREATE UNIQUE INDEX buddy_one_manager_rev ON buddy_relationships(from_buddy_id) WHERE kind = 'reports_to';

PRAGMA user_version = 12;
```

Verified: `ADD COLUMN … NOT NULL DEFAULT 0` succeeds on a STRICT table under `node:sqlite`,
existing rows get `0`, `user_version` reads back `12`. `CHECK (hire_quota >= 0)` matches the
file's convention for added numeric columns (`:555`, `:597`) and is load-bearing — STRICT
rejects non-integers but not negatives, and a negative quota makes the predicate
unfalsifiable in the opposite direction.

The partial unique index follows an existing precedent in this file
(`one_active_sprint_per_project`, `:210-211`). **It will fail on databases that already
violate it.** The migration must pre-check, and the design must say what happens then:

```
detect duplicate manager edges before creating the index
  → if any exist, keep the earliest per report (ORDER BY created_at, id) and DELETE the rest,
    recording one audit event per deletion so the Owner can see what was collapsed.
```

This is the backfill pass 2 omitted entirely.

## 7. Store prerequisites — build these before either operation

None of this is optional; B1–B5 are all here.

### 7.1 A re-entrant transaction helper

There are 11 hand-rolled `BEGIN`/`try`/`COMMIT`/`catch ROLLBACK` blocks in `store.js` (`:799`,
`:900`, `:1048`, `:1339`, `:1432`, `:1886`, `:2056`, `:2768`, `:2854`, `:2938`, `:3077`) plus
two in `#migrate()`. Add:

```js
#tx(fn) {
  // depth 0 -> BEGIN IMMEDIATE / COMMIT / ROLLBACK
  // depth > 0 -> SAVEPOINT sp_<n> / RELEASE / ROLLBACK TO
  // catch-arm rollback MUST be guarded (`if (this.db.isTransaction)`) or it
  // swallows the root cause — see B2.
}
```

Route hire, retire, `createBuddy`, and `updateBuddy` through it. Without this, hire cannot call
`createBuddy`/`updateBuddy` at all, and the pass-2 workaround (a raw `INSERT buddies(...)`)
duplicates `createBuddy`'s column list and its `buddy_projects` insert — a guaranteed drift
site.

### 7.2 `PRAGMA busy_timeout = 5000`

In the constructor beside the other pragmas (`store.js:126-129`). Treat `SQLITE_BUSY` as
retryable in hire.

### 7.3 `hireQuota` on `updateBuddy` and `createBuddy`

Add to the destructured options and the `UPDATE` column list (`store.js:1012-1022`,
`:1051-1054`), plus non-negative-integer validation at the route. **B1 — without this the
feature does nothing at all.**

### 7.4 `reassignOwnedProject({ project, toBuddy })`

A new primitive; nothing today can move `owned_projects.buddy_id` (B3). It must re-check
workspace membership, because `newProject` guards with `#requireBuddy(buddy, ownerWorkspace)`
(`:1880`) and a raw `UPDATE` would silently break the invariant that an owner belongs to its
project's workspace:

```
manager hires report into W1 → Owner calls assignBuddyToProject(report, W2) (unguarded, :1110)
→ report creates an owned project in W2 → retire with reassignOpenWorkTo = manager
⇒ manager owns work in a workspace it isn't in; getBuddyContext throws
  "buddy does not belong to the workspace" (:2681) whenever it opens that project.
```

So: if the manager is not in the project's workspace, retire **refuses** and names the
workspace. Test 12.

### 7.5 `countHeldDirectReports` — `UNION`, not `UNION ALL`

```sql
SELECT COUNT(*) AS held
FROM (
  SELECT to_buddy_id   AS report_id FROM buddy_relationships
   WHERE kind = 'manager'    AND from_buddy_id = :manager
  UNION                                    -- dedupe: the two encodings are one relationship
  SELECT from_buddy_id AS report_id FROM buddy_relationships
   WHERE kind = 'reports_to' AND to_buddy_id   = :manager
) AS reports
JOIN buddies ON buddies.id = reports.report_id
WHERE buddies.status <> 'archived';        -- paused holds a seat; see §8.2
```

`UNION` is load-bearing. `manager A→B` and `reports_to B→A` are distinct rows under
`UNIQUE(from_buddy_id, to_buddy_id, kind)` (`:418`) and denote the same relationship;
`overview()` dedupes exactly this with a Map keyed `` `${managerId}:${reportId}` `` (`:2592`).
`UNION ALL` would double-count, and the badge and the quota would disagree — the one thing §10
promises cannot happen.

## 8. The four traps that remain after the prerequisites

### 8.1 Seats are consumed by transitions, not by calls

Pass 2 put an unconditional `assert countHeld < quota` above target resolution. That fixes the
overrun and breaks replay (B6). The rule:

| Transition | Consumes a seat? |
|---|---|
| create a new report | yes — assert |
| reactivate an archived report | yes — assert |
| replay an existing active/paused report | **no** — must not assert |

Overrun sequence the assert must still catch (`hire_quota = 1`):

```
hire A → 0 held < 1 OK (1 held) ;  retire A → (0 held)
hire B → 0 held < 1 OK (1 held) ;  hire A again → reactivate, MUST assert → refused
```

Replay sequence the assert must **not** break: quota 2, two active reports, Owner lowers quota
to 1, manager replays `hire(A)` → returns A unchanged. Tests 5 and 6.

### 8.2 `hire_quota` is a headcount ceiling, and `paused` holds a seat

* It is a **concurrent headcount ceiling**, not a lifetime budget: retiring frees the seat.
* `buddies.status` is `active | paused | archived` (`store.js:179`). Counting only `active`
  lets a manager pause two reports, hire two more, then unpause. Hence `status <> 'archived'`.
* It is **not a depth rule.** A hired report inherits `0`, but the Owner can fund any Buddy,
  including a report. Depth-1 is a *default*, not an invariant. Pass 2's suggested assertion
  `manager.managerId === null` is not even expressible — `managerId` is an `overview()`
  projection field (`:2616`), never a `buddies` column. This design deliberately adds no depth
  assertion; a funded second level is a legitimate Owner choice.

### 8.3 One manager per report — enforced by index, not by assertion

`UNIQUE(from_buddy_id, to_buddy_id, kind)` constrains a *pair*, not a report's in-degree, so
`overview()` disagrees with itself when two managers hold edges to one report:
`managerByReport` keeps only the earliest (`:2597`) while `reportsByManager` keeps all
(`:2598-2600`). The report shows under two teams with one canonical manager, and retire's
"either direction" check lets the non-canonical manager retire someone else's report.

Worse, `kind` is a redundant inverse encoding: `manager A→B` and `reports_to A→B` are both
legal and mean opposite things, yielding pairs `{A:B}` **and** `{B:A}` — so **both buddies
disappear from `topLevel` permanently**, with no UI signal. Two curls against the ungated
relationships route (`routes.ts:284-297`) reproduce it.

An app-level assertion in hire is TOCTOU (two managers reactivating concurrently both see zero
edges) and, more importantly, is in the wrong layer: `setBuddyRelationship` (`:1146-1166`,
which today checks only self-reference) is the single choke point, and the relationships route
bypasses hire entirely. So:

1. the partial unique indexes in §6 make in-degree ≤ 1 a **database** fact;
2. `setBuddyRelationship` normalizes `reports_to A→B` into `manager B→A` on write, retiring the
   dual encoding;
3. `setBuddyRelationship` rejects a cycle;
4. hire and retire then inherit all of it, and every "either direction" matcher in the codebase
   can collapse to a single direction.

Also fix `ORDER BY created_at` → `ORDER BY created_at, id` (`:2579`). `created_at` is
millisecond-precision ISO (`:87-89`); ties have no stable order and can flip after
`VACUUM INTO` (`backupDatabase`, `:144`), making the canonical manager nondeterministic.

### 8.4 The slug is not safe to put on the filesystem

`slugify` (`store.js:108-113`) is **not** traversal-vulnerable — `[^a-z0-9]+ → '-'` kills `.`,
`/`, `\`; `"../../etc"` → `etc`. But it **returns the empty string** for `"..."`, `"!!!"`,
`".."`, `"🙂"`, `"---"`. `required()` (`:101-107`) passes because the *input* was non-empty.

Then `soulPath = profiles//BUDDY_SOUL.md` normalizes to `profiles/BUDDY_SOUL.md`, and the
post-commit `rename` targets **`<workspace>/profiles` itself** — replacing the profiles
directory if it is absent or empty. Today this is saved only by accident: `required("buddy
slug", slug)` at `:784` throws inside the transaction, before the rename. That is a defence at
the wrong layer, with an error naming "buddy slug" instead of "name", and it evaporates under
any reordering.

Immediately after `slug = slugify(name)`, before any filesystem work:

```
assert /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)   -- error names `name`, not `slug`
```

`#containedPath` (`:3275-3294`) protects paths *inside* the store, but hire's staging and
rename happen in unleashd code **outside** it, so run both through an equivalent containment
check rather than trusting the slug. Test 13.

### 8.5 Uniqueness: `getBuddy(slug, workspace)` is not the constraint

`getBuddy` with a project argument joins **`buddy_projects`** (assignment, `:982-993`) while
the constraint is `UNIQUE(project_id, slug)` (`:187`) on the **home** workspace. Two failures:

* **False 409** — a buddy homed in W1 and additionally assigned to W2 makes `hire(name, W2)`
  report "name taken" though the insert would succeed.
* **Missed collision → poisoned lookups** — manager owns W1 (home of archived `scout`) and W2.
  `getBuddy('scout', W2)` returns null → create path → insert succeeds. Two rows now share slug
  `scout`, and every bare `getBuddy('scout')` throws *"buddy slug is ambiguous across
  workspaces"* (`:1001-1005`) forever.

Resolve against the real constraint: `SELECT * FROM buddies WHERE project_id = ? AND slug = ?`.

## 9. The operations

### 9.1 `HireTarget` — canonicalize once, then dispatch

The three-way branch on `existing` in pass 2 was structural branching inside a handler, and its
`otherwise → 409 "name taken"` arm conflated four distinct cases — including a *top-level*
buddy holding the slug, where the message is simply a lie. Canonicalize (κ) first:

```ts
type HireTarget =
  | { kind: 'vacant' }
  | { kind: 'reactivatable';   sub: Buddy }              // archived, canonical manager === this manager
  | { kind: 'held';            sub: Buddy }              // active|paused, canonical manager === this manager
  | { kind: 'held_elsewhere';  sub: Buddy; managerId: string }
  | { kind: 'slug_owned_by_top_level'; sub: Buddy };

resolveHireTarget(manager, slug, workspace): HireTarget   // the ONLY place that inspects rows
```

Thin dispatcher, five handlers, each one semantic path. The last two are distinct typed errors.
`vacant` and `reactivatable` assert the quota; `held` does not (§8.1).

### 9.2 `hireDirectReport({ managerBuddy, name, role, soul, workspace, additionalWorkspaces, provider, model, reasoningEffort })`

```
manager = requireBuddy(managerBuddy); assert manager.status === 'active'
assert workspace and every additionalWorkspace ∈ listBuddyWorkspaces(manager.id)   -- test 14
slug = slugify(name); assert SLUG_RE.test(slug)                                    -- §8.4
soulPath = `profiles/${slug}/BUDDY_SOUL.md`; memoryPath = `profiles/${slug}/memory`
stage soul + memory/ into profiles/.staging/<uuid>/       -- §9.3; NOT the final path

#tx(() => {                                               -- §7.1, BEGIN IMMEDIATE at depth 0
  target = resolveHireTarget(manager, slug, workspace)    -- §8.5 uses project_id, not buddy_projects
  quota  = countHeldDirectReports(manager.id)             -- §7.5, INSIDE the txn — B4
  switch (target.kind) {
    vacant:                assert quota < manager.hire_quota
                           createBuddy(..., soul_path, memory_path, hire_quota = 0)
                           assign workspace + additionalWorkspaces (deduped)
                           setBuddyRelationship({fromBuddy: manager, toBuddy: sub, kind:'manager'})
                           audit('buddy.hire_direct_report')
    reactivatable:         assert quota < manager.hire_quota
                           updateBuddy(sub, {status:'active', role})
                           assert profile dir exists and soul is non-empty, else re-materialize
                           audit('buddy.reactivate_direct_report')
    held:                  return sub unchanged            -- no quota assert (§8.1)
    held_elsewhere:        throw 409 naming the other manager
    slug_owned_by_top_level: throw 409 naming the collision
  }
})
rename(profiles/.staging/<uuid>, profiles/<slug>)          -- §9.3
```

Note `setBuddyRelationship`'s real signature is `{fromBuddy, toBuddy, kind}` (`:1146`) — pass 2
wrote `{from, to}`, and `#requireBuddy(undefined)` throws *"buddy is required"* (`:3562`).

### 9.3 Filesystem: staging, and the window that stays open

Writing `profiles/<slug>/` with flag `'wx'` before `BEGIN` and unlinking on rollback covers a
*thrown error*, not a killed process — and because the flag is `'wx'`, a crash wedges that slug
forever with an `EEXIST` that names the filesystem instead of the problem. Staging plus a
post-commit `rename` is better, but **pass 2's claim that it is fully crash-safe is false**:

> "a crash at any point leaves either 'no row, no profile' or 'row + profile' — never a wedged slug."

The window between `COMMIT` and `rename` leaves **row, no profile**, and it is *silent and
permanent*:

* `getBuddyContext` swallows `ENOENT` on the soul read (`:2697-2698`), so the briefing renders
  `(No Buddy soul has been configured.)` and nothing errors;
* `remember` calls `mkdirSync(dirname(path), {recursive:true})` (`:2157`), so memory
  self-heals while the soul stays empty forever;
* the row is `active`, so re-hire takes the **`held`** arm and returns it unchanged — the
  repair path never runs.

Strictly worse than a wedged slug, because it is invisible. Therefore:

1. `held` and `reactivatable` both **verify the soul file exists and is non-empty**, and
   re-materialize from staging if not. This is the repair path;
2. staging dirs are garbage-collected on store open (nothing collected them in pass 2 —
   a crash before `COMMIT` orphaned `profiles/.staging/<uuid>/` forever);
3. test 7 asserts the *diagnosable* outcome on a hand-built post-crash fixture, not "hire
   succeeds" — which passes vacuously on the broken state.

### 9.4 `retireDirectReport({ managerBuddy, subBuddy, reason, reassignOpenWorkTo })`

```
assert canonical manager of sub === manager.id            -- §8.3, one direction only now
open = listBuddyOwnedProjects({buddy: sub})               -- excludes closed by default (:1982)
if open.length and !reassignOpenWorkTo -> 409 with the open project slugs
if reassignOpenWorkTo:
    assert it === manager.id
    assert manager ∈ each project's workspace             -- §7.4; else 409 naming the workspace
    reassignOwnedProject(project, manager) for each
disable sub's buddy_automations (enabled = 0, next_run_at = NULL)
cancel buddy_delegations where from_buddy_id = sub AND status IN ('pending','active')
cancel buddy_delegations where to_buddy_id   = sub AND status IN ('pending','active')
cancel buddy_reviews with status 'draft' authored by sub
UPDATE buddies SET status='archived'                      -- relationships untouched (§5)
audit('buddy.retire_direct_report', {reason})
```

Both delegation directions are cancelled and the spec says so explicitly, because
`buddy_delegations` uses one table for both (`:433-450`) and "cancel sub's delegations" is
ambiguous. Work the retiree *issued* would strand its recipients; work *assigned to* it would
sit pending forever.

**Retire and reactivate are deliberately asymmetric.** Retire disables automations; reactivate
does **not** re-enable them. A report returning after weeks should not fire a schedule written
against a world that has moved on. Memory and soul survive; schedules do not. Easy to mistake
for a bug, so it is test 11.

## 10. Threat model — honest version

**Pass 2's §6 claimed `hire_quota` bounds the route-spoofing risk. That claim is false and is
withdrawn.** `hire_quota` is a **headcount budget and an audit record, not a capability gate**
against a principal with a shell. Four Buddy-reachable write paths to it:

| Path | Evidence |
|---|---|
| `PATCH /api/buddies/:buddyId/profile` — no caller identity, `buddyId` fully caller-chosen | `routes.ts:227-268` |
| Direct SQLite write to `~/.buddies/buddies.sqlite`, same uid as the agent | `store.js:81-85` |
| Re-exec the MCP entrypoint with a forged `--buddy`; constructs its own store, no server, **no allowlist** | `mcp-server.ts:166-193` |
| `POST /api/buddies/:buddyId/relationships` — manufacture the manager edge directly, ungated, **no audit event** | `routes.ts:284-297` → `store.js:1146` |

The shared secret is not a barrier: on a loopback bind with no token the policy is literally
`{kind:'open'}` (`policy.ts:109`), and `docs/auth.md:37-39` states the token file is readable by
every agent the server launches. The codebase already concedes this — `integration.ts:215`
ships the prompt *"Do not invoke the buddies CLI, HTTP routes, direct database access, or
filesystem edits to Buddy state"*, which is an enforcement boundary implemented as a request.

So the accurate framing, and the one that goes in the doc and the code comments:

> A Buddy with a shell can already do anything its user can, including hiring itself.
> `hire_quota` makes the **sanctioned** path budgeted, legible, and audited. It is not a
> security boundary. The marginal risk of this feature at `hire_quota = 0` is approximately
> zero, because the escalation it would grant is already available.

A real gate needs OS-level separation (agent processes under a uid that cannot read the
database or the token) plus per-caller identity on `/api/buddies/*` — a server-minted,
per-conversation capability token bound to `buddyId`. **Out of scope here; tracked in §13.**

### 10.1 What this feature does newly depend on — fix in scope

* **`listDueAutomations` has no status filter** (`store.js:2904-2913`), and
  `BuddyScheduler.execute` never re-reads status. Retire is safe *only* because it sets
  `enabled = 0` — zero defence in depth. Concretely still broken: a **paused** Buddy's
  automations keep firing (`updateBuddy` doesn't touch them), an in-flight run finishes against
  an archived buddy, and any re-enable resurrects an archived identity's schedule.
  **Fix: join `buddies` and require `status = 'active'`, and re-assert after
  `createConversation`.** Test 10.
* **`routes.ts:342` (`isDirectReport`, the delegate gate) and `:481-494` (`manageable`, the
  review gate)** both use "either direction" matching and both still admit a **retired**
  report. These are the real authorization surfaces; §8.3's normalization fixes the matching,
  and both need an archived check. Test 15.
* **`enabled` is spread from the request body.** `operations.ts:440` forces `enabled: false`
  with the comment *"owner review is required before enabling"*, but `store.js:2738` defaults
  `enabled = true` and `routes.ts:705-713` spreads `req.body` straight through — so one curl
  creates an *enabled* automation on any buddy. Fix: explicit field pick in the route, flip the
  store default to `false` so the safe value is the default.

### 10.2 Unbounded, and knowingly so

Quota bounds headcount and nothing else. Not bounded: automations per buddy, outbound
delegations (each dispatch spawns a whole conversation, `routes.ts:397-422`), `profiles/` disk,
or scheduled spend. On spend specifically: `max_runtime_seconds` and `max_iterations` **are**
enforced (`scheduler.ts:282`, `:300`, `:333`) but **per-run, not cumulatively** — a fresh
`nextRunAt` is written after every completion *and* every failure (`:370-376`, `:384-390`), and
`nextAutomationRunAt` accepts any interval `> 0` (`:115-120`). `max_tokens` and `max_cost_usd`
are validated, persisted, and **never read** — repo-wide their only occurrences are the
declaration (`contract.ts:22-23`), the Zod input (`operations.ts:39-40`), and unrelated legacy
constants (`scheduler.ts:52-53`).

A funded manager reading the policy schema will reasonably believe spend is capped. It is not.
Either enforce both fields or delete them — a validated, persisted, unenforced budget is a
silent fallback (T4). **Tracked in §13, not fixed here**, but the doc must not imply otherwise.

## 11. Server surface

Two entries in `BuddyOperationName` / `BuddyOperationInputSchemas` / `BuddiesStorePort`,
dispatched by `BuddyOperationsService.execute`, registered by `createBuddyMcpServer`.

* Keep the dispatcher **thin** (R4). `execute` (`operations.ts:277`+) already does parse +
  authz + store call inline per arm; do not add two more inline bodies. Extract handlers.
* **Not** added to the store's `AUTOMATION_ALLOWED_OPERATIONS` (`store.js:57`, enforced via
  `assertAutomationOperationAllowed` at `:3145-3152`, reached from `operations.ts:282-283`).
  Scheduled runs can never hire.
* **No model-facing HTTP route.** `delegate` needs `--api-base` because dispatch spawns a
  conversation; hire does not, so it runs in-process where `--buddy` is server-set
  (`mcp-config.ts:56-57`).
* Move the self-delegation check from `routes.ts:342-353` into `prepareDelegation` — today the
  in-process `requireManageableBuddy` (`operations.ts:737`) returns early for self, so the HTTP
  layer is the only thing preventing an infinite self-delegation loop.
* Briefing (`integration.ts`): one line for a report — `You are a direct report of <Manager>
  (<role>).` One line for a funded manager — `You may hire N more direct reports.`
* Cap `soul` length at hire time and stamp provenance (`authored_by`, `at`) into the file
  header. It is LLM-authored text spliced verbatim into a system prompt (`integration.ts:220-224`)
  and written into a git-tracked file; an Owner reading a diff should be able to tell it was
  not hand-written.

## 12. Client

`overview.employees[].team` already carries `{id, name, role, status}` — the projection is
`store.js:2618-2626` (**not** `:2616`, which is `managerId`), corroborated client-side at
`types.ts:167`. `deriveBuddyDirectReports` (`client/src/components/buddies/buddies-shaping.ts:84`)
recomputes the same fact from raw relationships and **drops status**.

**Pass 2's plan does not compile.** `deriveBuddyDirectReports` is reachable only via
`deriveBuddyHierarchy` (`buddies-shaping.ts:116-124`), called from exactly two places —
`BuddiesDashboard.tsx:112` and `BuddyDetailMobile.tsx:113` — and **neither detail path has an
overview payload**. `BuddiesDashboard` fetches overview into separate state for the directory
only; `BuddyDetailMobile` never fetches overview at all (its only requests are `:99-101`,
`:148-149`, `:166`). "Read `team` from the overview projection" therefore either breaks the
mobile Team section or forces a second round-trip on every mobile detail open.

The plan:

1. **Serve `team` (with `status`) on `GET /api/buddies/:id`** in the same vendor bump. One
   server change; both detail views converge.
2. **Delete `deriveBuddyHierarchy` whole** — both `deriveBuddyDirectReports` *and*
   `deriveBuddyManager`. Deleting only the first leaves two sources of truth for the same edge
   inside one component. This also removes two T4 silent fallbacks: `?? 'Manager'` (`:75`) and
   `?? 'Direct report'` (`:104`), which map a missing join to a plausible name.
3. **Put the archived filter in `ui-contract.ts:27`** (`buddyCardMetrics`, which returns
   `team: employee.team.length` and is what actually renders the count on directory cards).
   One function, both shells — inlining it into `BuddiesMobile.tsx` / `BuddyDetailMobile.tsx`
   would duplicate it and let the badge disagree per device (G3 spirit, if not letter).
4. **`BuddyDirectory.tsx:68` must gate on `metrics.team > 0`, not raw `team.length > 0`.** Once
   archived entries stay in `team`, a manager whose reports are all archived renders a badge
   reading **"0 team"** — a regression this change introduces.
5. The count is `status !== 'archived'`, matching `countHeldDirectReports`, so the badge and the
   quota never disagree. Test 16.
6. Directory membership dispatches on `employment.kind` (§5.2), never on a null check.

Naming note: **there is no `"Team: N"` string in the codebase.** Shipped labels are lowercase
`team` on directory cards (`BuddyDirectory.tsx:70-71`, `BuddiesMobile.tsx:239-240`) and
`"N sub-buddies"` in mobile detail (`BuddyDetailMobile.tsx:378`). Pass 2 named a label that does
not exist. Either rename the shipped labels to match the doc's vocabulary (preferred — the
whole point is that "sub-buddy" is retired as a term) or stop calling it `Team: N`.

Hard-rule check: no new atom writes (G1 clean); shaping stays in `components/buddies/*` (G3
holds); no new atoms needed — this is component-local REST state, not conversation state. One
hazard: `BuddiesMobile.tsx:158` early-returns after its `useMemo`s, so any new memo must go
above line 158.

## 13. Tests (`server/test/buddy-direct-reports.test.ts`)

Consolidated onto **one fixture** — tmp workspace + real sqlite file + one funded manager — run
as a few real flows rather than sixteen independent setups. Everything except 7 and 15 is
naturally an integration test against a real store and a real tmpdir, per `docs/test-strategy.md`.

Pass 2 had 14; two were tautologies and are gone.

| # | Test | Guards |
|---|---|---|
| 1 | Buddy with default `hire_quota = 0` calling hire → refused | §3 — the gate is real |
| 2 | Funded manager hires → `topLevel` length unchanged, manager's `team` contains the report | directory rule |
| 3 | Hire → `buddy.remember` writes to `profiles/<slug>/memory` → retire → re-hire → **read the file back** | §4 + reactivation; the strongest test in the list |
| 4 | Concurrent hire from two connections on one file, `hire_quota = 1` → exactly one succeeds | **B4** — nothing in pass 2 was concurrent |
| 5 | quota 1: hire A, retire A, hire B, re-hire A → refused, 1 active | §8.1 overrun |
| 6 | quota 2 → two reports → Owner lowers quota to 1 → replay `hire(A)` → **succeeds** | **B6** — pass 2's fix broke this |
| 7 | Hand-built post-crash state (row present, profile absent) → `remember` throws, and hire's `held` arm **re-materializes** the soul | §9.3 — the silent permanent failure |
| 8 | Archive a *manager* with an active report → the report is still reachable in `topLevel` | §5.1 — the fix's own vanishing act |
| 9 | After retire, `recentRuns` excludes the archived report | §5.1 — a one-line filter nothing else covers |
| 10 | Archived and **paused** buddies' automations do not fire | §10.1 — scheduler status filter |
| 11 | Retire with an enabled automation → re-hire → automation still `enabled = 0` | §9.4 asymmetry |
| 12 | Retire with an open owned project → refused with the slug; with `reassignOpenWorkTo` → manager owns it; manager not in that workspace → refused naming it | **B3** + §7.4 |
| 13 | `hire(name: "...")` → refused naming `name`, and `profiles/` is untouched | §8.4 |
| 14 | Hire with an `additionalWorkspace` the manager is not in → refused | §9.2, untested in pass 2 |
| 15 | A **non-canonical** manager cannot retire; a retired report is rejected by the delegate and review gates | §8.3 + §10.1 |
| 16 | `buddyCardMetrics(...).team` equals `countHeldDirectReports(...)` across active/paused/archived | §12.5 — pure function over real `overview()`, no TSX assertions |

**Deleted from pass 2:** "hired report cannot itself hire (inherits 0)" — a constant-equals-the-
literal-one-line-away mirror already fenced by the column DEFAULT and test 1. **Rewritten:**
"`setAutomation` with hire in `allowed_operations` → rejected by the enum" was a mirror of a
constant; the gate that actually runs is `assertAutomationOperationAllowed` via
`operations.ts:282`, so drive a **real automation run** to an `execute('buddy.hire_direct_report')`
call and assert refusal. That version catches a policy row persisted before the list changed.

## 14. Out of scope — tracked, deliberately not smuggled in

* **Real capability containment** (§10): OS-level uid separation + per-caller identity on
  `/api/buddies/*`. The correct fix, much larger than this feature, and this feature does not
  make it worse.
* **Cumulative automation budgets** (§10.2): enforce or delete `max_tokens` / `max_cost_usd`;
  add a per-automation 24h spend/run window and an interval floor.
* **Per-report resource caps**: automations per buddy, open outbound delegations, delegation
  depth, `profiles/` disk.
* **Interval-repeat inside one conversation.** `job_kind: loop` iterates back-to-back with no
  delay (`scheduler.ts:335-363`). Correction to pass 2: `createConversation` is at
  `scheduler.ts:273`, **before** the `job_kind` branch (`:284`) — so it runs once per automation
  *run*, not once per loop iteration; the loop reuses that conversation (`:344-345`). The
  conclusion stands (no way to wake an existing thread on a schedule); the mechanism as
  described did not. Fix shape: a `conversation_id` binding on `buddy_automations` plus a
  scheduler resume path.
* **`overview()` cost.** `employee()` calls `listBuddyWorkspaces` per buddy (`:2617`, itself two
  queries) plus `listConversationLinks` per buddy (`:2644`) — ~3 queries per buddy, and hiring
  is a buddy-count multiplier. Not a problem at current scale; note it before the first manager
  with 20 reports.
* **Cascade risk: none.** `ON DELETE CASCADE` exists on the buddy FKs, but `rg "DELETE FROM"`
  finds exactly three sites (`:1170` relationships, `:1489` skills, `:2900` automations) —
  there is **no `deleteBuddy` and no `deleteProject` in the store API at all**, so those
  cascades are unreachable and cannot corrupt seat accounting. Recorded here so the next reader
  does not re-investigate it.
