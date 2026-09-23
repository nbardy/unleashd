# Completing the outcome after workers return

Owner-requested design review, September 22, 2026. Source baseline:
`7d66807ba687423b0116feea223bd12b3d35c123`, clean before this document.
This reviews existing behavior and proposes changes; it does not claim a shipped
runtime repair. Native review project
`buddy_project_86bb7e84-6326-42ab-a033-0ac340e6d227` owns the review task.

**The lead could already have integrated the local wave_sim changes and assigned
the remaining fixes.** The runtime did not require the lead to stop at a PR or
ask the human at every handoff. The lead narrowed the assignments to reviewed
packets, reserved integration, then treated its own publishing restriction as a
broad delivery stop. Unleashd successfully returned that decision to a review
turn; it did not maintain a separate obligation to finish the CEO's overall
outcome after that turn ended.

The source and tests support improving the existing Buddies, Mail and Tasks
workflow. A new supervisor, release registry, mandatory GitHub graph or second
task state machine is not justified by this incident. This narrows the broader
tooling suggestions in the earlier
[wave_sim forensic report](/Users/nicholasbardy/git/wave_sim/product/reports/2026-09-22_reflections/04_why_the_swarm_stopped.md).

## What already works, and how it should have been used

| Existing mechanism | Correct use for this delivery |
|---|---|
| A Task/project has criteria, todos, evidence and one owner | Put integration and combined application checks in the delivery owner's criteria. A child's PR can be complete while the parent outcome remains unfinished. |
| `send` with `delivery.kind: work` continues an unfinished project within bounds | Run the integration lead against the whole bounded delivery outcome on a recipient-owned, in-audience project. The lead may be the existing Product Lead, or CEO self-work on its own project; choose one, not competing integrators. |
| A lead launched as managed work waits for children in its managed chain, then resumes | Let that same lead inspect and consume child results, implement/integrate locally and dispatch bounded corrections. Do not add a parallel self-successor while managed work already exists. Foreground chats and standalone callbacks do not themselves acquire this whole-outcome obligation. |
| Todo-level blocking is separate from project-wide blocking/pause | Block the publishing todo when preview policy prevents pushes. Keep independent local implementation, combination and testing available. A parent pause fences descendant work too. |
| Fresh work on the same unfinished Task is supported after a terminal block | Inspect effects, repair the blocker, update canonical state and issue a new keyed work request with explicit bounds. `retry_run` is for failed/cancelled attempts; `continueFrom` is not the recovery path for a blocked reply. |
| A return can wake a lead in a separate background conversation | Use it for review and the next authorized action. Returning a review does not automatically create a whole-outcome work obligation. |
| Information, requests and managed work have different delivery semantics | Use information for facts, requests for one answer, work for a sustained task. Do not turn every status update into another review turn or expect a channel post to dispatch work. |

The first five mechanisms are documented in
[background execution](DESIGN_BACKGROUND_TASK_EXECUTION.md) and the
[operator guide](TEAM_OPERATOR_GUIDE.md). They are implemented by the installed
`@nbardy/buddies` package and host runtime, rather than merely proposed in old
designs. A fresh bounded assignment within an already authorized project is a
manager action; it is not inherently a new request for human permission. Real
scope/spend changes, explicit stops and enforced authority restrictions remain
separate.

That action still requires `buddy.send` in the callback's immutable operation
policy, an in-audience recipient-owned project, sender management authority and
normal admission. A fresh send creates a new explicit allowance; unused time
from the old request is not transferred. See
[operations.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/operations.ts:1937).

For wave_sim, the better original dispatch would have assigned one lead:
“Combine the preserved implementation branches, fix the remaining local product
acceptance failures, and produce one reviewed app at an exact commit. You own
local integration and the fix/review/retest loop within these bounds. Publishing
and separately funded physical runs retain their explicit conditions.” The
remaining beta requirements would stay on the parent, with independent child
assignments only where they can be consumed promptly.

When a worker returned, that lead would inspect the diff and checks, merge
accepted work into its integration checkout, run combined checks, and send the
smallest needed correction. It would return a finished local result, an exhausted
explicit allowance, or a real blocker that leaves no useful authorized work.
The exact completed scope must remain clear: local app acceptance does not
automatically establish hosted release or physical qualification.

## Why the runtime did not rescue the orchestration

Managed continuation and callback review are different paths. The installed
package's `background-work.js` reconciles `message_request` work carrying an
`until_done` policy. A terminal `blocked` disposition settles the request; it
does not inspect the semantics of a manager's claim that nothing more can be
done. In `coordination.js:367–387`, `enqueueMessageReply` explicitly removes
`returnPolicy.execution` before creating a `message_reply` run. A child of an
already managed parent instead reconciles that parent's original obligation.
Normal standalone review callbacks can finish after one successful provider
turn. Copying the worker's loop/budget into every callback would be wrong; give
the overall delivery its own explicit managed assignment through the existing path.

`background-work.js:132–144` also makes an explicit project-wide `blocked`
status terminal before considering individual todos. If the project stays
active, it only derives a terminal todo blocker when every remaining todo is
blocked and child results are consumed. The store therefore supports partial
blocking already; the lead's project-wide update overrode that useful behavior.

The existing callback prompt already says to inspect the actual artifacts and
“record your decision and continue, redirect or stop within current authority”
([run-executor.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/run-executor.ts:432)).
It supplies the child's current task at line 426, source attempt and transcript.
It does not explicitly assemble the originating lead's current overall project
alongside that child. Historical launch context helps, but is not a substitute
for the current outcome and remaining work. When there is no source project
binding, the host must expose that absence instead of guessing one.

The return tests prove delivery, context, serialization and execution completion.
For example, the fake reviewer in
[buddy-background-return.test.ts](/Users/nicholasbardy/git/unleashd/server/test/buddy-background-return.test.ts:137)
finishes with a statement that continuation needs a new assignment. The test
correctly accepts the delivery without requiring an actual next assignment.
That is a test of one boundary, not proof of autonomous product completion.

## Minimum product improvements

These are ranked proposals, with implementation scope intentionally small.
The [lean core](CORE_DESIGN.md#test-for-future-design-decisions) requires review before API/schema expansion;
none is necessary for the first operating correction.

| Priority | Before → after | Existing code owner / impact |
|---|---|---|
| 1. Make outcome execution explicit at launch | A saved in-progress project and separate helper runs can look like a running delivery effort → show whether the parent has an active managed assignment and let the user/lead launch that existing project with explicit bounds. | Existing project execution/run route and `send` work variant. Reuse project IDs, ordinary run admission and current creation path; no new scheduler or automatic budget renewal. |
| 2. Show task status and execution state together | “In progress” can survive after the last review ends → show “unfinished; no active assignment,” waiting, paused, limit reached or running from the corresponding authorities. | Existing project/team execution views and client derived state. Do not persist a second status. Never infer no work from a truncated page or unavailable descendants. |
| 3. Give the lead current parent context at review | Callback emphasizes the completed/blocked child → also supply the accessible originating lead project, its open criteria and existing managed allowance when a source binding exists. | `run-executor.ts` return assembly and existing message source-project metadata. No new public tool or mandatory report format. Do not fabricate a parent from a title or copy restricted context. |
| 4. Surface recovery and decision origin accurately | Generic recovery text and summarized “owner decision” obscure what can proceed → use canonical project blockers, existing `replied_by`/approval provenance, and the existing retry/new-work distinction. | Existing Mail/Task/readiness presentation and operator guidance. Preserve private-message boundaries; do not grant managers access to private reply bodies. |
| 5. Test the entire consume-and-correct loop | Tests stop at callback completion → verify the lead consumes the artifact, performs integration/verification, and continues corrective work before the parent completes. | Existing runtime/MCP boundary suites plus a small behavioral evaluation using retained wave_sim failures. No new production controller. |

For priority 2, an owner-facing warning should initially be a derived observation
with an as-of timestamp. It should not launch a model, send mail, infer a new
schedule or change project state. A durable alert/wakeup policy is a separate
behavior expansion to consider only if the simpler view proves insufficient.

The expanded [project panel](/Users/nicholasbardy/git/unleashd/client/src/components/buddies/BuddyProjectExecution.tsx)
already distinguishes Work status from Background work, including waiting and
limit-reached dispositions when a request exists. Keep that behavior. The narrow
gap is the unfinished/no-request or terminal-request case, and status-only list
summaries. Its existing polled `/api/buddies/projects/:id/execution` response
already supplies project, current/latest managed message and runs. Show the
project's recorded next action and execution state there; avoid fetching every
project's complete execution history merely to decorate list cards.

Do not implement a simplistic classifier that equates queued with running,
all todos done with product acceptance, or all historical runs terminal with
no active work. A held request needs its existing gate resolved; another run
is not automatically its remedy. Paused/cancelled/draining state, current
message disposition, actual child waits and data coverage must control the
available actions. These remain projections, not new persisted Task statuses.

For priority 3, better context is a hypothesis to test, not a claim that adding
one more instruction guarantees good judgment. Compare the current return
context against the parent-aware variant on the same cases. Success is actual
tool actions and final artifacts, not a better written plan.

## Corrections to the first tooling diagnosis

Some observed null errors are deliberate redaction. In
[team-observation.ts](/Users/nicholasbardy/git/unleashd/server/src/buddies/team-observation.ts:128),
non-participant supervisors receive no private error body. A live readiness read
for the sampled Engineer-to-Product message returned `message_scope`; the CEO
could observe coordination metadata but not open that private exchange. This
is not evidence that the underlying reason was lost. Preserve the boundary and
make restricted versus absent data understandable.

Human approval origin also already exists. The incident's preview decision was
addressed to and answered by the CEO, with `approval: null`. A host-only
owner-reply path is separate. The failure was calling that agent decision an
owner decision in prose, not a demonstrated bypass of human approval authority.
Use the existing attribution before adding a new decision object or registry.

Git operations need not become mandatory Buddy primitives. A lead can inspect
and merge through its normal tools and attach the exact source/check evidence to
Tasks. The immediate need is an integrated result in the parent's criteria and
an executing owner who consumes it. Git-specific automation can remain optional.

## Acceptance scenarios

1. **Child done; product unfinished.** Start a bounded lead Task with a worker
   implementation and parent integration/check todos. Worker returns a commit.
   The managed lead resumes, inspects and consumes it; it cannot complete merely by
   accepting the child. A remaining failed check produces bounded correction work.
2. **Publishing blocked; local work available.** One todo requires publishing
   and is blocked; integration and testing remain open. The managed lead continues
   locally. A separate case with an explicitly paused parent admits no child work.
3. **Review ends without follow-through.** Leave the parent unfinished after the
   final callback, with no running/queued/managed continuation. The owner view
   shows that precise state. Waiting on a real child and an incomplete paginated
   observation must not be mislabeled idle.
4. **Recovery after a terminal blocked return.** Preserve the original receipt
   and saved files, clear the resolved block and preview/send fresh bounded work
   on the same Task. No duplicate work, hidden budget transfer or revival of a
   stopped root. The existing MCP recovery test already covers much of this.
5. **Provenance and scope.** An agent's publishing decision stays agent-attributed;
   unrelated local todos remain available. Genuine human stop/approval records
   retain their authority. Restricted private errors remain restricted.

Use a temporary local Git repository for the integration fixture so success
means the returned commit is actually in the target tree and its combined test
passes. A scripted provider can verify runtime transitions; a separate bounded
real-agent evaluation is needed to measure whether the lead actually chooses
the correct next action. Neither alone substitutes for the other.

## Verification performed

Ran, from the clean source baseline above:

```sh
pnpm exec tsx --test \
  server/test/buddy-blocked-recovery.test.ts \
  server/test/buddy-background-runtime.test.ts \
  server/test/buddy-background-return.test.ts \
  server/test/buddy-coordination-observation.test.ts \
  server/test/buddy-lean-controls.test.ts
```

Result: **16 passed, 0 failed, 0 skipped**, exit 0. These use isolated fixtures
and simulated provider behavior; no new live provider campaign was launched.
They establish existing continuation, return, recovery and scope behavior, not
the unimplemented outcome-completion scenarios above or loaded-host adoption.

Also ran the existing rendered project-panel checks:

```sh
pnpm exec tsx --tsconfig client/tsconfig.app.json --test \
  client/test/buddy-project-execution.test.tsx
```

Result: **3 passed, 0 failed**, exit 0. They confirm the existing criteria/evidence
display and distinction between a completed provider turn and exhausted managed
work. Total for this review: **19 existing tests passed**. No runtime source,
tool contract, schema or test implementation changed in this review.

Vendored Buddy authority provenance: source commit
`71b4a2886eb0a2a10ab5c94fd9a4aba8330a05b4`, archive SHA-256
`065e7fda734906a7c1c8909633e30c3919a7e98546ecec4d9e91ee686302fb3f`.
Canonical package changes must be made in the Buddy source and repackaged via
`tools/vendor-buddies.mjs`, never delivered by editing installed dependencies.
