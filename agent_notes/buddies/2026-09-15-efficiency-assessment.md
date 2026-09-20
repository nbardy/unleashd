# Wave_sim efficiency handoff: assessment and implementation

September 15, 2026 · Buddies Development Lead

## Decision and attribution

**Question:** Which September 15 handoff proposals solve demonstrated workflow
gaps, and which should change the current implementation?

**Owner request:** inspect the handoff, investigate whether its ideas are good,
and implement the justified improvements. The specific implementation choices
below are the Development Lead's decisions under that request, not separately
ratified owner product mandates. No workspace-wide model ranking was adopted.

**Choice:** implement compact/focused reads and assignment-scoped configuration
using existing resource, Mail/run-policy and conversation authorities. Add
truthful timing and usage-coverage observations. Preserve existing managed-parent
return coalescing; defer cross-request batching and complete usage accounting
until their missing contracts/data exist.

This follows the earlier accepted resource-consolidation direction, rather than
reopening it. The handoff supplies a new measured cost: full historical work
objects dominate routine reads. The core's reasons for one Task authority, one
conversation-configuration resolver and separate work/review limits still hold.

Historical sources are preserved, with full text, observation time and SHA-256,
in [the source snapshot](2026-09-15-efficiency-sources.json). In particular:

- The handoff says: “A summary is a discovery view, not a second authority.”
- The core says: “Do not copy current Task status into memory, Mail metadata or
  a Worker ledger and then reconcile competing writers.”
- The handoff says: “Unknown is not zero.”
- The limits document separates execution policy proposals from implemented
  request/run limits. This review does not convert those proposals into defaults.

The native predecessor `2026-09-15T03:40:18.725Z:ed079d24-c7fa-4366-9bcc-fcad268c17fb`
was recalled before this decision; ordinary memory refresh continues to preserve
same-audience sessions. This change does not reset sessions on memory revision.

## Priority assessment

| Handoff priority | Assessment and delivered behavior | Remaining boundary |
|---|---|---|
| Compact/incremental reads | Strong, directly reproduced. Added opt-in summary/full work views, counts, truncation markers, status/recent/inclusive-time filtering, and result-set-bound work pagination. Added recent/outstanding inbox reads and summary/state-filtered team observations. Full criteria/evidence stay expandable. | Inclusive timestamps are current-record filters, not a gapless event feed. Work pagination detects concurrent updates, closures, removals and access changes and requires restarting; it does not retain a snapshot or return deletion tombstones. Inbox/team offsets retain their existing concurrency limits. |
| Assignment-level selection | Strong. `delivery.config` on request/work resolves through the common configuration service, pins the first applied selection, persists in the existing run policy, and creates an inert conversation with that configuration. Preview is write-free; continuation conflicts are explicit. | Unconfigured sends preserve their previous profile/thread behavior. No universal cheaper-model policy, profile edits, automatic fallback or changed provider semantics. |
| Complete usage/accounting | Useful objective, but prerequisites are absent: the current unified `turn.complete` event contains a reason, not token/cache usage. Added durable queue/claim/elapsed intervals and explicit null token/cost coverage. | No invented active-provider time, billed cost, child token totals or spending enforcement. Harness telemetry and deduplicated attribution must precede full accounting. |
| Fewer review wakeups | Sound operational intent. Task comments already avoid notifications. Existing managed-parent reconciliation already combines child returns into one bounded continuation; package tests cover both return-before-drain and return-after-drain. | Separate requests sharing a background conversation still carry independent root limits, policies and correlated outcomes. Combining them requires an explicit governing audience/allowance/urgency rule. Serializing their admission is not semantic batching. No new scheduler was added. |

## Concrete changes and ownership

### Work and attention

`shared/src/buddy-resources.ts` owns the public query options and work summary.
`server/src/buddies/work-query.ts` hashes and pages already-authorized current
rows. Both employee operations and owner resources use it. It creates no cache,
table, event store or second work record.

The four-project stress fixture retains extensive criteria and 32 long evidence
entries per project. Its normalized response changes from **564,726 to 3,190
serialized characters**, a **99.4% reduction**. Full expansion returns the same
historical object. This is a synthetic integration fixture, not a rerun of the
Wave_sim production sample, a token count, a latency benchmark or a dollar saving.

Defaults retain full work reads and existing inbox attention order. Work/inbox
filters run before the page bound, after authorization. New work cursors bind the
query, audience and current records. A changed set returns `STALE_WORK_CURSOR`
instead of skipping shifted rows; legacy offset cursors remain compatible.
Long, highly active scans may need to restart. Database materialization still
loads full projects before projection, so backend query-cost reduction is not
claimed.

MCP text now uses compact JSON. Both text and structured representations remain:
existing consumers/tests exercise each. Removing either without client
negotiation would create a compatibility change. Provider token charging was
not measured.

### Configuration and actual execution receipts

`server/src/buddies/assignment-config.ts` reuses the canonical configuration
resolver and required-MCP provider check. The dispatch path validates the exact
recipient/project/continuation route before looking up its configuration.
Unsupported selections fail before enqueueing or creating a return conversation.

The original config is part of the package command's idempotency payload. Its
first host resolution is stored as `policy.assignment_config` on recipient
attempts. No new database column is required. Same-key replay retains it; a
different config under the same key conflicts. Retries, managed continuations
and interruption reports retain the selection. Parent return policies explicitly
remove it so selecting a worker's model does not select the lead's model.

Fresh conversation creation takes a pinned `ConversationConfig`, preserving the
existing creation/replay/configuration boundary. Reused conversations must match
the requested effective provider/model/effort. Changed configuration between send
and invocation fails with `assignment_config_conflict`; no different provider
request is invoked and no actual execution snapshot is recorded.

The earlier execution receipt sampled conversation getters before preflight.
It now records the resolved configuration immediately before `executeTurn`.
The native integration test compares that receipt with the actual request passed
to the provider adapter. This proves host invocation configuration; it does not
prove a remote provider's internal model routing.

Moving `BuddyKnowledgeScopeSchema` into one small shared module removes the
circular dependency that otherwise results from reusing `ConversationConfig`
inside the resource schema. It remains re-exported from its existing location;
the schema and audience semantics did not change.

### Honest observation

`get_team_state` now separates requested selection from the actual execution
snapshot. Per-attempt `queuedMs`, `claimedMs`, and `elapsedMs` derive from durable
timestamps and stop advancing when terminal. Claim time includes setup/overhead;
it is not provider-active time, and concurrent claims are not wall-clock latency.
`usageCoverage.tokens` and `.cost` are null with an explicit coverage reason.

## Supporting requirements reconciled

| Requirement | Current evidence and disposition |
|---|---|
| Execution/delivery/acceptance separation | Existing message execution/project snapshot and background-work completion boundaries remain. Resource, observation and background-runtime tests pass. No status completion from provider success alone. |
| Historical provenance | Existing current-project snapshots remain separate from run/reply facts. This change only adds projections/receipts; cancelled attempts are not rewritten. |
| Recovery and budgets | Package recovery, request deadlines, foreground timeout and stopped-root checks remain. All 108 package tests and conversation runtime timeout tests pass. Assignment config is preserved through retry without renewing a limit. |
| Useful interrupted returns | Existing bounded reporting and explicit unavailable-report paths remain. Package tests additionally check that reporting retains worker config while the lead return does not inherit it. |
| Delivery reliability | Existing durable reply/failure delivery and background return tests pass, including restart, replay and missing destinations. Production incidents are not declared resolved by those fixtures. |
| Scoped oversight | The new work page hashes already-authorized rows. Tests exercise hidden work and a read-all-work grant being removed between pages. Configuration lookup follows exact route validation. No private-memory access changes. |
| Process/GPU truth | Existing explicit limitations remain. No independent process heartbeat or GPU lease integration was added. |
| Memory freshness | Current work remains in Tasks. Existing runtime/memory consistency tests pass. No automatic private-memory widening or stale-status copying. |
| Safe partial updates | No project mutation semantics changed. Full evidence remains unchanged through summary/expansion. Existing package work/evidence/revision tests pass. The historical omitted-evidence incident is not asserted to remain a current bug. |
| Tool contract clarity | New query bounds, modes, truncation and expansion are exposed in schemas/descriptions; the legacy read description retains its compatible vocabulary. Resource version is `2026-09-15.1`. |
| Deployment identity | Package commit, archive hash, installed-file parity and application file hashes are recorded below. Running-host adoption is not inferred from local build output. |

Operating recommendations such as one accountable implementation chain,
artifact-specific assignments and evidence-based review are useful practices.
They need no new controller or mandatory reporting ritual. Wave_sim's model
preferences remain its own workspace policy.

## Verification and preservation

- **66 relevant server tests passed** through native MCP, real isolated package
  stores, conversation creation/configuration, runtime provider-request capture,
  resource privacy, continuation, cancellation and prior regressions. The
  provider execution itself uses a deterministic test adapter, not a paid model.
- **108 package tests passed**, including new assignment-policy and inbox-order
  cases and existing admission/recovery/return behavior.
- Shared ESM/CJS compilation, server typecheck, client `tsc -b`, formatting of
  18 touched TS files and scoped `git diff --check` passed.
- The source package was checked out from the installed package's recorded
  `aed8badae7fdaa0763145bcc32df629fecbc10dc`, not the older package main checkout.
  New package commit: **`631829b62ae6a6f706e3fb9b171e85a387ccbebe`**, on local
  `codex/efficiency-20260915`.
- Reproducible vendored archive SHA-256:
  `961e14438ee1afea02252d5e030bbdbba377a140ca1b3f3c39431097f1d4db0f`.
  Every installed package file matches that source. No package/main push.
- The application checkout already contained broad uncommitted work at HEAD
  `1187a8b6660b95c0c60bd8fada105f015b98cc39`. This task's application edits remain
  local; that HEAD alone does not identify them. Source hashes and selected
  pre-edit deltas preserve attribution without committing unrelated changes.

See [verification and source hashes](2026-09-15-efficiency-verification/verification.json),
[server command](2026-09-15-efficiency-verification/server-test-command.json) and
[complete server result](2026-09-15-efficiency-verification/server-tests.log).
The [API guide](../../product/buddies/EFFICIENCY_API.md) describes exact usage and
compatibility. No browser redesign, live provider acceptance or production reload
was performed.

## Reconsideration criteria

Revisit an event feed when a consumer must reliably reconcile deletions and
audience removals over long/concurrent scans. Revisit cost accounting when at
least one provider supplies measured usage with clear event semantics and
interrupted-run coverage. Revisit cross-request batching when a concrete workload
demonstrates redundant independent review and its governing authority, limits
and urgent-delivery rule are defined. Append a successor decision with those new
facts; preserve this rationale and the original handoff.

Authoritative work: implementation assessment project
`buddy_project_6efaffd1-0415-4dcf-80a4-bb6599d924b7`; remaining boundary decisions are
tracked in `buddy_project_8638d8bf-f609-46f3-b991-a2d5232e55c4`. Their current state
belongs to native Tasks, not this historical note.
