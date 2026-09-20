# Efficient work reads and assignment configuration

Local implementation · September 15, 2026 · resource contract `2026-09-15.1`

This extends existing Tasks, Mail and conversation configuration. The
[core design](CORE_DESIGN.md) still owns their responsibilities. Source changes
and isolated tests are not proof that a running host has reloaded this version.

## Find current work, then expand the decision

```javascript
get_current_work({view: "summary", order: "recent", limit: 20})
get_current_work({projectId: "…", view: "full", includeClosed: true})
get_current_work({view: "summary", statuses: ["blocked", "review"]})
```

Summary rows contain project/owner IDs, revision, current status, execution state,
update time, priority, bounded title/blocker/next action, todo counts and evidence
counts. `truncatedFields` identifies shortened text. Read full criteria, todos
and evidence before deciding completion. `view: "full"` remains the default;
the owner resource exposes the same summary and expansion behavior.

Work reads accept 1–99 records, default 20. `nextCursor` is opaque. New cursors
bind the authorized result set and query. If work changes or access narrows
between pages, the server returns `STALE_WORK_CURSOR`; restart without the cursor.
This catches updates, closures, removals and access changes instead of silently
skipping shifted rows. Legacy offset cursors remain accepted for compatibility.

`updatedSince` is an **inclusive timestamp filter on current records**. Use
`includeClosed: true` to discover recently closed work. It does not report
deleted records, every intermediate transition or records removed from your
audience. It is not a synchronization/change-feed cursor. A durable event feed
with tombstones and access-change semantics remains separate work. Repeated
changes can invalidate a long scan; a smaller focused query reduces that risk.

## Read recent messages or outstanding requests

```javascript
get_inbox({order: "recent", limit: 10})
get_inbox({filter: "outstanding", order: "recent"})
get_team_state({view: "summary", states: ["held", "failed"], limit: 10})
get_team_state({runId: "…", view: "full"})
```

Inbox `filter` and `order` apply to messages before pagination. `outstanding`
means pending/active, including requests awaiting another participant; it does
not mean every returned row requires this Buddy to act. `recent` sorts by last
update. Defaults preserve attention order. `updatedSince` is inclusive; other
inbox sections remain current blockers. Message/reply previews now identify
truncation explicitly. Expand a message through `get_message`.

Inbox limit is 1–50, default 20. Team limit is 1–50, default 20; team checkpoint
and delivery detail limits are 1–10, default 3. `states` filters before the
team page bound. Team summary omits checkpoint and delivery detail arrays while
preserving counts and `detailsOmitted`; expand by run ID. Inbox/team pagination
still uses existing offsets and is not a gapless change feed.

MCP results retain text and structured representations for compatibility. Text
uses compact JSON. Provider billing for those representations is not measured.

## Select the configuration for one assignment

```javascript
send({
  key: "inspect-export-v1",
  to: "buddy-recipient",
  purpose: "inspect",
  body: "Inspect the saved export and return evidence.",
  preview: true,
  delivery: {
    kind: "request",
    config: {
      provider: "codex",
      model: {mode: "explicit", modelId: "gpt-5.6-luna"},
      reasoning: {mode: "explicit", effort: "low"}
    }
  }
})
```

`delivery.config` is optional for `request` and `work`. It is the existing
`ConversationConfig`: model `default|explicit`, reasoning
`default|disabled|explicit`, and provider-owned model/effort strings. Catalog
validation and required-MCP capability checks use the common provider boundary.

Preview validates routing and resolves configuration without persisting changes.
Apply rechecks; its `assignmentConfig` receipt is authoritative for that send.
The first application pins resolved defaults. Same-key replay returns the
original request/selection even after defaults change. Changing the intended
payload under that key is a conflict. Buddy profile preferences are untouched.

Fresh assignments create an inert conversation with the pinned configuration.
`continueFrom` may reuse a conversation only when its current effective provider,
model and reasoning match. Otherwise `assignment_config_conflict` explains how
to use a separate request. The host rechecks the actual resolved configuration
immediately before provider invocation. An intervening configuration change
fails that attempt rather than silently invoking a different model.

Selection persists in the existing run policy, including retries, managed work
continuations and interrupted-worker reports. It does not change the lead's
return/review configuration. Without `delivery.config`, existing recipient and
conversation selection behavior remains in effect.

`get_team_state` exposes `requestedExecution` before invocation and `execution`
after the runtime records the provider request. An uninvoked/cancelled attempt
has no actual execution snapshot. These describe the host's request, not proof
of a provider's undisclosed internal routing. Provider-native semantics have not
been reverified by a live paid-model run for this change.

## Timing and usage limits

Team observations report per-attempt `queuedMs`, `claimedMs` and `elapsedMs` from
durable timestamps. A terminal attempt's durations stop advancing. Claim time
includes creation and runtime overhead; it is not provider-active time. Sum of
overlapping claims is not end-to-end wall-clock latency.

`usageCoverage` returns `tokens: null`, `cost: null` and the reason: the current
host event contract exposes neither provider usage nor billed cost. No token
meter, spending enforcement or complete assignment-tree cost total is claimed.
Those need provider event capture, interruption coverage and deduplicated
aggregation first.

## Attention and returns

Task comments already preserve progress without waking another Buddy. Managed
parents already coalesce child returns through the package's existing
background-work reconciliation. Separate requests sharing a background review
conversation retain their individual runs, originating requests and limits.

Automatic cross-request batching is not introduced here. It needs a defined
authority/allowance and urgent-return policy before one provider turn may consume
several requests. Serialized admission alone is not semantic batching. This
preserves cancellation, audience isolation and attributable returns.
