import { z } from 'zod';
import { BuddyKnowledgeScopeSchema } from './buddy-knowledge-scope.js';
import { BuddyBackgroundExecutionSchema, BuddyWorkProjectSchema } from './buddy-work.js';
import { ConversationConfigSchema } from './conversation-config.js';

/** Public resource projection; the underlying store retains its own revision counters. */
export const BUDDY_RESOURCE_CONTRACT_VERSION = '2026-09-21.1';
export { BuddyKnowledgeScopeSchema } from './buddy-knowledge-scope.js';
export const BuddyMemoryAudienceSchema = z.object({
  label: z.string(),
  scope: BuddyKnowledgeScopeSchema.nullable(),
});
export type BuddyMemoryAudience = z.infer<typeof BuddyMemoryAudienceSchema>;
export type BuddyKnowledgeScope = z.infer<typeof BuddyKnowledgeScopeSchema>;
export const BuddyDocumentRefSchema = z.union([
  z
    .object({
      kind: z.enum(['soul', 'working', 'long_term']),
      name: z.string().trim().min(1).max(200).optional(),
      targetBuddyId: z.string().min(1),
      scope: BuddyKnowledgeScopeSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.enum(['shared', 'note']),
      targetBuddyId: z.string().min(1),
      scope: BuddyKnowledgeScopeSchema,
      name: z.string().trim().min(1).max(200),
    })
    .strict(),
]);
export const GetBuddyDocumentSchema = z.object({ ref: BuddyDocumentRefSchema }).strict();
export const UpdateBuddyDocumentSchema = z
  .object({
    ref: BuddyDocumentRefSchema,
    key: z.string().trim().min(1).max(200),
    revision: z.string().min(1).max(300),
    content: z.string().max(32000),
    reason: z.string().trim().min(1).max(4000),
    preview: z.boolean(),
  })
  .strict();
export type BuddyDocumentRef = z.infer<typeof BuddyDocumentRefSchema>;

const projectId = z.string().min(1).nullable().optional();
export const SendBuddyResourceSchema = z
  .object({
    preview: z.boolean().optional(),
    key: z.string().trim().min(1).max(200),
    to: z.string().trim().min(1),
    purpose: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(32000),
    evidence: z.array(z.string().trim().min(1).max(4000)).max(32).default([]),
    workspaceId: z.string().min(1).optional(),
    notBefore: z.string().datetime().optional(),
    delivery: z.discriminatedUnion('kind', [
      z
        .object({ kind: z.literal('inform'), projectId, inReplyTo: z.string().min(1).optional() })
        .strict(),
      z
        .object({
          kind: z.literal('request'),
          config: ConversationConfigSchema.strict().optional(),
          projectId,
          continueFrom: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('work'),
          config: ConversationConfigSchema.strict().optional(),
          continueFrom: z.string().min(1).optional(),
          projectId: z.string().min(1),
          maxRuns: BuddyBackgroundExecutionSchema.shape.maxRuns,
          maxDurationSeconds: BuddyBackgroundExecutionSchema.shape.maxDurationSeconds,
        })
        .strict(),
    ]),
  })
  .strict();

export function buddySendOperation(input: unknown) {
  const { delivery, ...message } = SendBuddyResourceSchema.parse(input);
  const { kind, ...settings } = delivery;
  if (delivery.kind === 'work')
    return {
      ...message,
      projectId: delivery.projectId,
      config: delivery.config,
      continueFrom: delivery.continueFrom,
      expectsReply: true,
      execution: {
        mode: 'until_done' as const,
        maxRuns: delivery.maxRuns,
        maxDurationSeconds: delivery.maxDurationSeconds,
      },
    };
  return {
    ...message,
    ...(kind === 'inform' ? { projectId: null } : {}),
    ...settings,
    expectsReply: kind === 'request',
  };
}

export const BuddyResourceSchemas = {
  get_document: GetBuddyDocumentSchema,
  update_document: UpdateBuddyDocumentSchema,
};

export const GetBuddyWorkResourceSchema = z
  .object({
    targetBuddyId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    includeClosed: z.boolean().default(false),
    view: z.enum(['full', 'summary']).default('full'),
    order: z.enum(['priority', 'recent']).default('priority'),
    statuses: z.array(BuddyWorkProjectSchema.shape.status).min(1).max(7).optional(),
    updatedSince: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(99).default(20),
    cursor: z
      .string()
      .max(100)
      .regex(/^work:(?:[a-f0-9]{32}:)?[0-9]+$/)
      .optional(),
  })
  .strict();
export function workPageInput(input: unknown) {
  const { cursor, limit, view: _view, ...scope } = GetBuddyWorkResourceSchema.parse(input);
  const parts = cursor?.split(':');
  const offset = parts ? Number(parts.at(-1)) : 0;
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid work cursor');
  return {
    ...scope,
    limit: limit + 1,
    offset,
    snapshot: parts?.length === 3 ? parts[1] : undefined,
  };
}
export function workPage(items: unknown[], input: unknown, snapshot?: string) {
  const p = GetBuddyWorkResourceSchema.parse(input);
  const { offset } = workPageInput(input);
  return {
    view: p.view,
    items: items
      .slice(0, p.limit)
      .map((item) => (p.view === 'summary' ? summarizeBuddyWorkProject(item) : item)),
    nextCursor:
      items.length > p.limit ? `work:${snapshot ? `${snapshot}:` : ''}${offset + p.limit}` : null,
    ...(p.view === 'summary'
      ? { expansion: 'get_current_work({projectId,includeClosed:true,view:"full"})' }
      : {}),
  };
}

/** Discovery only. Criteria/evidence remain in the canonical full project. */
export function summarizeBuddyWorkProject(value: unknown) {
  const p = BuddyWorkProjectSchema.parse(value);
  const truncatedFields: string[] = [];
  const preview = (field: string, text: string | null | undefined) => {
    if (text && text.length > 240) truncatedFields.push(field);
    return text?.slice(0, 240) ?? null;
  };
  const todoCounts = { open: 0, in_progress: 0, blocked: 0, done: 0, cancelled: 0 };
  for (const todo of p.todos) todoCounts[todo.status]++;
  return {
    id: p.id,
    workspace_id: p.workspace_id,
    buddy_id: p.buddy_id,
    title: preview('title', p.title),
    revision: p.revision,
    status: p.status,
    priority: p.priority,
    execution_state: p.execution_state,
    updated_at: p.updated_at,
    next_action: preview('next_action', p.next_action),
    blocked_reason: preview('blocked_reason', p.blocked_reason),
    todoCounts,
    evidenceCount: p.completion_evidence.length,
    todoEvidenceCount: p.todos.reduce((count, todo) => count + todo.completion_evidence.length, 0),
    truncatedFields,
  };
}

export const GetBuddyInboxResourceSchema = z
  .object({
    filter: z.enum(['all', 'outstanding']).default('all'),
    order: z.enum(['attention', 'recent']).default('attention'),
    updatedSince: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z
      .string()
      .regex(/^inbox:[0-9]+$/)
      .optional(),
  })
  .strict();

export function inboxPageInput(input: unknown) {
  const { cursor, limit, ...filters } = GetBuddyInboxResourceSchema.parse(input);
  const offset = cursor ? Number(cursor.slice(6)) : 0;
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid inbox cursor');
  return { ...filters, limit: limit + 1, offset };
}
