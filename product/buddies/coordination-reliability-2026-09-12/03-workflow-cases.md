# Design 3: Durable workflow cases and explicit handoff steps

September 12, 2026. Author: Buddies Development Lead. Status: candidate. Historical source versions and preserved evidence are in `source-manifest.json`; this proposal does not supersede the owner's accepted consolidation direction by itself.

## Problem and intended workflow

Model the coordinated outcome as a case with named steps and dependencies. Wave_sim CEO opens a delivery case; Project Lead owns the aggregate step, functional leads own branches, and engineer/designer/research steps return versioned artifacts to declared consumers. A case board shows running steps, saved artifacts, pending reviews and effective limits. Managers recover a failed step instead of discovering loose message/run IDs.

The observed problem is more specific than missing workflow notation: four returns hit duplicate conversation linking, timeouts used 600-second attempt caps, recovery selected the root requester, historical receipts absorbed later project state, and memory repeated stale startup uncertainty. The supplied report/appendix are a historical snapshot, not proof of production build identity. Any case engine must repair those boundaries and retain existing failures.

## Domain and schema

Add `cases`, `case_steps`, `step_dependencies`, `step_attempts`, `step_artifacts`, `handoffs`, `handoff_reviews` and `case_events`. Each case has workspace, accountable owner, explicit members, revision, overall envelope and execution epoch. Steps have assigned Buddy, completion criteria, input artifact versions, allowed operations, limits and a lifecycle. Dependency edges distinguish blocking input, review requirement and nonblocking related evidence; cycles are rejected transactionally.

An attempt references one existing `buddy_run`; the provider lifecycle remains in that run. A handoff references immutable artifact version, producer attempt, intended consumer step, delivery state and review outcome. Resource requirements reference configured resource IDs; actual leases have holder, expiration and fencing token. Conversation links remain transcript identities and are idempotent. Project records become compatibility work views mapped to steps, not a competing source of truth.

Avoid dual authority by selecting exactly one owner for each field. Cases own dependency admission and budget allocation; runs own provider claim/start/end; artifacts own versions; handoffs own review acceptance. Messages carry notifications and requests but do not independently advance step completion. Existing standalone Buddy projects continue to use their current semantics until explicitly imported.

## Public contract and execution

New MCP operations: `create_case`, `update_case` with revision and stable key, `assign_step`, `record_artifact`, `review_handoff`, `get_case` and `recover_step`. Compose creation and assignment in one preview/apply contract. Existing send remains for informal discussion and references a step when appropriate. Native case reads are paginated with optional events/artifacts; exact preview checks all actors, scopes, resource requests and return routes.

Case admission traverses satisfied dependencies, checks budgets/current authority and enqueues one existing Buddy run per eligible step. There is still one execution scheduler clock and one provider owner. A completed run does not complete a step unless criteria and required handoff reviews are satisfied. A failed attempt retains artifacts and effects; recover creates a successor attempt referencing a selected checkpoint. Case cancellation increments epoch, fences descendant operations and drains providers.

Use a transactional outbox for consumer notifications. Delivery retries never repeat producer work; acceptance keys deduplicate consumer input. A busy consumer queues its handoff. A deleted transcript produces an inspectable route-repair requirement; only an explicit controller action may select a new conversation. No automatic recreation of owner-deleted chats. Notifications do not acquire GPU resources or consume a work step's provider budget unless an explicit review step starts.

## Controller and access design

A case accountable owner may inspect every case step's coordination metadata, artifact manifests and reviews. Step owners may inspect their branches and required published inputs. Private memory and owner conversations are excluded. Membership is explicit and workspace checked. CEO/functional-lead oversight becomes case membership instead of inference through reporting relationships. Profile/document authority remains separately granted.

Each step stores its recovery controller at assignment: normally dispatching lead, inherited accountable owner as escalation. Identity survives continuation conversations. Transferring control requires a revisioned owner/supervisor action and retains historical controller attribution. A worker can register checkpoints and request recovery, not enlarge its own envelope. `recover_step` requires reason, failed attempt, selected artifact versions, inspected side-effect declaration and an unchanged execution epoch. Concurrent recoveries use a unique successor constraint.

Cross-team consultation is an explicit review step with declared consumer and inputs. Exact payload validation rejects unavailable consumers or incompatible project references before any run is created. Publication is explicit and narrower than private document access. A denied preview returns a supported route such as publishing to a shared case or asking its controller to relay; it never silently grants membership.

## State and limits

Step states are planned, ready, running, waiting_input, waiting_review, failed_recoverable, blocked, done and cancelled. These are case lifecycle states, separate from attempt queued/claimed/running/terminal states. The UI must show both. Old cancelled requests keep their old timeline and cannot acquire later acknowledgment. Case-wide success derives only from current required steps and accepted artifact versions.

Budgets are hierarchical allocations: case wall-clock envelope, per-step run/time allocation, per-attempt cap and configured resource limits. Requested and effective provider/model/effort are frozen at each admission; bespoke effort strings pass through. Unmetered token/cost budgets are explicitly unenforced. GPU exclusivity requires a registered executor checking lease fencing tokens, not a scheduling note. Parent waits do not hold a provider slot; waiting consumes the case/step wall-clock envelope. Recovery consumes remaining allocation and cannot reset it.

Ordinary standalone requests retain a 600-second default unless explicitly configured; case work must display and validate its cap. Automatic timeout uses `max_runtime_timeout`, preserving foreground chat's separate explicit application limit. Provider errors after admission do not auto-replay external effects. Checkpointing records artifact hashes/versions and side effects, and resumption prompts identify exactly what survived versus what remains unverified.

## UI, memory and discovery

Both shells share a case board and detail timeline via existing routes and state conventions. Rows show accountable controller, actual attempt, observed-at, deadline, resource lease, saved artifacts, waiting consumers and review disposition. Unknown heartbeats and costs display unknown. Chat links are real availability-checked Links. The UI must not claim a reservation is executing or a delivered notification is accepted work.

Memory is a derived summary of case decisions and accepted evidence with source revisions. Case status remains authoritative and is read fresh at each attempt. Contradiction detection compares summary refs with changed case/project revisions; a reviewer can append a superseding claim. Historical notes remain append-only. Inbox becomes an action list of pending handoffs and control decisions, with bounded descriptions and expandable evidence rather than repeated full projects.

## Migration, failure handling and rollback

Existing projects/messages remain usable. Import is explicit, previewed and idempotent: map one bounded project tree and its messages into a case, preserve all original IDs and mark unknown historical events as imported snapshots. Never start runs during import. Avoid migrating active attempts; wait for drain or retain them as read-only external attempts until completion. Old stopped roots remain stopped even if imported into a new active case.

Version case schema and public contract; publish package and host in lockstep. Rollback must stop new case admission and retain the schema for inspection. Imported projects cannot be freely edited by both systems: compatibility operations route through case services or are rejected with a precise remedy. Export case records and artifact manifests before destructive owner actions. Enqueue failures roll back case transition and outbox together; provider failures settle only their attempt and preserve step recovery state.

## Validation and decision criteria

Run the report's real-boundary acceptance scenarios plus dependency cycles, atomic import, ownership transfer during execution, competing recoveries, resource expiry/fencing, review of stale artifact versions, revocation and partial case rollback. Test two-worker aggregate handoff and one bounded live-provider case in an isolated repository. Preserve foreground deadline, deletion, privacy and provider continuity regressions. Load-test large case trees and mobile rendering without global conversation subscriptions.

This is the most explicit user workflow and could support repeatable organization-wide processes. It also adds a second work vocabulary, conversion rules, membership administration, dependency lifecycle and controller allocation. It conflicts with the current preference for ordinary projects/messages unless repeated case workflows clearly justify those costs. Choose it when users need reusable approval/dependency templates and real resource orchestration beyond what current primitives can represent; the Wave_sim evidence alone does not establish that need.
