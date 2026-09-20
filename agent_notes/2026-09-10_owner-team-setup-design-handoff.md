# Owner team setup: design correction and implementation handoff

September 10, 2026. **Design complete; new owner operation not implemented or deployed.**
Current runtime is `.3`. Do not tell Font Maker that `configure_team` is callable yet.

Read the [complete successor design](../product/buddies/DESIGN_OWNER_TEAM_SETUP.md).
It retains the existing resources and replaces a fragmented setup journey with one
owner-authorized composition, shared by Builder, a lead's owner chat and Settings.

## Diagnosis

The owner authorized team management, but the chat only had employee-scoped tools. The
lead therefore lacked the stored grants needed to carry out the request. Our tests
manually wrote those grants/settings before exercising execution. That skipped the
product failure. Repeatedly asking the same owner to grant individual bits was an
incomplete onboarding design, not proof that the owner had failed to give direction.

Keep employee grant checks. Introduce a real host-issued owner control for authenticated
owner turns, separate from the Buddy's standing authority. Never derive owner authority
from quoted text, a model argument, the absence of a delegation flag, or old thread history.
Asynchronous child returns must remain restricted even when they enter a former owner thread.

## Concrete change

One new owner MCP operation, `unleashd_owner.configure_team`, and one owner HTTP endpoint
use the same preparation/apply service. Prepare returns the full exact configuration diff,
all prerequisite failures and affected existing queue. Apply uses a host-bound owner
capability, current plan hash, existing atomic store operations and command receipts.
An already clear owner instruction needs no repeated grant approval in another screen.

For an onboarding request with imports, the composition is:

1. Resolve/adopt/create identities, configure reporting and standing access, keep held work held.
2. Read and reconcile authorized documents with existing revision-checked tools.
3. Enable incoming work on workers **and the returning lead**, then observe original receipts.

These steps use stable independent keys and recover from partial progress. There is no
new team table, work queue, assignment entity or mutable desired-state reconciler.
Existing owner/employee state boundaries still prohibit a developer from repairing the
live team's grants through HTTP, files or database access after a native denial.

## Issues the design addresses together

- Existing-team adoption and new-team creation share a single owner path.
- Dependency expansion prevents excessive or incomplete permission requests. In `.3`,
  Chief-as-manager needs no self relationship grant; an execution-only edit needs profile
  read plus execution management, not profile write.
- Handoff import precedes release of queued work; the return path is checked before activation.
- Directory search spans only already permitted workspaces. Discovery does not grant dispatch.
- Memory previews return only the requested document and its diff/revision.
- Real MCP automation discovery must advertise the action-specific fields callers need.
- Replays preserve later revocation and existing message/run IDs; they do not reapply old grants.
- Optional working-team staffing explicitly carries the new identity's initial incoming-work
  mandate. Old staffing grants do not silently gain it.
- Team setup never authorizes schedules, training, spending or external sends by implication.

## Live recovery targets, for an authorized owner scope

These are references from the supplied Font Maker evidence, not current execution claims:

| Record | ID |
| --- | --- |
| Font Maker workspace | `project_2f0a65f3-42a0-4527-92bf-686c29ed037a` |
| Chief Scientist | `buddy_b2ff0a7e-591c-4e76-9cc1-0cda8d171ec3` |
| Pixel | `buddy_f4940aaa-059d-4105-aa0c-0eb1fd4de3b5` |
| Path | `buddy_ef2ab261-bb31-4ed0-a3d9-4d5d9bd28bd2` |
| Original Pixel task | `message_367bfbfb-e28e-426c-9206-a39b99fdb887` |
| Original Path task | `message_3157688f-d3f0-4f96-b8d0-02f52d50c73c` |

Preserve both original bounded audits. No additional paid run, schedule, duplicate employee
or replacement task is needed to prove onboarding. Re-read canonical state before applying
anything; the supplied `held/background_disabled` observations are dated evidence.

## Completion evidence required

Extend the acceptance test to begin with only an authenticated owner input: empty grants,
existing unrelated identities and disabled incoming work. It must invoke the owner control
through its real boundary, then use actual employee MCP calls to manage the targets and
complete the existing requests. Test return delivery, stale-plan atomicity, crash/replay,
revocation, denied restricted turns, incomplete imports and private-document isolation.

Then perform one bounded live owner → lead → specialist → evidence → lead trial without
manual configuration repair. A setup receipt is configuration evidence, not acknowledgment
or task completion. The full design names the source modules, schemas and acceptance matrix.

General owner-private context isolation and the external inbox/demo-before-outreach adapter
remain separate unfinished requirements. This design must not be used to claim those are
already delivered.
