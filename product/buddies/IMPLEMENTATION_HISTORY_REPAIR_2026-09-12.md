# Buddy history repair — 2026-09-12

The repeated loss of earlier messages has a reproduced cause and a code repair. When a Buddy starts a new native provider session, the old loader replaced the whole application's displayed transcript and creation date with the newest session. Durable bindings and the older native files remained intact.

This is a dated successor to [the full audit](AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md), specifically findings A1 and A3. The audit's original observations remain unchanged. Authoritative repair work is project `buddy_project_f5e8e43a-9c69-4dd2-82d1-c6c953e3549b`; this document records evidence and decisions, not a separate task system.

## Exact conversation evidence

The owner thread is `7d9d117f-7a13-46e2-bf6a-95da591d6e2b`. Its durable creation time is `2026-09-09T04:45:02.313Z`. At the final isolated verification, its five bound Codex files contained **1,267 normalized message/tool rows**; the current native session alone contained **121**. The repaired loader recovered all 1,267 rows, the original application ID and creation date, and the original five-defect review. Its current execution session remained `01a094f0-3f6b-7272-b86b-4b7d6db7a900`.

Both startup orders passed with `startupLimit: 1`: selecting the newest session and selecting the original session. The loader expanded only the selected conversation's durable bindings through the registered Codex adapter. Production config and transcripts were read-only; temporary copies were removed. Counts include tool rows, not just chat turns. An earlier snapshot restored 1,261 rows; subsequent rows came from the continuing turn.

The original 60,237,815-byte transcript still hashes to `100c1bf32e4074352dd4a2837424ebf3ab399e163dd99a387f6441bbb4e270a4`. Its original five-bug review remains at the previously audited native line 8051. The earlier audit preserved the bounded excerpt. [Exact source paths, hashes, counts and reconstruction results](history-repair-2026-09-12/real-history-verification.json).

## Implementation

- [Session loading](../../server/src/lifecycle/session-loader.ts) projects display history from all available durable session bindings. The current session alone controls execution metadata. App-created conversations retain their durable birth date; imported sidecars use the original transcript date. Missing-current recovery can show historical files without resuming an obsolete session.
- [Adapter discovery](../../server/src/adapters/loader.ts) includes bound siblings outside the initial native-file cap using the existing discovery pass, normalized cache, filters and shared parse-byte budget. Provider-specific filename hints only select candidates; parsed provider and full session ID establish identity.
- [Message composition](../../server/src/lifecycle/session-history.ts) reconciles native turns with live rows, retains unmatched history when files are missing, deduplicates inherited rows using occurrence counts, and preserves event order within each source. It retains host-only notices and completed live answers when a native flush contains only the user row.
- [Polling](../../server/src/lifecycle/file-poller.ts) retains parsed updates if a turn becomes active after parsing or during asynchronous application. The newest update wins and an idle application consumes it once. All known bound sessions participate in the active-runtime guard.
- Buddy package commit `234ff0f681d3f8ede511f048f74d632f23a3f49d` replaces overly broad continuity-key inputs with effective disclosure authority. Peer scheduling changes and unrelated workspace relationships no longer force new sessions. Read-access narrowing, publication retractions, grant revocation/expiry and inherited-access loss still invalidate reuse.

The package was committed in the isolated package worktree, reproducibly packed, and installed locally. Archive SHA-256: `2cbb98805d5281fa08d7a5d07bcb8599f0773c38f0fe11aa10bc87099cde07ba`; installed `knowledge.js`: `157b068a5ff8bed9964a41b55ffa0e6e39ed1262d5ca338797832baa2e4d43e0`. No package push or outer repository commit was made.

## Verification

- **329 server tests passed; 3 existing opt-in live tests skipped.** Includes rotation → poll → reload, native file discovery, inherited duplicates, missing middle/current files, startup cap, birth-date semantics, active-runtime races, and provider input isolation.
- **76 client tests passed**, shared/server/client `tsc -b` passed, all six client invariant gates passed, and the client production build passed.
- **91 package tests passed** in the isolated package worktree. The original key implementation failed three new regression cases; the repaired implementation passed them.
- A real application runtime with an isolated Buddy store and controlled provider retained the same native session through unchanged input, a peer scheduler pause, and a foreign-workspace relationship change. [Requests and audience-key equality evidence](history-repair-2026-09-12/continuity-verification.json).
- The clean-install compiled-package/plain-Node server smoke passed. The initial normal smoke invocation stopped at the existing development supervisor lock before running tests. We built the artifacts explicitly and reran the smoke with `npm_config_ignore_scripts=true`, avoiding its redundant prepack build. The active development runtime was preserved. Both results are retained.

[Check commands and raw logs](history-repair-2026-09-12/README.md), [final source hashes and preserved code excerpts](history-repair-2026-09-12/repair-manifest.json).

## Decision record

Date: 2026-09-12. Owner decision: explicitly requested the history fix after the audit and required disk notes. Implementation decision-maker: Buddies Development Lead, with independent acceptance, adapter and continuity reviewers. The owner authorized the repair; the implementation details below are assistant engineering choices, not a separate claimed owner architecture decision.

Chosen: reconstruct the application's display from its existing durable bindings and native artifacts, retaining the current session as execution authority. Reuse the adapter/cache boundary instead of inventing another transcript store. Keep display restoration separate from provider admission. The existing resource-consolidation direction remains in place.

Alternatives rejected: removing audience invalidation would admit old private context after authority changes; replaying the combined display transcript would disclose it to a fresh provider; relying on only the latest native file reproduces the incident; uncapping all startup imports defeats the existing bounded-loading design. A new durable canonical message ledger was not required to recover the retained evidence.

Tradeoffs: historical files consume bounded additional parsing work. Native rows lack universal message IDs, so matching live/native turns uses ordered equal user content and a five-minute timestamp allowance. Ambiguous/unmatched rows are retained conservatively, which can display duplicates rather than silently discard distinct history. Contradictory source ordering retains every row with deterministic fallback order. New effective readable-project sets can conservatively rotate the provider; unrelated scheduling/topology changes no longer do.

Revisit if native files cease to be retained, distinct repeated prompts cannot be reconciled acceptably, shared conversation audiences require a different display-access model, or a verified native-checkpoint mechanism is implemented for safe continuity across backend restarts. A saved audience-key string alone is insufficient to prove an externally mutable native transcript is safe to resume.

Historical evidence: original audit SHA-256 `4b7394a26f52901f2cc78a389e91e59b2647749b24940ffe31611ccfe4b35b4e`; prior correction note `knowledge_6abd482c-a7ca-43da-a4a9-72c45dc63b7b`; final audit handoff `knowledge_b54e0bef-a468-4b79-9962-d909d2889c04`. Uncommitted source evidence is identified by dated hashes and excerpts in the repair manifest. A parallel owner conversation independently reproduced the same defect; its compatible regression and runtime reset logging were preserved, as documented in [its incident record](../../docs/incident-2026-09-12-buddy-history-loss.md).

## Delivery boundary and remaining audit findings

The source, compiled server, installed package and isolated real-transcript reconstruction are verified. The running development server still served the old projection at `2026-09-12T10:02:36Z`: this conversation was active, had 77 live rows, and reported the latest session's September 12 date. That is a pre-reload observation, not evidence of a failure in the new code. The existing watcher reloads after active operations finish; no forced restart interrupted this or the parallel owner turn. Live post-reload adoption must be observed separately. [Pre-reload evidence](history-repair-2026-09-12/live-before-reload.json).

A1 and A3 have implementation and regression evidence. The other audited findings remain separately tracked: A2 private capability-readiness receipts, A4 provisional delete/link race, A5 note-size mismatch, A6 regex contract mismatch and A7 stale send/wait documentation. This history repair does not claim to have closed them or verified production team activation.
