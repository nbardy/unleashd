# Memory use after a fresh session

Prepared on September 13, 2026 while closing the memory-curation discussion.
This is an **unevaluated fixture pack**, not an implemented runner or a new score.
The existing [curation benchmark](../memory-curation/README.md) remains unchanged.

| File | Use |
|---|---|
| [Histories](histories-2026-09-13.json) | Six synthetic histories, initial compact memory and optional same-audience notes |
| [Probes and rubrics](probes-2026-09-13.json) | Future reader questions and source-backed grading criteria |
| [Preservation record](../../../../docs/benchmarks/memory-curation/2026-09-13-closeout/README.md) | Rationale, private corpus boundaries and evidence integrity |

All six histories are development/regression material. They were written after
examining the original ten cases and this thread's lessons. Changed names and
numbers do not make them held-out data. Their labels K–P avoid reusing the
existing A–J identities; the current curation runner does not load these files.

The cases exercise qualified acceptance and comparative wording, source versus
loaded production provenance, stale memory versus a later repair report, enduring
numerical owner policy versus an assistant's temporary task allowance, applying
a preference with its rationale and reconsideration condition, and stable no-op
behavior with an existing evidence note. Case N is a counterexample to blanket
removal of numerical limits. Its kiln ceiling is invented fixture data, not real
equipment guidance.

## Proposed execution contract

Before building the runner, freeze the input files and rubrics and record their
hashes. These are design choices for a pilot, not a production memory change.

1. Create a disposable canonical store in a single synthetic authorized audience.
   Seed the stated initial documents and notes. Use the actual returned note refs,
   maintaining an adapter mapping from fixture note names; never invent a native
   path. Replay message sequences through successful-turn review boundaries.
2. Wait for each terminal receipt and committed memory revisions. Persist and
   reload the store. Record partial writes, missing results and infrastructure
   errors separately; source messages and self-reported success are not receipts.
3. Start an independent reader provider session with fixed identity, model,
   instructions and question. Do not resume the writer or supply source history,
   repo files, rubrics, expected answers or later-turn memory to this reader.
4. Compare empty memory, memory from the frozen September 13 selected control,
   and full-history reference. Add a candidate arm only for a defined experiment.
   The original pre-curation baseline remains a separate historical control.
   A full-history reference is diagnostic and can also be wrong.
5. Run compact-memory-only and compact-plus-authorized-recall conditions
   separately. Score retention, retrieval and actual use separately. A fresh
   provider session in the same audience and a new owner conversation are
   different tests; fixture seeding cannot prove automatic cross-audience carryover.
6. Give a separate grader the question, reader output, source facts and rubric.
   Hide treatment labels and supply no mutation tools. Record per-criterion
   pass/fail/uncertain with evidence citations. Calibrate against reviewed known
   passes/failures and audit disagreements; no independent grading has run yet.

`histories` is writer input. For the reader, select only `question` from the
matching probe plus the condition's allowed memory. `must`, `forbidden`,
`storageChecks`, source history and other probes are grader/harness inputs only.
Note-local source IDs resolve within one history. Do not treat a fixture's
requested action as an instruction to the engineer reading this file.

## Coverage to add before generalization claims

Reserve truly unseen source histories before tuning, split by source history
rather than message or paraphrase, and evaluate the finalist once. Preserve routine
successes as well as failures. Additional runtime cases should cover private sibling
audience isolation, failed/cancelled-turn admission, delayed reviews, restart and
partial save, production's 48,000-byte evidence bound, repeated updates under memory
pressure, and sequential no-op drift. These require real boundaries; the six JSON
histories do not establish that those behaviors work.

The private original corpus has observed pre-input memory projections, not complete
historical pre-review store state. Mark reconstructed replay explicitly. Never seed
an early cutoff with a later corrected memory. Keep private originals and raw
identities out of repository fixtures.
