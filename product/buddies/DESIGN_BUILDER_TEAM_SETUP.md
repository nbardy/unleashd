# Buddy Maker: compose a team from existing primitives

Decision and implementation contract · 2026-09-09

The [owner-to-team setup redesign](DESIGN_OWNER_TEAM_SETUP.md) defines the successor for
one owner workflow spanning both newly created and preexisting staff. It replaces the
product-level reliance on separate settings for existing teams. It is not yet implemented;
the created-identity scope described below remains the current Builder behavior.

For the final tested snapshot, API inventory and remaining whole-system gaps, see the
[September 10 system review](REVIEW_SYSTEM_SURFACE_2026-09-10.md).

The wave_sim request exposed a concrete mismatch: the Builder could save several
profiles, but explicitly prohibited managers and projects. It would therefore
produce eight independent top-level Buddies rather than the business team the
owner described. This document replaces that restriction for setup. It does not
select an entirely new storage architecture or declare the broader coordination
integration finished.

## Sample use case and expected result

The owner wants a persistent team in `~/git/wave_sim`:

```text
Project Lead
├── Go to Market Lead
│   └── Market Researcher
├── Product Lead
│   ├── Product Engineer
│   └── Product Designer
├── Wave Simulation Lead
└── Frontier Research Lead
```

Eight identities and seven manager edges. No hiring quotas. A direct report is
an ordinary Buddy with its own identity, soul, memory, work and conversations.
The Market Researcher has one manager, inferred as GTM, and can contribute to
Product through ordinary work and messages. Sharing expertise does not require
another identity or a second manager. Temporary harness sub-agents remain a
different, turn-scoped capability.

Each member of this working team has the existing background-execution setting
enabled so incoming requests and replies can run within the existing limits.
Without it, team messages would silently remain queued. Chat-only individual
hires retain the default disabled setting. Enabling the capability creates no
run and no recurring schedule; the saved card makes the setting visible.

Product and GTM receive the five target segments in their role briefs: wave pool
design, surfboard design, boat hull design, hydrofoil design and coastal
engineering. The owner's claim that coastal engineering is the biggest market
is retained as a hypothesis to investigate. The Designer challenges scope and
tests whether concrete target workflows become usable. Frontier Research
investigates sub-volumetric/non-volumetric fluid simulation; it hands useful
results to Simulation with theory, assumptions, evidence and limitations.

The request also asks for customer lists, theoretical use cases and customer
interviews. Preparation can be ready work. Outreach is blocked until demo video
evidence exists and the actual shared inbox/account has been identified and
configured. “Some shared inbox folder under ~/git” is not a concrete workspace:
do not register the entire parent folder, guess an account or claim it is wired.
There is no additional invented requirement to approve a market segment.

Setup saves this team and its initial work. It does not start employee runs,
send email, connect an account or create recurring wakeups. The existing Start
conversation action opens the Project Lead so the owner can begin that work.
The Builder must say this plainly when the hiring prompt also asks staff to
start researching. A saved research project is not completed research.

## Small atoms and their composition

| Atom | Durable authority | What the Builder does |
|---|---|---|
| Buddy | Existing identity and profile row | Create one keyed hire |
| Manager relationship | Existing canonical manager edge | Attach a new hire to a saved manager |
| Workspace membership | Existing explicit assignments | Resolve the home folder and specific additional folders |
| Background execution | Existing per-membership setting and limits | Enable bounded incoming work for an owner-requested working team |
| Soul | Existing versioned memory document | Save stable responsibility and owner constraints |
| Project | Existing owned project, optional parent, status and completion definition | Save initial work with a stable command key |
| Receipt | Existing Builder hire and coordination command receipts | Resume without duplicate identities or work |
| Message / run / schedule | Existing coordination and execution primitives | Used later by employees; not launched by setup |

There is no new Team table, team manifest authority, manager runtime, Builder
workflow engine, permission-by-soul rule, shared-researcher type or mail gate
hidden inside a project title. The reporting tree and project tree are distinct:
one answers who manages whom; the other groups work and gives the supervising
project owner visibility over its descendants.

The simplest call chain is:

1. `list_workspaces`, `list_buddies`, `list_created_buddies` recover what exists.
2. `create_buddy` saves each requested employee with a stable creation key.
3. `set_relationship` connects saved employees: seven manager relationships
   form the reporting tree, and Product consults the Market Researcher.
   Passing `managerBuddyId` at creation is a convenience that composes creation
   and the relationship in one transaction. Set `backgroundEnabled: true` for
   this working team's members.
4. Read each saved soul. Preserve shared goals and constraints in relevant roles;
   refine through the existing revision-checked soul operation when necessary.
5. `new_project` saves an umbrella project owned by Project Lead. Create lead
   projects beneath it and engineer/designer/research work beneath the relevant
   lead project. A supervisor can inspect descendants through existing work
   scope, without introducing a global “read everything” permission.
6. Save ready preparation separately from blocked outreach. Read saved results
   and compare actual identities, manager edges and work against the request.
7. Show canonical cards and report any unresolved setup. Later, opening the
   Project Lead conversation uses the normal employee workflow: read current
   work, send bounded requests, receive evidence-bearing replies and follow up.

Suggested initial work is a concrete planning choice, not hardcoded wave_sim
software behavior:

| Owner | Initial work | Completion evidence |
|---|---|---|
| Project Lead | Coordinate the initial product and market investigation | Linked results from the four leads and a bounded first milestone |
| Product Lead | Choose an initial usable demonstration | Prioritized target workflows, proposed scope and success criteria |
| Product Designer | Critique proposed workflows and constrain scope | Workflow sketches and explicit cuts/tradeoffs |
| Product Engineer | Assess the current product against the demo | Implementation gaps and a bounded implementation proposal |
| GTM Lead | Plan discovery for the five target segments | Candidate customers, interview questions and draft outreach |
| Market Researcher | Research concrete customers and use cases | Source-backed list, assumptions and evidence usable by GTM and Product |
| Simulation Lead | Assess simulator capabilities and demo feasibility | Reproducible baseline, limitations and proposed improvements |
| Frontier Lead | Evaluate radical cost-reduction hypotheses | Theory, assumptions, validation criteria and a qualified handoff when warranted |
| GTM Lead | Conduct customer interviews (blocked) | Demo video references, configured inbox and evidence of the authorized interviews |

## API and MCP changes

The canonical input schemas live in
[builder.ts](../../server/src/buddies/builder.ts); the MCP descriptions and
handlers live in [builder-mcp-server.ts](../../server/src/buddies/builder-mcp-server.ts).

`create_buddy` retains its existing identity, workspace, soul and execution
profile fields, adding:

```ts
managerBuddyId?: string; // optional creation + manager relationship composition
backgroundEnabled?: boolean; // existing membership setting; omitted means false
```

When using `managerBuddyId`, the manager must already exist. The package
transaction validates that the manager is active, was created in this Builder
conversation and belongs to every workspace requested for the report. Identity,
memberships, background setting, manager edge, initial soul revision and receipt
commit together. The existing canonical relationship validator owns cycle and
single-manager rules. Hiring quotas do not participate in admission.

`set_relationship({key, fromBuddyId, toBuddyId, kind})` is the independent
relationship atom. Both hires must be active and belong to this Builder
conversation. `kind: 'manager'` means the first Buddy manages the second;
`kind: 'consults'` records collaboration without changing the manager. The
manager must share all the report's workspaces; collaboration requires a shared
workspace. Existing conflicting manager edges and cycles are rejected. This
tool reuses canonical relationship writes and command receipts. No run starts.
Both manager and collaboration relationships are returned by
`list_created_buddies` so resuming setup does not lose them.

`new_project` is the ordinary work primitive exposed through a narrower Builder
adapter:

```ts
{
  key: string;
  buddyId: string;
  workspaceId?: string;       // defaults to the hire's home workspace
  parentProjectId?: string;
  title: string;
  objective?: string;
  definitionOfDone: string;
  status?: 'backlog' | 'ready' | 'blocked';
  nextAction?: string;
  blockedReason?: string;     // required when blocked
}
```

The target must be an active hire from the same Builder conversation. Work must
belong to one of that hire's assigned workspaces. A parent must be in the same
workspace and owned by a hire from this conversation. The adapter supplies the
owner actor and a namespaced command key to `createCoordinatedProject`; the
model cannot choose an actor or reach arbitrary preexisting staff through this
tool. No completed work is fabricated during setup.

`list_created_buddies` also returns the canonical team state and current owned
projects so an interrupted Builder can inspect actual saved setup. Inline
results carry the same shared typed projection. A successful `new_project`
emits `work_created`; readers can distinguish it from a profile or soul update.
Historical cards are labeled as saved snapshots, while Open Buddy/Work links
lead to current state. No new HTTP mutation route or WebSocket bridge is needed.

## Replay and failure behavior

- A hire key is unique within one Builder conversation. Changed arguments under
  the same key fail rather than mutate or duplicate a saved employee. Legacy
  single-hire keys and fingerprints remain valid when team fields are omitted.
- The package, not application lookup-then-write code, owns atomic hiring.
  Failed relationships included in creation do not leave a top-level orphan
  hire or consume its key. Independently saved hires remain available if a
  later relationship call fails; the Builder reports that unfinished step.
- A replay does not reactivate an archived identity, reparent it,
  re-enable owner-disabled execution, overwrite a refined soul or undo later
  work. It returns existing identities.
- The initial soul uses the existing revision ledger. Its filesystem projection
  is materialized after commit and repaired from the latest committed document
  on replay, so a crash in file promotion does not silently lose the brief.
- Each project has a separate command key. A partial team is not rolled back
  wholesale: saved hires and projects remain useful, and missing steps resume.
  Project replay returns current state rather than pretending the original
  receipt's status is still current.
- A Builder conversation is a creation scope, not permanent control over all
  organization state. Existing team reorganization stays with existing owner
  controls; copying a known Buddy ID from another chat grants no setup access.

## Visibility, memory and what is not guaranteed

Default directory nesting already follows canonical manager relationships. The
eight-person fixture should show Project Lead at the top level, leads under it
and their reports under them. Search, manager detail and explicit links preserve
discoverability. Directory placement is not a confidential-information boundary.

Each employee keeps its own memory and ordinary conversations. Relevant common
goals are explicit role context; mutable work remains in projects. The current
system does not promise that two conversations with the same shared Researcher
have isolated private cognitive contexts. Do not use the same employee for
mutually confidential teams on the strength of “hidden from top level.” The
broader redesign must resolve memory scope together with read scope before
making that promise; adding a Team noun does not solve it.

The demo condition is recorded and honored in setup. It is not a server-enforced
constraint on every later shell or external connector available to an employee.
A real outbound adapter needs to check the configured account, current authority
and required demo evidence at the actual send boundary. This Builder exposes no
send tool, so this change cannot accidentally send during provisioning. It also
does not claim arbitrary later agent execution is safely contained by prose.

Recurring check-ins remain an explicit automation configuration with existing
ownership and budget rules, not a side effect of hiring a lead. The independent
coordination integration handoff still needs its own exact-package validation.

## Owner correction: relationships, not headcount budgets

During implementation on 2026-09-09 the owner explicitly rejected hiring quotas:
create employees, give them relationships, then hand off work through messages.
This supersedes the earlier quota-based direct-report contract and this document's
initial funding recipe. Quota controls, prompt copy and admission checks are
removed. The old SQLite column may remain for migration compatibility; it is
not active authority and new team projections omit its counters.

The correction also makes the independent relationship operation explicit.
A lead can send a document and completion criteria to a Buddy. The existing
message dispatcher queues a recipient conversation, with that Buddy's identity
and context. The recipient reads the work, creates tasks or child projects,
works within its execution limits, and replies with evidence. The lead's reply
continuation can inspect the outcome and send further instructions. The same
send/reply operations work for a collaborator; a new handoff purpose needs no
schema or runtime type.

Execution limits still bound running model work. They are independent of the
organization graph and are not a reason to forbid creating a valid employee.

## Why this direction

The [typed resources proposal](REDESIGN_01_TYPED_RESOURCES.md) is the closest
base: preserve identities, work, messages and authority and compose them. This
change takes only the missing Builder adapters from that direction. Replacing
all tables with an event ledger or introducing shared spaces is unnecessary to
make this request work. A single batch `create_team` would hide useful partial
progress and introduce another request shape; per-member and per-project
receipts already give a resumable composition.

The September 9 fresh review also found broader design questions: memory
disclosure scope, visible dependency reads, bounded collaboration grants,
discussion of completed work and excessive universal acceptance machinery.
Those findings remain relevant to the full redesign. They do not require
smuggling an unimplemented privacy or workflow promise into this Builder fix.

Historical evidence is preserved rather than silently rewritten:

- [Integration handoff](../../agent_notes/2026-09-09_buddies-integration-handoff.md)
  — current and older checkouts are different snapshots; packaging provenance
  is not proof of delivered application behavior.
- [Typed resources](REDESIGN_01_TYPED_RESOURCES.md),
  [event ledger](REDESIGN_02_EVENT_LEDGER.md),
  [shared spaces](REDESIGN_03_SHARED_SPACES.md) — alternatives, not three
  simultaneously implemented architectures.
- [Direct reports](PLANNING_SUB_BUDDIES.md), [memory](PLANNING_MEMORY.md),
  [coordination](PLANNING_PRIMITIVES.md) — existing primitives reused here.

## Verification

Real MCP/SQLite fixtures cover the eight-member team, reporting scope and collaboration,
project ownership and hierarchy, blocked outreach, recovery after reopening the
store, unchanged replay, changed-key arguments and cross-conversation rejection.
Package tests cover the atomic write and soul projection recovery. Shared result
parsing and rendered client cards cover navigation and historical snapshots.

These deterministic tests prove the accepted tool sequence and persistence
behavior. They do not prove that every provider/model will infer the same task
breakdown from prose. No live wave_sim team or customer email is created by the
verification. Final test counts and exact package provenance belong in the
dated implementation evidence note.
