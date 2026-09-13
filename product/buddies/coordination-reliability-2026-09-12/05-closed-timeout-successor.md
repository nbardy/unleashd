# Decision successor: Explicit recovery of already-closed timeouts

September 12, 2026, after 16:22 UTC (September 13 local). Decision-maker: Buddies Development Lead under the owner's design-and-implement instruction. Status: selected implementation; not a separately claimed owner endorsement. Supersedes only the historical-timeout recovery boundary in [the original selection](04-decision.md), preserved at commit `5e9480e`.

## New evidence and earlier reasoning

A native read of project `buddy_project_f24b0cc3-e82e-40ab-b974-5f1bfc469950`, revision 3, audit `audit_c1f9d928-5fc8-4240-b5db-75a74268b541`, returned newer evidence: coordinator attempt `buddy_run_c9bb49a7-f98d-4bbe-ae51-6b1f1a0b3ffd` and UI/release attempts `buddy_run_aedf24d1-3a9d-4fc1-b5af-81304ae74773` / `buddy_run_a2f53fd2-bc3a-4538-9d7a-a0c77b310fa6` expired after 600 seconds despite larger chain durations. The record preserves a native retry failure, `Request is no longer open`, on the second attempt. This is evidence of an existing closed receipt, not authorization to resume those production jobs.

Preserved excerpt from that revision: “native retry_run(runId=buddy_run_aedf24d1-3a9d-4fc1-b5af-81304ae74773,key=buddy-timeout-retry-ui-20260912-v1) returned error 'Request is no longer open'. No retry was created and no alternate access path was used.” Package baseline `fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d`, `background-work.js` / `coordination.js`, supplies the matching settlement and retry behavior. The original report already identified timeout/recovery problems; this evidence makes the historical-closed case concrete.

The original reasoning remains correct: a failed attempt and its reply must not be rewritten, stopped roots remain stopped, elapsed time cannot be refunded, and recovery must be explicit after effects inspection. Preventing new automatic failure replies alone does not give old closed failures a supported path.

## Chosen contract

Extend existing `retry_run`; do not add a fourth recovery API. When the latest attempt of managed work failed with `max_runtime_timeout`, its request was closed as `replied/failed`, and its original run/time budget remains, an authorized original sender/root requester may explicitly create one successor request. A nonblank reason is required. The team observation returns `mode: successor_request`; the owner form labels the action **Recover closed timeout**.

The old message, body, reply, evidence, acknowledgment and attempt remain immutable. A new message copies the original bounded input and original return destination. Its run retains allowed operations and the original attempt cap, links `retry_of_run_id`, and carries trusted policy references `recovery_of_message_id` and `recovery_origin_message_id`. These fields are host-written metadata in the existing sealed run policy, not new model-controlled parameters. One transaction creates the message/run, audit and command receipt. Duplicate keys return the same successor; another key on the old request points at the existing recovery.

The work-envelope calculation includes all admitted request attempts sharing the original budget reference. It retains the first admission time and original maximums. A queued successor does not refund consumed runs; its next claim consumes another run. Recovered work can continue under its own request ID while retaining the original deadline. The old message still says failed even if a later successor succeeds. Current project evidence is independently sourced.

Recovery rechecks controller identity, current audience, project supervision, original execution epoch, root stop, available budget and absence of other open managed work for that project. Completed/cancelled/superseded work cannot be reopened by this path. Destination deletion remains an admission/repair fence. An explicit original attempt cap is preserved. If the legacy policy omitted its cap and inherited the old 600-second runtime default, the successor resolves the current managed-work default inside the original wall-clock envelope. Recovery does not replace an explicit 600-second immutable cap; an increased budget or changed policy requires a separately authorized new assignment.

## Alternatives and consequences

Reopening the original message would falsify history and conflate two accepted inputs. Creating a normal new assignment would silently reset its budget and could widen policy. Rejecting all historical closed failures would leave the consumer's concrete recovery case unresolved. A full case/event engine is still unnecessary; existing immutable message IDs, sealed policy, run linkage and transactional command receipts represent the successor cleanly.

The caller receives a run whose `input_id` is the new message. It should continue inspection/retry on that successor and use the original request for historical evidence. Root cancellation still affects the entire causal family. A late historical failure delivery remains a historical fact, so recipients must consult current work/receipts before deciding further action.

## Acceptance and reconsideration

The packaged boundary fixture calls the prior runtime's real `settleBackgroundReply` method to produce `replied/failed`, then verifies an explicit successor, unchanged old receipt, duplicate prevention, preserved policy/deadline, cumulative run exhaustion and stopped-root rejection. Native in-memory MCP repeats the recovery from a later sender conversation and verifies observation linkage. These tests do not resume the reported production attempts.

Reconsider if further legacy states require ambiguous inference (for example, an explicit human cancellation mistaken for timeout) or if consumers require versioned input edits during recovery. Those require a new explicit contract rather than broadening the timeout-only predicate.
