# Sub-Agent UI Contract

This document describes the current server-to-client contract for sub-agent
state in `unleashd`, with emphasis on Codex native sub-agents.

## Goal

The UI should be able to show, without provider-specific guesswork:

- when a sub-agent starts
- whether it is still active
- its current status
- when it reaches a terminal state

The stable shared status model is:

- `pending`
- `running`
- `completed`
- `error`

These are the only statuses the UI should use for color/state logic.

## Where the contract lives

- Shared schemas:
  - `shared/src/index.ts`
- Server lifecycle handling:
  - `server/src/server.ts`
  - `server/src/subagent-tools.ts`
- Client WS reducers:
  - `client/src/atoms/actions.ts`
- Client display merge:
  - `client/src/utils/subAgents.ts`
  - `client/src/views/conversation/SubAgentPanel.tsx` (both trees: `presentation` `tree` | `cards`)

## Upstream Codex runtime shape

Codex native sub-agents arrive from `vendor/agent-cli-tool` as normalized
`tool.use` events whose `input` contains Codex collab fields such as:

- `_phase`: `'started' | 'completed'`
- `receiver_thread_ids: string[]`
- `agents_states: Record<threadId, { status?: string; message?: string | null }>`
- `prompt`
- `sender_thread_id`
- `status`

The server is responsible for converting that provider-specific payload into the
shared UI model. The client should not parse raw Codex collab payloads.

## Server -> client websocket messages

### 1. `subagent_start`

Sent when a sub-agent first becomes visible to the conversation.

Shape:

```ts
{
  type: 'subagent_start',
  conversationId: string,
  subAgent: {
    id: string,
    description: string,
    status: 'pending' | 'running' | 'completed' | 'error',
    toolUses: number,
    tokens: number,
    currentAction?: string,
    startedAt: Date,
    completedAt?: Date,
    providerThreadId?: string,
    rawStatus?: string,
    statusSource?: 'native' | 'inferred_parent_completion' | 'recovered_from_disk',
  }
}
```

UI guidance:

- render the row immediately
- treat `pending` and `running` as active
- show `currentAction` if present

### 2. `subagent_update`

Sent whenever server-side state changes for an existing sub-agent.

Shape:

```ts
{
  type: 'subagent_update',
  conversationId: string,
  subAgentId: string,
  toolUses?: number,
  tokens?: number,
  currentAction?: string,
  status?: 'pending' | 'running' | 'completed' | 'error',
  rawStatus?: string,
  statusSource?: 'native' | 'inferred_parent_completion' | 'recovered_from_disk',
}
```

UI guidance:

- patch the existing row in place
- use `status` for display logic
- treat `rawStatus` as debug/secondary text only
- prefer `currentAction` as the human-readable “what is happening now” line

### 3. `subagent_complete`

Sent when a sub-agent reaches a terminal state.

Shape:

```ts
{
  type: 'subagent_complete',
  conversationId: string,
  subAgentId: string,
  status: 'completed' | 'error',
  completedAt: Date,
}
```

UI guidance:

- mark the row terminal
- stop any spinner
- preserve a meaningful existing `currentAction` when possible
- if no useful action text is present, fall back to:
  - `Done` for `completed`
  - `Error` for `error`

## Codex-specific normalization rules

The server currently folds Codex child runtime statuses into the shared model:

- `pending_init` -> `pending`
- `in_progress` / `running` -> `running`
- `completed` -> `completed`
- anything error/fail/cancel-like -> `error`

The server also derives a UI-facing `currentAction`:

- child `message` wins when present
- otherwise:
  - `pending_init` -> `Pending initialization`
  - `wait` + running -> `Waiting`
  - `send_input` + running -> `Sending follow-up`
  - generic error-ish state -> `Error`

## Native sub-agents vs child sessions

Codex can surface the same worker through two channels:

1. native sub-agent lifecycle in `conversation.subAgents`
2. spawned child conversations linked by `parentConversationId`

The client should not display both as separate rows when they refer to the same
underlying worker. `client/src/utils/subAgents.ts` dedupes child conversations
against native entries using `providerThreadId` / child conversation id.

Guidance:

- native server-tracked sub-agent row is the primary row
- child session data may enrich the row
- do not render a duplicate “Conversation:” row for the same worker

## What the UI should rely on

Safe to rely on:

- `status`
- `currentAction`
- `completedAt`
- `toolUses`
- `tokens`
- `providerThreadId`
- `statusSource`

Do not rely on:

- provider-specific raw collab payloads
- exact Codex `rawStatus` strings for logic
- tool names like `spawn_agent` / `wait` / `send_input` in the UI layer

## Current implementation direction

The desired long-term pattern is:

- harness-native output -> shared runtime events
- server runtime events -> shared sub-agent websocket messages
- UI consumes shared websocket messages only

If new provider-native sub-agent systems are added, they should map into this
same websocket contract rather than teaching the client a new provider-specific
format.
