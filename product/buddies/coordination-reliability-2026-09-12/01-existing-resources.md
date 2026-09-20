# Design 1: Reliable coordination through existing resources

September 12, 2026. Author: Buddies Development Lead. Status: candidate, selected only by the subsequent decision record. Owner asked for three alternatives, a decision and implementation; this is an assistant design, not a claimed owner selection.

## Problem and evidence

Wave_sim produced artifacts through real delegation, but four return-side runs failed during conversation linking. A failed attempt, saved reply, later project acceptance and undelivered notification were presented as one loosely joined status. A 7,200-second managed envelope still gave each attempt 600 seconds. Project Lead dispatched children under a CEO root but could not retry those children because control checked only the root sender. CEO could dispatch to leads without observing their downstream execution.

The exact report, appendix and historical consolidation/repair decisions are preserved under `sources/`; `source-manifest.json` records original paths, SHA256 hashes, observation time and host/package revisions. The package baseline is `fd9f0a85d4f6882954c86b32e5aceec3e0cedb5d`. Host snapshot is `3ea36ad97dbfed535b0da9841519222040b074bc`. The report's four failures are historical observations, not proof of which build ran. Source inspection confirms `linkConversation` always inserts, readiness calls it again, `getMessageExecution` joins current project evidence, and `requireControllableRunRoot` checks root sender only.

## Product contract

Keep messages, attempts, projects, conversation links and documents as the authorities. Build one joined observation with explicitly named source fields. A conversation is a durable transcript identity; each incoming item has its own attempt. Project acceptance is current project state, not message acknowledgment. Reply persistence is not consumer delivery; successful delivery is not human acceptance.

The owner/team view shows a row per execution with observation time, employee, input kind, message/root/project IDs, state and deadline. An expandable row shows immutable attempts, registered checkpoints, notification attempts and recovery controls. The same projection powers a native read and HTTP. Both desktop and mobile use the shared Buddy component and route. Links are available only for conversations the client actually holds.

## Resource and schema changes

1. Make linking idempotent by Unleashd conversation ID. Validate the immutable Buddy/workspace/project binding and return the original row. Do not reset its timestamps or terminal status; session updates remain the explicit update path. A different binding is a structured conflict. Serialize lookup/insert in the package transaction.
2. Add an attempt acknowledgment timestamp written at actual input admission. Historical rows remain unknown unless a direct reply supplies evidence of processing. Never derive it from project acceptance. Retain legacy receipt fields with corrected message semantics and add `projectSnapshot` containing its ID, revision, status, acceptance and evidence count.
3. Reuse `buddy_runs` as the durable delivery queue. Replies and failure notices already have unique input keys. Expose their entire attempt history separately. Transient pre-admission failure may retry with a stable key and bounded backoff; once input admission happened, recovery is explicit because effects may exist. Busy destinations stay queued. No notification-of-notification recursion.
4. Add append-only checkpoints referencing run, message, root, project, producer and creation time. Payload contains versioned artifact references, content digests when known, side-effect notes and resume instructions. Registration attests what the producer saved; it does not make arbitrary file contents trusted or prove that a file still exists. A checkpoint belongs to its original attempt forever. Current project evidence remains a separate resource.
5. Store effective execution settings on the attempt when the host starts it: provider, model, effort, requested turn limit, effective deadline and limiting source. Unknown historical fields stay null. Token/cost usage stays explicitly unavailable where no meter exists. Do not imply that a max-cost field is enforced.

No second execution engine, provider protocol or project status enum is introduced. Additive SQLite migration must reopen older populated databases without changing cancelled history. Package code, types, archive and provenance ship together.

## MCP and authorization

Add `get_team_state` for bounded coordination metadata and `checkpoint` for a bounded append-only recovery receipt. Extend send with exact-payload preview using the same validation/transaction boundary as apply; preview rolls back every write and cannot enqueue a provider. Existing `get_message`, `get_runs`, `retry_run`, `reply` and work/document tools remain.

Team observation admits non-chat coordination belonging to a root requested by the observer, or work already readable under supervision in the current workspace. It returns no private message body, provider transcript, private memory or profile. Team turns also apply the current knowledge audience: a project turn cannot use a same-identity root from an unrelated owner conversation. An optional target filter narrows existing access and never grants it. Paginate after authorization; bound evidence and use detail reads for expansion.

Recovery controllers are the original message sender for that input and the original root requester. They retain identity across conversations; current audience, workspace, supervision, immutable run policy, root stop and project execution gates still apply. A direct sender can resume its child without gaining control of siblings. A worker can inspect its own attempt but cannot silently reset the manager's budget. Owner controls remain a separate authenticated host authority.

Cross-team informs should default to no destination project; an explicit project is contextual and must be readable by the producer and consumer. Work still requires a recipient-owned project. Reply is addressed by immutable message ID and eligible recipient/audience, not by accidental current conversation ID. Exact preview reports invalid return route, project mismatch or missing permission before dispatch. It is an observation, not a lease: apply rechecks.

## Limits and recovery state machine

Managed work has a chain envelope and an attempt cap. Use the explicit policy turn cap when present; otherwise managed work derives a cap from its requested envelope, bounded by the host's 3,600-second background maximum. Ordinary request/notification defaults remain 600 seconds and are advertised. Admission takes the minimum with the remaining managed envelope. Child waiting consumes chain wall time, while a suspended parent holds no provider slot. Parent cancellation fences descendants; the parent's individual attempt deadline is not an implicit new child permission or a replacement for the child envelope.

Timeout with remaining managed budget leaves a failed attempt and a recoverable open request, plus a durable failure notification. Do not automatically repeat provider effects. `retry_run` checks no live sibling attempt, remaining runs/time, a recoverable open message, execution epochs, current authority and a stable key. A successful retry inserts a new attempt linked to the failed one and retains the original envelope. Exhaustion produces a terminal limit disposition; stopped roots never reopen. Existing terminal replies remain immutable: a new authorized request may reference them but must be visibly new work.

A recovery card names eligible controller IDs, whether this viewer can retry, exact reason/remedy, checkpoint refs, recorded effects, remaining runs/time and the proposed native command. It must distinguish delivery recovery from rerunning producer work.

## Freshness, artifacts and resource limits

Show current project revision/time beside historical attempts and document revision. Memory is descriptive; prompts/read responses identify current work as authoritative. Memory maintenance receives source revisions so later accepted evidence can supersede an earlier unverified claim without erasing decision history. No automatic production memory rewrite from a consumer report. Register checkpoints before long commands; unregistered temporary files remain undiscovered rather than invented.

GPU reservations are not host leases today. The view explicitly states resource leasing is unavailable, and displays only recorded artifact/effect claims. Implementing actual device exclusivity requires a separate resource manager and owner device configuration; this release must not label prose reservations as held leases. Per-assignment provider override is similarly not silently inferred from prose; expose actual settings and the limitation. Existing profile controls remain the supported configuration path.

## Queue, errors and observability

FIFO within each destination prevents results being overtaken there. Across destinations use bounded fair admission so one busy recipient cannot block others. Record structured codes for creation/link conflicts, missing destination, timeout and delivery exhaustion. Preserve original errors on immutable attempts. An undelivered failure notice is inspectable through the team view even if no subsequent notification can run. Observation timestamps are read times; a running claim is not an independent process heartbeat. Display heartbeat as unavailable unless the runtime supplies one.

## Validation and rollout

Use the real configuration store, conversation service, Buddy integration, executor and controlled provider. Test two-worker aggregate return; busy manager then exactly one admitted return; repeated link after session binding; pre-start failure/retry; timeout after checkpoint with sender/root recovery; cancellation followed by later project success; cross-team preview/apply; privacy and pagination; stopped/deleted destinations; old schema reopen. Render both shells' shared view and retain conversation-link invariants. Complete typechecks, package tests and focused host tests, then broader regression gates. Run one bounded isolated live-provider round trip without resuming production roots.

Land package changes on an isolated source branch and create a reproducible archive. Merge host changes into the dirty shared checkout only after comparing against the preserved baseline; resolve concurrent edits instead of overwriting them. Let the existing watcher adopt at an idle boundary. Verification of the new build and any production recovery are distinct receipts. Rollback application code must understand the additive schema; do not downgrade the database or delete historical attempts.

## Tradeoffs and revisit criteria

This preserves the accepted consolidation architecture and fixes its broken boundaries with small extensions. It avoids dual lifecycle authority and provides immediate consumer value. Joins and append-only checkpoint receipts are less general than an event-sourced history, and lease/model override workflows remain explicitly unsupported. Revisit when several independent consumers need replayable subscriptions, real resource scheduling is authorized, or joins cannot express provenance without duplicating state.
