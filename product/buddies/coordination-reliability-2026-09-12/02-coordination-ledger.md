# Design 2: An append-only coordination ledger

September 12, 2026. Author: Buddies Development Lead. Status: candidate. Evidence and exact baseline versions are in `source-manifest.json` and `sources/`. This alternative independently covers the Wave_sim incident; it is not an accepted replacement for prior resource consolidation.

## Objective and product experience

Make every assignment explainable as an event sequence: requested, admitted, input accepted, artifact checkpointed, provider ended, reply stored, delivery attempted, delivery accepted, review recorded. The timeline separates durable facts from current projections. Managers filter by team, root request, artifact consumer or changed-since cursor. Cancelled September 10 work stays cancelled beside a separate September 12 project-success event. A recoverable artifact remains visible under its originating failed attempt.

Wave_sim's report establishes four duplicate conversation-link errors, repeated 600-second expiries, descendant inspection denials, mixed-age receipt fields and stale memory. It does not establish universal failure, completed simulation physics or which binary ran. Baseline source independently shows insert-only linking, project-joined acknowledgment and root-only controller checks. These require fixes even if a ledger is added.

## Authorities and data model

Introduce `coordination_events` with immutable event ID, workspace, stream ID, monotonic stream sequence, event type, source Buddy, trusted source run, actor kind, occurred-at, recorded-at, causation ID, correlation root, audience and versioned payload. A unique `(stream_id, sequence)` and command receipt protects ordering. Use a transaction to append each event and mutate the established message/run/project authority together. Do not initially rebuild every table from events: imported history contains gaps that cannot be safely synthesized.

Introduce delivery records keyed by `(source_event_id, consumer_id, channel)`, with append-only attempts and leased dispatch. Add artifact manifests with immutable version/digest/location and producer attempt; handoffs reference artifact versions and intended consumer. Reviews reference the precise handoff/version, outcome and unmet requirement. A resource lease stream can later express request, granted lease, heartbeat, release and expiry for a configured GPU resource.

Current tables remain materialized operational state during transition. The ledger is the provenance authority only for events recorded after rollout. Existing fields are backfilled as `legacy_snapshot` with observation time and unknown event time; a snapshot never becomes proof that an old request was acknowledged. New projections use event identity, never timestamp heuristics.

## Writes, concurrency and return delivery

Canonical resource services append events inside their existing SQLite transaction. The execution service still owns providers, deadlines and drain. Creation remains inert and links idempotently by conversation ID. A durable outbox entry is inserted atomically with reply persistence; an idempotent dispatcher accepts one input by event key. An acknowledgment event records acceptance into the consumer's runtime, while provider completion and consumer review remain separate.

At-least-once delivery with unique consumer acceptance gives one effective input admission. A crash after acceptance but before outbox acknowledgment is resolved through the acceptance key. Never claim exactly-once arbitrary external effects. Classify errors as retryable before admission, unknown after admission, or permanent. Retryable deliveries use capped exponential backoff; unknown effects require a recovery decision. Failure notices themselves use the outbox but cannot recursively generate unlimited notices. An independent undelivered view exposes them.

FIFO by consumer stream preserves order; a bounded round-robin dispatcher prevents one busy conversation from blocking other streams. Backpressure caps pending events/deliveries per workspace and returns precise retry-after evidence. Observers have bounded cursors over authorized event streams and see gaps only as unavailable entries, never leaked private payloads.

## MCP and owner API

Keep existing write tools as commands to canonical services. Add `observe_coordination({rootMessageId, cursor, limit})`, `record_checkpoint`, `inspect_recovery`, `recover`, and `review_handoff`. Exact-payload `preview_send` uses the same command validation and reports route plus effective limits. Native subscriptions are optional later; normal pull reads remain sufficient and avoid creating a second WebSocket bridge.

`recover` references the failed attempt and checkpoint, requires stable command key/reason and explicitly declares whether it retries delivery or continues producer execution. It never accepts an arbitrary actor ID or source-run claim. Existing `retry_run` becomes a compatibility adapter. Owner HTTP uses the same services with authenticated owner context. Tool descriptions, schemas and implementation must be released together and capability discovery must state the ledger version.

## Authorization and recovery contract

Audience is attached at event creation. Metadata visibility follows authorized work/root participation and declared observation grants. A CEO gets causal-tree metadata for requests it originated; direct senders get their branch. Private owner-thread payloads, memory and transcripts stay private. Cross-team publication emits a new explicit shared artifact event; possession of an artifact URL grants no work mutation rights. Revocation hides future reads and invalidates active operations without deleting history.

Controller identity is the original sender of the failed input, plus root requester and explicit authenticated owner. A child sender can resume its branch across conversations while current project audience and supervision still hold. Recoveries run compare-and-swap against the latest attempt and chain budget. One winner may enqueue a successor; repeat keys return the same receipt. Stopped roots and cancelled projects remain fenced. Recovery cannot erase a failure event, refund elapsed time, increment allowed runs or widen immutable policy.

## Effective limits and configuration

Record requested model/provider/effort and the resolved execution snapshot. The host validates provider-specific strings without translating values. Per-assignment overrides, if added, are explicit immutable commands constrained by owner policy; prose requests never change routing. Attempts record chain envelope, turn cap, inherited restrictions, actual deadline and limiting source. A deadline event reports `max_runtime_timeout`, not user stop.

Parent waiting releases execution slots but consumes wall-clock envelope. Child envelopes are independent bounds constrained by parent cancellation and explicit root policy. A timeout checkpoint is evidence, not permission to repeat effects. Usage events carry provider-reported token/cost values with meter provenance; absent meters are unknown and unenforced. GPU lease grants must be issued by a single configured resource authority and enforce fencing tokens at the executor boundary; a planned reservation is never a held lease.

## Team UI and memory

One shared timeline/team component serves both shells. Summary cards show current project status, most recent run, saved artifact count, pending consumers, effective limits and recovery owner. Expansions expose source revision/event ID and event-time/observation-time distinction. Conversation links are availability checked. Unknown fields render as unknown. Large artifact bodies load on demand through an authorized resource, not in inbox summaries.

Memory maintenance subscribes to accepted work/review events and writes a revision-checked synthesis with event refs. Contradictions are presented as claims superseded by newer authoritative evidence; historical decisions are retained. Model summarization can fail without blocking coordination. The context block always points to fresh project/run reads for current status. No event payload becomes an instruction or grants authority.

## Migration and deployment

Add tables/indexes without deleting existing data. Start dual writing in the canonical service, compare projections against current reads, then switch observation tools/UI. Historical rows are explicitly labeled snapshots. Export baseline hashes and migration receipts. Deploy package and host together under a new contract version. Keep old reads available for one transition period with corrected attribution. Rollback disables ledger reads but preserves all events; never replay all old events into production execution.

A safe dispatcher restart reclaims only expired delivery leases whose acceptance state is known. Provider ownership remains with the original process until drain; the ledger cannot adopt detached providers. Disk failures roll back message and outbox together. A large event table requires indexes, retention/export policy and bounded queries; workspace deletion needs an explicit historical retention decision.

## Acceptance and assessment

Test command duplication/concurrent append, crash at every persistence/acceptance edge, two-worker aggregate return, busy consumer, timeout checkpoint recovery, cancelled old request versus later success, cross-team artifact publication/review, revocation, pagination and changed-since cursor isolation. Include real conversation creation and a bounded live-provider round trip. Test backup/restore and migration from populated pre-ledger data; use production-sized fixtures for query cost.

The ledger gives the strongest provenance and future incremental observation. It introduces durable event contracts, dual-write reconciliation, outbox acceptance state, migration unknowns and eventual UI consistency. It still must repair all original boundaries. Choose it when event replay/subscriptions or formal resource leases are near-term funded requirements; otherwise its additional operational burden delays the concrete delivery fixes.
