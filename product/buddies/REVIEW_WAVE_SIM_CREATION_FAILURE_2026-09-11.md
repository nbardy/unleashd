# wave_sim startup feedback: consolidate creation before expanding the API

2026-09-11, Asia/Makassar. Design review by Buddies Development Lead in response to the owner forwarding the Wave_sim CEO conversation. **Documentation only.** The quoted conversation supplies incident evidence and preferences; it does not authorize restarting stopped work or changing team configuration here.

This is a successor to [Direction 1: resource consolidation](REFLECTION_01_RESOURCE_CONSOLIDATION_2026-09-11.md), not a fourth architecture. It makes the first consolidation boundary concrete.

## 1. What the incident establishes

The forwarded CEO conversation reports five lead starts failing before acknowledgment with a minimum-length error at `creation.initialMessage`. Its supported Project Lead retry then held because the reserved destination conversation did not exist. The owner stopped substantive work and subsequently requested design review before more patching.

The [CEO's repair note](../../agent_notes/2026-09-11_buddy-launcher-creation-fix.md) records a provisional local patch, 12 focused passing regressions and a passing server typecheck. Source inspection here confirms the patch is present. Those tests were not rerun during this review. This review does not establish whether the active server loaded it or whether a live team round trip now works.

The architectural diagnosis is narrower than “Buddies need a different conversation system”:

- Ordinary chat and Buddy work already use `ConversationConfigService` and the same `Conversation` runtime.
- WebSocket chat creation and Buddy creation separately orchestrate persistence, runtime construction, registration, links and first-input handling.
- The launcher supplied an empty pending initial message to a schema that correctly permits omission but requires a supplied message to be nonempty.
- The prior real-provider owner test directly constructed its conversations. It tested a real provider and message/reply behavior, but bypassed the production creation boundary.

The last point corrects the breadth of our earlier verification claim. A real model does not make a test end-to-end if the failing application boundary is replaced. The newly modified coordination regression now uses the real creation/configuration service; the older real-provider test still bypasses it in the inspected source.

This feedback also changes the operational lesson: when persistent team execution fails, replacing the staff with temporary helpers can conceal the broken product path. For this incident, the owner explicitly stopped that workaround. Diagnosis and repair must be reported before claiming that the team is working.

## 2. The shared path

Use one application-level conversation creation operation behind all adapters:

```text
Owner chat / Builder / Buddy request / automation
                       |
       shared create-or-reuse conversation operation
                       |
        existing config store + runtime + registry
                       |
         authorized input admission and dispatch
                       |
        existing provider runtime + drain/settlement
```

These are in-process application functions, not new network services. Buddy dispatch and scheduling call them directly; they do not loop back through a WebSocket or HTTP route.

The shared creation operation owns:

1. Validated configuration, workspace and conversation identity.
2. Stable creation command replay, conflicting-intent rejection and tombstones.
3. Runtime lookup/materialization, with one winner under concurrent replay.
4. Idempotent registration and Buddy/provider linkage.
5. A typed creation result, including whether durable creation and runtime materialization succeeded.

Adapters resolve their authorized inputs, provide source-specific context and translate transport acknowledgments. They do not copy the persistence/replay/register algorithm. Provider-specific model/effort values still pass through the existing provider boundary.

Creating a conversation does not execute a model. Starting a turn requires a distinct authorized input. Human UI “create and send” stays one convenient user action composed from those operations. It still needs durable input identity and reconnect-safe acknowledgment; removing the empty placeholder must not make the first human message lossy.

This does not require migrating every human chat turn into the Buddy run tables. Share the creation/runtime and input admission boundary while retaining each legitimate input producer's durable identity. Do not create a second generic job scheduler to unify function names.

## 3. Keep conversation identity, input identity and attempt identity separate

Conceptual internal types:

```ts
type ConversationTarget =
  | { kind: 'existing'; conversationId: string }
  | { kind: 'fresh'; creationKey: string };

type DurableInputRef =
  | { kind: 'owner_message'; inputId: string }
  | { kind: 'buddy_message'; messageId: string }
  | { kind: 'schedule'; scheduleId: string; occurrenceKey: string };

type CreateResult = {
  conversationId: string;
  state: 'created' | 'reused';
};

type StartupProblem = {
  phase: 'configuration' | 'creation' | 'linking' | 'admission' | 'provider';
  code: string;
  message: string;
  input: DurableInputRef;
  conversationId: string | null;
  runId: string | null;
  recovery: 'repair_then_retry' | 'wait' | 'new_request_required';
  remedy: string;
};
```

These are sketches for the existing application seam, not new public MCP tools. Host-produced owner provenance or current run claims are separate private arguments; they never come from these model-visible identifiers.

Persist the distinction between a fresh create and an existing-thread continuation at the request/creation boundary. A conversation ID reserved before failed creation does not prove that a thread was successfully created. A missing runtime does not prove that the durable thread was deleted. Recovery consults the durable creation/config record and its tombstone.

An explicit retry of failed fresh creation reuses the original creation intent and stable thread identity. A new attempt gets its own run/claim identity. A continuation or reply cannot silently become fresh creation, and a deleted conversation cannot be recreated by replay. A failure after provider submission is uncertain execution, not a safe creation-only retry.

The CEO's `creationOrigin` helper is a constrained provisional repair based on existing run lineage and generated IDs. The consolidated design should make creation provenance an explicit resource fact and keep recovery at the common creation boundary. Do not generalize ID-prefix parsing into a public lifecycle protocol.

## 4. Background is presentation, not another runtime

Dedicated background/automation conversations should appear under Buddy activity/work history by default. Human chat remains in the ordinary list. A schedule that targets an existing human conversation must not change that conversation's placement.

Use existing conversation purpose/origin metadata for the default placement and an explicit owner presentation override when needed. The predicate belongs in a shared derived client view. Do not infer background status from a temporary folder name or treat every conversation that ever had a run ID as hidden. Do not reuse a swarm-specific worker classification if it changes unrelated behavior.

Background transcripts remain stored, reloadable, searchable within permission scope and directly inspectable. Hiding them from a default list must not remove them from the canonical conversation registry or break availability-checked links. Opening or promoting one changes neither its grants nor its stopped/completed state.

No special `BackgroundConversation` class, alternative transcript store or new Goal table is needed. Projects/tasks still own criteria and evidence; runs still own bounded attempts. Visibility, read permission and execution authority remain separate.

The desire to inspect a transcript does not decide how arbitrary live human steering interrupts it. Preserve existing supported stop/follow-up behavior. Any future live steering should be a typed new input that serializes with active work, not an unclaimed side channel into a running provider.

## 5. A hidden worker must have a visible failure path

Persist startup/hold/failure state on the input/run receipt, independently of successful child-conversation creation. Surface a compact failure card to the responsible lead and owner activity view using ordinary application events. Rendering that card must not require launching another model through the same broken creator.

An optional lead wake can use the normal queue, but the durable visible failure must survive if that wake also fails or the lead is paused. Coalesce repeated notices by failed attempt so one incident does not create an alert or retry storm.

Reuse `send`, `get_message` and `get_runs` to expose the startup phase, precise code, remedy and original identifiers. `retry_run` must distinguish retryable failed creation from stopped roots and uncertain prior execution. Configuration readiness and actual execution are different observations.

The running build identity belongs in existing runtime diagnostics/receipts. A compatible `.4` schema version alone cannot show that this source-level launcher repair is loaded. Cooperative reload must preserve active ownership; a pending reload is observable state, not proof that new code is active.

## 6. Acceptance must exercise the application that ships

| Boundary | Required evidence |
|---|---|
| Ordinary create + first message | Real config persistence and input delivery; reconnect causes one runtime and one first turn |
| Fresh Buddy assignment | Native send → scheduler → actual shared creator → config/registry/link → provider admission |
| Failure before/after persistence | Explicit retry reuses original intent; no duplicate thread or provider start |
| Missing/deleted existing thread | Honest hold/error; no implicit replacement or tombstone resurrection |
| Cancellation during async creation | Any late-created runtime stays dormant; fenced claim cannot enqueue; cleanup is observable |
| Child reply/lead return | Same original visible lead chat, fresh employee authority; no inherited owner tools |
| Dedicated automation and current-thread schedule | Same creator/runtime; only dedicated background thread is omitted from default chat list |
| Failure with no child conversation | Lead/owner sees persisted failure and remedy without needing a callback model to start |
| Restore/open background transcript | Link resolves after reload; opening neither starts nor elevates a run |
| Deadlines and partial startup | Foreground `TURN_MAX_RUNTIME_MS` remains explicit; automatic timeout is `max_runtime_timeout`; drain owns release |

Use a deterministic provider for repeatable lifecycle tests, then a bounded real-provider test through **the same creation/config/registration path**. Avoid rebuilding production wiring differently in every fixture. Finally verify the loaded runtime through a native lead request, acknowledgment, evidence and return. Each layer proves something distinct.

The CEO explicitly stopped some original request roots. They must remain stopped. When execution is authorized to resume, use a new bounded verification request and later explicitly reissue the intended work as appropriate. No setup replay, hidden transcript promotion or background toggle may revive stopped work.

## 7. Effect on the three alternatives

- **Direction 1 remains the recommendation.** One shared application service is an actual deletion of duplicate policy/orchestration. Creation is its first concrete consolidation target.
- **Direction 2 would not fix this by itself.** An atomic roster/document batch still has to create a provider conversation correctly afterward.
- **Direction 3 would not fix this by itself.** Shared spaces and attention still require that same creation and execution boundary.

No additional team-management MCP is needed for this defect. The work is common application wiring, accurate existing receipts, background presentation and proof at the real boundary. Broader private-context and external-action controls remain separate unfinished requirements.

## 8. Provenance and decision status

Owner-forwarded source conversation: `6247f227-6659-4b53-a9d0-2d04272bd60e`, Wave_sim CEO. Native wave_sim design note: [one conversation creation path](</Users/nicholasbardy/git/wave_sim/agent_notes/20260910T171822Z_01M2657RET8ASRMYQ19MR2SQCR_design-direction-one-conversation-creation-path-_wave_sim-ceo_e3b4920d.md>). Its statement of owner intent is historical evidence, not current execution authority.

Observed working-file snapshots on this date:

| File | SHA-256 | Evidence retained here |
|---|---|---|
| `server/test/buddy-owner-live.test.ts` | `74e81fb52a26768d1fd28e6135db3cd6fd7b73653a4b9268801f8fe1f342d6a9` | `createConversation: async (input) => create(input.conversationId, input.context)`; helper directly calls `new Conversation` |
| `server/test/buddy-coordination.test.ts` | `b6305737dd04d9668dda9fd37c659cb041a65cb3f64871183656fea59b4c627e` | New wiring: `createConversation: creation.createServerBuddyConversation` with real config store |
| `server/src/conversations/buddy-creation-service.ts` | `4c7df91709cf3675caabd43277a4b055f9019e5e256cda031ab97b46bdacd1d1` | `initialMessage?: string`; `createAndRegister` persists, constructs, registers and links |
| `server/src/transport/conversation-websocket.ts` | `793d3a152149502496b61f6a12fbae4dcd21c9f2e39b766d66d6c1ec42f528ac` | Separate orchestration calls `createOrReplay`, checks registry winner, constructs/registers/links |
| `server/src/buddies/run-executor.ts` | `1300f5e090d2865905516c7a6d3a81edb5ca109e1a30fd423fdf08dbf73c54e7` | Initial message omitted; `creationOrigin` restricts fresh-create recovery |
| `shared/src/conversation-config.ts` | `e353f562e889d906fcac1c93f4e2be1bbbe6081804f6a47ea8d66d7e85cbd8bf` | `initialMessage: z.string().min(1).optional()` |
| CEO repair note | `a597b2376fb117a1ee807fbee45e271296ce44ac372a2dc61bcf903efcbebf4e` | Reports 12 local tests; explicitly leaves live activation unverified |

Proposed design refinement by Buddies Development Lead. No source patch was added/reverted, live team command issued, server restarted or production grant changed in this review. The existing provisional fixes and their evidence remain available for the implementation decision.
