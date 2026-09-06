# Pass-through pattern for provider-owned values

Use this pattern for per-conversation settings whose values belong to the
upstream CLI, such as model IDs and reasoning effort. Preserve the provider's
strings through storage, transport, resolution, and CLI arguments.

## Canonical settings and catalog

[ConversationConfig](../shared/src/conversation-config.ts) stores selection
intent. A model is `default` or `explicit`; reasoning is `default`, `disabled`,
or `explicit`. An explicit effort is a `z.string().min(1)`, not a shared enum.
These selection modes are application semantics; the effort strings remain
provider-owned. `disabled` omits the effort argument, while `default` resolves
the selected model's catalog default.

The model and effort catalog originates in
[`vendor/agent-cli-tool/catalog.jsonc`](../vendor/agent-cli-tool/catalog.jsonc).
[`shared/scripts/gen-catalog.ts`](../shared/scripts/gen-catalog.ts) generates
[`shared/src/generated/catalog.ts`](../shared/src/generated/catalog.ts); do not
hand-maintain parallel arrays in `shared/src/index.ts`. The server's
[catalog service](../server/src/providers/catalog-service.ts) builds the runtime
`ProviderCatalog`, including dynamic model handling. UI choices come from that
catalog through [useProviderCatalog](../client/src/hooks/useProviderCatalog.ts).

`resolveConversationConfig` resolves intent to a `ResolvedExecutionConfig` and
validates model-specific reasoning levels. The server owns execution defaults
and validates every create/update through
[ConversationConfigService](../server/src/conversations/config-service.ts).
Client defaults express `{ mode: 'default' }`, not guessed model or effort values.

A running turn keeps the execution snapshot captured at spawn. Model/reasoning
changes apply to the next turn; provider changes are blocked while work is active
or queued and after a provider session has started.

## Adding a setting: seven touch points

1. **Shared contract** — extend the schemas and types in
   [conversation-config.ts](../shared/src/conversation-config.ts), including
   selection intent, patches, and resolved execution values as needed. Keep
   provider values as strings and reuse these types across client and server.
2. **Catalog and resolution** — add provider/model capabilities and defaults to
   the catalog and shared resolver. Record evidence from the actual CLI contract;
   expose validation failures with typed errors and valid values. Regenerate the
   shared catalog with `pnpm --filter @unleashd/shared gen:catalog` when it changes.
3. **Server update path** — use `create_conversation` and revision-checked
   `set_conversation_config` through the config service. Extend runtime execution
   mapping in [runtime.ts](../server/src/conversations/runtime.ts), rather than
   adding an independent setter or assigning a provider default in the UI.
4. **Persistence and hydration** — extend the durable config record and review
   [config-store](../server/src/conversations/config-store.ts) and
   [legacy-config-migration](../server/src/conversations/legacy-config-migration.ts).
   Provider transcripts may lack the setting: retain durable intent on reload.
   Retired explicit selections remain `unavailable` with diagnostics rather than
   silently becoming defaults; `lastResolved` is historical resolution context.
5. **CLI harness** — extend the appropriate flag hook in `agent-cli-tool` and
   pass the value verbatim. Commit and push the submodule before bumping its outer
   pointer; see [submodule workflow](git-submodule-dance.md).
6. **Shared UI** — extend
   [ConversationConfigPicker](../client/src/components/ConversationConfigPicker.tsx)
   and its callers using the same config and catalog. Keep provider-change resets
   synchronous in the selection handler; avoid effects that race user input.
7. **Commands and verification** — extend
   [config actions](../client/src/atoms/config-actions.ts) or the
   [pending creation/replay path](../client/src/atoms/pending-creations.ts), as
   appropriate. Preserve authoritative acknowledgement/rejection handling from
   [WS contract notes](ws-contract-surprises.md). Exercise the real config/CLI
   boundaries using [test strategy](test-strategy.md).

Do not add a union of every provider's effort strings, translate one provider's
value into another's vocabulary, or infer selected intent from a displayed
resolved value. Keep legacy-format conversion at its existing migration boundary.
