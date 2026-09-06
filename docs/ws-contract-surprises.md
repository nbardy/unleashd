# WebSocket contract notes

The wire contract is defined in [shared schemas](../shared/src/index.ts).
[Conversation WebSocket handlers](../server/src/transport/conversation-websocket.ts)
apply commands; the client's single `handleMessage` dispatcher in
[actions.ts](../client/src/atoms/actions.ts) reconciles their results.

## Creation acknowledgements and updates are distinct

Protocol v2 uses these messages:

| Command or event | Contract |
|---|---|
| `create_conversation` | Includes `commandId`, client-generated `conversationId`, working directory, and canonical `config`. |
| `conversation_created` | Acknowledges creation to the requesting socket, with its `commandId` and authoritative conversation. Matching create retries receive the same acknowledgement. |
| `conversation_updated` | Carries an authoritative conversation and `reason`; config updates include `commandId`. Other sockets receive this event when a conversation is created. |
| `set_conversation_config` | Includes `commandId`, `conversationId`, `expectedRevision`, and a shared `ConversationConfigPatch`. Success broadcasts `conversation_updated`. |
| `command_rejected` | Correlates a typed error with `commandId`; may include `authoritativeConversation`. A rejected update to an existing conversation includes that snapshot. |

The old `set_model`, `set_provider`, and `set_reasoning_effort` messages are no
longer the setter API. Do not reuse `conversation_created` for config updates.
A generic `error` remains for uncorrelated protocol failures and legacy drain
handling; it is not the config rejection contract.

## Pending commands are separate from server snapshots

`conversationsAtom` contains server `Conversation` snapshots. New creations live
in `pendingCreationsAtom`, and config writes live in `pendingConfigCommandsAtom`;
neither is a partial `Conversation`. Config actions send the patch and record
pending state without overwriting the authoritative config optimistically.

[pending-creations.ts](../client/src/atoms/pending-creations.ts) persists creation
intent and migrates the older localStorage format. Preserve the original command
and conversation IDs on reconnect so retries stay idempotent. A matching
`conversation_created` removes its pending record; a rejection retains the error.
Only retryable admission failures are automatically cleared for a new connection.

On `init`, the client reconciles persisted creations with server IDs and clears
pending config commands from the previous socket epoch. A lost acknowledgement
must not leave the UI saving forever. Any new creation field must be carried
through the command, pending representation, persistence, and replay path.

## Summaries are not full transcripts

`init` and `conversations_updated` can set `summaries: true`: their `messages`
contain a preview, while `messageCount` preserves the total. Full history loads
through `GET /api/conversations/:id`. Check `conversationDetailsLoadedAtomFamily`
when the UI needs a complete transcript; preserve hydrated messages when merging
summary updates.

`init.loading` means historical loading is still in progress. The client keeps
prior state while batches arrive and marks completion on `conversation_load_complete`.
Only WebSocket `create_conversation` bypasses the startup barrier and is admitted
while the server is `starting`. Other WS commands wait for that barrier. HTTP
mutations, including `POST /api/buddies/builder` used by New Buddy, return
`503 server_starting` until the server is `idle`. See
[architecture](architecture.md) for lifecycle ownership and failure behavior.
