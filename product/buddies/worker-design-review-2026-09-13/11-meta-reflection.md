# Meta-reflection on the integrated design

September 13, 2026. Self-review by Buddies Development Lead, after writing the
integrated final design. This is not an independent-agent or live-provider
evaluation. [Frozen review input](final-review-input.json) preserves the exact
pre-reflection files and hashes. [Current source evidence](final-source-evidence.json)
and the earlier [source index](source-index.md) distinguish code from proposals.

## Assessment

The information model is now substantially simpler: agents use files they already
know how to operate, Mail carries the immediate point, and Workers reuse Buddy
memory. The remaining risk is the surrounding execution protocol. A 21-tool
union can still contain too many choices and too much host machinery. Deleting
four knowledge tools does not prove the whole system is simple or implemented.

The earlier review's mistake was arguing from existing implementation to retained
API, rather than asking which responsibilities the agent actually needs. This
review applies that question to prompts, delivery, memory, handoff and execution.

Priority is by what prevents a trustworthy first slice, not section order:

| Priority | Findings | Disposition |
|---|---|---|
| Before activation | Contradictory catalog/context (1), inaccessible files (3), private export (6) | Resolve together before enabling the reduced employee surface |
| First real workflow | Mail attention/account isolation (2), common reviewer note I/O (4), current package preservation (9) | Prove at the MCP/provider boundary; source inspection alone is insufficient |
| Usability and tuning | Note/Mail clutter (5), redundant execution/diagnostic choices (7), supervision overhead (8) | Evaluate in the same journey; no extra deletions or timing claims without evidence |

## 1. A prompt addition alone would leave a contradictory system

Current `integration.ts` still lists published Documents and explicitly instructs
`remember_note`, `recall`, `get_document` and `update_document`; the source capture
preserves the exact lines. Merely adding a notes paragraph leaves two competing
workflows, especially in resumed sessions and automation contexts.

**Disposition:** the final map activates the reduced catalog and replacement
context together, removes obsolete recipes/aliases, and leaves historical notes
as evidence. The shared block is outside truncatable history and rendered once
for both ordinary Buddies and Workers. This is specified; the running composer
has not yet been changed. Verify rendered context and actual tool use, not just
whether a new string exists in a source file.

## 2. The earlier Mail rule defeated the owner's immediacy requirement

V2 said routine Mail never woke a model. A Buddy could send an important question
and its recipient remain idle indefinitely unless the sender knew to use another
operation. That makes directed communication unreliable by design.

**Disposition:** the integrated design selects durable bounded attention from
ordinary Mail, routed through the existing input machinery. Running Workers use
their current lane; held work stays held. Routine automatic progress remains
passive while required reviews wake the parent. Mail does not grant work or time.
This is a new assistant mechanism, not a previously accepted runtime fact.

Reflection exposed a second detail: coalescing across different audiences/work
roots could combine private input or charge the wrong allowance. The final design
and MCP now restrict coalescing to compatible context, audience and account.
Remaining proof: one reply under idle/busy conditions, no duplicate cause on
retry, correct held receipt, no second Worker writer and no cross-root charge.

## 3. File references require a real location and lifetime

“Just pass the path” fails if one Worker writes into an iteration worktree that
another participant cannot resolve, or cleanup deletes an uncommitted candidate.
A content hash identifies bytes but cannot retrieve deleted bytes. The frozen
context also ambiguously said to place `agent_notes/...` under a root already
ending in `agent_notes`, inviting a doubled directory.

**Disposition:** context now spells the destination as
`{{notesRoot}}/{optional_group}/{datetime}_{topic}.md`. The host supplies a stable
workspace root; the active code checkout stays independent. Preserve review
artifacts before cleanup and report saved paths/versions. Use existing files and
Git, without inventing a registry. Test an actual cross-worktree handoff.

## 4. Common Worker memory is reuse, but note I/O still needs integration

The existing reviewer already has successful-turn admission, a bounded tail,
compact-memory revision checks and its own restricted tools. Its current note
tools use managed knowledge; it has no ordinary file path capability. Removing
the employee tools does not automatically make its note transport file-based.

**Disposition:** reuse the lifecycle, model/effort and compact-memory behavior;
adapt note I/O once in that common system. The exact restricted file mechanism
is still an implementation choice to prove through the real provider boundary.
Do not silently give the reviewer a shell, rebuild it for Workers, or retain a
second active note collection. The curation benchmark must compare against its
preserved accepted control, labeling transport/retrieval changes separately.

The bounded tail can miss an early decision. Foreground agents can save important
details as ordinary notes; reviewer reuse of those referenced files is part of
the acceptance test. Long failed/cancelled turns remain outside the existing
successful-turn review mandate; this design does not silently change that policy.

## 5. “Lean Mail” must not become “write a file for every sentence”

Compulsory documents would trade long inboxes for note clutter and extra reads.
A path-only message also hides the actual decision or question.

**Disposition:** the common prompt explicitly permits short self-contained Mail,
asks for an outcome/ask plus essential context, and uses files for detailed or
reusable material. Notes are selective; reuse relevant existing evidence and
write successors for material changes. No word quota, body schema or mandatory
metadata was added. Evaluate actionability and duplicate notes, not just length.

## 6. Broad note export would accidentally publish private history

The earlier correction's one-time export wording did not fully distinguish shared
artifacts from private owner memory. A group folder in a repository is not a
privacy boundary. Worker memory inheritance is not parent-memory disclosure.

**Disposition:** migrate appropriately shared artifacts to shared notes; retain
private legacy history under its existing authorized owner reader until a suitable
export is selected. No bulk private-memory dump. This is a migration requirement,
not a reason to preserve employee Document tools. Existing identity editing and
compact-memory inspection stay in their dedicated flows.

## 7. Two more protocol choices look redundant

`get_capabilities` remains a general diagnostic even though exact mutation
previews, failures and team-state projections already report much of that data.
And once ordinary Mail schedules a response, `prompt(kind:"turn")` for ordinary
Buddy conversation overlaps with Mail. These are stronger next deletion candidates
than creating another combined all-purpose resource API.

**Recommendation, not applied or owner-selected:** remove `get_capabilities`
from ordinary coordination if preview/error/team-state results cover the real
staffing and return-route cases. Limit explicit Prompt to work lifecycle; ordinary
Buddy questions/answers should use Mail. Its Worker binding/task-addition behavior
still needs an explicit home before deleting that variant. Keep the final catalog
at the audited 21 for now rather than claiming an unexamined extra reduction.

Compare the ordinary create → task → start → report → review journey by number of
required calls and decisions, not merely number of names. The eight-tool Worker
surface is reasonably focused; the lead's 14 tools and Prompt's four variants
still need a real usability pass.

## 8. Supervision overhead and delivery scope need measurement

The proposed 30-minute session with up to six 60-second reports and one 120-second
review reserves up to eight minutes of coordination before early reviews. This
is a conservative bound, not observed cost. Running an extra periodic reporter
at the same boundary as required review may add little value.

**Recommendation:** implement one Worker/two Tasks and measure complete delivered
work, missed decisions, duplicate reports and coordination time before tuning
cadence or widening rollout. Coalesce coincident reporting/review where semantics
permit. Keep timeout, cancellation and foreground independence tests. Do not use
new accounting tables or role profiles as evidence of better throughput.

The common files/Mail/context slice can be validated first. The full request,
session and account model should follow a successful end-to-end supervised Worker
journey. Migration succeeds only when the old new-work writer is actually retired;
indefinite dual controllers would erase much of the simplification.

## 9. The delivery baseline changed while the design was being finished

Closeout verification found that the package and foreground runtime had advanced
since the original source capture. The current archive names source commit
`03638bdbcf778a63de22b227aa76099b0f1c8761`, and all 13 installed source files match
it. Its admission implementation excludes foreground work from background
capacity and hourly gates. The unchanged owner requirement remains valid; the
earlier statement that this separation is entirely unimplemented is now stale
at the source level.

**Disposition:** preserve the original v1/v2 and source snapshots, record the
[closeout package/excerpts](final-closeout-source-evidence.json), and correct the
current entry point and implementation map. Reconcile this successor when
building the Worker slice. This design review did not execute the concurrent
change's tests or verify which package the running process loaded. Neither a
matching archive nor an old incident handoff establishes production acceptance.

## Workflow audit

| Journey considered | Design result | Evidence still needed |
|---|---|---|
| New and existing Buddy/Worker learn the convention | One common rendered block and stable roots | Live composition on resumed and background paths |
| Worker saves a useful note, sends lean Mail, parent reviews | Ordinary file and Mail refs; parent accepts exact Task candidate | Cross-worktree access and saved-artifact review |
| Recipient idle, active or held | Coalesced bounded attention, existing lane or visible hold | Real admission/delivery/race test |
| Same Worker finishes A then handles related B | Identity/memory/context retained; Tasks independent | Real provider continuity and memory parity |
| Solo time ends during a long tool | Host holds/fences/drains, parent reviews | Non-cooperative provider boundary |
| Duplicate report, crash or uncertain side effect | Saved references and one durable decision/delivery cause | Restart/retry/cancellation fixture |
| Worker retires while maintenance is pending | Common memory lifecycle and preserved history; drain before retirement | Existing queue/retirement behavior, including queued reviews |
| Old shared and private notes migrate | Shared files, private history retained without publication | Authorized export and historical-reference checks |

This audit found actionable design gaps and next deletion candidates. It does not
establish runtime reliability. The final document set is coherent enough to build
the first vertical slice; it should now earn further complexity through that
slice's evidence rather than another round of object definitions.
