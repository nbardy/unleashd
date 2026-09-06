# WebSocket message contract — surprises

(Moved out of AGENTS.md to keep startup context small.)

## WebSocket message contract — surprises

### `conversation_created` is reused for UPDATES

Set-value handlers (`set_model`, `set_provider`, `set_reasoning_effort`)
broadcast `conversation_created` carrying the new state. There is no
`conversation_updated` type today. Consequences:

- Any client-side code reacting to `conversation_created` (like
  `removePendingConversation`) MUST be idempotent or guarded against the id
  not being in the pending list.
- If you add a new setter, follow the same pattern OR introduce a proper
  `conversation_updated` message and update all existing handlers in lockstep.

### Rejection → authoritative rebroadcast

When a setter rejects input (e.g. `isEffortValidForProvider` fails), the
server sends `{type: 'error', message}` AND a `conversation_created` carrying
the unchanged authoritative state. The client uses this to roll back optimistic
writes. Without the rebroadcast, optimistic writes would stick forever.

### Optimistic stubs need the full schema shape

`createConversation` writes a Conversation stub to `conversationsAtom` before
the server confirms. Any field you add to the schema MUST also land in that
stub (plus the pending-conversation localStorage stub in `handleMessage`'s
`init` reconciler), otherwise the UI renders wrong for a brief window before
the server confirmation arrives.

### Replay of `create_conversation` can send `conversation_created` THEN `command_rejected`

When a client re-sends `create_conversation` for an id the server already
holds (a reconnect replay), the server answers `conversation_created` as soon
as the config replay matches, and only THEN runs `dispatchInitialMessage`.
Dispatch rethrows Buddy-authority rejections, so the client can receive
`conversation_created` followed by `command_rejected` for the same
`commandId`. The conversation does exist in that case — only the initial
message was refused — which is why the rejection still carries
`authoritativeConversation`.

Until 2026-09-06 that rejection, and a deleted-id tombstone, were both
reported with the fingerprint-mismatch text "Conversation ID already exists
with different configuration", so a refused Buddy message read to the user as
a config conflict on a conversation they had just been told exists.
`replayFailureMessage` in `server/src/transport/conversation-websocket.ts`
now picks the message by error type (`ConfigRevisionConflictError` →
mismatch text, `ConversationTombstonedError` → its own message, anything else
→ the failure's message). Guarded by
`server/test/buddy-conversation-contract.test.ts` ("replaying
create_conversation reports the real failure").

---
