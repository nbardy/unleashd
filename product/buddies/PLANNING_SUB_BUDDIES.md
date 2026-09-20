# Direct reports

Current contract · updated 2026-09-13. Start with the
[team operator guide](TEAM_OPERATOR_GUIDE.md) for setup, assignment and returns.
The [coordination contract](PLANNING_PRIMITIVES.md) defines native delivery;
[budgets and limits](BUDGETS_AND_LIMITS.md) is the shared policy reference, with
implemented behavior distinguished from the proposed lead-review flow.

| Capability | Implementation |
|---|---|
| Creation, grants, relationships, profile provisioning | `@nbardy/buddies`: `createTeamBuddy`, `setTeamRelationship`, `updateTeamProfile`, `updateTeamDocument` |
| Manager tools and scope checks | `server/src/buddies/direct-reports.ts`, `operations.ts`, `mcp-server.ts` |
| Owner relationship control and team projection | Profile/detail routes; desktop and mobile profile editors |
| Boundary verification | `server/test/buddy-direct-reports.test.ts`; package `test/direct-reports.test.js` |

A direct report is an ordinary persistent Buddy with one manager, its own soul
and memory, projects, and automations. An ephemeral harness sub-agent lives only
within a turn and is a separate mechanism. There is no third Buddy lifetime.

The owner-side Buddy Builder can compose the same hierarchy while hiring a team:
`create_buddy` accepts `managerBuddyId` of an earlier hire from that conversation
or connects saved hires with `set_relationship`. The package commits an inline
manager edge atomically with creation; the manager must belong to the report's
workspaces. `consults` relationships express collaboration without a second manager. Builder `new_project` saves initial work for its own
hires without starting execution. See the
[team setup contract](DESIGN_BUILDER_TEAM_SETUP.md) and its wave_sim fixture.

A lead uses `get_capabilities`, `create_buddy` and `set_relationship` to create or attach
staff. Explicit owner grants authorize creation and reporting changes. Existing IDs are
attached without replacing identities, memory or work. Restricted runs can use these atoms
when both their saved operation policy and the current owner grants permit them.

Two older tools remain as compatibility helpers in ordinary owner conversations:

- `hire_direct_report({key, name, role, soul, provider?, model?, reasoningEffort?})`
  composes creation and a manager relationship under the same staffing grant. Reuse
  the stable key. Additional workspace membership requires owner membership controls.
- `retire_direct_report({buddyId, reason, reassignOpenWorkToManager?})` archives a
  report. Open projects must be completed first or explicitly transferred to the
  manager; the manager must belong to every affected workspace. Target `profile.write`
  and `execution.manage` grants are required.

The owner removed hiring quotas on 2026-09-09. There is no seat-funding step. A reporting
line grants work supervision, while staffing/profile permissions use explicit owner
grants as requested in the September 10 feedback. The legacy `hire_quota`
column can remain for stored-data compatibility, but it does not gate hiring or
reparenting and the UI has no quota control. Execution budgets remain separate.

Creation replay uses a stable key, not a name match. It does not reactivate an archived
identity or undo later owner changes. Retirement preserves the manager edge and history, disables
schedules, and cancels outstanding coordination work. Active automation occurrences
must be cancelled and drained by the scheduler before retirement; the store
serializes this check with new claims so neither operation can race the other.

The store decides canonical employment. Detail responses include `employment`,
`manager`, and `team`. Both shells consume this
projection instead of reconstructing relationship direction. Archived reports retain their canonical manager edge and history in the store,
but public app projections omit them from teams, directories, messages, and
conversation navigation. Individual Buddy Settings exposes Delete as archival;
it disables schedules, cancels automation runs, and stops active conversations.
Archived Buddy detail URLs return 404. WebSocket init and archive events keep
both shells' visibility current without deleting transcripts or memory. The overview shows only non-archived top-level Buddies and promotes surviving
reports to visible top-level entries when their manager is archived.

Hire/retire are unavailable in delegated conversations and automation runs,
even if a caller tries to add them to an operation list. These tool scopes are not an
OS security boundary: locally launched agents run as the owner's user. Stronger
containment needs a different process identity and authentication design.

The historical [implementation review](../../agent_notes/2026-08-19_sub-buddies-design.md)
and [handoff](../../agent_notes/2026-08-20_direct-reports-handoff.md) explain the
historical quota decision, transactions, and filesystem failure cases. The owner's
2026-09-09 correction supersedes that quota decision. Their old “not built” statements
are historical, not current status.
