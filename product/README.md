# Product contracts

Living documents are organized by workstream. Dated reviews, handoffs, and sprint
boards belong in the flat `agent_notes/` directory.

Start with the [Buddy team operator guide](buddies/TEAM_OPERATOR_GUIDE.md): inspect
readiness → preview/apply setup → assign a project → send bounded work → verify
evidence and return delivery. Owner-native `configure_team` is implemented; saving
setup does not prove that a particular team has started or completed work.

| Contract | Scope |
|---|---|
| [Buddy coordination](buddies/PLANNING_PRIMITIVES.md) | Send/reply, bounded waits, open purposes |
| [Buddy memory](buddies/PLANNING_MEMORY.md) | Dense revisions, evidence notes, capture, recall |
| [Direct reports](buddies/PLANNING_SUB_BUDDIES.md) | Identities, relationships, retirement, visibility |
| [Team management](buddies/DESIGN_TEAM_OPERATIONS.md) | Current authority model and links to native operating contracts |
| [Background work](buddies/DESIGN_BACKGROUND_TASK_EXECUTION.md) | Recipient-owned projects, typed work delivery, completion and recovery |
| [Owner setup design history](buddies/DESIGN_OWNER_TEAM_SETUP.md) | Rationale and dated successors for the implemented owner configuration operation |
| [Automation ownership](buddies/AUTOMATION_OWNERSHIP.md) | Run authority, budgets, cancellation, recovery |
| [Mobile plan](mobile/PLANNING_MOBILE.md) | Mobile view tree |
| [Mobile handoff](mobile/HANDOFF_MOBILE.md) | Mobile implementation context |

Each Buddy contract starts with its implementation map. Historical artifacts keep
their original date and an archive banner; old “not built” statements do not
override the current contracts. `AGENTS.md` links the living entry points.
