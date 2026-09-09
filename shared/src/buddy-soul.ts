import { z } from 'zod';

export const BUDDY_SOUL_MAX_CHARACTERS = 10_000;

export const BuddySoulSchema = z.object({
  body: z.string(),
  revision: z.number().int().nonnegative(),
});

export const BuddySoulUpdateSchema = z
  .object({
    content: z.string().trim().min(1).max(BUDDY_SOUL_MAX_CHARACTERS),
    reasoning: z.string().trim().min(1).max(2_000),
    baseVersion: z.number().int().nonnegative(),
  })
  .strict();

export const BuddySoulConflictDetailsSchema = z.object({
  document_kind: z.literal('soul'),
  current_version: z.number().int().nonnegative(),
  supplied_base: z.number().int().nonnegative(),
  current_content: z.string(),
});

export const BuddySoulConflictSchema = z.object({
  code: z.literal('MEMORY_STALE'),
  details: BuddySoulConflictDetailsSchema,
});

export type BuddySoul = z.infer<typeof BuddySoulSchema>;
export type BuddySoulUpdate = z.infer<typeof BuddySoulUpdateSchema>;
