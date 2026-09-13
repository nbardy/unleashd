# Buddy system design review — September 13, 2026

September 13 successor: the later [owner design](../LATEST_HUMAN_DESIGN.md) and
[single budgets and limits specification](../BUDGETS_AND_LIMITS.md) are the current
design entry points. This dated dossier preserves the earlier reasoning. The
[pending-handoff incorporation](../final-designs-2026-09-13/06-handoff-and-limits-successor.md)
adds the delivery evidence without treating the originally empty H3 as recovered.

Prepared by Buddies Development Lead at the owner's request to examine the overlapping
handoffs as one system-design problem. This dossier is a review and a set of proposals.
It does not replace the current operator contracts or record implementation completion.

The central question is: **how can a Buddy remain a dependable, addressable owner of work
while its conversations, execution processes, models and resource allocations change?**

The four substantive handoffs approach that question from different directions: owner
access, inexpensive delegation, workers that last for an assignment, and autonomous
continuation. Handoff 3 contains no material. Their common design problem is that several
independent things have become coupled: identity and process lifetime, conversation and
authority, background concurrency and owner access, task difficulty and budget exhaustion,
and result delivery and actual review.

## Reading paths

For the whole-system assessment, start with [06 — Meta synthesis](06-meta-synthesis.md).
It develops the shared model, tensions, alternatives, a complete example, and recommended
sequencing. For a faithful account of the supplied material, start with the intake.

| File | What it covers |
|---|---|
| [01 — Handoff inventory and history](01-handoff-inventory-and-history.md) | Every supplied thread, source strength, owner/proposal distinctions, historical changes and missing evidence |
| [02 — Foreground access and admission](02-foreground-access-and-admission.md) | Capacity incident, disappearing input, repeated failures, fairness, host limits, waiting semantics and repair boundaries |
| [03 — Delegation and execution profiles](03-delegation-and-execution-profiles.md) | Lead/worker model selection, compact handoffs, immutable configuration, provider continuity, review routing and cost tradeoffs |
| [04 — Assignment workers and continuity](04-assignment-workers-and-continuity.md) | Buddy versus task versus thread, memory and audience, sleep/wake/archive, staffing, follow-up, UI and lifecycle composition |
| [05 — Allowances and autonomous continuation](05-allowances-and-autonomous-continuation.md) | Provenance of limits, clocks and meters, renewal, accounting, manager authority, recovery, cancellation and progress checks |
| [06 — Meta synthesis](06-meta-synthesis.md) | Overlap matrix, common principles, incompatible assumptions, coherent target design, alternatives and reflection |
| [07 — Decision register and verification](07-decision-register-and-verification.md) | Proposed decision records, unresolved choices, issue index, behavioral scenarios and evidence needed before shipping |
| [08 — Source evidence](08-source-evidence.md) | Dated SHA-256 records and preserved source excerpts, including historical designs and inspected implementation seams |
| [Source manifest](source-manifest.json) | Machine-readable source metadata, literal excerpts, repository baseline and installed-package/archive comparison |

## How to interpret claims

**Owner direction reported in the handoffs** is distinguished from **assistant proposals**.
Resupplying a discussion for review does not ratify every suggestion in it. **Current
contract** means the inspected local documentation/schema; **source observation** means
the inspected code; **historical result** means an earlier report; **live observation**
requires a contemporaneous native receipt or directly observed execution. These categories
are deliberately not interchangeable.

Sources S01–S37 are pinned in the evidence appendix with full-file hashes and literal
excerpts. The local checkout contains extensive pre-existing changes, so repository HEAD
alone cannot reproduce it. The 26 installed package files matched the current vendor archive
at evidence capture. That is disk parity, not proof that an existing backend loaded them.

This review makes no new model-price, benchmark, dollar-metering, production-recovery or
staffing claims. Astra, Terra and Luna are the model examples from the supplied discussions;
their suitability and relative cost must be evaluated against actual permitted execution
and measured work. Proposed API shapes are explicitly marked and are not copy/paste native
tool contracts.

[Documentation verification](review-verification.json) records file hashes, word counts,
link/anchor checks and source-drift reconciliation. S37 preserves a concurrent memory-guide
update observed during the final pass; the earlier S04 snapshot remains intact.

The files are intentionally substantial: the detailed notes preserve the reasoning behind
each concern, while the synthesis connects them. Operational ownership, status and next
actions remain in native projects. Future decisions should append a dated successor to this
review with evidence, rather than silently rewriting the history here.
