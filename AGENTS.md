# AGENTS.md — Agentic Coding Guide

Index for agents. Hard rules inline; read the linked doc BEFORE working in
that area.

## Code tree map

```
shared/src/index.ts                → Zod schemas, types, per-provider helpers
server/src/server.ts               → Conversation class + WS router (state authority)
server/src/adapters/*              → registry/disk-adapter/loader: session persistence
server/src/auth/*                  → shared-secret gate (policy/gate/express)
server/src/providers/*             → thin Provider impls per CLI
vendor/agent-cli-tool/             → GIT SUBMODULE: canonical request → argv →
                                     process → unified event stream. Thin wrapper;
                                     harness differences live at its edges only.
client/src/atoms/*                 → jotai atoms, derived views, WS actions
client/src/components/{Sidebar,Chat,ProviderModelPicker}.tsx → main desktop UI
client/src/mobile/*                → mobile view tree (second shell, same core)
client/src/atoms/ui.ts             → persisted UI prefs (local+shared partition)
```

## Hard rules (violations = rejected PR)

- Never `useAtomValue(conversationsAtom)` in components — use
  `conversationAtomFamily` / derived atoms. Streaming text goes to
  `streamingContent`/streaming atoms, never `conversations.messages` mid-stream.
- All hooks before any early `return`. New list views go in derived atoms, not
  component `useMemo`. Stable fallbacks are module constants.
- `jotaiStore.set` only inside `client/src/atoms/` (via `mutate()` for partial
  updates). Mobile never imports `components/*` except `components/buddies/`.
  Gates: `bash tools/check-client-invariants.sh`.
- One WS bridge (`App.tsx`), one `handleMessage` spine — never a second.
- Auth gate stays FIRST in the Express chain and the WS stays `noServer` +
  explicit `upgrade` handler. `new WebSocketServer({ server })` accepts every
  upgrade before app code runs and republishes the whole command channel.
- Provider-bespoke values (effort levels etc.) pass through verbatim as
  `z.string()`; no shared enums, no value translation, server-side defaults.
- Submodule commits: commit + push INSIDE `vendor/agent-cli-tool` first, then
  bump the outer pointer. Never push main unless the user asks.
- Prefer one integration test through a real boundary over mock-heavy units;
  never assert on TSX/CSS source text.

## Read before touching

| Area | Doc |
|---|---|
| Client state: subscriptions, mutations, perf, hook ordering | `docs/client-state.md` |
| Mobile view tree, grep gates, DeviceKind, UI-state partition | `docs/mobile-view-tree.md` |
| Mobile UI primitives, styling layers, extraction rules | `docs/mobile-ui.md` |
| Architecture: provider seam, submodule rules, lifecycle | `docs/architecture.md` |
| Auth: shared secret, bind policy, why plain-http LAN is the weak path | `docs/auth.md` |
| Per-conversation settings + pass-through pattern (7-step checklist) | `docs/pass-through-pattern.md` |
| WS contract surprises (`conversation_created` reused for updates, optimistic stubs) | `docs/ws-contract-surprises.md` |
| Submodule commit dance + `git status` cheatsheet | `docs/git-submodule-dance.md` |
| Test strategy: useful vs overkill, lifecycle authority | `docs/test-strategy.md` |
| New provider integration protocol | `docs/agent_client_spec.md` |

## Misc

- Adding a provider: harness (submodule) + `server/src/providers/{name}.ts` +
  `ProviderSchema` in shared + registry entry + disk adapter if persisted.
- When source is broken, `server/dist/*.js` (and `shared/dist/`) is the oracle
  for the author's prior intent — check it before git archaeology.
