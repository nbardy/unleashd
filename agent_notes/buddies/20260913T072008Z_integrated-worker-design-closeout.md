# Integrated Worker design: reflection and source successor

Recorded 2026-09-13T07:20:08.354848+00:00 by Buddies Development Lead in owner conversation
`89d40447-9d68-4b53-9688-67c154dbfae2`.

## Question, decision-maker and status

How should the owner-selected files/Mail/common-memory direction compose with
Worker execution, and which remaining complexity deserves implementation?
The owner's accepted information-model choice remains unchanged. The integrated
execution mechanisms and recommendations below are assistant proposals, recorded
by Buddies Development Lead; finishing the design does not imply owner acceptance
of every API or runtime activation.

## Choices and reasoning

The integrated design has Buddy, Task, Mail and human Conversation. Workers are
parent-owned ordinary Buddies and reuse the common memory lifecycle across related
Tasks. Existing dated agent_notes files hold detailed evidence. The exact shared
context permits short self-contained Mail and asks for useful detail in accessible
files, avoiding a compulsory note for every exchange. The four employee knowledge
tools remain deleted from the proposed surface; Worker 8, lead 14, union 21 are
catalog arithmetic, not measured performance.

Directed Mail now proposes bounded attention under existing recipient/work
policy. This supersedes the passive-Mail mechanism in v2 because an idle recipient
otherwise needs a second execution command to notice an ordinary question.
Delivery cannot grant allowance or resume held/stopped work. Coalescing is limited
to compatible audiences and accounts; Workers retain one executor. Routine
check-ins stay passive; required review receives parent attention.

Keep one common memory reviewer, adapting restricted note I/O once. A shared
notes directory is not a privacy boundary: preserve private historical knowledge
under authorized access rather than bulk-exporting it into the repository.
Artifacts must survive worktree cleanup; hashes identify bytes but cannot recover
deleted files. These constraints preserve the owner's deletion and reuse choice.

Further removal of get_capabilities or ordinary prompt(turn) remains a candidate,
not an applied change: their remaining staffing/binding responsibilities need
an explicit home. Evaluate the first complete file/Mail/Worker journey before
adding more abstractions or claiming that the proposed timings save effort.

## Historical evidence and what changed

Predecessor: [owner files/Mail decision](20260913T063400Z_files-mail-memory-simplification.md),
SHA-256 `5dd80d1e8141bf3807c2d8b5cba224dbbf4034acf1e4175fa08831d08f783aaf`.
Preserved owner excerpt: “we should just reuse that and remove the remeber_note
receall and document stuff”. The frozen integrated review input preserves all
four main drafts and previous entry points before reflection corrections.

Concurrent implementation advanced the package from original review commit
`b70c0def1373034aeff56e409adb97d66ff6d7f7` to
`03638bdbcf778a63de22b227aa76099b0f1c8761`. The closeout capture verifies archive
provenance and all 13 installed source files. Its admission excerpt now has
`if (!run?.policy.foreground)` around the background-capacity gate. This changes
the source assessment, not the owner's independence requirement. Loaded adoption
and runtime tests were not verified in this design task; old captures stay intact.

Preserved final reflection excerpt: “A content hash identifies bytes but cannot retrieve deleted bytes.” Preserved final-design excerpt: “There is no managed Document
object.” The final reflection ranks activation blockers, first-workflow evidence,
and subsequent simplification/timing candidates.

## Versioned artifacts

Captured 2026-09-13T07:20:08.354848+00:00. These hashes identify the exact uncommitted artifacts reviewed.

| Source | SHA-256 |
|---|---|
| `product/buddies/worker-design-review-2026-09-13/07-final-design.md` | `3b02c39238c2d19e46a16e47969119472b4146c0e9859e704f750a5ae2fd3a24` |
| `product/buddies/worker-design-review-2026-09-13/08-final-mcp.md` | `44a826f3b8b4b2fcf05a6ea12c38e7799f5978ca48cdcdf584d2415d2560f673` |
| `product/buddies/worker-design-review-2026-09-13/09-final-implementation.md` | `596bd6272cd54f6f49373f5b6c3bf5e2afa129a38ffcfb42ba15514ba87116c9` |
| `product/buddies/worker-design-review-2026-09-13/10-shared-context.md` | `7a8a4adeaed1444bca48e288aa6fb22a757c02f05c7415ca1ff67c40b217c452` |
| `product/buddies/worker-design-review-2026-09-13/11-meta-reflection.md` | `f01e3d963bcfc6ea797d382c56511765228aa4cf9b9c96d93a52c0740fcefcc3` |
| `product/buddies/worker-design-review-2026-09-13/final-review-input.json` | `95158e33c674e2468d430180869a099819ec19baef4d67f789e002491a833fb4` |
| `product/buddies/worker-design-review-2026-09-13/final-closeout-source-evidence.json` | `063bc6e718a3301bfb86e2f13e460834e4750609de0501fbd7dd6ffeac79835c` |

## Alternatives, tradeoffs and revisit criteria

Rejected by the owner: retaining optional employee recall/managed Documents.
Not selected: rebuilding Worker memory, a file registry, independent mailbox
executors, mandatory native forks, or treating smaller tool counts as proof.
Explicit sessions/accounts add host complexity; keeping both new and legacy
write controllers indefinitely would defeat the simplification.

Revisit these assistant mechanisms on a demonstrated missed Mail, wrong-account
charge, second Worker writer, inaccessible candidate, private-content leak,
lost decision across common memory, or excessive supervision effort. Keep
provider-specific claims unproven until real boundary evidence exists. Detailed
reflection is self-review, not independent-agent or provider evaluation.
