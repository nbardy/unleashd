# Memory curation evaluation

Ten synthetic analogues of the September 13, 2026 cross-Buddy audit exercise the
real reviewer, Codex runner, scoped MCP tools and disposable canonical store.
Private Buddy memories and conversations are not copied into these fixtures.
`cases.ts` defines the inputs and rubric before execution; the model never sees
the rubric. The frozen baseline is the instruction text preceding the curation
change. The candidate is the current `MEMORY_REVIEW_INSTRUCTIONS` export.

From the repository root:

```sh
UNLEASHD_LIVE_MEMORY_CURATION=1 \
UNLEASHD_MEMORY_CURATION_RESULTS=/tmp/memory-curation-comparison \
pnpm exec tsx --test server/test/buddy-memory-curation.test.ts
```

The default is two runs per case and variant, alternating variant order. Both
variants use the same current tool descriptions, model (`gpt-5.6-luna`), effort
(`low`), runtime limits and fixture inputs; only the main instructions differ.
This measures the main prompt change conditional on the revised tool wording,
not the separate effect of the tool descriptions.

Optional controls:

- `UNLEASHD_MEMORY_CURATION_CASE`: one exact case ID from `cases.ts`.
- `UNLEASHD_MEMORY_CURATION_REPEATS`: 1–3, default 2.
- `UNLEASHD_MEMORY_CURATION_VARIANT`: `baseline` or `candidate`; omitted runs both.
- `UNLEASHD_MEMORY_CURATION_RESULTS`: output directory; omitted creates a temporary one.

Use a new output directory for each prompt revision to preserve failed attempts.
Each JSON result records prompt/tool-description hashes, before/after documents,
tool calls and results, the reviewer receipt and its report. Inspect those saved
documents against every rubric item; a model's report is not a grade.

Automated checks cover completion, document limits, unchanged soul, private-scope
isolation and candidate memory reads. Expected no-op cases reject any write;
note-reuse cases reject duplicate notes, and the calibration case requires the
exact existing note name in compact memory. Semantic judgments such as correct
decision attribution and preservation of qualified evidence still require review.

The ordinary `buddy-memory-review.test.ts` and `conversation-runtime.test.ts`
suites cover real MCP transport, stale-write reconciliation, partial saves,
cancellation and successful-turn admission. Case G is a successful report of a
child failure; it does not test admission of failed Buddy turns. No live Buddy
state is rewritten by this evaluation. These small repeated examples are a
development regression set, not a held-out estimate of production reliability.
