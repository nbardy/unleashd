import { z } from 'zod';

export const BUDDY_TEAM_CONTRACT_VERSION = '2026-09-12.2';
export const BuddyTeamCapabilitySchema = z.enum([
  'staff.create',
  'relationship.write',
  'profile.read',
  'profile.write',
  'soul.read',
  'soul.write',
  'memory.read',
  'memory.write',
  'schedule.manage',
  'execution.manage',
]);
export type BuddyTeamCapability = z.infer<typeof BuddyTeamCapabilitySchema>;
export const BuddyAccessGrantSchema = z.object({
  grantee_id: z.string(),
  workspace_id: z.string(),
  target_id: z.string(),
  capabilities: z.array(BuddyTeamCapabilitySchema),
  revision: z.number().int(),
  expires_at: z.string().nullable(),
  reason: z.string(),
  updated_at: z.string(),
  created_buddy_incoming: z.boolean().default(false),
});
export type BuddyAccessGrant = z.infer<typeof BuddyAccessGrantSchema>;
export const BuddyTeamAccessViewSchema = z.object({
  targets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      managerId: z.string().nullable(),
      backgroundEnabled: z.boolean(),
      permissionsEditable: z.boolean().default(true),
    })
  ),
  grants: z.array(BuddyAccessGrantSchema),
});
export type BuddyTeamAccessView = z.infer<typeof BuddyTeamAccessViewSchema>;
export const BuddyCapabilityDecisionSchema = z.object({
  allowed: z.boolean(),
  code: z.string(),
  reason: z.string(),
  remedy: z.string().nullable(),
  grantRevision: z.number().optional(),
  expiresAt: z.string().nullable().optional(),
});
export type BuddyCapabilityDecision = z.infer<typeof BuddyCapabilityDecisionSchema>;
export const BuddyDeliverySchema = z.object({
  mailboxOnly: z.boolean().optional(),
  runId: z.string(),
  kind: z.string(),
  attempt: z.number(),
  state: z.string(),
  acknowledgedAt: z.string().nullable(),
  createdAt: z.string(),
  endedAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  error: z.string().nullable(),
  retryOfRunId: z.string().nullable(),
});
export const BuddyMessageExecutionSchema = z.object({
  background: z
    .object({
      mode: z.literal('until_done'),
      disposition: z.string(),
      maxRuns: z.number().int(),
      maxDurationSeconds: z.number().int(),
      runsUsed: z.number().int(),
      startedAt: z.string().nullable(),
      deadline: z.string().nullable(),
      waitingMessageIds: z.array(z.string()),
    })
    .nullish(),
  messageId: z.string(),
  runId: z.string().nullable(),
  projectId: z.string().nullable(),
  state: z.string(),
  code: z.string().nullable(),
  reason: z.string().nullable(),
  remedy: z.string().nullable(),
  conversationId: z.string().nullish(),
  acknowledgedRunId: z.string().nullable().optional(),
  projectSnapshot: z
    .object({
      id: z.string(),
      revision: z.number(),
      status: z.string(),
      updatedAt: z.string(),
      acceptedBy: z.string().nullable(),
      acceptedAt: z.string().nullable(),
      evidenceCount: z.number(),
    })
    .nullable()
    .optional(),
  delivery: z.array(BuddyDeliverySchema).optional(),
  acknowledgedAt: z.string().nullable(),
  acceptedBy: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  completionEvidence: z.array(z.string()),
  outcome: z.string().nullish(),
  error: z.string().nullable(),
});
export type BuddyMessageExecution = z.infer<typeof BuddyMessageExecutionSchema>;
/**
 * Where a grant party stands in the workspace. `archived` wins over membership:
 * archiving keeps the membership row. `detached` is a live identity whose
 * membership was removed. Grants survive both, and neither party can be reached
 * from per-Buddy settings (BuddyCoordination renders current memberships only),
 * which is why the inactive-access inventory exists.
 */
export const BuddyAccessStandingSchema = z.enum(['member', 'archived', 'detached']);
export type BuddyAccessStanding = z.infer<typeof BuddyAccessStandingSchema>;
// Parties say `standing`, never `status`: the route guard's visibleBuddyPayload
// drops any record carrying status 'archived', which is every row this read shows.
export const BuddyAccessPartySchema = z.object({
  id: z.string(),
  name: z.string(),
  standing: BuddyAccessStandingSchema,
});
export type BuddyAccessParty = z.infer<typeof BuddyAccessPartySchema>;
export const BuddyInactiveAccessSchema = z.object({
  entries: z.array(
    z.object({
      grant: BuddyAccessGrantSchema,
      grantee: BuddyAccessPartySchema,
      // A staffing grant targets the workspace itself (target_id === workspace_id).
      target: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('workspace') }),
        BuddyAccessPartySchema.extend({ kind: z.literal('buddy') }),
      ]),
    })
  ),
  omitted: z.number().int(),
});
export type BuddyInactiveAccess = z.infer<typeof BuddyInactiveAccessSchema>;
