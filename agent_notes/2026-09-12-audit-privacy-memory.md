# Independent privacy and memory audit — 2026-09-12

The September 12 repairs are present in current source and the installed package. The original R1 message-detail/inbox leak, R2 competing memory heads, and R3 ordinary-learning session resets have desired-behavior regression coverage that passes now. **Three adjacent defects remain: a private execution disclosure through capabilities, unrelated changes that still reset provider continuity, and inconsistent note-size enforcement.** No application/package source, production data, employee work records or team configuration changed in this audit.

This is an independent assistant finding and repair recommendation, not an owner design decision or an authoritative project-status update. It succeeds the September 11 review (SHA-256 `ae10cedce4bfbab0e202c44987864bda09697a4821fb6f0a86d424e2e8c9733c`) and narrows the completeness claim in the September 12 implementation report (SHA-256 `311152c5aa3823a9c60af8412a89455fee47967f6100fbfd12b2fb408de98ba6`). The accepted resource-consolidation design can remain; the fixes below complete existing boundaries rather than adding another coordinator.

## Current source and package identity

- Unleashd HEAD was `1187a8b6660b95c0c60bd8fada105f015b98cc39`, with the existing extensive mixed working tree. HEAD alone does not identify reviewed files.
- Installed package source commit is `135aafa6ecfbf26dd17c269e2818d5db80c2f15a`, from the clean worktree `/Users/nicholasbardy/git/.codex-worktrees/buddies/resource-repair-20260912`. The ordinary `~/git/buddies` checkout is older and dirty and was not used for acceptance tests.
- Archive SHA-256 is `54fc8e53846dbc1fb66f101ecbc963c8dee9e442b89cbb1b797a2a88f4c9059a`. All **25** archive files were byte-for-byte SHA-256 equivalent to both the installed package and the repair worktree. [Equivalence evidence](../product/buddies/audit-2026-09-12/package-equivalence.json).
- File hashes and preserved numbered excerpts are in [privacy.evidence.json](../product/buddies/audit-2026-09-12/privacy.evidence.json). Line citations below were read against individual files, not recursive search output.

## Repaired original sequences

| Historical defect | Current evidence | Assessment |
|---|---|---|
| R1: project association makes private addressed message readable in unrelated team turn | `operations.ts:1891` uses one current-root/publication predicate; `:1912` requires `visibility === 'project'` outside the actual request root; detail checks it at `:811`, inbox at `:1938`, run projection at `:847`. | Original detail/inbox sequence fixed. Separate capabilities leak below remains. |
| R2: reviewer creates a blank scoped head and hides inherited owner memory; ordinary tools cannot find reviewer notes | Package `knowledge.js:76` atomically reads/initializes authorized owner memory. Composer `integration.ts:222`, reviewer `memory-review.ts:263`, document dispatch `operations.ts:569`, scoped HTTP Memory `routes.ts:965`, and scoped recall share these resources. | Original loss-of-effective-context sequence fixed, including scoped UI CAS and note discovery. Global compatibility APIs intentionally remain separate and reject team use. |
| R3: ordinary compact-memory/note learning resets an unchanged audience | Package `knowledge.js:154` derives retractions from immutable revisions; normal employee compact learning is omitted. Existing test performs actual reviewer write plus note, preserves prior preference, resolves matching document content, finds the note, and asserts unchanged audience key. Package test verifies public additions preserve keys and public retractions change them. | Original ordinary-learning trigger fixed. Unrelated metadata/topology changes still reset continuity, below. |

The relevant current source hashes are: `operations.ts` = `b42f90303563eb0aaaaf6cd8509204c6db930d6e2b89361365c3b9811d64dda4`; `knowledge.ts` = `010740aefb612d451f0204a50a235e7864627d6ba203df1553cbda66051fbb20`; `integration.ts` = `e93867fa7d9c5eaca4fd05570b6673fe9675380e1927b958c8b1a7d888272a15`; `memory-review.ts` = `54bd4c8435513d97d8a648acaf8eda07c61d72db149c8191808e323150de1606`; `routes.ts` = `4c9d404e3e5097e45eced1adae23403c145f832143f177dfaba9e8516923b97f`; installed package `knowledge.js` = `d4e4ca1fbc3ac952d25b4bd1ea216435a29f311079e95913fcbe48f7ea07590a`.

## P1 — capabilities bypasses the message audience predicate

**Confidence: high; reproduced through actual native MCP with an isolated store.**

`get_capabilities({messageIds:[privateMessageId]})` reveals a private request's execution error to a different team turn of the same Buddy. The same context is denied by `get_message` and receives a redacted `get_runs` result. The capabilities result also identifies the private execution conversation.

`team-readiness.ts:78` checks persistent participants/project readership and `:96` checks workspace, but neither checks the active knowledge audience or request root. At `:127` it projects `messageExecution`. The private `run.error` is included by package `team-access.js:276`. MCP `mcp-server.ts:312` calls `compactCapabilities`, whose `resources.ts:117` preserves the full readiness messages. The missing filter is therefore exposed through the public native tool, not merely an internal return value.

Reproduction: create a participant-private lead → worker request; finish its isolated run as failed with `PRIVATE_READINESS_FAILURE_CANARY`; invoke all three reads in an unrelated delegated workspace turn of the worker. Observations:

```json
{"getMessageDenied":true,"getRunsRedacted":true,"nativeMcpAlsoLeaks":true}
```

The native response includes `readiness.messages[0].execution.error = "PRIVATE_READINESS_FAILURE_CANARY"` and `conversationId = "private-request-thread"`. This proves cross-audience disclosure within a participant identity; it does not prove arbitrary unrelated identities can read every private message. A known message ID is sufficient. Run-list metadata can supply IDs in the tested context.

Recommendation: move the active message-audience predicate to one reusable service and apply it before readiness collects message receipts, targets, blocker details and return-path data. Reuse it for detail/inbox/runs; preserve allowed actual-root and explicitly published access. Add a native MCP regression comparing all four projections in one fixture. The predicate must govern the entire receipt, not just redact one error field.

Reviewed `team-readiness.ts` SHA-256: `61efb77033198a27fe742fa6d9c47d72cfb26bf6f5a3f10d3c8c0f29f540c866`. `mcp-server.ts`: `bfb51f72dc0c8f78933f33a094cddeb6dd9b368e2f474fd937569b34d5e118a9`. `resources.ts`: `20cd8a63837f51f090dc74ec0e2906d048846bfa4e854e65773411a8530c92cd`.

## P2 — unrelated settings and relationship changes still reset provider continuity

**Confidence: high; independently reproduced through both composer/key and real conversation runtime.**

Installed `knowledge.js:149` selects `*` from every workspace membership. `:160` hashes all those complete rows and the **entire global relationship table**. Therefore changes unrelated to this conversation's readable content alter its key:

1. Set a peer Buddy's `background_paused_reason` to `Hourly run limit reached` in the current workspace. This is an execution/admission status, not a disclosure change. The real scheduler writes that condition at package `coordination.js:497`.
2. Add a manager relationship between two other Buddies who belong only to a completely separate workspace.

Each changes the current owner's key. Runtime `runtime.ts:2111` resets a previously started session when that key changes. The history-audit agent independently extended both cases through four real-runtime turns: first turn fresh; unchanged follow-up resumed `native-0`; peer pause next turn fresh; foreign-workspace relationship next turn fresh. [Runtime diagnostic](../product/buddies/audit-2026-09-12/history-unrelated-key-reset.observed.ts), [observed result](../product/buddies/audit-2026-09-12/history-unrelated-key-reset.result.json).

This can still interrupt ordinary follow-up context during normal team operation even though memory writes themselves no longer do. How a provider answers without its previous session is not measured here. The separately audited loader replacement bug explains why a newly rotated session can also overwrite visible history; that is a distinct repair.

Recommendation: derive the continuity key from this actor's effective disclosure authority, including relevant transitive access, scoped publication retractions and identity boundaries. Exclude execution counters, scheduling pause reasons and relationships that cannot change this actor's audience. Keep explicit narrowing/unpublication tests. Do not remove resets wholesale: restored unknown sessions and genuine privacy changes still require safe invalidation.

`runtime.ts` SHA-256: `8b8912b1f15aae6d3a76563d4499b0845df3f6083c2f06dc6062873e07f9269b`. Package `coordination.js`: `27d92bc29959d5a672affc7996f086b041d2e5f9e85c1e5a3f82b96f8c94cbc9`.

## P3 — document-note creation bypasses the common body-byte bound

**Confidence: high; reproduced through actual document/operation boundary. Impact is contract/resource-bound inconsistency, not a privacy bypass.**

`remember_note` rejects a 6,000-character Chinese string because it occupies **18,000 UTF-8 bytes**; `operations.ts:222` enforces the exported 16,000-byte note body cap. The identical body is accepted by `update_document` with `kind:'note'`: shared schema `buddy-resources.ts:42` permits 32,000 characters, and package `knowledge.js:104` uses the generic 32,000-character fallback because notes have no entry in `MEMORY_DOCUMENT_CAPS`.

A subsequent attempt to replace that existing note with a new command/revision correctly fails with `Notes are append-only; use a new name` (`knowledge.js:110`), and the original content remains unchanged. **The public note resource is not mutable.** This directly checks the parent's append-only question rather than inferring mutability from the name `update_document`.

Recommendation: put the note-specific body-byte validation at the canonical ledger boundary, and keep both document-resource and remember-note representations consistent about body versus metadata limits. Existing append-only validation should remain. Either explicitly document a separate generic document-note contract or enforce the existing shared note cap; silently varying the bound by entry point is the defect.

Shared resource schema SHA-256: `2aa546d4e73c904552f80810e9315d3244f2ef927e8e7dc396733ba0019dbada`. Memory contract SHA-256: `f0027ddf595f01b5bfd41a28f63dac5e65d1a39aaa1c902508c489f2404c0a6d`.

## Validation and limits

- `pnpm exec tsx --test server/test/buddy-resource-consistency.test.ts server/test/buddy-knowledge-context.test.ts server/test/buddy-memory-review.test.ts`: **12 passed, 0 failed, 1 opt-in live skipped**. [Log](../product/buddies/audit-2026-09-12/privacy-acceptance.result.log).
- `node --test` in the verified clean package repair worktree: **87 passed, 0 failed, 0 skipped**. [Log](../product/buddies/audit-2026-09-12/package-full-tests.result.log).
- `pnpm exec tsx --test product/buddies/audit-2026-09-12/privacy-adjacent.observed.ts`: **4 observed-behavior diagnostics passed**. [Diagnostic](../product/buddies/audit-2026-09-12/privacy-adjacent.observed.ts), [result](../product/buddies/audit-2026-09-12/privacy-adjacent.result.log). These deliberately assert the defects and the append-only negative control; they are historical audit evidence, not desired-behavior acceptance tests.
- All stores were isolated in-memory fixtures; the normal test suite uses temporary directories where needed. No paid provider call or production acceptance run was made. Package-file equivalence proves installed bytes, not that an already-running long-lived server has reloaded them.
- No web evidence was needed: the conclusions concern local, directly inspected code and executable fixtures. `RTK.md` was absent at the repo root; the supplied AGENTS rules and linked architecture, memory and testing documents were read.

Full artifacts also remain in `/tmp/unleashd-audit-20260912/privacy`. The report preserves findings, evidence and recommendations; authoritative work state remains with the parent Buddy's project records.
