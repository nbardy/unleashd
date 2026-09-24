# September 13 memory curation evidence

Start with the [benchmark runbook](../../../../server/test/fixtures/memory-curation/README.md)
for current commands and extension guidance, and the
[dated report](../../../memory-curation-evaluation-2026-09-13.md) for the decision.
The grades, prompts and hashes here are committed. The raw runs (100 scored
invocations and two pilot invocations, under `results/`, `final-results/`,
`verified-results/`, `release-results/` and `pilot/`) and the `sources/`
snapshots are git-ignored and exist only on the machine that produced them, or
in git history before 2026-09-24. `sha256.json` still lists them. No private
production memory or conversation was copied into the fixtures.

## Which candidate is which?

Raw `variant: "candidate"` labels are local to their run directory. The prompt
hash identifies the treatment; the folder name alone is not a release claim.

| Treatment | Prompt snapshot | Raw output directory | Grades | Semantic passes |
|---|---|---|---|---:|
| Original baseline | [text](sources/server/test/fixtures/memory-curation/baseline-2026-09-13.txt) | `results/*-baseline-*.json` | [initial](initial-grades.json) | 16/20 |
| First proposal | [text](candidate-prompt.txt) | `results/*-candidate-*.json` | [initial](initial-grades.json) | 16/20 |
| Candidate 2, selected | [text](final-prompt.txt) | `final-results/` | [second](second-grades.json) | 19/20 |
| Candidate 3 | [text](verified-prompt.txt) | `verified-results/` | [third](third-grades.json) | 18/20 |
| Candidate 4 | [text](release-prompt.txt) | `release-results/` | [fourth](fourth-grades.json) | 19/20 |

`pilot/` holds the two initial wiring runs, excluded from scores. Grade `result`
paths resolve relative to this directory. Grades are historical manual, unblinded
case-level judgments, not automated or independent held-out scores. Candidate 2's
[known miss](final-results/B-decision-provenance-candidate-2.json) retained an
enforced packet allowance and unresolved renewal detail in compact memory. Some
outputs also repeat facts across working and long-term memory.

The original [boundary test output](regressions.log.txt) and
[typecheck output](typecheck.log.txt) are preserved byte-for-byte with `.txt`
suffixes so the global `*.log` ignore rule does not hide them. They are historical
results, not validation of future changes.

## Provenance and integrity

[provenance.json](provenance.json) records preservation time, the source directory,
repository HEAD, source-snapshot mappings and the exact scoped decision-note ref.
The prior implementation was uncommitted: its HEAD alone cannot reproduce it.
`sources/` preserves the harness, cases, reviewer instructions/tools/runner, prior
reviewer tests, baseline and the original report/runbook as observed at preservation.
Source hashes recorded in the prior native decision match the preserved files.
The original report and runbook are stored as raw `.txt` snapshots; their relative
links refer to their original repository locations, not their snapshot directory.

[sha256.json](sha256.json) hashes every archived file except itself. Verify from
the repository root without a model call:

```sh
python3 - <<'PY'
import hashlib, json
from pathlib import Path
root = Path('docs/benchmarks/memory-curation/2026-09-13')
manifest = json.loads((root / 'sha256.json').read_text())
for relative, expected in manifest.items():
    assert hashlib.sha256((root / relative).read_bytes()).hexdigest() == expected, relative
print(f'Verified {len(manifest)} archived files')
PY
```

Historical dependency versions, exact provider build and token/cost accounting
were not captured per invocation. Later source snapshots cannot fill those gaps
retroactively. Model/effort and prompt/tool-description hashes are in each raw
result. Temporary absolute paths inside traces are historical evidence, not setup
instructions. See the runbook for metadata to capture in future runs.

Preserve this dated evidence unchanged; place new runs, regrades or corrections
in a new dated directory/report with a link back here. These files are eligible
for version control; fresh clones receive them only after the documentation and
implementation are committed. No commit or publication is implied by preservation.
