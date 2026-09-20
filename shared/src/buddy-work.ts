import { z } from 'zod';
import { BuddyRunSchema } from './buddy-coordination.js';
import { BuddyMessageSchema } from './buddy-message.js';

export const BuddyWorkEvidenceSchema = z.array(z.string().trim().min(1).max(4000)).max(32);
export const BuddyTaskCommentInputSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(32000),
    evidence: BuddyWorkEvidenceSchema.default([]),
  })
  .strict();
export const BuddyTaskCommentsQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(1000).optional(),
  })
  .strict();
export const BuddyTaskCommentSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  author: z.string(),
  body: z.string(),
  evidence: BuddyWorkEvidenceSchema,
  created_at: z.string(),
});
export const BuddyTaskCommentsPageSchema = z.object({
  items: z.array(BuddyTaskCommentSchema),
  nextCursor: z.string().nullable(),
});
export type BuddyTaskComment = z.infer<typeof BuddyTaskCommentSchema>;
export type BuddyTaskCommentsPage = z.infer<typeof BuddyTaskCommentsPageSchema>;
export const BuddyBackgroundExecutionSchema = z
  .object({
    mode: z.literal('until_done'),
    maxRuns: z.number().int().min(1).max(100).default(20),
    maxDurationSeconds: z.number().int().min(1).max(86400).default(3600),
  })
  .strict();
export const BuddyProjectRunInputSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    maxRuns: BuddyBackgroundExecutionSchema.shape.maxRuns,
    maxDurationSeconds: BuddyBackgroundExecutionSchema.shape.maxDurationSeconds,
    parentConversationId: z.string().min(1).optional(),
  })
  .strict();
export const BuddyTodoOperationSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('add'),
      title: z.string().min(1),
      status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
      definitionOfDone: z.string().min(1).optional(),
      nextAction: z.string().min(1).optional(),
      blockedReason: z.string().min(1).optional(),
      evidence: BuddyWorkEvidenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal('update'),
      todoId: z.string().min(1),
      title: z.string().min(1).optional(),
      status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
      position: z.number().int().nonnegative().optional(),
      definitionOfDone: z.string().min(1).nullable().optional(),
      nextAction: z.string().min(1).nullable().optional(),
      blockedReason: z.string().min(1).nullable().optional(),
      evidence: BuddyWorkEvidenceSchema.optional(),
    })
    .strict(),
]);

// Older project rows expose their JSON column verbatim; the owner wire view is an array.
const storedEvidence = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, z.array(z.string()).default([]));
export const BuddyWorkTodoSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']),
    definition_of_done: z.string().nullish(),
    next_action: z.string().nullish(),
    blocked_reason: z.string().nullish(),
    completion_evidence: storedEvidence,
  })
  .passthrough();
// Product "Task" maps to this existing owned project, not a second work ledger.
// Outcome and evidence outlive runs: ../../product/buddies/CORE_DESIGN.md#data-model-and-authority
export const BuddyWorkProjectSchema = z
  .object({
    id: z.string(),
    workspace_id: z.string(),
    buddy_id: z.string(),
    title: z.string(),
    objective: z.string().nullish(),
    definition_of_done: z.string(),
    status: z.enum(['backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled']),
    priority: z.number(),
    revision: z.number().int(),
    next_action: z.string().nullish(),
    blocked_reason: z.string().nullish(),
    updated_at: z.string(),
    execution_state: z.enum(['enabled', 'paused', 'cancelled', 'draining']),
    completion_evidence: storedEvidence,
    todos: z.array(BuddyWorkTodoSchema),
  })
  .passthrough();
export const BuddyProjectExecutionViewSchema = z.object({
  project: BuddyWorkProjectSchema,
  message: BuddyMessageSchema.nullable(),
  runs: z.array(BuddyRunSchema),
});
export type BuddyProjectExecutionView = z.infer<typeof BuddyProjectExecutionViewSchema>;
