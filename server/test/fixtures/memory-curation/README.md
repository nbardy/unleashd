# Memory curation benchmark

This is the entry point for maintaining the Buddy memory reviewer evaluation.
Read it before changing reviewer prompts, tool descriptions, fixture inputs or
grading. Project agents discover it through the root `AGENTS.md` and
`docs/test-strategy.md`; it does not depend on a particular Buddy's private memory.

| Resource | Purpose |
|---|---|
| [Cases and rubrics](cases.ts) | Synthetic inputs, expected behavior and assertion flags |
| [Live harness](../../buddy-memory-curation.test.ts) | Production reviewer against a disposable store |
| [Frozen original control](baseline-2026-09-13.txt) | Pre-curation instruction text; retain unchanged |
| [Current reviewer](../../../src/buddies/memory-review.ts) | Candidate instructions and runtime configuration |
| [Current tools](../../../src/buddies/memory-review-tools.ts) | Shared tool contract for both variants |
| [September 13 report](../../../../docs/memory-curation-evaluation-2026-09-13.md) | Method, selection rationale, results and known misses |
| [Historical evidence](../../../../docs/benchmarks/memory-curation/2026-09-13/README.md) | Prompts, grades and hashes; raw runs and source snapshots are local-only |
| [Thread preservation](../../../../docs/benchmarks/memory-curation/2026-09-13-closeout/README.md) | Lessons, private-corpus boundaries and six prepared fresh-session fixtures |

The September 13 selected prompt scored **19/20** manually graded case runs
versus **16/20** for the original control. Those are historical observations,
not an expected score for every rerun or a production reliability estimate.

## What it measures

Ten synthetic analogues of the September 13, 2026 cross-Buddy audit exercise the
real reviewer, Codex runner, scoped MCP tools and disposable canonical store.
Private Buddy memories and conversations are not copied into these fixtures.
`cases.ts` defines the inputs and rubric before execution; the model never sees
the rubric. The frozen baseline is the instruction text preceding the curation
change. The candidate is the current `MEMORY_REVIEW_INSTRUCTIONS` export.

The runner deliberately ignores repository/user instructions: `AGENTS.md` guides
the engineer maintaining the benchmark, not the reviewer being measured.

## Setup and execution

Use the repository's normal dependency setup: Node >=22.5, pnpm (the root manifest
pins 9.15.0), initialized `vendor/agent-cli-tool` submodule and installed workspace
dependencies. See the [development setup](../../../../README.md). Live evaluation
also requires an authenticated Codex CLI that supports the flags in
[the production runner](../../../src/buddies/memory-review-runner.ts) and access to
the configured reviewer model. It makes real model calls and consumes provider
usage; ordinary tests do not enable it. A running Unleashd web server is unnecessary:
the harness starts a temporary control server and isolated store.

From the repository root, validate deterministic boundaries without model calls:

```sh
UNLEASHD_LIVE_MEMORY_CURATION=0 UNLEASHD_LIVE_MEMORY_REVIEW=0 \
pnpm exec tsx --test server/test/buddy-memory-review.test.ts \
  server/test/conversation-runtime.test.ts server/test/buddy-memory-curation.test.ts
```

The curation test is **skipped** in that command. A skipped live test is not a
semantic benchmark pass. To check live wiring with one candidate run first:

```sh
UNLEASHD_LIVE_MEMORY_CURATION=1 \
UNLEASHD_MEMORY_CURATION_CASE=A-duplicate-cleanup \
UNLEASHD_MEMORY_CURATION_REPEATS=1 \
UNLEASHD_MEMORY_CURATION_VARIANT=candidate \
UNLEASHD_MEMORY_CURATION_RESULTS=/tmp/memory-curation-pilot-NEW-RUN-ID \
pnpm exec tsx --test server/test/buddy-memory-curation.test.ts
```

For the full comparison, start with the case and variant filters unset:

```sh
unset UNLEASHD_MEMORY_CURATION_CASE UNLEASHD_MEMORY_CURATION_VARIANT
UNLEASHD_LIVE_MEMORY_CURATION=1 \
UNLEASHD_MEMORY_CURATION_REPEATS=2 \
UNLEASHD_MEMORY_CURATION_RESULTS=/tmp/memory-curation-comparison-NEW-RUN-ID \
pnpm exec tsx --test server/test/buddy-memory-curation.test.ts
```

Replace `NEW-RUN-ID` with a unique label. With ten cases this requests **40 model
invocations** (10 cases × 2 variants × 2 repeats), with up to two subtests running
concurrently. Each reviewer has a 120-second runtime limit; the harness allows
150 seconds to drain, 180 seconds per subtest and 50 minutes for the parent test.
Record infrastructure failures separately from semantic failures; never quietly
exclude them from the results.

The default is two runs per case and variant, alternating variant order. Both
variants use the same current tool descriptions, model (`gpt-5.6-luna`), effort
(`low`), runtime limits and fixture inputs; only the main instructions differ.
This measures the main prompt change conditional on the revised tool wording,
not the separate effect of the tool descriptions.

Production reviews fall back to `muse-spark-1.3` when Luna credits run out (see
"The reviewer ladder" in `product/buddies/PLANNING_MEMORY.md`). This benchmark
must NOT: a fallback changes the model under comparison, and the baseline variant
loses its instruction override with it, because that override rewrites codex's
`model_instructions_file` and `muse exec` has no counterpart. The harness asserts
`receipt.fallbackFrom === undefined` and aborts with "out of credits" rather than
publishing a mislabelled result, and every result row records the receipt's
actual model and effort instead of the intended constants.

Optional controls:

- `UNLEASHD_MEMORY_CURATION_CASE`: one exact case ID from `cases.ts`.
- `UNLEASHD_MEMORY_CURATION_REPEATS`: 1–3, default 2.
- `UNLEASHD_MEMORY_CURATION_VARIANT`: `baseline` or `candidate`; omitted runs both.
- `UNLEASHD_MEMORY_CURATION_RESULTS`: output directory; omitted creates a temporary one.

Use a new output directory for every invocation, including retries. The harness
writes deterministic case/variant/repeat filenames and does **not** prevent
overwriting existing results. Freeze source during a run; do not edit prompts,
tools, the baseline or fixtures while it is running.
Each JSON result records prompt/tool-description hashes, before/after documents,
tool calls and results, the reviewer receipt and its report. Inspect those saved
documents against every rubric item; a model's report is not a grade.

Results are saved before post-run assertions. A setup or pre-drain failure may
occur before any JSON is saved, so retain stdout/stderr and identify uninvoked
cases. Temporary output is not durable: before relying on reviewed results for
a handoff, copy them into a subdirectory of a dated `docs/benchmarks/` directory.
Those subdirectories are git-ignored; commit only the dated directory's README,
prompts, grades and `sha256.json`.

## Grading and comparison

Automated checks cover completion, document limits, unchanged soul, private-scope
isolation and candidate memory reads. Expected no-op cases reject any write;
note-reuse cases reject duplicate notes, and the calibration case requires the
exact existing note name in compact memory. Semantic judgments such as correct
decision attribution and preservation of qualified evidence still require review.

Several extra assertions apply only to the candidate; semantic rubrics provide
the common comparison across both variants. For new grading, record each rubric
judgment, a short reason and concrete output/tool evidence, plus case, variant,
repeat, result path and grader identity. A case passes only when all applicable
rubric items hold. Keep automated outcomes separate from semantic outcomes. The
historical grade files contain case-level reasons only; do not invent older
item-level judgments.

Define acceptance criteria before tuning. Unsupported authority/owner policy,
lost valid knowledge, invented completion, scope leakage, invalid references,
stale overwrites and duplicate notes where reuse suffices are failures. Any
accepted miss needs an explicit disposition: the September 13 winner retains
operational bookkeeping in one run, so its selection is not a perfect pass.

Report passes/attempts per case and variant, missing results, setup failures and
repeat variability. For future comparisons, mask treatment labels during grading
where practical, calibrate graders on reviewed examples, and keep unseen cases
for evaluation after tuning. The original grading was manual and unblinded.

The ordinary `buddy-memory-review.test.ts` and `conversation-runtime.test.ts`
suites cover real MCP transport, stale-write reconciliation, partial saves,
cancellation and successful-turn admission. Case G is a successful report of a
child failure; it does not test admission of failed Buddy turns. No live Buddy
state is rewritten by this evaluation. These small repeated examples are a
development regression set, not a held-out estimate of production reliability.

## Extending or changing the benchmark

1. Add a minimal synthetic `CurationCase` to `cases.ts` with a stable unique ID,
   `working`, `longTerm`, `messages` and a rubric fixed before execution. Optional
   `note` seeds one same-audience evidence record. Link the motivating defect with
   an authorized evidence reference; do not copy private production memory.
2. `noOp` requires no document/note writes; `reuseNote` requires recall and zero
   new notes; `notePointer` requires the seeded note's exact name in compact
   memory. These flags drive candidate assertions, not reviewer instructions.
   Use observable output/transport assertions, not source-text tests.
3. Preserve old IDs and the frozen baseline. Date/version changes to existing
   inputs or rubrics and report changed case sets separately. Never silently
   regrade old results with a new rubric.
4. Run deterministic boundaries, a live pilot when needed, then both variants on
   identical fixed inputs with repeats. Preserve unsuccessful attempts too. Record
   command/filters, prompt/tool/fixture/harness hashes, code commit plus dirty
   snapshots, CLI/package versions, model/effort, outputs and grades.
5. Choose the control explicitly. The current harness always uses the **original
   pre-curation prompt**; there is no environment control for an arbitrary prompt
   or the September 13 winner. For a later accepted control, add a versioned
   fixture and test-only selection at the existing execute seam, retaining the old
   baseline. Use an isolated checkout; avoid production override flags or briefly
   replacing a running server's prompt to perform an experiment.
6. Write a new dated report with the decision-maker, rationale, acceptance bar,
   failures, tradeoffs and artifact hashes. Link it here and retain earlier reports.
   Native Buddy projects own current task status; private notes supplement the
   portable repository evidence.

Model, tool-contract, retrieval and runtime changes are separate experimental
variables. Changing them in both arms changes what the baseline measures; label
that difference and do not attribute all effects to prompt text. Failed-turn
admission, cross-audience learning and production activation need separate proof.

## Availability to future agents

An agent reading this checkout's `AGENTS.md` gets the direct entry point. A new
clone gets only committed files: include the harness, fixtures, runbook, report,
archive and index changes when delivering the implementation. Evidence under
`product/**` or `/tmp` alone is not a clone-safe handoff. A separate `MEMORY.md`
would duplicate this runbook without adding discovery beyond the `AGENTS.md` link.
