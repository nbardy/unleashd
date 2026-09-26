# Buddy memory: lean target design (2026-09-26)

## One sentence
A Buddy has one soul, one working memory and one long-term memory; every turn reads them, and
after every completed turn a reviewer that can see what happened updates them when it matters.

## Model
```
MemoryKind = Soul | Working | LongTerm          -- addressed by buddyId alone. No scope.
SharedDoc  = { buddyId, scope: Buddy | Workspace(id), name }   -- the only scoped docs
DocRef     = Memory(buddyId, MemoryKind) | Shared(SharedDoc)    -- sum type, one dispatcher
```
- Working vs long-term differ ONLY in the prompt text describing each, and their caps
  (2,000 / 4,000 chars). Same storage, same write path (CAS `writeDoc`), same readers.
- Readers: the briefing (every turn kind), the reviewer, the Buddy's `doc_read`, the owner's
  Memory tab. All four address the same row, so owner edits and agent writes are one history.
- Writers: the Buddy (`doc_write`, in conversation), the reviewer (working/long_term only), the
  owner (Memory tab). Soul: owner and the Buddy with a grant, never the reviewer.
- Notes: `agent_notes/*.md` files (done, 9519dfc).

## Deleted
DocScope::Thread, DocScope::Task, `docScopeFor`, `grant.scope`, the mcp `scope: 'turn'|'buddy'`
input for memory kinds, the briefing's "Audience:" line and scope in its cache key, the client's
thread/task address arms and labels, the importer's per-audience memory rows.

## Kept, decoupled
**Session audience key** (turn-policy `admitAudience`): still resets a provider session when a
conversation switches between owner turns and worker/message turns. Derived from the turn origin,
producing byte-identical strings, so no saved session resets on deploy. It no longer mentions memory.
It gets its first test.

## Reviewer
- Fires after every completed Buddy turn (already true: runner.ts:670). Unchanged.
- Sees what the turn did: transcript messages carry `toolCall {name, input}`, input capped at
  ~400 chars each; the 48 KB budget keeps the newest.
- Runs in the workspace root. Read-only file tools per harness are allowed (Codex sandbox
  read-only shell; Cursor `--mode ask` read/glob/grep; Claude Read/Glob/Grep). Write-capable tools
  are still refused. The guard lists allowed names per harness; nothing else changes.
- Time budget per ladder attempt, 300 s (was 120 s for the whole ladder).
- Instructions: tightened to the two docs; "update when relevant" = in-flight state → working,
  resolved state → remove from working, lasting preference/lesson → long-term, nothing new → NONE.

## Credits (stateless)
agent-cli-tool stops the CLI as soon as it emits `out_of_tokens`. No cache between runs.

## Migration (importer, one-time, verified)
Per Buddy and kind (working, long_term): the newest revision across the legacy head and every
thread/task/workspace copy becomes the Buddy's single doc; revision history of the winner kept.
Every other copy is appended to `agent_notes/buddy-notes/<buddy>/memory-archive.md` by
`export-notes`. Verify: per-Buddy count of folded copies = archived sections; winner hash equal.
Thread-scoped souls (5): same rule, archive the rest.

## Budgets (net lines)
| Area | Now | Target |
|---|---|---|
| scoping (core/briefing/review/mcp/grants/policy/runner/shared/routes/client/crate) | ~100 | 0 |
| session key (turn-policy) | inside docScopeFor | ~12, own function |
| reviewer transcript + harness tools + timeout | — | +40 |
| importer fold + archive | — | +80 (deleted after the swap) |
| tests: acceptance (todo→real), session key, importer fold | — | +120 |

## Decisions (defaults taken; owner may overrule)
| # | Question | Default |
|---|---|---|
| D1 | Which per-chat copy becomes the memory | newest revision wins, rest archived to a file |
| D2 | Keep the session reset between owner and worker turns in one conversation | keep (behaviour unchanged) |
| D3 | Let the reviewer read files | yes, read-only tools per harness; writes refused |
| D4 | Live relevance benchmark (costs credits) | port the harness + add relevance cases; running it is an owner gate |
