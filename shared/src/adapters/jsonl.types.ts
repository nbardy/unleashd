/**
 * JSONL Adapter Types
 *
 * Zod schemas and TypeScript types for parsing Claude Code's JSONL session files.
 * These files are stored at ~/.claude/projects/{encoded-path}/*.jsonl
 *
 * Claude Code writes entries in real-time as conversations progress.
 * Each line is a complete JSON object with a `type` field for discrimination.
 */

import { z } from 'zod';

// =============================================================================
// Content Block Schemas (inside message.content)
// =============================================================================

/**
 * Text content block - plain text response
 */
export const JsonlTextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export type JsonlTextBlock = z.infer<typeof JsonlTextBlockSchema>;

/**
 * Thinking content block - Claude's extended thinking (internal reasoning)
 * Contains signature for verification
 */
export const JsonlThinkingBlockSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  signature: z.string().optional(),
});

export type JsonlThinkingBlock = z.infer<typeof JsonlThinkingBlockSchema>;

/**
 * Tool use content block - Claude requesting a tool execution
 */
export const JsonlToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
});

export type JsonlToolUseBlock = z.infer<typeof JsonlToolUseBlockSchema>;

/**
 * Tool result content block - result returned from tool execution
 * Found in user message content arrays
 */
export const JsonlToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.string(),
  is_error: z.boolean().optional(),
});

export type JsonlToolResultBlock = z.infer<typeof JsonlToolResultBlockSchema>;

/**
 * Union of all content block types
 */
export const JsonlContentBlockSchema = z.discriminatedUnion('type', [
  JsonlTextBlockSchema,
  JsonlThinkingBlockSchema,
  JsonlToolUseBlockSchema,
  JsonlToolResultBlockSchema,
]);

export type JsonlContentBlock = z.infer<typeof JsonlContentBlockSchema>;

// =============================================================================
// Message Schemas (inside entry.message)
// =============================================================================

/**
 * User message - can be plain text or array with tool results
 */
export const JsonlUserMessageSchema = z.object({
  role: z.literal('user'),
  content: z.union([
    z.string(),
    z.array(z.union([JsonlToolResultBlockSchema, z.object({ type: z.string() }).passthrough()])),
  ]),
});

export type JsonlUserMessage = z.infer<typeof JsonlUserMessageSchema>;

/**
 * Assistant message - array of content blocks with model metadata
 */
export const JsonlAssistantMessageSchema = z.object({
  model: z.string().optional(),
  id: z.string().optional(),
  type: z.literal('message').optional(),
  role: z.literal('assistant'),
  content: z.array(JsonlContentBlockSchema.or(z.object({ type: z.string() }).passthrough())),
  stop_reason: z.string().nullable().optional(),
  stop_sequence: z.string().nullable().optional(),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

export type JsonlAssistantMessage = z.infer<typeof JsonlAssistantMessageSchema>;

// =============================================================================
// Entry Schemas (top-level JSONL lines)
// =============================================================================

/**
 * Common fields present on most entry types
 */
const JsonlBaseEntrySchema = z.object({
  uuid: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  sessionId: z.string(),
  timestamp: z.string(),
  cwd: z.string().nullable().optional(),
  version: z.string().optional(),
  gitBranch: z.string().optional(),
  slug: z.string().optional(),
  isSidechain: z.boolean().optional(),
  userType: z.string().optional(),
});

/**
 * User entry - user message or tool result
 */
export const JsonlUserEntrySchema = JsonlBaseEntrySchema.extend({
  type: z.literal('user'),
  message: JsonlUserMessageSchema,
  permissionMode: z.string().optional(),
  toolUseResult: z.record(z.unknown()).optional(),
  sourceToolAssistantUUID: z.string().optional(),
});

export type JsonlUserEntry = z.infer<typeof JsonlUserEntrySchema>;

/**
 * Assistant entry - Claude's response
 */
export const JsonlAssistantEntrySchema = JsonlBaseEntrySchema.extend({
  type: z.literal('assistant'),
  message: JsonlAssistantMessageSchema,
  requestId: z.string().optional(),
});

export type JsonlAssistantEntry = z.infer<typeof JsonlAssistantEntrySchema>;

/**
 * Progress entry - tool execution progress events
 */
export const JsonlProgressEntrySchema = z.object({
  type: z.literal('progress'),
  parentUuid: z.string().optional(),
  sessionId: z.string().optional(),
  timestamp: z.string().optional(),
  uuid: z.string().optional(),
  data: z
    .object({
      type: z.string(),
    })
    .passthrough()
    .optional(),
  parentToolUseID: z.string().optional(),
  toolUseID: z.string().optional(),
});

export type JsonlProgressEntry = z.infer<typeof JsonlProgressEntrySchema>;

/**
 * System entry - hooks, retries, system events
 */
export const JsonlSystemEntrySchema = z.object({
  type: z.literal('system'),
  subtype: z.string().optional(),
  parentUuid: z.string().nullable().optional(),
  sessionId: z.string().optional(),
  timestamp: z.string().optional(),
  uuid: z.string().optional(),
  hookCount: z.number().optional(),
  hookInfos: z.array(z.record(z.unknown())).optional(),
  hookErrors: z.array(z.unknown()).optional(),
  preventedContinuation: z.boolean().optional(),
  stopReason: z.string().optional(),
  hasOutput: z.boolean().optional(),
  level: z.string().optional(),
  toolUseID: z.string().optional(),
});

export type JsonlSystemEntry = z.infer<typeof JsonlSystemEntrySchema>;

/**
 * File history snapshot - for undo/recovery system
 */
export const JsonlFileHistorySnapshotEntrySchema = z.object({
  type: z.literal('file-history-snapshot'),
  messageId: z.string(),
  snapshot: z.object({
    messageId: z.string(),
    trackedFileBackups: z.record(
      z.object({
        backupFileName: z.string().nullable(),
        version: z.number(),
        backupTime: z.string(),
      })
    ),
    timestamp: z.string(),
  }),
  isSnapshotUpdate: z.boolean(),
});

export type JsonlFileHistorySnapshotEntry = z.infer<typeof JsonlFileHistorySnapshotEntrySchema>;

/**
 * Queue operation entry - internal queue management
 */
export const JsonlQueueOperationEntrySchema = z.object({
  type: z.literal('queue-operation'),
  operation: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
});

export type JsonlQueueOperationEntry = z.infer<typeof JsonlQueueOperationEntrySchema>;

/**
 * Union of all entry types - for parsing any JSONL line
 * Note: Using loose parsing to handle unknown entry types gracefully
 */
export const JsonlEntrySchema = z.union([
  JsonlUserEntrySchema,
  JsonlAssistantEntrySchema,
  JsonlProgressEntrySchema,
  JsonlSystemEntrySchema,
  JsonlFileHistorySnapshotEntrySchema,
  JsonlQueueOperationEntrySchema,
  // Fallback for unknown types
  z
    .object({ type: z.string() })
    .passthrough(),
]);

export type JsonlEntry = z.infer<typeof JsonlEntrySchema>;

// =============================================================================
// Session Metadata
// =============================================================================

/**
 * Parsed session data extracted from a JSONL file
 */
export interface JsonlSession {
  /** Session ID (from filename, without .jsonl extension) */
  sessionId: string;
  /** Absolute path to the JSONL file */
  filePath: string;
  /** Working directory for this session */
  workingDirectory: string;
  /** Model used (from first assistant message) */
  model: string;
  /** When the session was created (first entry timestamp) */
  createdAt: Date;
  /** When the session was last modified (last entry timestamp) */
  modifiedAt: Date;
  /** All parsed entries (for message extraction) */
  entries: JsonlEntry[];
  /** Provider-generated label (Claude ai-title/custom-title). Null when unobserved. */
  title?: string | null;
}

// =============================================================================
// Type Guards
// =============================================================================

export function isJsonlUserEntry(entry: JsonlEntry): entry is JsonlUserEntry {
  return entry.type === 'user';
}

export function isJsonlAssistantEntry(entry: JsonlEntry): entry is JsonlAssistantEntry {
  return entry.type === 'assistant';
}

export function isJsonlTextBlock(block: unknown): block is JsonlTextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block as { type: string }).type === 'text'
  );
}

export function isJsonlThinkingBlock(block: unknown): block is JsonlThinkingBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block as { type: string }).type === 'thinking'
  );
}

export function isJsonlToolUseBlock(block: unknown): block is JsonlToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block as { type: string }).type === 'tool_use'
  );
}

export function isJsonlToolResultBlock(block: unknown): block is JsonlToolResultBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    (block as { type: string }).type === 'tool_result'
  );
}
