/**
 * Codex Native Session JSONL Types
 *
 * Type definitions for Codex CLI's native session files stored at:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{uuid}.jsonl
 *
 * Codex self-persists all sessions. We read these files to load conversation
 * history, extract messages, and get the session UUID for `codex exec resume`.
 *
 * Entry types (top-level `type` field):
 * - session_meta: Session metadata (id, cwd, model, cli_version)
 * - response_item: Messages, tool calls, tool results, reasoning
 * - event_msg: User messages, agent messages, reasoning, token counts
 * - turn_context: Per-turn config (cwd, sandbox policy, model, effort)
 *
 * The session UUID (used for `codex exec resume <id>`) is in:
 *   session_meta.payload.id
 */

import { z } from 'zod';

// =============================================================================
// Session Meta — first entry in every session file
// =============================================================================

export const CodexSessionMetaSchema = z.object({
  timestamp: z.string(),
  type: z.literal('session_meta'),
  payload: z
    .object({
      id: z.string(),
      timestamp: z.string(),
      cwd: z.string(),
      originator: z.string(),
      cli_version: z.string(),
      source: z.union([
        z.string(),
        z
          .object({
            subagent: z
              .object({
                thread_spawn: z
                  .object({
                    parent_thread_id: z.string(),
                    depth: z.number().optional(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      ]),
      model_provider: z.string(),
      base_instructions: z
        .object({
          text: z.string(),
        })
        .optional(),
    })
    .passthrough(),
});

export type CodexSessionMeta = z.infer<typeof CodexSessionMetaSchema>;

// =============================================================================
// Response Items — messages, tool calls, tool results, reasoning
// =============================================================================

// User/developer/assistant messages
export const CodexResponseMessageSchema = z.object({
  timestamp: z.string(),
  type: z.literal('response_item'),
  payload: z
    .object({
      type: z.literal('message'),
      role: z.enum(['user', 'assistant', 'developer']),
      content: z.array(
        z
          .object({
            type: z.string(),
            text: z.string().optional(),
          })
          .passthrough()
      ),
    })
    .passthrough(),
});

export type CodexResponseMessage = z.infer<typeof CodexResponseMessageSchema>;

// Function calls (tool invocations)
export const CodexFunctionCallSchema = z.object({
  timestamp: z.string(),
  type: z.literal('response_item'),
  payload: z
    .object({
      type: z.literal('function_call'),
      name: z.string(),
      arguments: z.string(),
      call_id: z.string(),
    })
    .passthrough(),
});

export type CodexFunctionCall = z.infer<typeof CodexFunctionCallSchema>;

// Function call outputs (tool results)
export const CodexFunctionCallOutputSchema = z.object({
  timestamp: z.string(),
  type: z.literal('response_item'),
  payload: z
    .object({
      type: z.literal('function_call_output'),
      call_id: z.string(),
      output: z.string(),
    })
    .passthrough(),
});

export type CodexFunctionCallOutput = z.infer<typeof CodexFunctionCallOutputSchema>;

// Reasoning blocks
export const CodexReasoningSchema = z.object({
  timestamp: z.string(),
  type: z.literal('response_item'),
  payload: z
    .object({
      type: z.literal('reasoning'),
    })
    .passthrough(),
});

// Custom tool calls
export const CodexCustomToolCallSchema = z.object({
  timestamp: z.string(),
  type: z.literal('response_item'),
  payload: z
    .object({
      type: z.literal('custom_tool_call'),
    })
    .passthrough(),
});

// Custom tool call outputs
export const CodexCustomToolCallOutputSchema = z.object({
  timestamp: z.string(),
  type: z.literal('response_item'),
  payload: z
    .object({
      type: z.literal('custom_tool_call_output'),
    })
    .passthrough(),
});

// =============================================================================
// Event Messages — user prompts, agent responses, token counts
// =============================================================================

export const CodexUserMessageEventSchema = z.object({
  timestamp: z.string(),
  type: z.literal('event_msg'),
  payload: z
    .object({
      type: z.literal('user_message'),
      message: z.string(),
    })
    .passthrough(),
});

export type CodexUserMessageEvent = z.infer<typeof CodexUserMessageEventSchema>;

export const CodexAgentMessageEventSchema = z.object({
  timestamp: z.string(),
  type: z.literal('event_msg'),
  payload: z
    .object({
      type: z.literal('agent_message'),
      message: z.string(),
    })
    .passthrough(),
});

export type CodexAgentMessageEvent = z.infer<typeof CodexAgentMessageEventSchema>;

export const CodexAgentReasoningEventSchema = z.object({
  timestamp: z.string(),
  type: z.literal('event_msg'),
  payload: z
    .object({
      type: z.literal('agent_reasoning'),
    })
    .passthrough(),
});

export const CodexTokenCountEventSchema = z.object({
  timestamp: z.string(),
  type: z.literal('event_msg'),
  payload: z
    .object({
      type: z.literal('token_count'),
    })
    .passthrough(),
});

// =============================================================================
// Turn Context — per-turn config
// =============================================================================

export const CodexTurnContextSchema = z.object({
  timestamp: z.string(),
  type: z.literal('turn_context'),
  payload: z
    .object({
      cwd: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
    })
    .passthrough(),
});

export type CodexTurnContext = z.infer<typeof CodexTurnContextSchema>;

// =============================================================================
// Union — any entry in a Codex session JSONL
// =============================================================================

export const CodexSessionEntrySchema = z.union([
  CodexSessionMetaSchema,
  CodexResponseMessageSchema,
  CodexFunctionCallSchema,
  CodexFunctionCallOutputSchema,
  CodexReasoningSchema,
  CodexCustomToolCallSchema,
  CodexCustomToolCallOutputSchema,
  CodexUserMessageEventSchema,
  CodexAgentMessageEventSchema,
  CodexAgentReasoningEventSchema,
  CodexTokenCountEventSchema,
  CodexTurnContextSchema,
  // Fallback for unknown entry types — Codex may add new types in future versions
  z
    .object({ type: z.string(), timestamp: z.string() })
    .passthrough(),
]);

export type CodexSessionEntry = z.infer<typeof CodexSessionEntrySchema>;

// =============================================================================
// Parsed Session — extracted from a JSONL file
// =============================================================================

export interface CodexParsedSession {
  /** Session UUID from session_meta.payload.id — used for `codex exec resume <id>` */
  sessionId: string;
  /** Absolute path to the JSONL file */
  filePath: string;
  /** Working directory from session_meta.payload.cwd */
  workingDirectory: string;
  /** Model name from turn_context or session_meta */
  model: string;
  /** CLI version from session_meta */
  cliVersion: string;
  /** Timestamp of first entry */
  createdAt: Date;
  /** Timestamp of last entry */
  modifiedAt: Date;
  /** All parsed entries */
  entries: CodexSessionEntry[];
}

// =============================================================================
// Type Guards
// =============================================================================

export function isCodexSessionMeta(entry: CodexSessionEntry): entry is CodexSessionMeta {
  return entry.type === 'session_meta';
}

export function isCodexResponseMessage(entry: CodexSessionEntry): entry is CodexResponseMessage {
  return (
    entry.type === 'response_item' &&
    (entry as { payload?: { type?: string } }).payload?.type === 'message'
  );
}

export function isCodexFunctionCall(entry: CodexSessionEntry): entry is CodexFunctionCall {
  return (
    entry.type === 'response_item' &&
    (entry as { payload?: { type?: string } }).payload?.type === 'function_call'
  );
}

export function isCodexFunctionCallOutput(
  entry: CodexSessionEntry
): entry is CodexFunctionCallOutput {
  return (
    entry.type === 'response_item' &&
    (entry as { payload?: { type?: string } }).payload?.type === 'function_call_output'
  );
}

export function isCodexUserMessageEvent(entry: CodexSessionEntry): entry is CodexUserMessageEvent {
  return (
    entry.type === 'event_msg' &&
    (entry as { payload?: { type?: string } }).payload?.type === 'user_message'
  );
}

export function isCodexAgentMessageEvent(
  entry: CodexSessionEntry
): entry is CodexAgentMessageEvent {
  return (
    entry.type === 'event_msg' &&
    (entry as { payload?: { type?: string } }).payload?.type === 'agent_message'
  );
}
