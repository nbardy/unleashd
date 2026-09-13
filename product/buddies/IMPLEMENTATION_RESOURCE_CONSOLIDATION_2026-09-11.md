# Resource consolidation — implementation successor

2026-09-11, Asia/Makassar. Buddies Development Lead. The owner selected implementation with “Fully impliment that” after the three-design comparison and the Wave_sim startup incident. This records the implemented choice and its evidence; production team activation is separate.

## Decision and rationale

Retain identities, relationships/grants, projects/tasks, documents/notes, addressed messages, runs and schedules. Consolidate their application services and exposed contracts. Normal chat, Builder, delegated work and automations now use the same conversation creation implementation. Creation persists and registers a thread; an independently admitted input starts the provider. Background placement affects navigation, not authority.

This follows [Direction 1](REFLECTION_01_RESOURCE_CONSOLIDATION_2026-09-11.md), SHA-256 `7bbced9d941e72e42ca7facb7dddfd616ce2ad2fe4ec30bff1da26e0a609c89f`, and the [Wave_sim incident review](REVIEW_WAVE_SIM_CREATION_FAILURE_2026-09-11.md), SHA-256 `7327536f2977f74f109f1feb78ae140958e10bc09c9fc2fc80d81b3e5a9a5c83`. The earlier proposal remains unchanged as historical evidence. Its governing excerpt is: “It is the one with the fewest independently implemented rules.”

The startup incident strengthened the case for sharing the actual creation/configuration boundary. Earlier tests had constructed a Conversation directly; even a live model using that fixture could not prove the production creation path worked. The provisional empty-message and explicit-retry fix is preserved inside the shared path, with real persistence tests. A new live fixture now uses the production creation service, configuration store, context composer and native MCP transport.

Alternatives remain typed change sets and shared collaboration spaces. Neither resolves this incident more directly; both require additional semantics and migration. Revisit change sets if repeated multi-resource edits exceed existing keyed setup composition. Revisit spaces if shared discussions become the dominant workflow and addressed handoffs remain duplicative after this consolidation.

## Implemented behavior

| Area | Result |
| --- | --- |
| Conversation creation | Chat, Builder, Buddy dispatch and schedules share `createConversationService`. Replay validates durable identity/tombstones even on a runtime-registry hit; concurrent creation reuses one registered runtime. Link repair can retry before input admission. |
| Startup and recovery | Fresh background creation stores no pending placeholder message. Only the claimed run dispatches its input. Explicit retry of an unacknowledged failed fresh creation preserves its original command/thread identity. Deleted threads and missing continuations are not recreated. |
| Visibility | Dedicated workers persist `placement: background`, stay out of default chat/recent lists and remain addressable through activity/history. A scheduled or returned input in an existing owner chat does not hide that chat. Inbox includes execution receipts even when startup produced no child transcript. |
| Owner and Builder | Builder discovery plus owner `configure_team`, profile, document and work resources operate on existing in-scope identities. The new Builder catalog no longer advertises its separate creation/document/project setters. Host owner authority is checked again after asynchronous control-boundary resolution; employee callbacks cannot inherit it. |
| Settings | Desktop and mobile profile writes use the same owner resource service and catalog validator. Revision, stable key and reason travel through that boundary. |
| Document MCP | New `get_document` and `update_document` replace the four soul/memory aliases in the default catalog. Document-bound opaque revisions, complete bounded content, reason, exact preview and keyed replay are enforced. A revision from one document cannot edit another. Notes remain append-only operations. |
| Other MCP contracts | Typed `send.delivery` distinguishes inform, request and bounded project work. Schedule commands use an exact nested discriminated schema. Directory and current-work reads return pages. New project writes require keys and updates require current revisions. New current-work input uses `targetBuddyId` and a cursor. |
| Capabilities | One compact target collection replaces repeated full root/target payloads. An omitted action reports `not_evaluated`; requested intent and receipt IDs govern evaluation. Existing policy checks still enforce the mutation independently. |
| Knowledge | Explicit owner-thread, project and workspace scopes store versioned heads and immutable revisions in the native ledger. Shared work receives curated scoped documents; legacy global soul/memory is not automatically disclosed. Project/message/run reads and notes/search respect the active audience. |
| Provider context | A changed or unknown audience starts a fresh provider session while retaining the visible transcript. Audience identity includes current scope, access state and visible document revisions. Owner/private context is not resumed by a team callback. |
| Memory review | The independent memory-only reviewer receives source-turn messages and source-authorized scoped knowledge. Its writes stay in that audience; it cannot publish into another scope or inherit owner tools. |
| Mailbox adapter | A provider-neutral adapter and native effect ledger pin exact draft/account/demo acceptance, separate explicit send approval, preserve uncertain delivery for reconciliation and deduplicate inbound events. Account adapters own credentials. No account is connected. |

The public resource projection is `2026-09-11.1`; the existing package/team-operation contract stays `2026-09-10.4`, with database schema 26. Explicit legacy catalogs/adapters preserve earlier callers. Profile/project counters retain their established numeric revisions; documents use opaque tokens. The proposal's universal result/error and arbitrary-check sketches are not an additional fully migrated protocol: existing non-document operation envelopes and grouped readiness intents remain compatible. These choices avoid renaming durable records or duplicating execution state.

The scoped ledger and mailbox bookkeeping are the only added persistence categories. There is no new Team, Goal, Space, event-store or workflow-engine entity. Sharing/publication is an explicit owner action. Scoped compact memory remains private to its Buddy; old global target grants do not silently authorize editing another compartment.

## Verification

| Check | Evidence |
| --- | --- |
| Canonical package | 87 tests passed; schema upgrade, revision/replay/access checks, mailbox draft changes, demo gates, uncertain sends and inbound deduplication covered. |
| Full server | 301 tests: 298 passed, 3 opt-in skipped, 0 failed. Subsequent work-filter/key refinements passed the real MCP resource test and server build. |
| Client | 75 tests passed; TypeScript build and Vite build passed; all six repository client invariants passed. Background list filtering preserves direct conversation IDs. |
| Compiled artifact | Installed-package MCP handshake and plain-Node server startup passed against the final vendored archive. Source/client/server builds were completed first; smoke used `npm_config_ignore_scripts=true` to avoid rebuilding through the occupied dev supervisor. |
| Lifecycle boundaries | Real configuration-store tests cover fresh creation, partial persistence, explicit retry, deletion, concurrent replay, original return thread, cancellation and foreground deadline behavior. |
| Privacy boundaries | Actual context composer excludes a private canary and unrelated project content; global legacy reads are refused in team turns; scoped document replay and cross-scope token rejection are tested. |
| Real provider | An isolated owner → worker → evidence → original lead round trip passed in 351 seconds through production creation/configuration/context code and native MCP. Worker and return starts used fresh provider sessions, without owner controls or the private canary. |

The final package source commit is `e22bdd5d73b74c125410ec9ba0b89c72566b6cea`, following implementation commit `6641182865c3db28c57148628728da3593058f64`. Reproducible archive SHA-256: `d8642c78333241eacb26befc47a708cfeeeac5463a823598379dbd6d79a4c58e`. Package source was clean when packed. The shared Unleashd tree remains uncommitted and includes unrelated work; HEAD `1187a8b6660b95c0c60bd8fada105f015b98cc39` alone is not a source snapshot. [Source/evidence manifest](IMPLEMENTATION_RESOURCE_CONSOLIDATION_2026-09-11.evidence.json) pins the reviewed files and test logs.

Live fixture identities: project `buddy_project_842df4b3-48d5-43ce-aba9-c2ded42a5f92`, message `message_20cb74c2-e0d2-4897-8cab-7208fea860b2`, worker run `buddy_run_47a59f8c-87c2-42d0-a61f-a868d84dd0e9`. Two owner turns, one worker turn and one return turn were observed. The owner used `update_document` preview and apply with key `imported-audit-handoff`, producing revision `doc:b9a7f710152ca05aa1058400:1` before enabling work. The preserved handoff excerpt is “Audit 2+2=4 against the assigned criteria”. Native transcript hash: `d63132ef442d428d3d168de8b889d30580a3f57c4191e40d28b4f6a708f224ab`.

A full-suite fixture exposed a separate ordering assumption: its simulated lead could receive the reviewer's reply before the engineer's thread existed. The fixture now waits for both actual replies before continuing. Production missing-thread refusal was preserved; no recovery exception was added to make the fixture pass.

## Activation and limits

The installed artifact and isolated provider flow are verified. The current development backend loads source changes at its normal idle reload boundary; an already-connected MCP session does not acquire the new catalog automatically. Use a fresh session after reload. No forced restart, production Font Maker/Wave_sim configuration change or resumption of stopped business assignments occurred.

The mailbox code is an integration adapter, not a connected inbox product or exposed production mailbox MCP. An identified account, provider implementation and its explicit send authority are still required before wiring production mailbox operations. No external message was sent. The selected design explicitly places account connection last; this implementation does not claim that the whole business scenario is active.

Knowledge isolation covers application reads, model context and reviewer inputs. Unrestricted shell/files/credentials under the owner's OS user remain outside this boundary. Revocation cannot erase information already disclosed. Neither a team grant nor a schedule grants spending, training or external-action authority.

General prerequisite graphs, shared multi-party discussions, dollar-budget reservations and complete staff offboarding are the separate capabilities identified in the design's limits section. They were not introduced by this consolidation.
