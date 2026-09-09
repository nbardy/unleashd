import { z } from 'zod';
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

export const BuddyBuilderResultSchema = z.object({
  conversationId: z.string().min(1),
  buddy: BuddySummarySchema,
  homeWorkspace: BuddyWorkspaceSummarySchema,
  workspaces: z.array(BuddyWorkspaceSummarySchema),
  followUpQuestions: z.array(z.string().min(1)).default([]),
});
export type BuddyBuilderResult = z.infer<typeof BuddyBuilderResultSchema>;

/** Successful Builder mutations, carried by the tool result into the transcript. */
export const BuddyBuilderEventSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('created'), result: BuddyBuilderResultSchema }),
  z.object({
    action: z.literal('updated'),
    result: BuddyBuilderResultSchema,
    revision: z.number().int().nonnegative(),
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
