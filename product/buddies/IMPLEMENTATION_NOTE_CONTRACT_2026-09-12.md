# Note bounds and native contract repair — 2026-09-12

Successor to A5–A7 in `AUDIT_HISTORY_AND_RESOURCES_2026-09-12.md` and the readiness
review, preserved at baseline `4c6835b53190a64650c8948ac67f7fd6badbf1ed`.
The owner authorized continued development and commits. The choices below are
Development Lead implementation decisions within that scope.

**A5:** preserve the existing 16,000 UTF-8 byte body bound. Apply it in the common
scoped resource service to note-document preview/apply and scoped evidence-note
creation. Owner resources, HTTP document writes and employee tools already use
that service; the reviewer uses its scoped-note path. The package's exported
limit remains the single numeric source. A raw note document treats all content
as its body. An evidence note checks `input.body` before adding its metadata
envelope, preserving valid exact-limit inputs. Existing notes remain append-only.
This closes application resource paths; it does not introduce a new generic
storage-envelope limit in the underlying package API.

Why: character counts admit oversized multilingual notes. Counting the serialized
evidence envelope instead would reject existing valid bodies based on JSON
escaping or metadata length. Revisit envelope limits separately if measured
storage growth warrants them; that is a different contract from the body bound.

**A6:** native resource MCP advertises literal-only recall and removes its
unsupported `regex` field. Reject an explicit unsupported field at schema
validation. Keep the existing compatibility catalog/service behavior intact.
Why: scoped search intentionally supports literal matching; implementing a regex
engine would expand the contract just to match a stale advertisement. Revisit
only for an evidenced retrieval need with bounded execution semantics.

**A7:** the living coordination guide now matches `SendBuddyResourceSchema`:
stable key, `inform`/`request`/`work` delivery, durable receipts, host-bound return
identity, bounded managed continuation and grant-checked team operations. It
preserves the historical synchronous-wait source at the baseline commit and
links the older decision note. This documents implemented behavior, not a new
owner permission or architecture decision.

Evidence: both new native boundary tests failed before the repair and pass after.
Tests cover 18,000-byte Unicode rejection through employee preview/apply, owner
preview/apply and scoped reviewer-note creation; unchanged revision on rejection;
16,000-byte acceptance through both note creation paths; append-only rejection;
literal regex metacharacters and `listTools`/`callTool` agreement. The combined
note/resource/reviewer set passes 15 tests, with one opt-in live test skipped.
The coordination examples are parsed against the actual shared send schema.
Final combined validation: 345 server cases, 342 pass, 3 opt-in skips and no
failures; server TypeScript check and `git diff --check` pass.
No package vendoring or production settings changed for A5–A7. Native project
records retain current status and deployment acceptance remains separate.
