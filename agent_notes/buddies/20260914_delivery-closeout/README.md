# Lean Worker delivery closeout — 2026-09-14

Scope: local delivery of the accepted September 14 lean Worker slice. The owner
asked to close out all work required here. This closeout does not treat the older
Buddy backlog or production deployment as part of that slice.

The existing implementation is preserved against the previously committed mixed
source baseline c3cdfa85a5e35fe8c3fcd83c5ce97dff807cc22c. This is an integration
snapshot, including pre-existing sidebar/transcript changes, not a claim that
all baseline-to-delivery lines belong to Workers. The current shared checkout,
its index and the CLI submodule pointer are left in place.

The uncommitted CLI dependency is preserved in cli-source-snapshot.json with its
base commit, complete tracked/unignored UTF-8 file contents and hashes. In an
isolated checkout, initialize the submodule at that base and restore the listed
files before building. This makes the local dependency explicit without pushing
unrelated harness work or claiming a clean-submodule release.

The Buddies package archive has SHA256
0b202eafb108cee332cf65804fa5495c2b573a313946e52e03c976c3d27e4b93,
from clean source aed8badae7fdaa0763145bcc32df629fecbc10dc. The archive hash and every
installed src file were verified again. All 13 recorded implementation/package
files still matched the prior evidence snapshot; the two design documents had
only their later delivery-evidence pointers appended.

Fresh closeout verification: server 360 passed, 5 optional tests skipped, 0 failed;
client 91 passed; client tsc -b passed; all six client invariant gates passed.
Full outputs accompany this note. Previous full builds, package 106 passing tests,
compiled package smoke and actual normal/timeout Codex Worker artifact-read and
lead-acceptance evidence remain linked in ../20260914_lean-workers-implementation.md.
No runtime source changes were made during this closeout.

## Decision reconciliation

The expanded Worker refactor is superseded by the accepted lean redesign. Its
historical app refactor 2edfd95 and package 5bf496b remain preserved; unfinished
criteria were cancelled as superseded rather than retroactively marked verified.
Native Tasks carry the authoritative disposition and completion evidence.

Owner clarification from note
2026-09-14T10:39:03.758Z:ddc56da2-415f-4317-b7b6-70eb644842c6:
checkpoint-history preservation and backward compatibility are not requirements.
This supersedes the preservation constraint in the earlier implementation map.
The delivered runtime has retired checkpoint writes/UI but still has historical
checkpoint readers and a rejecting write adapter; this closeout makes no claim
that every legacy structure has been deleted. Ordinary employee knowledge-tool
cleanup was explicitly separated from this Worker slice in the accepted map.
Neither remaining surface blocks the demonstrated Worker return/comment workflow.
Revisit those surfaces as scoped deletion work, without reintroducing a history
preservation requirement or changing identity memory maintenance.

This is a local reviewable delivery. No main merge, push, deployment, live data
migration, all-provider validation, or production-duration timeout test is claimed.
