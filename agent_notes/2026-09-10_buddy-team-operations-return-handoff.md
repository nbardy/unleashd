# Buddy team operations — return handoff

Status: the two team-management handoffs are implemented and pass integration tests in the working copy. Actual team configuration and a live-provider acceptance trial remain outstanding. Final app/package contract: `2026-09-10.2`, schema 23. Updated September 10, 2026.

Do not interpret this as “all historical Buddy work is finished.” The larger privacy and
external-inbox requirements are listed explicitly below.

## September 10 recovery update — use the existing requests

The Chief's **07:16 UTC** `TEAM_CONTRACT_UNAVAILABLE` report was real evidence of a loaded
runtime mismatch, not evidence that a staffing grant or replacement task would repair it.
Fresh native development-session reads succeeded with `.2` at **07:51:15 UTC** and
**08:08:35 UTC**. The latter still lacked the new `contract`/`ownerSetupUrl` fields: the app
process serving the active conversation has not loaded this latest recovery patch. Its
normal reload must wait for active work to drain. Neither observation verifies the Chief's
current session or changes his team's configuration.

The patch keeps `get_capabilities` diagnostic during team package incompatibility, including
expected/loaded version and a remedy. Authorized message reads remain available with
`execution.state:"unknown"`; null `runId` in that case means unknown, not that the old run
was lost. Team mutations still reject the mismatch. No new MCP tools or data tables were added.

After the app reload, use **Chief → Settings → Font workspace → Team management access**.
`get_capabilities({targetBuddyId})` supplies a relative `ownerSetupUrl` selecting the exact
workspace and target. The corresponding routes are:

```text
/buddies/buddy_b2ff0a7e-591c-4e76-9cc1-0cda8d171ec3/settings?workspaceId=project_2f0a65f3-42a0-4527-92bf-686c29ed037a&targetBuddyId=buddy_f4940aaa-059d-4105-aa0c-0eb1fd4de3b5
/buddies/buddy_b2ff0a7e-591c-4e76-9cc1-0cda8d171ec3/settings?workspaceId=project_2f0a65f3-42a0-4527-92bf-686c29ed037a&targetBuddyId=buddy_ef2ab261-bb31-4ed0-a3d9-4d5d9bd28bd2
```

The owner can attach the selected existing identity and enable incoming work there. The
message card also offers **Enable incoming work** when the receipt reports
`background_disabled`. It changes the existing membership, so already queued requests may
start. It does not create a new message, run, schedule or private-document grant.

For the Chief's currently documented review scope, use `relationship.write`, `profile.read`
and `soul.read` on each exact specialist. Soul writes and private memory are separate choices;
do not bundle them into read-only review. If the owner enables incoming work directly, the
Chief does not need `execution.manage` merely to observe execution. Delegating future
incoming-work control requires `profile.read` plus `execution.manage` explicitly.

Preserve and inspect these exact requests:

| Recipient | Message | Original recipient run |
|---|---|---|
| Pixel | `message_367bfbfb-e28e-426c-9206-a39b99fdb887` | `buddy_run_bb662919-1297-4ef3-baae-173406eb8e57` |
| Path | `message_3157688f-d3f0-4f96-b8d0-02f52d50c73c` | `buddy_run_d46dc532-0f8b-447e-a616-6e97b71dde8a` |

Resume the existing Chief conversation `1be773df-1f2b-4ce1-b46b-3ee707e27166`. After any
needed MCP refresh, inspect each target with `get_capabilities`, then each saved message
with `get_message`. Confirm its original run moves through admission/running and receives
a recipient reply or explicit recipient project acceptance. Use `get_runs({rootMessageId})`
for attempts. **Do not resend these audits or create replacement projects.** If they remain
held, report their exact code/reason/remedy. `retry_run` is for inspected interrupted/failed
attempts, not disabled incoming work.

The queued audits may reference the Chief's coordination project. Acceptance of that project
by the Chief is not Pixel or Path acknowledging a request. The package now enforces this
in receipts. A completed provider run alone still does not establish a completed deliverable.

Current development-session capabilities deny staff creation, reporting changes and execution
management. No live Font Maker configuration was changed here; using another interface to
bypass that native scope would be incorrect. The owner controls are implemented and tested,
but their live application and the Chief's receipt recheck remain required.

### Recovery verification

- Package commit `6c9343bfa16fb666b928fe58c085af500e07be6e`; reproducible archive SHA-256
  `fa2ec4ec58e908aca0e5529645d18c606f6461d8a358f9947e9bc069d154cf58`.
- Official clean-source vendoring and installation completed; root and server installed
  package code/declarations match the archive byte-for-byte.
- **65 package tests, 84 Buddy server tests and 25 Buddy client tests passed; one opt-in live
  parser test skipped.** Shared/server/client builds, client TypeScript and all six client
  invariant gates passed. The separate foreground deadline/runtime regression also passed.
  The counts are this targeted recovery run, not a full repository run.
- `server/test/buddy-team-recovery.test.ts` exercises real MCP, owner HTTP and temporary SQLite:
  incompatible package diagnostics, private-message denial, replayed attachment/minimal grants,
  incoming enablement, original run IDs, running state, explicit replies and no duplicate requests.
- The test explicitly drives recipient execution; it is not a live model/scheduler demonstration.
  Existing coordination/runtime boundary fixtures also pass. Owner UI click-through remains
  unverified in an authenticated browser.
- Logs: `/tmp/buddy-team-{package,server,client}-recovery-20260910.log`.

## What changed

The two handoffs identified missing team configuration, profile access and execution visibility. Their proposed one-off onboarding and assignment APIs have been reduced to ordinary identities, relationships, explicit owner grants, versioned documents, projects, messages and runs.

- `get_capabilities({targetBuddyId})` reports the loaded contract, effective grants, relationship/work scope and denial reasons.
- `create_buddy({key,name,role,soul,...})` imports one new identity. Reuse the key to resume safely. Existing specialists should be attached by ID instead.
- `set_relationship({key,fromBuddyId,toBuddyId,kind:"manager"})` installs the reporting line and preserves identity, memory and projects. `consults` connects a shared specialist without copying it.
- The same operation with `present:false` removes an edge. Replaying setup cannot reactivate an archived identity. The old hiring helper uses the same staffing grants as `create_buddy`.
- `get_profile` / `update_profile` use a current revision, stable key and reason. Incoming-work enablement requires a separate execution grant.
- `get_soul` / `update_soul` and `get_memory` / `update_memory` accept an authorized target. Updates use the complete document, current baseVersion, reasoning and stable key. `preview:true` returns the proposed difference. Private document bodies are excluded from the new team-edit audit records.
- `new_project({ownerId,key,title,definitionOfDone})` then `send({to,key,projectId,purpose,body})` is the assignment recipe. No extra assignment object or dispatch queue was added.
- The recipient records acceptance by setting the project `in_progress`; completion requires `done` plus evidence. It then replies to the message.
- Send receipts and message/run reads expose execution state, run ID, blocker/remedy, acknowledgement and project acceptance/completion evidence.
- `send({projectId:null,...})` starts fresh recipient work while preserving the source project. Use this when completed research hands off implementation. Otherwise the current or follow-up project is retained.
- `set_automation({action:"enable",automationId,baseRevision,key})` requires an owner schedule grant. Creation remains disabled by default.

## Owner setup

In the lead's Settings → Background coordination → workspace → Team management access, choose each exact specialist and grant the intended capabilities. Creation is a separate workspace grant. Private memory, soul, incoming execution and recurring schedules are separate choices. Grants can be revoked; checks happen again on mutation and replay.

| Intended responsibility | Exact grants |
|---|---|
| Attach an existing specialist | `relationship.write` on the specialist; also on the other endpoint if it is not the acting lead |
| Inspect/change profile | `profile.read`, `profile.write` on the specialist |
| Import soul | `soul.read`, `soul.write` on the specialist |
| Import working/long-term memory | `memory.read`, `memory.write` on the specialist |
| Enable incoming work | `profile.read`, `execution.manage` on the specialist, or owner enables its background setting directly |
| Create a new identity | `staff.create` on the workspace |
| Activate a recurring check-in | `schedule.manage` on the Buddy that owns the schedule |

New identity creation grants initial profile/document/relationship access to its creator,
but does not grant execution or schedule activation. Enable the new specialist explicitly
before expecting it to run. A grant starts no work. A manager relationship permits work
supervision and assignment; it does not grant private documents. Read-only access can be
selected independently in the owner controls.

These grants affect the same identity across its workspaces. They do not authorize training, spending or external actions. The local app is a trusted owner environment; these MCP restrictions are not an OS sandbox against an unrestricted local process.

## Font Maker identities

Use the existing active identities from the Chief Scientist handoff:

- Chief: `buddy_b2ff0a7e-591c-4e76-9cc1-0cda8d171ec3`
- Pixel Lead: `buddy_f4940aaa-059d-4105-aa0c-0eb1fd4de3b5`
- Path Lead: `buddy_ef2ab261-bb31-4ed0-a3d9-4d5d9bd28bd2`
- Workspace: `project_2f0a65f3-42a0-4527-92bf-686c29ed037a`

Do not recreate them. Do not reactivate archived Chief `buddy_87fc5085-7ce5-4af5-8a44-1712b3ace667`. Empty directory relationships mean configuration is absent; a denied work read does not mean there is no work. No live Font Maker identities have been edited by this implementation test.

## Lead workflow

1. Call `get_capabilities` on each target. A missing tool/contract requires a matching server/package and fresh MCP session. An explicit `owner_grant_required` response requires stored owner access, not a retry loop.
2. Attach the existing specialists. Import only genuinely new identities, with stable creation keys.
3. Read current profiles and documents, preview changes, then apply them with those exact revisions. On conflict, reread and reconcile; never substitute file or database edits.
4. Create one bounded project per recipient. Send its ID and a concrete handoff using another stable key.
5. Inspect `get_message` and `get_runs`. A queued message is not proof of scheduler failure. Resolve the reported background, permission, predecessor, project or runtime hold.
6. Review acceptance and completion evidence. Follow up with `send({continueFrom:originalMessageId,...})` to reuse the recipient thread. Replies can return to the originating lead thread.

Use stable keys for each logical step, for example `team-v1:pixel:attach`,
`team-v1:pixel:profile`, `team-v1:pixel:project`, `team-v1:pixel:dispatch`. Repeating the
same step with the same arguments returns its saved effect. Changed intent needs a new
key and, for edits, a fresh revision. Do not generate a new random key when retrying a
timed-out request.

For a profile import: `get_profile` returns `revision`; pass it as `baseRevision`.
`get_soul` returns `body` and `revision`; `get_memory` returns `content` and `revision`.
Document updates take that revision as `baseVersion`. Preview the full proposed replacement
with `preview:true`, then commit the same content/revision with a stable key. Authorized
soul import also handles an existing Buddy with no configured soul path. Working/long-term
memory caps are 2,000/4,000 characters; retain larger source material as supporting evidence.

Recipient acceptance is explicit: `update_project({status:"in_progress",...})` by the
assignee. Completion is `status:"done"` plus evidence, followed by `reply`. A completed
provider run alone proves neither acceptance nor delivery. Supervisors can see run and
project state without reading private message bodies, private memory or raw provider output.

## Interpreting an incomplete step

| Result | Action |
|---|---|
| Missing tools, `TEAM_CONTRACT_UNAVAILABLE` or `TEAM_CONTRACT_MISMATCH` | Install the matching app/package, then start a fresh MCP session. Expect `contract.compatible:true` and both expected/package versions `2026-09-10.2` on the updated app. An older `.2` response without `contract` needs the app reload for the latest diagnostic behavior. |
| `workspace_scope` | Owner admits the exact identity to the workspace; do not duplicate it. |
| `owner_grant_required` / `grant_expired` | Owner supplies or renews the named target grant. A reporting line does not substitute for it. |
| `run_policy` | This run's saved allowlist excludes the operation. Use a newly authorized execution; granting access does not rewrite an old policy snapshot. |
| `background_disabled` / `background_paused` | Owner or execution-authorized lead enables/resumes incoming work. |
| `project_gate` / revision conflict | Inspect the project or ancestor and reconcile against its current revision. |
| `active_run_limit`, `predecessor`, `not_due` | Inspect active/source work or wait until the due time; do not create another dispatch. |
| `awaiting_admission` | Accepted, waiting for an executor/conversation slot. Inspect scheduler health if it persists. |
| `legacy_dispatch` | This old message has no durable run receipt. Inspect its existing child/legacy dispatch before deciding whether to resend. |

Public execution fields are `messageId`, `runId`, `state`, `code`, `reason`, `remedy`,
`conversationId`, `projectId`, `acknowledgedAt`, `acceptedBy`, `acceptedAt`,
`completionEvidence`, `outcome` and `error`. Claim tokens are excluded.

## Earlier verification checkpoint — superseded by the recovery update above

- Package source: `codex/system-finish-20260910`, commit `11ebcea6a50f7e8c35dffee60a632b43564091a0` (includes `2a47847` and `bd6e61d`).
- Archive SHA-256: `44a40c9e56e9ced7b8bcceccd4ce691bf43a01f5d040ae5d43e5396c20ef5b84`.
- Official vendoring script packed twice from a clean commit, verified the manifest contains no runtime/private/untracked files, recorded provenance, and installed the archive/lockfile.
- Package: **64 passed**. Server: **263 passed, 1 separate live Claude parser test skipped**. Client: **63 passed**. Server/client typechecks, shared/server/client builds and all six client invariants pass.
- The MCP boundary fixture attaches four existing identities, imports a fifth, updates granted documents/profiles, assigns four bounded projects, starts recipient runs, records acceptance/completion/replies, and verifies replay and revocation. One existing identity starts with no soul path. These use temporary durable stores, not the real Font Maker team.
- Existing runtime fixtures cover Chief → lead → engineer → review → lead → Chief, follow-up in the same application conversation, and recurring checks. The completed-research → new-simulation-work boundary also passes.
- Fresh fixture MCP checks report `2026-09-10.2`. The **already-running native session** still reported `2026-09-10.1` at `2026-09-10T07:16:19Z` and correctly denied this development Buddy staffing/team-edit grants. That is direct evidence that an existing session can be stale after code updates; refresh it before live acceptance.
- Browser inspection reached the authentication screen. Visual interaction with the owner grant form is not yet verified.
- No live specialists were attached, hired, reactivated, assigned or launched by these tests. No external messages, customer emails or recurring production schedules were created. Main app changes remain in the shared working copy; nothing was pushed.

## Remaining broader work

The authoritative completion project remains open for a live natural-language team trial,
general workspace/private knowledge separation (including provider-session context), and
the real inbox/action adapter. The inbox folder/account is still unspecified. Demo-video
prerequisites and outbound idempotency are not machine-enforced at an email boundary yet.
Training, spending and external-action approvals remain separate from all grants above.

Neither the test counts nor the package's reproducible-release flag establish that a team
can independently run a business safely or that every earlier Buddy request is complete.

Design: [Team operations](../product/buddies/DESIGN_TEAM_OPERATIONS.md).
Source feedback: [Font Maker handoff](/Users/nicholasbardy/git/font_maker/CHIEF_SCIENTIST/2026-09-10_buddy_team_missing_capabilities_handoff.md).
