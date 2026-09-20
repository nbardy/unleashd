# Buddy identity and soul editing review — 2026-09-08

## What the trace establishes

The original hire is Muse session
`~/.local/share/muse/sessions/2026/09/07/01a079f0-792d-7a63-9609-6d6707ed3535/session.jsonl`.
Sequence 179 calls `create_buddy` with the detailed production brief in `role`;
sequence 191 returns `soul_path: null`; sequence 203 declares the hire complete.
Sequence 966 recognizes the missing soul and asks again whether to draft it.
The role already retained substantial intent; claiming none of the brief was
encoded anywhere overstated the failure.

The quoted follow-up did useful source inspection, then mixed three different
claims: what tools existed, what the product ought to allow, and what the owner
had authorized. “No soul MCP exists” did not imply “a soul MCP must never exist.”
Owner-directed identity editing is a legitimate capability. Proposals discovered
in untrusted content and actual changes to permission grants are separate cases.
The unsupported initial claim that the creation session was inaccessible, and the
inconsistent UI claims, should have been replaced with bounded searches before
assertions. Repeated offers to do the already-requested work prolonged the gap.

Do not infer an exact model-level cause from this trace. The briefing was injected
into first-turn user content; the provider's higher-priority instructions and
model behavior can also influence self-identification. Empty soul text alone does
not prove why Muse led with its harness.

## State had already changed

Commit `84d7012` (2026-09-07 20:22 +0800) added Builder-drafted soul persistence and
an owner HTTP write path. This review builds on that work. The live Animal Fights
Lead already had a revision-1 soul, but its identity paragraph hardcoded Muse.
The CLI `buddy update --soul` sets a file pointer; the current store reads soul
content from a revision ledger. A pointer/file edit is not a reliable replacement
for a revision write after initialization.

## Changes from this review

- All Buddy briefings lead with the persistent name. Provider/model details must
  come from current runtime evidence. Soul/name/role content participates in the
  conversation fingerprint to prevent stale identity inheritance on fresh forks.
- Builder creation requires non-empty soul text and preserves the detailed brief
  there, rather than using an overloaded role field. Builder soul tools refine
  only hires belonging to that Builder conversation.
- `get_soul` and `update_soul` let direct owner chats read and revise their own
  soul. A full replacement, current `baseVersion`, and reason are required.
  Delegated, operation-restricted and automated contexts cannot update souls.
- GET/PUT soul routes and the shared desktop/mobile inline editor use the same
  versioned contract. Stale writes return 409 plus current content/revision;
  the server never substitutes its own latest revision for the caller's base.
  Existing file paths are preserved. Revisions commit before file projection.
- Animal Fights Lead now has revision 2, with the original work principles and
  a provider-independent identity. The store readback and file projection agree.

Soul text remains behavior guidance. It does not create application tool grants,
headcount, budgets or approvals. In a normal chat, recognizing owner intent still
relies on the model following its instructions; this is not a cryptographic
approval mechanism or proof of resistance to prompt injection. The platform must
enforce operational capabilities independently of prose. MCP likewise locates
resource authorization at the transport/server boundary:
https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx

## Verification and remaining limits

The initial verification passed 70 Buddy tests, four client memory tests, server
and client typechecks, and all six client invariant gates. Coverage includes MCP
persistence, restart, missing-soul initialization, stale-write protection for the
file projection, scope restrictions, Builder follow-ups and identity fingerprint
changes. Chrome checks also verified desktop and mobile saves, and a concurrent edit
returned a conflict while retaining the local draft. QA used an isolated temporary
database, not the live Buddy store. Screenshots are `/tmp/unleashd-soul-desktop.png`
and `/tmp/unleashd-soul-mobile.png`.

No paid/live model evaluation was run, so these checks establish the application
contract, not a measured introduction-success rate across providers. Existing
conversations retain their original injected snapshot; `get_soul` reads current
state, and fresh conversations receive the latest persisted identity. Source
changes are local; no production restart, commit or push was performed.

Other work was already in progress in this checkout, including memory/coordination
cleanup and team hiring. This review preserves those edits rather than treating
the entire git diff as its own contribution.

## Concurrent package reconciliation

A later team-hiring package replacement temporarily removed the previously
installed memory, messaging and team APIs; a repeat run reported 49/70 passing.
The older complete implementation was recovered from the local pnpm cache and
three-way merged against `buddies` commit `4e4090d`, preserving the newer export
check (`8426319`) and current team-hiring changes. This restored canonical source,
not just a patched node_modules copy. Pre-merge sources and merge evidence are
retained under `/tmp/buddies-package-reconcile`.

Both independent branches had used schema version 18 for different tables:
`buddy_messages` versus `buddy_builder_hires`. Version 19 creates any missing
members of both sets and copies the legacy single-hire entries. Regression tests
exercise each version-18 shape and retain the existing Buddy. Current-head locked
file materialization and the newer export-check helper are both preserved.
The package was rebuilt as a non-release local snapshot; no package was published.

Final verification after reconciliation: all 70 application Buddy tests and all
53 canonical package tests pass, including export checks and both schema shapes.
Server and client typechecks pass after refreshing the shared declarations.
The package's legacy CLI/automation tests now use the current note operation;
retired compaction checks are superseded by the existing memory-v2 migration,
source-retention and concurrent CAS coverage. The four client memory tests and
six UI invariant gates also passed. No live model generation was invoked.
