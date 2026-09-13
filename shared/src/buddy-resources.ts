import { z } from 'zod';
import { BuddyBackgroundExecutionSchema } from './buddy-work.js';

/** Public resource projection; the underlying store retains its own revision counters. */
export const BUDDY_RESOURCE_CONTRACT_VERSION = '2026-09-13.1';
export const BuddyKnowledgeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner_thread'), conversationId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1) }).strict(),
]);
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
          projectId,
          continueFrom: z.string().min(1).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('work'),
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
    limit: z.number().int().min(1).max(99).default(20),
    cursor: z
      .string()
      .regex(/^work:[0-9]+$/)
      .optional(),
  })
  .strict();
export function workPageInput(input: unknown) {
  const { cursor, limit, ...scope } = GetBuddyWorkResourceSchema.parse(input);
  const offset = cursor ? Number(cursor.slice(5)) : 0;
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid work cursor');
  return { ...scope, limit: limit + 1, offset };
}
export function workPage(items: unknown[], input: unknown) {
  const p = GetBuddyWorkResourceSchema.parse(input);
  const offset = p.cursor ? Number(p.cursor.slice(5)) : 0;
  return {
    items: items.slice(0, p.limit),
    nextCursor: items.length > p.limit ? `work:${offset + p.limit}` : null,
  };
}

export const GetBuddyInboxResourceSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z
      .string()
      .regex(/^inbox:[0-9]+$/)
      .optional(),
  })
  .strict();

export function inboxPageInput(input: unknown) {
  const { cursor, limit } = GetBuddyInboxResourceSchema.parse(input);
  const offset = cursor ? Number(cursor.slice(6)) : 0;
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid inbox cursor');
  return { limit: limit + 1, offset };
}
