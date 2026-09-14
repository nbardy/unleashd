# Lean Workers implementation — 2026-09-14

Owner authorized implementing the minimal map with four sub-agents after asking
to stay tight to the core design in function and code. This is the delivered
implementation record, succeeding the recommendation recorded in native note
`2026-09-14T10:06:56.025Z:0252e961-f45f-47d0-b90e-0dc031b2900c`.
The owner's behavioral choice remains reusable parent-owned Workers, responses
correlated to their launching request, contextual lead review, independent human
chat, ordinary files, and complementary Task comments/Mail. The implementation
mechanisms below were selected by the implementation team, not independently
specified by the owner.

## Delivered changes

- Integrated Worker mode into the existing Buddy and manager relationship model;
  a Worker can be reused across Tasks through existing work delivery/continuation.
- Captured a bounded frozen launch handoff at authorized dispatch. Existing Mail
  request IDs correlate responses. Existing conversation creation metadata holds
  the private handoff and validated audience. Background review reuses its own
  conversation; human chat remains available.
- Normal replies and failure notices receive original request, matching execution
  state, report/evidence, current Task criteria when present, and available native
  transcript references. An unrelated later Worker run cannot replace the source.
- Timeout settlement drains the original execution, admits one bounded reporting
  turn through existing Mail/run admission, then delivers a report or explicit
  fallback. Original failure remains visible; explicit user stop does not start
  reporting. Queue time counts toward the reporting allowance.
- Added append/list Task comments through real package authority, MCP, HTTP and
  the shared desktop/mobile Task view, with evidence, pagination, access checks
  and idempotent command keys. Task status remains the existing project authority.
- Retired advertised checkpoint writes and active checkpoint selection. Historical
  rows, references, migrations and evidence remain readable. The compatibility
  write entry point gives an explicit retirement error.

There is no new Worker table, report table, scheduler, completion ledger, file
registry or artifact-acceptance state. Ordinary knowledge tool-surface cleanup
remains the separate scope explicitly identified in the approved map; identity
memory maintenance and its access controls remain intact.

## Concrete API and ownership

The package adds `appendTaskComment(input, authority)` and
`listTaskComments(input, authority)`. Input fields are projectId/key/body/evidence
for append and projectId/limit/cursor for list. Server-assigned records contain
id/project_id/author/body/evidence/created_at; pages contain items/nextCursor.
Shared Zod schemas define wire validation. Existing `create_buddy` accepts
employmentMode; existing work delivery accepts continueFrom.

`createReturnConversationPreparer` captures launch context using existing
conversation creation/configuration services. `BuddyRunExecutor` assembles
return context in its existing path. `runCoordinationMessage` passes the typed
terminal cause through its drained callback. `resolveSessionTranscript` resolves
and validates an adapter's real transcript path, or returns null.

## Evidence and validation

- Final Buddies source commit: `aed8badae7fdaa0763145bcc32df629fecbc10dc`, clean
  worktree `/Users/nicholasbardy/git/.codex-worktrees/buddies/thread-returns-20260913`.
  Package suite: 106 passing tests. Schema version 30.
- Reproduced installed archive `vendor/nbardy-buddies-0.1.0.tgz`, SHA-256
  `0b202eafb108cee332cf65804fa5495c2b573a313946e52e03c976c3d27e4b93`.
  Provenance records clean source and reproducible packing.
- Full server suite: 359 passed, zero failed, five optional tests skipped.
  Final normal-return source-selection refinement then passed six focused tests.
- Full client suite: 91 passed. Client typecheck and all six client invariant gates
  passed. Shared, CLI, server and client builds passed.
- Clean installed artifact, compiled MCP handshake and plain-node server smoke
  passed. Builds ran directly first; npm pack's duplicate prepack was skipped
  with `npm_config_ignore_scripts=true` because the owner's dev-supervisor lock
  was held. The running development server was not stopped or replaced.
- [Independent real-provider evidence](20260914_worker-return-live-evidence/README.md):
  normal and forced runtime-timeout workflows both passed. In each, the Worker
  saved an artifact, the background lead actually read its bytes and recorded
  acceptance, and a concurrent human follow-up completed. Timeout additionally
  proved drain, bounded report, and preservation of max_runtime_timeout.

[Dated source and check snapshot](20260914_lean-workers-implementation.evidence.json)
preserves full relevant uncommitted files, SHA-256 hashes, and check output.
It includes pre-existing content: it is historical evidence of the tested tree,
not a claim that every line was introduced by this work. The independent live
evidence retains exact tested versions; normal ran before the later timeout fixes.

## Tradeoffs and revisit conditions

Messages lack stable provider call IDs at this bridge. The cutoff is an honestly
labeled `snapshot-sha256:...` identifier, with a 60,000-character history tail,
explicit omissions, and a full-history link. A review conversation keeps at most
128 distinct launch snapshots and rejects overflow rather than silently replacing
required context. Revisit these bounds if real workloads hit them or providers
expose a verifiable native fork/call boundary. Do not fabricate tool-call IDs.

The reporting allowance is 120 seconds including queue delay; read operations
are intersected with the original run's allowed operations. Revisit with measured
report duration and queue pressure, preserving one terminal cause and one return.
The provider still has its configured harness tools; this is not a new filesystem
sandbox. Live evidence covers Codex gpt-5.6-sol medium and explicit runtime expiry,
not every provider or waiting out the production deadline.

Independent testing found and fixed three real issues: briefing budget overflow,
loss of the runtime's typed timeout cause, and failure routing from a stale
pre-settlement run. Regression tests preserve these lessons. No production data
migration, main merge, push or deployment was performed. App edits remain local
amid substantial pre-existing changes; the isolated package source is committed.
