import { z } from 'zod';

export const BuddyEmploymentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('top_level') }),
  z.object({ kind: z.literal('direct_report'), managerId: z.string() }),
]);

export const BuddyTeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  status: z.string(),
});

export const BuddyTeamStateSchema = z.object({
  employment: BuddyEmploymentSchema,
  manager: BuddyTeamMemberSchema.nullable(),
  team: z.array(BuddyTeamMemberSchema),
  /** Deprecated historical projection. New teams use relationships without hiring quotas. */
  hiring: z
    .object({
      quota: z.number().int().nonnegative(),
      held: z.number().int().nonnegative(),
      available: z.number().int().nonnegative(),
    })
    .optional(),
});
