# Fresh review of resource consolidation

2026-09-11, Asia/Makassar. Buddies Development Lead. Review requested by the owner after implementation. **Five defects reproduced. The architecture remains appropriate, but the implementation is not ready to describe as fully reliable for daily team operation.** No application source or production team configuration changed during this review.

This is a correction to the scope of the [implementation report](IMPLEMENTATION_RESOURCE_CONSOLIDATION_2026-09-11.md), SHA-256 `798bd5893f92f9b95c7ce4f1453ca040ca62354192affc72fa85b6135974de5f`. Its tests and isolated live result remain valid observations. They did not exercise the sequences below. In particular, the statement “scoped notes/search and the independent source-turn memory reviewer respect the same audience” did not establish that ordinary owner reads and reviewer reads select the same document.

## Reproduced defects, in repair order

### R1 — P1: private addressed messages become readable in unrelated project turns

In [operations.ts](../../server/src/buddies/operations.ts:1905), a project audience accepts a message when its project is inside the current project tree. That branch omits the `visibility === 'project'` check used for workspace audiences. The earlier participant check uses the persistent Buddy identity, so it cannot distinguish that Buddy's private owner interaction from its current team turn.

Reproduction: a worker sends a participant-private message to the owner and associates it with a project. A separate delegated turn of the same Buddy in that project can read the complete private body through `get_message`; no publication or shared request root is required. The canary was synthetic. This does not prove one unrelated Buddy can read all other Buddies' mail; it proves private-to-team context leakage within the same identity, the boundary this redesign intended to enforce.

Repair: use the same explicit audience predicate for detail reads, inbox projections and execution results. A current request/root can expose its addressed input; an unrelated message needs explicit publication. A project foreign key must not imply publication.

### R2 — P1: memory now has competing read/write paths

The [composer](../../server/src/buddies/integration.ts:222) falls back to global owner memory until a scoped head exists. The [reviewer](../../server/src/buddies/memory-review.ts:252) reads only the empty scoped document and writes its first revision. That immediately disables the composer's fallback. Meanwhile, scope-omitted `get_document`, ordinary owner `recall`, and the [Memory HTTP read](../../server/src/buddies/routes.ts:915) still use global storage.

Reproduction: the next owner briefing originally contains `PRIOR_OWNER_PREFERENCE`. The actual reviewer service reads empty memory, saves `NEW_THREAD_LESSON`, and appends a scoped note. The next briefing loses the prior preference; scope-omitted `get_document` still returns the old preference; ordinary `recall` cannot find the reviewer's note. The old bytes remain stored, so this is loss from effective context/discovery, not physical deletion.

Repair: one effective-document resolver and one explicit migration policy across composer, reviewer, MCP and Memory UI. Preserve the authorized inherited document when initializing a scoped owner head. Make the selected scope visible in the UI and make reviewer notes discoverable from the corresponding ordinary context. Do not solve this by copying private owner memory into team scopes.

### R3 — P1: ordinary learning resets conversational continuity

The package's `knowledgeAudienceRevision` hashes all visible document revisions, including the Buddy's own compact memory and notes. [Runtime](../../server/src/conversations/runtime.ts:2111) calls `resetProcess()` whenever that hash changes. Thus an ordinary successful memory review in an unchanged audience starts the next turn with a fresh model session. The visible transcript stays, but it is not replayed wholesale into that new session.

Reproduction: with the same Buddy, owner thread, membership and permissions, the reviewer's memory/note write changes the audience key. The runtime's reset branch is directly selected by that difference. This is a deterministic key/reset condition, not a measured claim that every model will answer a follow-up incorrectly. It makes follow-ups like “use the second option” depend on whether compact memory happened to preserve the needed details.

Repair: distinguish authorization/disclosure epochs from ordinary content revisions. Refresh allowed content without discarding same-audience conversation continuity. Narrowing access or unpublishing sensitive content still needs session invalidation; that safety behavior must remain tested.

### R4 — P1: work can vanish from pagination

[Current work](../../server/src/buddies/operations.ts:923) takes a slice before [result projection](../../server/src/buddies/operations.ts:1920) removes projects outside the active audience. The MCP page builder then sees an empty short page and returns `nextCursor:null`, although matching projects occur later in the underlying list.

Reproduction: create five projects for one Buddy, select a project outside the first two rows, then call native MCP `get_current_work({limit:1})` in that project audience. Result: `{items:[],nextCursor:null}`. Requesting that exact `projectId` returns the project. This can tell a worker that no work exists at the very moment it is expected to accept work.

Repair: apply all authority/audience filters before counting and slicing the query. Derive the continuation cursor from that same authorized result set. Check `get_runs` for the same ordering pattern.

### R5 — P2: retry can skip incomplete conversation linkage

The shared creation service registers a runtime before awaiting its link write. If linking fails, the first run fails but the runtime stays in the registry. On explicit retry, [the executor](../../server/src/buddies/run-executor.ts:301) sees that runtime and skips the creation service entirely, so the failed link is never retried.

Reproduction through the actual configuration and creation services: inject failure only in `createConversationLink`, after registration. The original run fails; the explicit retry completes. Link attempts remain **1**, successful links **0**. Existing startup tests failed before registration and therefore missed this boundary. The fake link port proves the missing repair call; it does not claim that an actual production link outage occurred.

Repair: runtime existence must not mean creation is operationally complete. Before admitting input, go through the common idempotent readiness/link-repair path, including registry hits. Preserve original command identity and tombstone/continuation protections.

## Missing workflow capabilities and rough edges

- **Shared knowledge is still awkward to use.** Publication of every `shared`/`soul` document is owner-only. Ordinary scoped search searches only the current Buddy's documents; the composer does not list shared document references. A reader can fetch another author's shared document if it already knows its complete ref, but a researcher cannot autonomously publish a newly produced in-scope shared brief. We need a clear policy for writing work that is already shared versus disclosing private material, and bounded discovery of published refs. This is a design gap, distinct from the five reproductions.
- **The mailbox remains a disconnected adapter.** Actual provider/account integration, production mailbox MCP and account-specific verification remain unfinished. Adapter tests are not an operational shared inbox.
- **Compatibility still creates competing meanings.** Scoped versus global defaults, document-reference variants whose runtime requirements are stricter than the advertised schema, mixed revision/envelope shapes and old prompt examples need one compatibility boundary. For example, `shared` and `note` refs advertise optional `name`, but the ledger requires it. This is further contract cleanup, not a reason to add an alternative workflow engine.
- **The live test is too short to prove daily operation.** It proves setup/import, one worker and one original-thread return. It does not prove a long owner conversation with memory reviews, a Product lead coordinating two returning children under competing timing, or visibility recovery after a partial creation. The new reproductions show why total test count was insufficient evidence.

## Simplest next design step

Keep Direction 1. Finish consistency at its boundaries: one knowledge resolver, one explicit audience policy, one creation-readiness path, and authorized queries that paginate after filtering. Keep identity, audience authority and content revision distinct. Do not add a second coordinator or another approval workflow to mask these mismatches.

Before lifting the readiness claim, exercise a repeated owner → lead → two children → lead → owner journey with memory review enabled between turns. Include private and published documents/messages, enough unrelated work to require pagination, failures immediately after persistence/registration/linking, reload, and replay of existing keys. Verify both “can act” and “can still find what happened.”

This is an assistant repair recommendation based on the owner's requested review, not a newly accepted redesign. The earlier owner choice still holds: share conversation infrastructure and keep background visibility separate from execution authority. No production tasks, external messages, cloud runs, grants or schedules were changed.

## Reproduction and historical evidence

The two diagnostic files deliberately assert **the observed bugs**, not correct behavior. Three diagnostic tests reproduced all five findings using isolated memory/configuration stores, the real composer/reviewer/operations/MCP boundary and a controlled creation-link failure. They are outside the normal test suite so they cannot be mistaken for acceptance tests.

```sh
pnpm exec tsx --test product/buddies/REVIEW_RESOURCE_CONSOLIDATION_2026-09-11.scope-repro.ts
pnpm exec tsx --test product/buddies/REVIEW_RESOURCE_CONSOLIDATION_2026-09-11.link-repro.ts
```

The [evidence snapshot](REVIEW_RESOURCE_CONSOLIDATION_2026-09-11.evidence.json) preserves source hashes, key excerpts, diagnostic hashes and observed results. The installed package source is commit `e22bdd5d73b74c125410ec9ba0b89c72566b6cea`, archive SHA-256 `d8642c78333241eacb26befc47a708cfeeeac5463a823598379dbd6d79a4c58e`. Unleashd's shared working tree remains uncommitted; its HEAD alone does not identify the reviewed source.
