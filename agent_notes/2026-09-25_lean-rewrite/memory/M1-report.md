# M1 report: one memory per Buddy (2026-09-26)

Branch `lane/memory-unify`, worktree `.claude/worktrees/lane-memory`. Commits on top of 486a2d3:
`a6fcec1` (crate), `d3a5058` (server/client/tests/docs), plus a small follow-up (helper rename, guard
name). Not merged, not pushed. `git status --porcelain` empty.

## What changed
- **Crate** (`crates/unleashd-buddies`): `DocScope::Thread` and `::Task` deleted (types.rs, index.d.ts),
  schema CHECK is now `scope_kind IN ('buddy','workspace')`. `docs.rs` has one address rule,
  `check_address`: soul/working/long_term with a Workspace scope is `CoreError::Invalid` in both
  `read_doc` and `write_doc`; `doc_workspace` has only Buddy | Workspace arms. Kept the flat `DocRef`
  (the smaller change) instead of a Memory | Shared sum. `tests/query_plan.rs` now reads a
  Workspace-scoped shared doc instead of the Task one. New test `memory_kinds_are_refused_outside_buddy_scope`
  (tests/core.rs).
- **Server**: deleted `docScopeFor` (core.ts), `grant.scope` (grants.ts, policy-port.ts,
  memory-review.ts), runner.ts `knowledgeScope`, routes.ts `scopeOf` thread/task arms and enum values.
  mcp.ts: the doc tools' `scope` is now `'buddy' | 'workspace'` (default buddy; described as
  shared-docs only, the crate refuses it for memory kinds); the reviewer's doc tools have no `scope`
  input at all. briefing.ts: reads soul/working/long_term at Buddy scope, no "Audience:" line, no
  scope in the identity hash or the cache key (now `[buddyId, workspaceId]`). memory-review.ts
  reads the Buddy doc. Fix-guard comments at the briefing and reviewer read sites name the
  2026-09-26 bug and the acceptance test.
- **Session audience key**: new pure function `sessionAudienceKey(origin, conversationId, context)`
  in turn-policy.ts, tagged `// Pattern: pure-core`. Same strings as before:
  `{"kind":"thread","threadId":<conv>}` for owner_input/buddy_post, else
  `{"kind":"task","taskId":…}` / `{"kind":"workspace","workspaceId":…}`. `contextForInput(input)` became
  `turnContext()` (it no longer depends on the input); the now-unused `input` parameter of
  `TurnPolicy.spawned` was dropped (policy.ts, turns/runner.ts).
- **Shared**: `BuddyContext.knowledgeScope` removed. `BuddyContextSchema` is a non-strict `z.object`,
  so persisted rows that still carry the field parse (the key is stripped); a comment says so.
  `BuddyKnowledgeScopeSchema` stays, because `ConversationBranchSchema.audience` still uses it
  (nothing reads `.audience`; a candidate for a later deletion).
- **Client**: BuddyMemory.tsx loses the thread/task `addressOf` arms and labels; the client test
  drops its thread-address assertion.
- **Docs**: a dated header in `product/buddies/PLANNING_MEMORY.md`.

Behaviour note: the briefing identity hash no longer includes the scope, so each live session
re-briefs once after deploy (memoryGeneration changes once). Saved provider sessions are not reset.

## Lines (git diff --shortstat 486a2d3 HEAD)
23 files changed, 307 insertions(+), 243 deletions(-). Source (not tests/docs): +119 / -136.
Tests: +181 / -107. About 100 lines each way are biome re-indenting the acceptance test body after
the `{ todo }` options object was removed.

## Tests
- `cargo test -p unleashd-buddies --no-default-features`: all pass (26 + 1 + new test).
- `pnpm addons`: rebuilt unleashd-buddies.
- `pnpm typecheck`: exit 0.
- `pnpm test:server`: 201 pass, 0 fail, 0 todo. The acceptance test "memory the reviewer saves after
  one chat is in the next chat's briefing" is no longer todo and passes. It uses a real owner-chat
  context shape (conversation context + `coordinationRunId`) and also checks that the owner's Memory
  tab row holds the reviewer's write. The ladder test's context now has the same shape.
- New `conversation-runtime.test.ts` test "session audience key: an owner turn resumes a session
  saved under the old key; a non-owner turn resets it". It goes through the real Conversation runtime
  and restores a session saved under the literal old key. Two owner turns resume it, then a
  non-owner turn starts fresh, and the persisted keys are asserted as literal JSON. Mutation-checked:
  it fails if the key format changes, and it fails if owner and non-owner turns share a key.
- `pnpm test:client`: 167 pass. `bash tools/check-client-invariants.sh`: all 8 gates PASS.
- Setup note: the worktree's `vendor/agent-cli-tool` checkout was behind its recorded commit
  (efe0503 vs 31469d4), which broke typecheck. I ran `git submodule update` for that path and
  rebuilt its dist. No vendor source was edited.

## Import crate impact (not edited, other lane)
`unleashd-buddies-import` still compiles, but 4 of its tests now fail at runtime:
`CHECK constraint failed: scope_kind IN ('buddy','workspace')`. import.rs:437 maps
`owner_thread` to `'thread'` and `project` to `'task'` when it inserts doc rows, and verify.rs:115,123 use the same
mapping. The importer's fold (the newest revision wins; the other copies are archived) must write
only buddy/workspace rows. Soul rows that were thread-scoped must fold the same way.

## Left for M3 (not done here)
Reviewer transcript with tool calls, per-harness read-only tools with the workspace as cwd, the
per-attempt 300 s timeout, and tighter instructions. The reviewer instructions still mention "scope"
in their generic provenance sentence (memory-review.ts:80). That sentence is about claims, not
doc scope, so I left it.

## Gate: merge of lean/integration (5d8ae9f) into lane/memory-unify: 11ceb54

The coordinator's ca1bccc merged lane/memory-import (M2), which fixes the 4 importer failures noted
above. The lean/integration merge conflicted in 5 files. Each was resolved by hand onto upstream's
structure; no file was taken whole with --ours or --theirs.

### Survival check (lines each parent added vs merge base 486a2d3 that are missing from the result)
| File | Parent | Added | Missing | Why each miss is correct |
|---|---|---|---|---|
| briefing.ts | ours | 15 | 4 | Our inline Buddy-scope read and its 3-line fix-guard comment moved into upstream's shared `readBuddyState` (same read; the comment is reworded there). |
| briefing.ts | theirs | 19 | 12 | `readBuddyState(core, buddyId, scope, soulScope)`, its `DocScope` parameters, the per-kind scope reads and the `docScopeFor` call site. These are the per-audience scoping M1 deletes; the function now takes `(core, buddyId)`. |
| core.ts | ours | 1 | 1 | Our one-line import, superseded by upstream's multi-line import (BuddyChanges, ManagerRef, zod). |
| core.ts | theirs | 121 | 1 | `type DocScope` import: only `docScopeFor` used it, and that function is deleted. |
| mcp.ts | ours | 19 | 5 | Our `DocInput` type. Upstream's `docRef` takes `z.infer` of the schema, so the type is redundant; our scope logic now lives in their `docRef`. |
| mcp.ts | theirs | 64 | 1 | `input.scope === 'buddy' ? … : grant.scope`: grant.scope is deleted, replaced by an explicit 'workspace' (shared docs) or Buddy. |
| memory-review.ts | ours | 5 | 4 | Our inline read and its fix-guard comment, replaced by upstream's `readBuddyState(core, buddyId)` (the guard comment is at that definition). |
| memory-review.ts | theirs | 37 | 2 | `readBuddyState(core, buddyId, scope, {kind:'buddy'})`: the scope arguments are gone. |
| routes.ts | ours | 1 | 0 | nothing missing |
| routes.ts | theirs | 195 | 2 | The `task` and `thread` rows of `DOC_SCOPES` (the deleted scopes); the table is kept with its workspace row. |

`cursor-ephemeral` (the old import in HEAD's memory-review.ts) had been removed upstream in favour of
`detached-cli`; the result follows upstream.

### Results after the merge
- `git submodule update`: not needed (vendor/agent-cli-tool already at the recorded 31469d4).
- `cargo test -p unleashd-buddies --no-default-features`: ok (26 + 1).
- `cargo test -p unleashd-buddies-import --no-default-features`: ok (5 passed; the 4 earlier failures are fixed by M2).
- `pnpm addons`: rebuilt. `pnpm typecheck`: exit 0. biome format/lint on the 5 files: clean.
- `pnpm test:server`: 199 pass, 0 fail, 0 todo. This includes "memory the reviewer saves after one
  chat is in the next chat's briefing", "session audience key: …" and the reviewer ladder test.
- `pnpm test:client`: 179 pass. `check-client-invariants.sh`: all 8 gates PASS.
- `git status --porcelain`: empty.
