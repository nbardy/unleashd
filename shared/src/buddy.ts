import { z } from 'zod';
import { BuddyTeamStateSchema } from './buddy-team.js';
import { ProviderSchema } from './provider-catalog.js';

export const BuddySummarySchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  status: z.string().min(1),
  provider: ProviderSchema.nullable(),
  model: z.string().min(1).nullable(),
  reasoning_effort: z.string().min(1).nullable(),
});
export type BuddySummary = z.infer<typeof BuddySummarySchema>;

export const BuddyWorkspaceSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  root_path: z.string().min(1),
  assignment_role: z.string().nullish(),
});
export type BuddyWorkspaceSummary = z.infer<typeof BuddyWorkspaceSummarySchema>;

/** Saved work projection; the project store remains the authority for its current state. */
export const BuddyBuilderProjectSchema = z.object({
  id: z.string().min(1),
  buddy_id: z.string().min(1),
  workspace_id: z.string().min(1),
  parent_project_id: z.string().min(1).nullish(),
  title: z.string().min(1),
  objective: z.string().nullable(),
  definition_of_done: z.string().min(1),
  status: z.string().min(1),
  blocked_reason: z.string().nullable(),
  next_action: z.string().nullable(),
});
export type BuddyBuilderProject = z.infer<typeof BuddyBuilderProjectSchema>;

export const BuddyBuilderResultSchema = z.object({
  conversationId: z.string().min(1),
  creationKey: z.string().min(1).default('default'),
  buddy: BuddySummarySchema,
  homeWorkspace: BuddyWorkspaceSummarySchema,
  workspaces: z.array(BuddyWorkspaceSummarySchema),
  followUpQuestions: z.array(z.string().min(1)).default([]),
  teamState: BuddyTeamStateSchema.optional(),
  projects: z.array(BuddyBuilderProjectSchema).optional(),
  relationships: z
    .array(
      z.object({
        id: z.string(),
        from_buddy_id: z.string(),
        to_buddy_id: z.string(),
        kind: z.string(),
      })
    )
    .optional(),
  backgroundEnabled: z.boolean().optional(),
});
export type BuddyBuilderResult = z.infer<typeof BuddyBuilderResultSchema>;

export const BuddyBuilderResultsSchema = z.object({
  conversationId: z.string().min(1),
  results: z.array(BuddyBuilderResultSchema),
});
export type BuddyBuilderResults = z.infer<typeof BuddyBuilderResultsSchema>;

/** Successful Builder mutations, carried by the tool result into the transcript. */
export const BuddyBuilderEventSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('created'), result: BuddyBuilderResultSchema }),
  z.object({
    action: z.literal('updated'),
    result: BuddyBuilderResultSchema,
    revision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('work_created'),
    result: BuddyBuilderResultSchema,
    project: BuddyBuilderProjectSchema,
  }),
]);
export type BuddyBuilderEvent = z.infer<typeof BuddyBuilderEventSchema>;

/** Unwrap provider/MCP result envelopes; failed tools never become success cards. */
export function parseBuddyBuilderToolResult(value: unknown, depth = 0): BuddyBuilderEvent | null {
  if (depth > 6) return null;
  if (typeof value === 'string') {
    try {
      return parseBuddyBuilderToolResult(JSON.parse(value), depth + 1);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const block of value) {
      const event = parseBuddyBuilderToolResult(block, depth + 1);
      if (event) return event;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.isError || record.is_error || record.error) return null;
  const event = BuddyBuilderEventSchema.safeParse(record.buddyBuilderEvent);
  if (event.success) return event.data;
  if ('buddyBuilderEvent' in record) return null;
  // Creation results from older Builder transcripts already contain this projection.
  const legacy = BuddyBuilderResultSchema.safeParse(record);
  if (legacy.success) return { action: 'created', result: legacy.data };
  for (const key of ['structuredContent', 'content', 'text', 'result']) {
    const nested = parseBuddyBuilderToolResult(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function formatBuddyBuilderToolResult(output: unknown): string | null {
  const event = parseBuddyBuilderToolResult(output);
  return event ? `<!--buddy_builder_result:${encodeURIComponent(JSON.stringify(event))}-->` : null;
}

/** Canonical dense documents; legacy file projections are not a second memory model. */
export const BuddyMemorySnapshotSchema = z.object({
  working: z.string(),
  longTerm: z.string(),
  workingRevision: z.number().int().nonnegative(),
  longTermRevision: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
});
export type BuddyMemorySnapshot = z.infer<typeof BuddyMemorySnapshotSchema>;

export const BuddyAutomationRunStatusSchema = z.enum([
  'claimed',
  'running',
  'cancel_requested',
  'complete',
  'failed',
  'cancelled',
]);

export const BuddyAutomationPolicySchema = z.object({
  max_runtime_seconds: z.number().int().positive(),
  max_iterations: z.number().int().positive(),
  max_tokens: z.number().int().positive(),
  max_cost_usd: z.number().nonnegative(),
  allowed_operations: z.array(z.string().min(1)),
});

/**
 * Public run projection. Executor claim fields intentionally do not exist on
 * this schema: both HTTP and MCP must construct this representation instead of
 * serializing a durable store row. See invariant I3 and the alternatives in
 * agent_notes/2026-08-24_automation-execution-ownership-design.md.
 */
export const BuddyAutomationRunSchema = z.object({
  id: z.string().min(1),
  automation_id: z.string().min(1),
  scheduled_for: z.string().min(1),
  idempotency_key: z.string().min(1),
  status: BuddyAutomationRunStatusSchema,
  conversation_id: z.string().min(1).nullable(),
  iteration: z.number().int().nonnegative(),
  tokens_used: z.number().int().nonnegative(),
  cost_usd: z.number().nonnegative(),
  policy: BuddyAutomationPolicySchema,
  outcome: z.string().nullable(),
  error: z.string().nullable(),
  claimed_at: z.string().min(1),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  claim_expires_at: z.string().nullable(),
});
export type BuddyAutomationRun = z.infer<typeof BuddyAutomationRunSchema>;
