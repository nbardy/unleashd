# Automation execution ownership — one owner, expiring authority, honest recovery

**Date:** 2026-08-24  
**Status:** accepted; implemented  
**Decision owner:** repo owner  
**Companions:**

- `agent_notes/2026-08-21_buddy-automations-reference.md` — the system before this decision
- `agent_notes/2026-08-21_turn-lifecycle-design.md` — provider-turn lifecycle vocabulary
- `agent_notes/2026-08-21_turn-lifecycle-RFR.md` — review of that lifecycle
- `docs/architecture.md` — current provider and reload boundaries
- `docs/test-strategy.md` — boundary-test policy

## 1. Decision in one paragraph

An automation occurrence has exactly one active executor. Its durable run row is the authority
for lifecycle and permissions; a conversation is an execution transcript, not an ownership
token. Authority exists only while the run is in an executable state and the executor presents
the current private claim token. Completion, failure, cancellation, expiry, or interruption
revokes mutation authority permanently. A development source reload leaves the old server in
ownership until admitted work finishes, but a new server never adopts or silently replays a
possibly-live run. Recovery terminalises ambiguous work as interrupted and makes retry explicit.
True crash adoption would require a separately designed durable worker and event protocol; it is
not approximated with SQLite lease expiry.

This is deliberately less clever than automatic takeover. It is also the smallest design that
does not permit two agents to perform the same side effect.

## 2. Why this decision exists

The previous implementation distributed authority across facts that could disagree:

1. an in-memory scheduler `Set` said a run was active;
2. a SQLite lease said which claim token most recently acquired it;
3. a conversation retained `automationRunId` forever;
4. an MCP server treated that id as durable permission;
5. a provider process could outlive a lease or a web-server reload;
6. terminal schedule advancement independently updated the automation definition;
7. deleting the definition cascaded away the run while execution continued.

Each fact was locally reasonable. Together they created an accidental distributed system with
no fencing protocol. Expiring a lease did not prove the previous executor was dead, and opening
an old transcript could regain the same mutation surface after every budget and deadline ended.

The reload regression exposed the same underlying mistake on a second axis: process completion,
event consumption, mutation admission, and scheduler wrappers could each independently declare
that ownership ended. Robustness requires one release point, not more watchdogs around several
release points.

## 3. Evaluation criteria

The choice was weighted in this order:

| Weight | Criterion | Meaning here |
|---:|---|---|
| 5 | No duplicate side effects | A stale or resumed executor cannot mutate after ownership moves or ends. |
| 5 | Honest authority | UI labels, MCP access, deadlines, and recovery match what the system can enforce. |
| 4 | One lifecycle authority | One durable transition path decides whether work is executable or terminal. |
| 4 | Failure legibility | An interrupted run is visible as interrupted; it is not silently replayed. |
| 3 | Implementation simplicity | Prefer deleting competing mechanisms over coordinating them. |
| 3 | Audit retention | Definitions can disappear from active UI without deleting occurrences or transcripts. |
| 2 | Automatic recovery | Useful only when it does not weaken the higher-weight guarantees. |
| 1 | Zero-click continuity after a hard crash | Explicitly lower priority than duplicate prevention. |

“Simple” does not mean fewest lines in the next patch. It means fewest independent authorities
that future code must keep consistent.

## 4. Alternatives considered

### A. Keep lease takeover and add renewals everywhere

**Shape:** renew `claim_expires_at`, pass claim tokens through MCP, reject stale tokens, and let a
new scheduler take over immediately after expiry.

**Advantages:** quickest route to automatic retry; resembles a conventional queue worker.

**Rejected for now:** renewal plus fencing makes takeover safer but does not restore the provider
event stream, conversation-local buffers, queued messages, or pending tool results. A new
executor would still start a second conversation rather than adopt the first. The old detached
process might remain alive and perform external effects that do not pass through Buddy storage.
This is distributed-worker complexity without distributed-worker completeness.

### B. Detach every provider and let the replacement server adopt it

**Shape:** providers write a durable event log through a stable daemon/socket; web servers attach
and detach as consumers.

**Advantages:** genuine survival across web-server crashes and upgrades; clean separation of UI
and execution lifetimes.

**Deferred, not rejected:** this is the correct architecture if crash-transparent execution is a
product requirement. It needs a process supervisor, stable execution identity, durable ordered
events, acknowledgement/checkpoint semantics, credential lifetime, orphan reaping, and versioned
adoption. Building only `detached:true` while retaining parent-owned pipes does not supply those
properties. It is a separate project, not a scheduler patch.

### C. Force every hot reload after a short grace

**Shape:** preserve work briefly, then interrupt it so replacement is bounded.

**Advantages:** simple watcher behavior; source changes appear quickly.

**Rejected:** ordinary provider turns routinely exceed the grace. It made development reload a
destructive business event and caused the repeated “Interrupted by restart” incident.

### D. Wait without bound after quiescing

**Shape:** after the reload grace, refuse new writes and wait forever for admitted work.

**Advantages:** never intentionally interrupts a healthy provider.

**Rejected:** any forgotten counter release, hung store call, or pre-provider creation promise
turns the whole backend permanently read-only. Preserving work is not a justification for losing
operator recovery. The bounded path must terminalise explicitly and visibly rather than clear
counters or pretend completion.

### E. Make conversations the durable execution object

**Shape:** reopening an automation conversation resumes the same authority and budgets.

**Advantages:** intuitive transcript continuity and fewer visible nouns.

**Rejected:** transcript lifetime and authority lifetime are different. Users need permanent
read access to history, while mutation authority must expire. Making the conversation both is
exactly why terminal runs remained privileged.

### F. Keep direct SQLite MCP tools plus selected HTTP callbacks

**Shape:** simple state operations open the database in the MCP process; delegation/review call
the public web API.

**Advantages:** little server plumbing; direct operations survive many web routing changes.

**Rejected:** the two paths have different auth, reload admission, retries, observability, and
failure semantics. Authenticated deployments returned 401 for one half; reload quiescence
returned 503 for one half. Server-dependent operations need one scoped internal boundary.

### G. Chosen: explicit single owner, no ambiguous takeover

**Shape:** durable run states, private fencing token, authority checked on every mutation,
joined provider completion, archival definitions, and explicit interruption/retry.

**Cost:** a hard crash may require a human retry and cannot claim transparent continuity.

**Why it wins:** it satisfies every high-weight criterion without introducing a daemon. It also
leaves a clean migration path: a future worker can become the single owner behind the same run
state and fencing boundary instead of replacing client and policy semantics again.

## 5. Durable run state machine

The public lifecycle is intentionally small:

```text
claimed -> running -> complete
   |          \----> failed
   \---------------> cancel_requested -> cancelled
running ------------> cancel_requested -> cancelled

claimed|running --startup failure/interruption--> failed
claimed|running --explicit cancellation--> cancel_requested
```

The UI may label `claimed` as “starting,” but `starting` is not another durable authority state.
`cancel_requested` remains active for per-automation exclusion while being non-executable for
every Buddy operation. That single distinction prevents both a replacement run and late writes
while the provider acknowledges stop.

Terminal states are absorbing. A terminal occurrence is never reset to `claimed`. Retry creates
a new occurrence with a new idempotency key and claim token and, if applicable, an explicit link
to the prior occurrence.

## 6. Invariants

These are code-review rules, not aspirations.

### I1 — one terminal authority

Only the automation coordinator terminalises a run and advances its schedule. UI routes, MCP
tools, conversation cleanup, and recovery request transitions through that authority.

### I2 — authority is a conjunction

A state-changing automation operation is authorized only when all are true:

```text
run exists
AND run.status is executable
AND supplied private claim token equals current claim_token
AND claim has not expired
AND cancellation has not been requested
AND operation is in the immutable run-policy allowlist
```

The run id alone is routing metadata, never a credential.

### I3 — tokens are private

Claim tokens are not returned by public `/run` or `/runs` responses, serialized into client
conversation state, included in prompts, or exposed in process argv. They travel only through
the scoped internal execution capability.

### I4 — transcript lifetime does not extend authority

Automation conversations remain readable after terminal status. Sending another message from a
historical transcript either creates ordinary explicitly authorized work or is refused; it never
reuses terminal automation authority.

### I5 — no takeover by elapsed time alone

Lease expiry permits terminal recovery, not automatic execution replay. Elapsed wall time is not
proof that a detached process or an external side effect stopped.

### I6 — one run deadline

The runtime deadline begins before Buddy resolution and conversation creation. It covers config
resolution, durable registration/linking, provider startup, and every iteration. Cancellation
cleanup and terminal persistence remain part of the same owned occurrence and must finish before
release, but they do not receive a second execution budget; the process-stop kill grace is the
only bounded cleanup allowance.

### I7 — cancellation has acknowledgement

Cancellation is a requested transition first. Completion is `cancelled` only after the current
owner has stopped/cleaned up or recovery has proven there is no live local owner. Conversation
creation resolving after cancellation must immediately stop and terminalise the new conversation.

### I8 — events drain before ownership releases

Provider process exit and provider event consumption join before clearing `process`, releasing
reload/automation ownership, terminalising the automation run, or starting the next queued
message. A timeout may publish its diagnostic attempt result before kill acknowledgement, but it
does not release either ownership boundary.

### I9 — history is immutable

Removing an automation from active use archives/disables its definition. Run rows and their
conversation links are never cascade-deleted by a product “Delete” action.

### I10 — schedule validation precedes persistence

Definition validation and next-run calculation happen before create/update commits. A 4xx
response means no mutation occurred. Schedule advancement is owned by the occurrence terminal
transition, not whichever concurrent run finishes last.

### I11 — fail-closed means behavioral enforcement

“Can encode MCP configuration” and “will refuse provider startup when required MCP fails” are
separate capabilities. Buddy turns use only providers that implement the latter. A comment or an
ignored `required` field is not enforcement.

### I12 — health describes outcomes, not polling alone

A successful due-list query is not successful automation execution. Operational health must
eventually be durable and include last successful occurrence, last failed occurrence, lateness,
and paused/reloading state. Process-local poll diagnostics are useful debug data but not a
watchdog.

## 7. Reload and crash contract

### Development source reload

The old server remains the owner of already admitted provider turns and stays fully available
while the reload is pending. It does **not** enter an absorbing read-only state merely because a
source file changed. At an observed idle boundary it pauses scheduler admission, rechecks that no
work appeared, and exits; if the boundary was lost it resumes and keeps waiting. Internal
callbacks belonging to an already admitted turn remain valid through their scoped capability;
they do not re-enter the public mutation gate.

The server releases ownership only after event drain, terminal persistence, and coordinator
cleanup. A continuously busy or genuinely hung server can defer a development reload, but it
remains usable rather than becoming permanently read-only. Explicit SIGINT/SIGTERM is the bounded
operator-recovery path and must record the actual terminal cause; reload code never clears
counters or kills work merely to make a source change apply sooner.

### Explicit SIGINT/SIGTERM

Explicit shutdown remains destructive and bounded. It requests cancellation, records
interruption, flushes within its watchdog, and exits. This path does not promise work survival.

### Hard crash, OOM, SIGKILL

No transparent survival guarantee. On boot, a nonterminal occurrence owned by a vanished server
is terminalised as interrupted/failed. It is not automatically replayed. The transcript remains
available, and retry is an explicit new occurrence.

Product language must say “preserves active work across cooperative development reloads,” not
“agents are detached from the server” or “runs survive every restart.”

## 8. MCP and control-plane boundary

The provider receives a scoped capability created for one admitted turn. It carries trusted
identity and, for automation work, the private current claim token outside model-controlled tool
input. All server-dependent Buddy operations use that boundary rather than public browser auth.

Properties:

- loopback alone is not authentication;
- the capability is unguessable, short-lived, and turn-scoped;
- public auth middleware remains first and has no broad exemption;
- the internal endpoint validates capability, conversation, run ownership, and operation;
- reload quiescence accepts callbacks for the already-admitted owner but rejects new work;
- logs identify the conversation/run but never print the capability or claim token;
- provider harnesses receive secrets through per-server environment, not argv.

If the current patch cannot supply the complete internal RPC cleanly, restricting server-dependent
operations or providers is preferable to silently weakening the contract.

## 9. Definition deletion and retention

The user-facing action may continue to say “Delete” if product copy prefers it, but the storage
operation is archive/retire:

1. disable future claims;
2. refuse or request cancellation of active occurrences according to the endpoint contract;
3. hide the definition from the default active list;
4. retain the definition key needed by historical runs;
5. retain run policy snapshots, outcomes, errors, timestamps, and conversation links.

Physical deletion is maintenance-only, must require no runs, and is not exposed by the ordinary
product route.

## 10. Concurrency and schedule advancement

The initial policy is one active occurrence per automation. Manual “Run now” and scheduled fire
share the same exclusion. A concurrent request returns the active occurrence or a conflict; it
does not create another owner.

Only scheduled occurrences advance `next_run_at`. A manual run records its own result but does
not race the schedule cursor. When the server was absent, catch-up coalesces missed ticks into one
new occurrence and records the original due timestamp plus observable lateness. It does not
pretend every missed tick ran.

This policy can be widened later with an explicit `concurrency` field. It must not emerge from
unique run ids accidentally.

## 11. Budgets and truthful UI

Wall-clock and iteration limits are enforced today; token and cost accounting are not available
reliably across providers. Until the provider-neutral event contract carries trustworthy usage:

- do not advertise token/cost values as enforced limits;
- do not render zero as measured usage;
- preserve schema fields only for compatibility and mark usage unavailable;
- never infer spend from text length.

Adding metering later requires one normalized provider usage event, cumulative monotonic updates,
and a boundary test through a real harness. It does not require another scheduler lifecycle.

## 12. Approval and waiting are separate

`request_human_approval` records pending intent and instructs the model to stop. Resolving that
record later does not resume the terminal automation run. A resumable wait/approval workflow is
the separate primitive discussed in `product/buddies/PLANNING_PRIMITIVES.md`; it must not be
smuggled into execution ownership.

## 13. Testing strategy

The important tests cross real boundaries:

1. fast provider exit plus delayed session persistence proves events drain before terminal state;
2. two schedulers plus an expired claim proves the stale executor cannot mutate and is not replayed;
3. completed/cancelled/expired automation context cannot perform a state-changing MCP operation;
4. cancel during deferred conversation creation leaves no active conversation or link;
5. archive during an active run preserves history and coordinates cancellation;
6. invalid/impossible cron returns 4xx with byte-for-byte unchanged storage state;
7. auth-enabled server plus real stdio MCP delegation/review succeeds through scoped capability;
8. reload quiescence plus admitted MCP callback succeeds without opening a public auth bypass;
9. every provider marked `required` is behaviorally tested with a deliberately failing MCP server;
10. installed-package smoke starts the compiled MCP entrypoint, not only the source-mode one.

Unit tests remain useful for schedule math and pure transition validation, but source-text tests
or mock-only lifecycle assertions are insufficient.

## 14. Migration order

1. Join provider events and completion so process ownership is truthful.
2. Add run authorization/fencing and revoke terminal conversation authority.
3. Remove automatic expired-run replay; recover to explicit interruption.
4. Bound/cancel conversation creation and observe every execution promise.
5. Archive definitions and preserve run history.
6. Validate schedule changes before persistence; serialize per-automation execution.
7. Unify internal callbacks and restrict Buddy providers to genuine required-MCP support.
8. Make desktop/mobile projections refresh from durable state and expose cancellation.
9. Replace misleading token/cost and ephemeral-health UI with honest availability/status.
10. Only then consider a durable worker/adoption project based on demonstrated need.

## 15. Guidance for future changes

When touching this area, ask these questions in order:

1. Which single object owns this transition?
2. What durable evidence proves the previous owner cannot still mutate?
3. Does this extend authority beyond the run deadline or terminal state?
4. Can a 4xx/5xx response leave a partial durable mutation?
5. Can reload or cancellation resolve between these two awaits?
6. Is the UI displaying measured truth or a schema-shaped placeholder?
7. Is a proposed retry safe, or can it duplicate an external side effect?

If an answer requires “the other callback probably ran first,” the design has recreated the bug.

## 16. Implementation record and deliberate constraints

Implemented in the change following baseline commit `039c303`:

- provider completion joins normalized event consumption before ownership release;
- automation completion is an owner-only drained signal; UI `turn.complete` may render early but
  cannot terminalise the run or admit another automation turn;
- source reload remains fully available and exits only at a verified idle boundary;
- automation execution has one pre-creation deadline and observed task promise;
- one active occurrence per definition; lease expiry terminalises but never takes over;
- exact private claim-token fencing encloses each synchronous operation and its audit in one
  SQLite transaction; server-dependent dispatch binds and starts a dormant child only inside the
  same final authority check;
- `cancel_requested` durably revokes tools before process stop while retaining claim exclusion;
- failed terminal persistence retains local ownership, reports degraded health, and retries on a
  later poll instead of publishing a false success;
- startup scans every nonterminal run, including manual/disabled definitions, and terminalises it
  without replay;
- terminal or expired runs cannot regain authority by reopening their transcript; every public
  send, queue, interrupt, and stop path refuses or routes through the scheduler;
- internal delegation/review use a rotating loopback capability, not public browser auth;
- Buddy provider admission distinguishes MCP `none | inject | required`; only Codex currently
  satisfies the required contract; the profile API, Builder, and desktop/mobile selectors share
  that harness-derived capability rather than separate allowlists;
- archive has an explicit `archived_at` field; archived definitions are immutable and hidden from
  active projections while exact run/conversation classification retains all history;
- one shared public run schema omits executor credentials at HTTP and MCP boundaries;
- create/update cron calculation precedes persistence and reuses one timezone formatter;
- desktop/mobile reload durable automation projections, fetch history explicitly, and expose
  archive/cancellation; visible active history polls until terminal, and unimplemented usage
  metering is labeled unavailable rather than zero;
- package provenance rejects dirty Buddies sources and installed-package smoke handshakes with
  the compiled MCP entrypoint.

Two constraints are intentional and must remain visible:

1. **Cron search has a documented 366-day horizon.** The built-in parser rejects malformed and
   impossible calendar fields quickly, but it intentionally does not scan multiple years for a
   rare valid occurrence such as a distant leap day. The error names the supported horizon rather
   than claiming the expression is globally invalid. Replacing this requires one calendar-aware,
   timezone-tested iterator; multiplying the minute scan would add latency, not correctness.
2. **Codex forwarding environment is scoped, not secret from the harness.** Capability and claim
   values stay out of argv, prompts, BuddyContext, and public responses. Codex must nevertheless
   receive them in its process environment so `env_vars` can forward them to the MCP subprocess;
   model-launched children may inherit that environment. The capability cannot exceed the
   already-admitted conversation/run/allowlist authority, so possession does not widen access.
   Stronger isolation would require a brokered file descriptor or separate supervisor and is not
   justified by the current local single-user threat model.

Still deliberately not claimed as solved:

- hard-crash/SIGKILL provider adoption;
- trustworthy cross-provider token/cost metering;
- durable external scheduler heartbeat/alerting;
- resumable approval/wait workflows;
- publishability of a local dependency source commit that has no configured remote (the vendored
  artifact is clean and commit-addressed, but that source repository must gain a canonical remote
  before another machine can fetch the commit by hash).
