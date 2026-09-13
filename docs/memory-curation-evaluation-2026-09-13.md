# Memory reviewer curation evaluation — September 13, 2026

The installed prompt is **candidate 2**, a 3,555-character refinement of the
owner-approved proposal. It passed the automated checks for all 20 live runs and
met the fixed semantic rubric in **19/20**, versus **16/20** for the old prompt.
This is a small development evaluation, not a production reliability estimate.

The owner accepted active curation and authorized implementation. The Development
Lead selected the shorter candidate after testing the proposal and three
refinements. The model, effort, permissions, scopes, admission rules, time limit,
tool-call limit, transcript bounds and tool schemas remain unchanged.

## What changed

The reviewer now explicitly reconciles existing correction notes, consolidates
duplicates, preserves useful older knowledge, separates decision authorship from
owner acceptance, and promotes confirmed reusable learning for lasting value.
It reads both compact documents, reuses exact native evidence references and
keeps task bookkeeping in work records. Routine compliance does not itself
justify another note.

The first proposal sometimes treated an existing note as sufficient even when a
reusable lesson was missing from compact memory. Candidate 2 explicitly connects
those layers. It also clarifies that unresolved allowance/renewal questions are
operational bookkeeping and that routine rule-following is not new learning.

Additional instructions about historical numbers, retrying shorter searches and
checking both drafts did not improve the measured score. Those expansions were
removed; the exact tested candidate 2 text was restored and its hash checked.

## Method and results

Ten synthetic analogues of the cross-Buddy audit were fixed before execution.
No private production memories or transcripts were copied. Each variant used
`gpt-5.6-luna`, `low`, the real production runner, scoped MCP and a disposable
canonical store. Each case ran twice. The baseline and first candidate alternated
order; later candidates reused that control. All variants used the same revised
tool descriptions, so the comparison isolates main instruction text conditional
on that tool wording. It does not separately measure the tool-description change.

The Development Lead manually inspected saved tool traces and resulting documents
against the rubrics. Grading was not blind. Automated assertions are separate from
semantic judgments; successful process completion alone is not a quality pass.

| Fixed case | Baseline | Proposal | Candidate 2, installed | Candidate 3 | Candidate 4 |
|---|---:|---:|---:|---:|---:|
| A: duplicate cleanup without a new fact | 0/2 | 2/2 | 2/2 | 1/2 | 2/2 |
| B: owner/assistant attribution and bookkeeping | 2/2 | 1/2 | 1/2 | 2/2 | 1/2 |
| C: reuse an existing correction | 0/2 | 2/2 | 2/2 | 1/2 | 2/2 |
| D: preview versus execution evidence | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| E: retain earlier success with a later caveat | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| F: retain concise, valid older preferences | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| G: failure to execute versus a negative result | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| H: truncated/unsupported completion evidence | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| I: reusable lesson and exact existing note reference | 2/2 | 0/2 | 2/2 | 2/2 | 2/2 |
| J: quoted instructions and a legitimate no-op | 2/2 | 1/2 | 2/2 | 2/2 | 2/2 |
| **Total** | **16/20** | **16/20** | **19/20** | **18/20** | **19/20** |

All 100 scored model invocations completed. Two additional pilot invocations
validated fixture wiring. An earlier fixture setup failed before model invocation
because it attempted a scoped soul write; setup was corrected to use normal soul
provisioning, preserving the production permission boundary.

## Remaining limits

Candidate 2's B repeat 2 corrected owner attribution but retained an enforced
packet allowance and unresolved renewal policy in working memory. This is a
known curation miss, not a runtime permission change. The longer candidate 4
instead introduced an unsupported absence claim about the current allowance, so
its similar score did not justify keeping the expansion.

Results also vary in placement between working and long-term memory, and some
outputs still repeat facts across those layers. A case-level pass does not certify
every instruction in every output. The synthetic cases were used for tuning;
independent, unseen traces are needed before claiming general improvement.

Failed-turn capture, cross-audience learning and evidence retrieval bounds remain
separate runtime questions. This evaluation did not bulk-rewrite live Buddy
memory. It proves the source prompt through the real runner on isolated data;
production activation after the server's normal reload is not independently
verified here. The development watcher defers reload until active turns drain.

## Verification and preserved evidence

- Boundary/runtime suites: **32 passed, 0 failed, 2 opt-in live tests skipped**.
  They cover real MCP transport, CAS, partial saves, scope, cancellation,
  successful-turn admission and foreground deadline behavior.
- Installed candidate live checks: **20/20 passed**; semantic rubric: **19/20**.
- Server typecheck and Biome checks for the four changed TypeScript files passed.
- The runner and pre-existing reviewer test file retained their pre-change hashes.

The [evaluation method and commands](../server/test/fixtures/memory-curation/README.md)
are reusable. The preserved synthetic evidence directory contains
[initial grades](benchmarks/memory-curation/2026-09-13/initial-grades.json),
[installed-candidate grades](benchmarks/memory-curation/2026-09-13/second-grades.json),
[third grades](benchmarks/memory-curation/2026-09-13/third-grades.json),
[fourth grades](benchmarks/memory-curation/2026-09-13/fourth-grades.json),
[regression output](benchmarks/memory-curation/2026-09-13/regressions.log.txt)
and [typecheck output](benchmarks/memory-curation/2026-09-13/typecheck.log.txt).
The original artifacts were in ignored `product/**` scratch. A September 13
documentation follow-up copied them byte-for-byte outside that ignore rule;
the [archive index and hashes](benchmarks/memory-curation/2026-09-13/README.md)
also preserve the original report and relevant source snapshots. This is local
preservation, not a commit or publication.

Historical prompt snapshots and SHA-256 values:

| Version | Snapshot | SHA-256 |
|---|---|---|
| Baseline | [text](../server/test/fixtures/memory-curation/baseline-2026-09-13.txt) | `3c56c97dc6eb4ba8a9643cb1fbc94b17991b785b885016821c37c936127e318f` |
| Proposal | [text](benchmarks/memory-curation/2026-09-13/candidate-prompt.txt) | `4a84581faefb99d205a61fef2cc62192147ecdfccb27c7325b905f1d4e1bd09f` |
| Installed candidate 2 | [text](benchmarks/memory-curation/2026-09-13/final-prompt.txt) | `a58682c6d7a549ef90339bfd08560111fa0cd8e825d1b9200b3f76a677ee4b67` |
| Candidate 3 | [text](benchmarks/memory-curation/2026-09-13/verified-prompt.txt) | `273771502f8d2267fff3b106eecadd7983f99d6c87adc37d3dc858bb15488f14` |
| Candidate 4 | [text](benchmarks/memory-curation/2026-09-13/release-prompt.txt) | `640dc8de6c1ad2e03a6515df7715893683288e87b8c0261a2e9e3949260307a5` |

Every raw result includes its prompt and tool-description hashes. The common
tool-description hash is
`1fe1ca463feff7eb046c02dd160ef1a34b8c94cac1716c9bb20311a291c57a70`.
