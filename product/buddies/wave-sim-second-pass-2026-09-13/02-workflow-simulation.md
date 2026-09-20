# CEO operating simulation: normal day and failures

These are hypothetical actions and expected records, not claims that Wave_sim
staff executed them. Symbols such as `product-project` stand for existing IDs
resolved through current native reads. Use the active tool schema, not the old
`expectsReply`/`execution` draft syntax.

## 1. Morning reconciliation

CEO reads inbox and current work, then a bounded Team page for the active root.
He sees an old cancelled startup, a failed attempt with a checkpoint, and a newer
done project. He keeps these as three facts. A later project revision cannot turn
the cancelled request into an acknowledged one. He expands the exact messages
that require decisions and reads their versioned artifacts.

**First-pass shortcoming found:** native inbox returns full bodies, policy JSON
and repeated evidence. The store reads only the first 100 messages before the
audience filter. A project-scoped manager can miss readable work buried behind
unrelated private messages. Routine reconciliation needs compact pages with
filtering before pagination and explicit expansion, not more prompting.

## 2. Prove one round trip, then dispatch four independent lines

CEO inspects existing assignments and capabilities, previews the exact Project
Lead request, then applies the same key and payload. Project Lead uses existing
recipient-owned projects and typed managed delivery:

```json
{
  "key": "reviewed-first-wave-product-v1",
  "to": "product-lead-id",
  "purpose": "Complete the existing M0 packet",
  "body": "Use the selected source and existing criteria. Save versioned evidence, delegate bounded child work, and return the deciding results.",
  "delivery": {
    "kind": "work", "projectId": "product-project",
    "maxRuns": 4, "maxDurationSeconds": 7200
  }
}
```

Product assigns its Engineer and Designer. GTM assigns Market Research. Simulation
reconciles engine/source authority before any numerical step. Frontier selects one
bounded falsifiable hypothesis. Each send has a different stable key and existing
project. Replaying one send returns its original receipt. A queued receipt is not
reported as running. Each recipient marks project acceptance through a revisioned
update; managed completion requires every non-cancelled todo's own evidence.

## 3. Keep independent work moving

Product's Engineer blocks on an actual fixture mismatch. Designer can continue a
storyboard using already-published market evidence. Simulation awaits numerical
authority while GTM prepares interview questions and unsent drafts. Project Lead
records the exact blocker on the affected task, not a blanket team stop.

An active manager turn ends after dispatching and checkpointing. Outstanding
children suspend its managed chain; the runtime resumes eligible work on return.
The manager does not create a second self-assignment to manufacture continuation.
Waiting between attempts consumes the original elapsed work envelope. A live turn
has its own cap. The actual admitted snapshot/deadline outranks a prose request.

## 4. Cross-functional artifact and consumer review

Market Research publishes a team-visible checkpoint naming `market-evidence.md`,
its commit/hash, findings and saved effects. Product Designer needs a reviewable
artifact, not another private project's work assignment. A direct consultation
uses `delivery:{kind:"request"}` without borrowing the producer's project ID;
exact preview either validates the route or returns the missing prerequisite.

Designer replies with `outcome:"accepted"` or `"needs_revision"` and the precise
artifact/version reviewed. A progress inform uses `inReplyTo` for the actual
request's return route. Those ordinary messages express the handoff and verdict.
They do not require a second handoff database. Manager relay remains appropriate
when no direct route is authorized; copying a denied private body is not a remedy.

## 5. Reply while the CEO is busy

Project Lead finishes a review and the reply persists. CEO is already in an owner
turn. Return delivery stays queued, then admits once when the conversation drains.
A known failure before admission may retry automatically up to the existing bound.
An admitted or uncertain input does not replay automatically. Old failed delivery
attempts remain visible alongside the successful retry.

**First-pass shortcoming found:** Team observation reduces deliveries to strings
such as `message_reply: failed`. It drops run IDs, retry ancestry, admission time
and errors from the joined view. CEO cannot identify which return to inspect or
recover. Preserve structured delivery receipts and page them instead.

## 6. Timeout after a checkpoint

Engineer saves the artifact first, then registers a checkpoint with version,
SHA256, effects and resume instructions. The attempt expires. Team shows failed
attempt, surviving reference, original remaining runs/time and actual controllers.
CEO or original sender inspects effects and retries once with a stable key and
checkpoint. Replaying that retry returns the same successor. No new full budget
or unrestricted policy appears. A historical already-replied timeout receives a
linked successor request; its old failure remains unchanged.

The checkpoint is an attestation, not an automatic filesystem verification. The
recovering employee verifies the bytes and reconciles uncertain effects first.
Stopped roots and deleted destinations do not revive. A consumer can review a
surviving artifact without claiming the failed producer attempt completed.

## 7. Inspect the right page, then recover

CEO goes to older checkpoints on one run, chooses a checkpoint and submits a
recovery reason. The displayed receipt must stay in the selected workspace and
run. Returning to all executions restores the execution page; changing Buddy or
workspace must reset old offsets and selected checkpoint/run state.

**First-pass shortcoming found:** the Team component shares page state across
changing Buddy/workspace props, and leaves execution pagination active during a
single-run checkpoint view. Old offsets can yield an empty new workspace or make
the Next button appear to do nothing. Key the stateful view to its scope and give
checkpoint/delivery detail their own explicit paging controls.

## 8. Closing the day

CEO reviews current criteria and the consumer's verdict, updates the authoritative
project and records the decision with pinned evidence. M0 closes only from its
deciding artifacts. A successful return proves delivery, not accepted physics,
deployment, a finished board report or outreach permission. The restricted memory
review can reconcile stale orientation against current project observations.

The report back lists meaningful results, unresolved requirements and next
decisions. It does not claim model/effort switching from a prose instruction,
independent process heartbeat, GPU lease ownership or metered spend enforcement.
