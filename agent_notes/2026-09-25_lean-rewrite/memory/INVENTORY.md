# Buddy memory: inventory (lean/integration fc5b976)

All citations re-checked on single files by the inventory agent.

## Findings
1. Doc scope is server-side routing only; the crate's `authorize` (store.rs:147-171) never checks it.
   Doc ops are `Subject::Buddy` under SelfOrManager (store.rs:43).
2. `grant.scope` (grants.ts:34,50) is read once: mcp.ts:83 `docRef`, as the default when a doc
   tool's `scope` is 'turn'. Set at policy-port.ts:77 and memory-review.ts:413. Gates nothing.
3. Root bug: turn-policy.ts:433-439 gives owner_input/buddy_post turns
   `knowledgeScope: owner_thread(conv)`; `docScopeFor` (core.ts:159-170) → `DocScope::Thread`;
   briefing.ts:62-70 and memory-review.ts:370-377,413 read/write per-chat memory.
4. **The owner's Memory tab edits buddy-scoped working/long_term (BuddyMemory.tsx:362-392,
   PORTABLE), while chat turns use thread-scoped copies: owner and agents see different memory.**
5. `docScopeFor` callers: 5 (policy-port:77, turn-policy:459, briefing:62, briefing:123 cache key,
   memory-review:370).
6. Audience key = provider-session reuse fence. `admitAudience` (turn-policy.ts:454-465) resets
   the process when JSON(docScopeFor(ctx)) differs from the saved `buddyAudienceKey`
   (conversation-config.ts:124-126; persisted turns/runner.ts:421; seeded ingest/runtimes.ts:130).
   It can be derived from the turn origin with byte-identical strings. **No test covers it** (the
   guard its comment names does not exist).
7. Thread/task docs are otherwise only touched by owner routes (routes.ts:213-230,369-387), the
   client DocList (BuddyMemory.tsx:32-49,252-290) and the importer (import.rs:435-443,
   `divergent_thread_soul` flag, never read at runtime).
8. Reviewer fires on every Buddy turn with success/exit 0/no stop (turns/runner.ts:670-673), all
   origins. Skips: builder/plain chat, spawn failure, duplicate id, inactive Buddy. 2 concurrent,
   1 per Buddy.
9. Reviewer transcript: turn-policy.ts:600-602 maps {role, content}, dropping `toolCall`
   (shared/src/conversation.ts:34); reviewTranscript (memory-review.ts:87-114) keeps user/assistant,
   48 KB. cwd = mkdtemp (memory-review.ts:398), so it cannot check agent_notes paths it is told to cite.
10. Reviewer kind restriction is zod-only; it can still pass `scope:'buddy'` or a managed buddyId.
11. Caps: timeout 120 s (memory-review.ts:38) for the whole ladder; 32 tool calls; briefing soul
    10k / memory 6k / tasks 4k / total 40k (briefing.ts:19-20).
12. Tests: ladder test buddies-v2.test.ts:725 uses a scope-less context (masks the bug); todo
    acceptance test :876-973; conversation-runtime.test.ts:129,676 cover memoryGeneration.

## Verdicts
| Concept | Verdict |
|---|---|
| DocScope Buddy / Workspace | CORE (Workspace for shared docs only) |
| DocScope Task / Thread | DEAD after the import folds them |
| knowledgeScope | MERGE into the session-audience key only |
| grant.scope, mcp `scope:'turn'` | DEAD |
| audience/session key | CORE, derived from origin, same strings |
| memoryGeneration, reviewer ladder/grant/guard, briefing caps | CORE |
| briefing cache key | MERGE → [buddyId, workspaceId] |
| reviewer transcript | MERGE: include tool calls |

## Size
Memory section files: types.rs 715, docs.rs 129, schema.rs 228, core.ts 170, briefing.ts 147,
memory-review.ts 503, mcp.ts 691, grants.ts 130, policy-port.ts 101, turn-policy.ts 703,
routes.ts 697, BuddyMemory.tsx 393. Scoping removal deletes ~75-100 lines across 12 files.
