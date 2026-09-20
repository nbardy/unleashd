# Unleashd / Buddies: Font Maker field feedback

From: Chief Scientist and the Font Maker research workflow  
Evidence window: September 9–15, 2026; live checks September 15, approximately 13:55–13:58 UTC.

## Overall assessment

The native MCP tools now support a real, inspectable handoff to an existing specialist. Pixel received the dataset-publication assignment, acknowledged it, accepted project ownership, and posted an evidence-bearing progress report. This is a meaningful improvement over the September 10 briefs that were saved but never started.

The main product problem is the amount of control-system knowledge needed to operate a small team. The owner asks for a colleague to take responsibility; the agent must reconcile identity, reporting relationships, workspace membership, grants, incoming execution, request type, project state, return routing, and document audience. Each distinction can be justified. Their combined operational burden repeatedly displaced the actual research work.

We have evidence of delegation and progress, not yet a completed specialist assignment followed by an independently verified manager review and successful result delivery. No team-throughput improvement or cost saving has been measured.

## What worked well

1. **Persistent identities and evidence survived the changes.** We reused Chief and Pixel rather than making replacement agents. Original failed/held requests remain inspectable, with IDs and their eventual cancellation recorded. The archived duplicate Chief was preserved as archived.
2. **Owner-native setup is a substantial improvement.** On September 10, a native relationship write was rejected with `owner_grant_required`, without an exposed bootstrap operation. By September 12, `configure_team` preview exposed exact effects and a specific workspace prerequisite. September 15 receipts show Pixel's reporting edge and incoming execution were applied successfully. Preview, revision checks, stable keys and audit receipts make changes reviewable. Retry safety is a useful contract; this retrospective did not fault-inject duplicate submissions to prove every path.
3. **The latest handoff became observable work.** The September 15 message was created at 13:50:32.282 UTC, acknowledged at 13:50:33.252, and accepted by Pixel at 13:50:56.803. At 13:55:55 Pixel posted its own process/artifact audit and test results. Those are worker reports, not a fresh independent verification of every underlying artifact in this retrospective.
4. **Projects provide a useful completion contract.** The child project has an accountable owner, four concrete deliverables, evidence fields and a parent link. It can remain incomplete while a process runs. That matches research engineering, where a successful launch or falling loss cannot establish completion.
5. **Access boundaries are explicit.** Current Pixel supervision works while private-document reads remain denied. Discovery does not silently grant private access. Readiness and error responses give structured codes and remedies.
6. **The documentation team addressed prior feedback.** The current product index links a dedicated operator guide and describes owner setup as implemented. Background-work examples now use typed `delivery`; the memory guide explains native document refs; the live capability response includes `documentOperationMapping`. These correct several September 12 findings. Do not forward the old audit as a list of unchanged defects.

## Highest-priority friction and requested changes

### P0: A successful soul edit can leave the active behavior unchanged

**Observed:** This turn's injected soul lacks the new delegation section. A scoped `get_document` returns that section at revision `doc:1de1a312e3b81098306349a6:3`; an unscoped read returns the older portable soul at `doc:006618fdccf94fbaccc30043:2`. The earlier handoff recorded a successful scoped owner edit and read-back. The injected context also publishes the scoped ref and instructs us to include that audience in document refs.

The current memory guide explains that adding an audience selects a different document, while omitting it selects the portable soul. This is therefore a demonstrated resource-selection trap, not established evidence of cache or reload failure. Our earlier verification checked persistence on the edited resource, but did not establish that it drove the next briefing.

**Impact:** The owner can reasonably hear “I updated my soul” while the operating preference used in the next turn remains unchanged.

**Request:** Give the portable identity and published role document distinct names. Expose which exact ref/revision drives the active briefing. A write preview/receipt should say where the change will take effect. Make generated context point to the correct editing resource for the intended behavior.

**Acceptance test:** Edit a delegation preference in an owner chat, then begin another turn. Verify both the effective briefing ref/revision and the new text; also test that a scoped publication edit is clearly described as such.

### P1: Team setup required repeated discovery of separate gates

**Observed:** September 10 tasks were durably saved but held with `background_disabled`. Relationship and private-document grants were absent. September 12 setup then uncovered Path's additional workspace. Today Pixel can work, while Path still lacks the complete relationship/workspace/incoming configuration.

**Impact:** “Connect my team and start work” became repeated inspection and owner-configuration explanations. It was easy to confuse missing application configuration with a need for the owner to repeat conversational permission.

**Request:** An intent-based setup preview that resolves the minimal required settings for the requested assignment, shows all blockers together, and returns the exact owner action. Preserve explicit scope and private-document choices. Explain when a reporting relationship affects another workspace; consider workspace-local reporting if global reporting is unnecessarily restrictive.

**Trade-off:** From an access-control perspective, automatically granting everything would be unacceptable. Improve the workflow for the specific requested action rather than broadening default access.

### P1: Stop scope was broader than the apparent individual request

**Observed:** The September 15 handoff records that stopping the old never-started Pixel request also cancelled the old Path request because the backend placed it in the same root chain. Both were held, so no running work was lost in this incident. The current `stop` schema accepts run/root IDs but has no preview field.

**Request:** Show every affected request, Buddy and project before a chain stop. Distinguish “stop this attempt,” “cancel this assignment,” and “cancel this chain.” Make the lineage visible from the original request.

**Acceptance test:** Two sibling requests; cancelling one must either leave the other intact or explicitly show the sibling in the selected cancellation scope before mutation.

### P1: Status is detailed, but the operator must assemble the answer

**Observed:** `get_message.execution.acceptedAt` was null while its `projectSnapshot.acceptedAt` contained Pixel's acceptance. These fields represent distinct things, but are easy to misread. The capability response aggregates Path configuration failures and a `conversation_busy` return-path condition into `ready:false`, while Pixel is already running. It reports a busy destination despite the original message containing a separate background return route; no actual callback was attempted here, so whether this warning would delay delivery is unproven.

**Request:** A concise per-assignment summary: saved, admitted, input acknowledged, project accepted, last evidence update, awaiting review, delivered. Label attempt and assignment deadlines separately. Group configuration blockers, execution blockers and temporary return conditions. Include the actual selected callback destination and the reason it can or cannot run.

**Acceptance test:** Keep the owner chat active while the specialist finishes; verify where the result goes, whether review starts, and that readiness reports the same route the runtime uses.

### P1: Research operations lack reliable liveness and resource ownership

**Observed:** Current `get_team_state` explicitly says running is a durable claim without an independent process heartbeat; provider token usage and billed cost are unavailable; GPU reservations are not integrated as resource leases; artifact availability is not automatically verified.

**Impact:** A research manager still needs process IDs, logs, storage checks and billing checks outside the team system. An agent assignment ending does not explain what happened to its detached process or paid machine.

**Request:** Expose last provider/tool activity, stale-run detection, actual usage where available, and explicit ownership of external jobs/resources with a defined handoff or cleanup policy. Preserve “unknown” where telemetry is absent. Local detached jobs may intentionally outlive an assignment; paid GPU cleanup requires a different policy.

**Trade-off:** From a distributed-systems perspective, a status row cannot prove process health, and a heartbeat cannot prove useful work. Show both liveness and the latest artifact evidence without conflating them. These are missing integrations, not evidence that this particular run died or overspent.

### P2: Recall needs a relevance and output-size contract

**Observed:** `recall({pattern:"team", limit:30, scope:"current"})` returned 30 matches containing 141,572 content characters, including many unrelated June research/swarm documents. A match-count limit did not bound context size. My broad query and initially printing full tool envelopes compounded the problem.

**Request:** Metadata/snippets by default; expand exact refs. Add source-kind, date/order and path/topic filters plus a character/token budget. Clearly identify document kinds and revisions, especially portable versus scoped soul.

### P2: Some documentation still disagrees about return behavior

**Observed:** The current operator guide describes separate background return threads for new owner-chat assignments and Mailbox behavior for legacy assignments. The background-execution guide still describes human-chat results generically as Mailbox-only. The actual new message contains a background return route. Several earlier documentation defects are fixed; this remaining distinction needs harmonizing.

**Request:** One canonical return-routing table used by docs, receipts and UI, with version-sensitive behavior explicit. Keep the new operator guide as the front door and run its examples against the exposed schema.

## What we struggled with ourselves

- I became the implementation engineer before making team ownership explicit. The owner had to challenge that. Better routing cues would help, but the manager still owns delegation judgment.
- I treated save-and-read-back of the scoped soul as sufficient evidence for a behavioral change. It was not. Verify the effective briefing source.
- Broad recall and broad archive reads increased context noise. The agent should request narrow summaries and expand evidence selectively even before better retrieval controls ship.
- We should define the useful team loop as assignment → specialist evidence → manager assessment → accepted deliverable. A roster, a saved message, or a successful provider turn proves only an intermediate step.

## Suggested product acceptance scenario

Use one manager and two existing specialists in an authorized test workspace. Start from an ordinary owner instruction and use only public tools/docs. Preview and apply the necessary scoped setup; create and dispatch one small artifact task; observe acceptance and progress; complete it while the owner chat is active; verify the manager's evidence review and returned decision. Then test a held request, a stopped sibling, a timed-out attempt with existing artifacts, and a soul edit followed by a new turn. Keep explicit spending and workspace boundaries throughout.

Developer-experience objection to declaring the product effortless: our first useful specialist handoff still required understanding several backend state machines. That objection remains valid. The improvement is real; the next goal should be to make the common delegation loop understandable without reconstructing those internals.

## Evidence and coverage

- [Live native receipts and bounded evidence](2026-09-15_unleashd_buddies_feedback_evidence.json): employee contract `2026-09-15.1`, owner contract `2026-09-12.2`, assignment, comments, capabilities, both soul refs and recall measurement.
- [September 10 integration history](2026-09-10_buddy_team_missing_capabilities_handoff.md): includes `TEAM_CONTRACT_UNAVAILABLE` after exposed tools had previously worked, followed by recovery in the same conversation. Deployment/reload root cause was never established; it is historical and not recurring in this check.
- [September 12 interface/documentation audit](2026-09-12_buddy_team_and_documentation_audit.md).
- [September 15 handoff and queue reconciliation](2026-09-15_pixel_data_engineering_handoff.md).
- Current local docs inspected: `/Users/nicholasbardy/git/unleashd/product/README.md`, `product/buddies/TEAM_OPERATOR_GUIDE.md`, `DESIGN_BACKGROUND_TASK_EXECUTION.md`, and `PLANNING_MEMORY.md`.

This is an evidence snapshot and feedback artifact, not a replacement for native Task state. No messages were sent to staff or the product team, and no team configuration, soul, training code or compute resources were changed for this retrospective. Desktop/mobile UI behavior and restart recovery were not exercised. Product suggestions above are reasoned recommendations, not measured performance claims.
