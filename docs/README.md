# Unleashd documentation

Start with [AGENTS.md](../AGENTS.md) for the code map and required rules, then
read the guide for the area you are changing.

| Task | Guide |
|---|---|
| Understand providers, persistence, and lifecycle ownership | [Architecture](architecture.md) |
| Change client subscriptions, mutations, or streaming state | [Client state](client-state.md) |
| Change the mobile shell or shared UI preferences | [Mobile view tree](mobile-view-tree.md) |
| Style or extract mobile components | [Mobile UI](mobile-ui.md) |
| Change conversation settings | [Pass-through pattern](pass-through-pattern.md) |
| Change WebSocket behavior | [WS contract notes](ws-contract-surprises.md) and [shared schemas](../shared/src/index.ts) |
| Change how sub-agents are shown | [Sub-agent UI contract](subagent_ui_contract.md) |
| Change authentication or network access | [Auth](auth.md) |
| Add a provider | [Provider integration protocol](agent_client_spec.md) |
| Update the provider submodule | [Submodule workflow](git-submodule-dance.md) |
| Choose and run checks | [Test strategy](test-strategy.md) and [Maintenance](MAINTENANCE.md) |
| Work on Buddies or planned product changes | [Product index](../product/README.md) and the area-specific links in [AGENTS.md](../AGENTS.md) |

Current client conversation and UI state lives in [atoms](../client/src/atoms/).
[server.ts](../server/src/server.ts) wires the [conversation runtime](../server/src/conversations/runtime.ts)
and [WebSocket router](../server/src/transport/conversation-websocket.ts);
persistence loads through the [adapter registry](../server/src/adapters/registry.ts).

## Historical context

Dated incident reports and [agent notes](../agent_notes/) preserve rationale
and evidence; superseded designs live only in git history. Update the relevant
guide when behavior changes; keep this file as an index rather than
duplicating implementation instructions.
