# Delegation, model selection and compact execution context

September 13, 2026 · Handoff 2, connected to foreground access, assignment workers and renewal.
All added profile behavior below is proposed. Current native work delivery has no such override.

## 1. Desired workflow and the actual design question

The handoff describes a lead configured to Astra that plans and reviews while delegating
execution to Luna or Terra with a compact handoff. The product value is selective use of
different capabilities and resource costs across a task. A lead should not have to change
its enduring identity or manually reconfigure a worker's global defaults for every job.

The question is broader than adding `model` to `send`. The system needs to answer:

- Who owns the work and its accumulated knowledge?
- Which execution configuration was requested, permitted, resolved and actually used?
- What context crossed the handoff boundary, and was the worker allowed to read it?
- Which budget paid for planning, execution, failed attempts and review?
- Where did the result arrive, and did the intended lead actually review it?

An execution profile is a choice for how an admitted attempt runs. It is not a Buddy,
permission grant, memory scope or task. Keeping these independent is what makes the feature
useful for both persistent staff and temporary assignment workers.

## 2. Current capabilities and limits

The inspected Buddy integration derives model and reasoning defaults from the recipient's
saved profile. Ordinary conversation configuration already has canonical selection intent,
server resolution, validation and an execution snapshot captured at spawn. Provider-native
values are strings; the application does not translate a provider's effort vocabulary into
a shared enum. [S09](08-source-evidence.md#s09), [S29](08-source-evidence.md#s29)

The strict native send schema allows three delivery kinds. Managed `work` has a required
project and run/duration bounds. Its adapter carries those bounds into the internal execution
policy. Adding `model` or `reasoningEffort` to today's work delivery is rejected, not ignored
as a benign hint. [S23](08-source-evidence.md#s23), [S24](08-source-evidence.md#s24)

Current routes therefore offer different tradeoffs:

| Mechanism | Durable separate identity | Per-job profile in native send | Context/lifetime |
|---|---|---|---|
| Send to an existing specialized Buddy | Yes | Unavailable | Recipient briefing and work context; saved profile defaults |
| Send background work to self | Same identity | Unavailable | Separate background transcript, scoped work |
| Harness helper | No separate Buddy identity | Provider-specific capability | Turn-scoped helper; parent attribution can be coarse |
| Proposed assignment worker plus execution profile | Ordinary Buddy | Proposed | Durable assignment context across bounded attempts |

Harness features must be checked in their actual environment. The historical helper project
does not prove all providers support identical model switching or fork controls. Likewise,
this review does not verify current model prices or benchmark claims. Model names retain
their role as examples from the owner's supplied discussion.

## 3. Separate identity defaults from assignment intent and execution facts

There are three useful configuration layers:

1. **Buddy defaults:** the employee's ordinary provider/model/reasoning preferences.
2. **Assignment selection:** the requested execution intent for this obligation, optionally
   choosing another permitted profile without editing those defaults.
3. **Attempt snapshot:** the exact provider, model, reasoning and relevant resolution context
   used when a particular process starts.

The assignment should retain the selection provenance. If the sender omits an override,
the implementation must decide whether that means “pin the recipient default as accepted”
or “follow the recipient default at each future attempt.” Both are plausible user intents;
silently alternating between them is not acceptable.

Recommendation: resolve and record an assignment baseline before its first admission, retain
the original requested intent, and capture the effective configuration for every attempt.
Ordinary continuation should remain stable. A later profile change for unfinished work
should be an explicit, revisioned change applying to the next attempt. This is a proposed
contract, not a claim about existing queue semantics.

Existing conversation selection modes matter. Model `default` and explicit model selection
are distinct. Reasoning `default`, `disabled` and `explicit` are distinct. A nullable string
cannot safely compress these meanings. Reuse the canonical schema and resolution service
instead of inventing a second profile resolver with different omission rules.

At the actual spawn boundary, recheck current availability and authority. A model disappearing
after a request is queued should produce a specific unavailable result, preserving the input
and prior resolution evidence. Do not silently route expensive work to a different model or
provider just to make the queue drain.

## 4. Proposed selection surface, without prematurely freezing syntax

The handoff's example nests `model` and `reasoningEffort` inside `delivery.work`. That shows
the desired locality of a per-job choice, but it leaves provider identity, default modes,
change revision and permission semantics unspecified.

Two API options deserve comparison:

| Option | Benefit | Cost |
|---|---|---|
| Reuse canonical selection intent as an optional work execution configuration | Minimal new vocabulary; full expressiveness; fits existing resolver | Payload can be verbose; authority must validate each setting |
| Reference a named permitted profile with a pinned revision | Compact for frequent delegation; easier owner policy and auditing | Adds profile configuration/versioning as a resource if none exists |

Recommendation: begin with reused canonical intent and a clear permitted-override policy.
Introduce named profiles only if repeated practical use needs them. “Planning,” “execution”
and “review” can initially be UI descriptions, not three new object types.

Conceptually, a requested profile must include enough information to resolve provider,
model selection and reasoning selection. The host adds source revision, effective values
and admission evidence. These host-written facts must not be supplied as trusted claims
inside an agent's prose. The native surface should return both requested and effective
configuration with an explicit unknown value for legacy runs lacking a snapshot.

The feature may later support one-response `request` work, not only managed `work`. That
scope should be selected explicitly. An informational message with no execution obligation
does not need an execution profile merely because some consumer might later act on it.

## 5. Permissions and routing

“Permitted model” needs an actual authority. A sender should not change a recipient's
global defaults through a work message. Nor should selecting a model automatically grant
a new provider credential, workspace membership, external integration or broader tool policy.

A viable selection must satisfy the recipient's permitted providers/models, current runtime
catalog, available configured credentials, and any relevant owner policy. Provider/model
catalog validity and authorization are separate checks: a known model can still be
unauthorized. Effort strings pass through after provider-specific validation; no common
effort mapping is inferred.

The assignment retains its original operation policy and audience. Renewal can allocate
more effort within granted resource authority; it cannot quietly add a new integration
because the cheaper worker failed without it. If an owner changes or revokes an applicable
grant while work waits, admission rechecks the current boundary. Historical snapshots
explain past execution, not permanent immunity from revocation.

For a cross-provider change, reuse the existing provider integration seam. Do not grow a
parallel subprocess launcher in the Buddy scheduler. The shared creation service remains
inert, and the existing executor performs claimed input admission. [S08](08-source-evidence.md#s08),
[S30](08-source-evidence.md#s30), [S34](08-source-evidence.md#s34)

## 6. Model changes and provider-session continuity

The current conversation config contract blocks provider changes once a session has started
and while work is active or queued. A future assignment override cannot assume it can mutate
an existing long-lived worker transcript arbitrarily. A provider switch may require a fresh
execution conversation or session binding while the same Buddy and project continue.

This is acceptable if the UI and context model distinguish:

- same employee and assignment;
- preserved durable messages, artifacts, notes and work criteria;
- current provider execution session;
- historical displayed transcript.

Changing execution context must not erase visible history or re-import private material from
the previous context. The history incident already demonstrates why durable application
conversation identity and native provider session identity differ. A combined visible
transcript is not automatically safe to replay into a new audience. [S22](08-source-evidence.md#s22)

For same-provider model changes, rely on the provider's actual supported semantics and
capture what happened. A stored model preference is not proof that a resumed process used
it. Exact execution observation belongs to the attempt. Model comparisons based on current
Buddy defaults would misattribute old work after settings changed.

## 7. Compact handoffs that preserve responsibility

The goal is a short, sufficient task packet, with authorized retrieval of details. “Compact”
must not mean omitting the constraint that would have prevented the worker's first mistake.
A useful packet describes objective, current criteria, known evidence, relevant prior
decisions, constraints, artifact destination, known effects and return expectations.

This is an illustrative content template, **not native tool arguments**:

```yaml
assignment: Repair export clipping for the recorded fixture
canonical_work: project ID and criteria revision
current_observation: failing fixture and reproduction command
decision_context: relevant accepted choice and pinned evidence reference
constraints: preserve shared work; scope of permitted changes
artifacts: output location and required version or digest
known_effects: commands already run; external effects, if any
next_checkpoint: reproduce, isolate cause, save failing example
return: artifact refs, validation evidence, remaining uncertainty
```

The actual project remains authoritative for criteria and status. A task packet can identify
the expected revision and summarize it, but the worker must read current work before acting.
If the criteria changed, old completion evidence cannot silently satisfy the new requirement.
Provider transcripts and large notes should be fetched selectively, not automatically copied
from the manager's entire owner conversation.

References must be readable to the recipient and durable enough for follow-up. A filesystem
path alone may identify neither a historical version nor an accessible artifact. Include
commit/revision/digest where available, and record missing or ephemeral evidence honestly.
Information publication is deliberate: a manager relationship does not grant the worker
access to the lead's private owner-thread memory.

## 8. Returning evidence and actually reviewing it

The original four-step loop ends with “Astra reviews the result.” The existing return contract
does not guarantee that step merely by delivering a reply. A result addressed to the source
owner chat settles in the Mailbox with `mailboxOnly`; it does not inject the transcript or
start a model. An executing background lead needs an admitted background destination and
incoming work enabled. [S02](08-source-evidence.md#s02), [S07](08-source-evidence.md#s07)

A coherent autonomous review loop therefore has:

1. An authorized background lead obligation with its own criteria and resource envelope.
2. A recipient-owned worker project and original request identity.
3. A return tied to that request and artifact version.
4. Parent suspension that releases execution capacity while the child works.
5. Parent continuation within policy, inspecting the actual result and recording a verdict.
6. A final owner-facing summary when the parent criteria are met or a real decision is needed.

The parent should not schedule a parallel self-successor while the managed chain already
owns continuation. A queued return, a persisted reply, a completed worker process and an
accepted review are different facts. This distinction is essential for a capable lead/cheap
worker strategy: inexpensive execution is not valuable if its result never reaches review.

Use a targeted revision request when review finds a defect. Keep the worker identity and
project if responsibility is unchanged. Reference the failing artifact version and revised
criteria rather than sending a fresh vague task that discards learned context.

## 9. Economics and quality without unsupported precision

The expected value of cross-model delegation depends on total work, not the worker's label.
A useful accounting expression is:

`total effort = lead planning + handoff preparation + worker attempts + lead review + revisions + maintenance`

For measured spending, replace each term with observed provider usage and the applicable
price/version, while distinguishing unknown costs and subscriptions. No such dollar meter
is established by the present contracts. Runtime and attempt counts are valid quantities,
but they must not be displayed as measured money. [S05](08-source-evidence.md#s05)

A high-capability lead can waste resources by overplanning simple tasks or repeatedly
reviewing partial output. A cheap worker can be a good fit for bounded implementation with
clear fixtures and a poor fit for poorly specified architecture. A specialized persistent
worker can outperform a fresh assignment worker because it already has relevant knowledge.
These are hypotheses to evaluate, not universal provider rankings.

Initial evaluation should measure artifact correctness, lead correction effort, wall latency,
retries, handoff size, process occupancy and actual available usage data. Compare a complete
lead/worker/review journey with direct execution on the same class of task. Do not call a
single successful worker run a cost-saving study.

Concurrency is a separate control. Increasing the background global threshold from 8 to 16
or 24 may shorten independent workloads, or it may increase memory/process pressure and
review backlog. The handoff's suggested values are unvalidated options. Keep the limit
configurable only with explicit scope and observation; do not select a higher default as
an assumed consequence of using cheaper models.

## 10. Failure cases and acceptance boundaries

The feature needs meaningful tests through actual schema, config resolution and provider
request construction:

- A requested permitted profile reaches the provider verbatim and appears in the attempt
  snapshot; the recipient's saved defaults remain unchanged.
- Omitted/default/disabled/explicit settings retain their canonical semantics.
- An unavailable or unauthorized selection preserves input and reports a typed failure.
- A settings change during execution affects only eligible subsequent work according to
  the selected revision contract; retries retain historical configuration evidence.
- A cross-provider change preserves Buddy/project identity and does not reuse incompatible
  native context or discard displayed history.
- The worker receives the intended bounded packet and authorized resources, without the
  manager's unrelated private transcript or memory.
- A returned artifact triggers background review only through the admitted parent route;
  owner-chat mailbox delivery stays non-executing.
- Worker retries and lead review are charged to the selected aggregate policy once such
  accounting exists; a new model does not reset the assignment's consumed allowance.

The smallest useful feature is reliable per-assignment execution selection using the
existing config authority. A generic profile marketplace, automatic model router or new
agent type is not required to establish that boundary.
