# Wave_sim efficiency task plan — September 15, 2026

Planning record by Buddies Development Lead. The owner requested: “if there is work here plan it out, write the tasks.” The scope is the newly created Wave_sim coordination-efficiency project, which had three broad todos. The detailed decomposition below is the assistant's planning choice; it does not record owner acceptance of every proposed runtime mechanism.

Parent Task: `buddy_project_6efaffd1-0415-4dcf-80a4-bb6599d924b7`.

## Outcome and sequence

Make it cheaper in context and time to discover changed work, assign the intended model, inspect actual effort, and review worker results.

| Task | Deliverable | Dependency |
|---|---|---|
| Compact summaries | Bounded work/inbox/team discovery, full expansion, measured four-project summary ≤15,000 serialized characters | First delivery |
| Incremental reads | Reliable recent/actionable reads and documented cursor/removal/access-change semantics | Summary contract |
| Assignment selection | Requested/resolved/admitted provider, model and effort through common conversation configuration | Next delivery after summaries |
| Usage reporting | Deduplicated assignment-tree usage and time with explicit coverage | Selection receipts and causal IDs |
| Review wakeups | Bounded coalescing through existing Mail/return scheduling, with each return retained | Return attribution and usage observations |
| UI and integration | Owner views, boundary regression, build provenance and representative workflow qualification | Prepare fixtures early; accept after all five slices |

Suggested delivery order: summaries → selection → usage → review wakeups. Incremental-read work follows the summary contract and is independently reviewable. Integration consumes all slices. Each implementation slice includes its own verification; the final task checks their composition.

## Native Tasks

### 1. Finish compact Buddy work and attention summaries

Task: `buddy_project_075e367e-3442-474c-a58d-8094aec59e25`

Let a lead discover current work without repeatedly loading full historical criteria and evidence. Reconcile and finish the summary code already being edited in shared/src/buddy-resources.ts; reuse existing work, inbox and team read authorities.

Acceptance: A frozen representative four-project fixture produces a summary of at most 15,000 serialized characters. Report the normalized payload and complete MCP envelope sizes separately, with measured read latency. Summary fields are bounded and include IDs, revisions, owner, status, update time, blocker/next-action previews, todo/evidence counts, truncation and expansion refs. Full criteria, history and comments remain accessible under the same audience. Public defaults and text/structured compatibility are verified through real MCP calls; do not claim loaded adoption from local source.

### 2. Add reliable incremental and actionable Buddy reads

Task: `buddy_project_56ced029-2ce3-4897-b037-462d5a01e2ff`

Expose changes and actionable attention without silently skipping records during concurrent updates. Extend existing work/inbox/team read services; a timestamp filter alone must not be represented as a lossless change cursor.

Acceptance: A documented cursor and recent/actionable filter contract covers closure, cancellation, ownership change and deletion where supported. Concurrent paging, same-time updates, stale cursors, replay and access changes cause no silent gaps or unauthorized disclosure. Unsupported delta guarantees are explicitly rejected or labeled; full expansion and old client behavior are retained through documented compatibility.

### 3. Select models per Buddy assignment and show actual admitted settings

Task: `buddy_project_4abf69fe-7981-4934-aaa0-7b4d2908906e`

Let one assignment request a provider/model/effort without editing a Buddy's permanent profile or silently reusing incompatible conversation settings. Reuse shared conversation configuration and existing send preview/admission.

Acceptance: Optional assignment selection is preserved through preview, queue and admission. Preview shows requested/resolved values, source and conflicts without writes; admitted receipt matches the actual provider invocation. New work and continuation have documented deterministic semantics. Provider-specific strings pass through and unsupported values/conflicts are explicit. Concurrent assignments do not alter one another or permanent profiles.

### 4. Report complete assignment usage and time with coverage

Task: `buddy_project_cdae619b-6e1d-4d5b-9c78-84308f418344`

Show known effort across planning, worker attempts, retries, returns and review using existing causal IDs and provider telemetry. Unknown usage must remain unknown.

Acceptance: Observations expose assignment/root/parent IDs, requested/admitted settings, input/output/cache usage with provider semantics, and separate active/queued/dependency/review time. Totals deduplicate attempts and child aggregates. Partial/interrupted/missing usage and harness attribution have explicit coverage reasons. Known cost, dated sourced estimates and unavailable cost are distinct; wall-clock latency is separate from summed concurrent time. Reporting does not claim unimplemented spend enforcement.

### 5. Coalesce redundant lead review wakeups while retaining every return

Task: `buddy_project_4f875aff-3481-4ba9-8aab-eb0ea62c1308`

Use existing Mail and background return scheduling to reduce repeated parent reviews while preserving each originating assignment, outcome, artifact reference and decision.

Acceptance: Pending nonurgent returns with compatible audience/route can share a bounded review wakeup. Every result stays individually attributable and separately acceptable/revisable; duplicate delivery attempts and already-consumed results do not cause redundant actionable reviews. Urgent failures have a defined immediate route and batching has a documented maximum delay. Stop/cancel, retry, restart, budgets and foreground availability retain existing semantics.

### 6. Verify the efficiency workflow in UI, MCP and the loaded runtime

Task: `buddy_project_67c0de12-9b60-4748-ae8b-0a88792c2f74`

Make the five API/runtime slices usable and provide one coherent evidence-backed acceptance record for the Wave_sim handoff. Preserve existing repair ownership and distinguish source, local tests and loaded-host behavior.

Acceptance: Owner views and tools support summary→full criteria/comments, actionable errors, requested/admitted configuration, usage coverage and separate execution/delivery/acceptance states. Focused boundary tests, shared/server checks, client tsc -b and client invariant gates pass for changed paths. Frozen source/package/build identities and authorized loaded-path evidence are recorded separately. Historical defects are only reopened when reproduced; unsupported heartbeat/GPU/meters remain explicit. A small representative workflow comparison reports payload, latency and accepted-result effort without unsupported savings claims.

The six Tasks contain 18 bounded todos. Native Task records own status, responsibility, completion evidence and next actions. This file is a dated plan and rationale; it is not a second current-work ledger.

## Observations and evidence limits

- The native current-work and inbox reads returned contract `2026-09-13.1`. Current work expanded complete project histories; native send did not expose assignment model/effort selection. The MCP response contained both text and structured representations. This is observable response structure, not proof of doubled model billing.
- Local `shared/src/buddy-resources.ts` was already being edited during planning. At inspection it declared `2026-09-15.1` and included work summary/recent/status/updatedSince fields, a summary helper and inbox filters. The summary Task must reconcile these edits before implementing anything overlapping. These local edits are not proof of loaded runtime support or passing tests.
- Preserved observed excerpts: `view: z.enum(['full', 'summary']).default('full')`; `updatedSince: z.string().datetime().optional()`; `items: items.slice(0, p.limit).map((item) => p.view === 'summary' ? summarizeBuddyWorkProject(item) : item)`.
- A timestamp filter and snapshot invalidation are not by themselves proof of a lossless incremental feed. The separate incremental Task must establish that guarantee, including deletions and access changes, or document precisely what remains unsupported.
- No implementation or live-provider tests were performed in this planning pass. Existing claims of historical fixes must be assessed at their recorded source version and only reopened for a current reproduction.

## Reuse existing work

These are dependency references, not new assignments or duplicate repair tracks:

| Existing native Task | Relationship to this plan |
|---|---|
| `buddy_project_19703c1b-e2ad-4499-adf5-7bb16b0b6fa9` — setup/admission/return diagnostics | Reuse its authority and acceptance for truthful configuration and actionable UI errors |
| `buddy_project_37f2780f-f766-452b-991c-eb4ca4192a9b` — remaining repairs and delivery | Reuse its preserved effects, integration and delivery evidence |
| `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b` — history/privacy/consistency | Preserve its regressions; do not duplicate closed fixes |
| `buddy_project_9ef2b573-f8fd-48d6-9218-c390c9035487` — blocked-work recovery | Reuse verified recovery behavior and keep its recipient-routing issue separate |
| `buddy_project_b55e2554-3dae-4b14-8b81-fcd1cfec3531` — deferred direct-report limits | Usage reporting does not silently promote metered spending enforcement |

The parent retains the all-requirements assessment. The integration Task covers handoff section 8: separate attempt/delivery/acceptance facts, cancelled-then-later-success history, recovery limits, interrupted reports, delivery retries, scoped oversight, memory/live-state distinctions, partial updates, real tool bounds and loaded build identity. Heartbeat/GPU integrations remain explicit limits unless a demonstrated gap requires separately scoped work.

## Planning decision and rationale

Question: how to convert four priorities into work that can be accepted independently?

Choice: use six children of the existing project, with three todos each. Separate summary payload reduction from cursor correctness because their proof obligations differ. Keep model selection before telemetry integration, and use measured return attribution before changing wakeup scheduling.

Decision-maker: assistant, within the owner's request to plan and write tasks. Status: planning recommendation recorded for execution; detailed cursor, continuation and attention-policy mechanics remain to be selected at their canonical boundary.

Constraints: Buddies, Mail, Tasks, ordinary files and shared conversations remain the core. Full criteria are read before completion decisions. Provider-specific strings pass through. Reads remain audience-scoped. A changed notification policy cannot renew assignment limits. Reporting unknown usage as zero or source edits as deployment would defeat the task.

Alternatives: keep the original broad implementation todo (hard to accept or resume); create a new top-level program or new repair projects for historical incidents (duplicates existing work); require a parallel workflow engine or spending ledger (not justified by this handoff).

Tradeoff: six child Tasks add some coordination overhead but provide concrete independent acceptance and preserve the existing project as the single umbrella. Revisit if the summary and delta code can be delivered coherently in one reviewed patch, current evidence proves a slice already complete, or a provider lacks the telemetry/configuration guarantees requested. Update native criteria/dispositions with evidence instead of silently weakening completion.

## Historical sources

The existing source snapshot preserves full source bytes and their hashes:

- [Efficiency source snapshot](2026-09-15-efficiency-sources.json), observed `2026-09-15T13:34:33.601879+00:00`, SHA-256 `0cf628e511a726dc1de2c52e431ac2191980ceb55932e12f8d37c25605fa4345`.
- Handoff source SHA-256 `98aece04975a3615eddccb3113e23a594029e82b24acfafaecca76e166a351c0`.
- Efficiency review SHA-256 `d92bac8d53124671f70505a3c1a5b50df5d4dbc9e74a935fe8ae4289318a6206`.
- Core design SHA-256 `8b4a700ddbe940b0335bbf6feae02565dd56bc23283246e3ebc49ae7467e0646`.
- Limits design SHA-256 `f0b73649e27aa9db98291fe852a907ba1d3c576901149a894085d375230ef6d3`.

All four embedded source hashes were recomputed successfully during planning. The handoff's four priorities, ≤15,000-character target, unknown-is-not-zero telemetry requirement and instruction to reuse existing Tasks are preserved in full in that snapshot. Its proposals remain proposals until verified.

Repository HEAD observed during planning: `1187a8b6660b95c0c60bd8fada105f015b98cc39`. The working tree had substantial concurrent edits; HEAD alone does not identify the inspected local source. The excerpts above identify the limited local observations without claiming their implementation complete.

