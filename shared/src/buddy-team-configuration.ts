import { z } from 'zod';

export const BuddyConfigurationRefSchema = z.union([
  z.object({ id: z.string().min(1).max(200) }).strict(),
  z.object({ creationKey: z.string().min(1).max(200) }).strict(),
]);
export const TeamSetupBlockerSchema = z.object({
  code: z.string(),
  path: z.string(),
  reason: z.string(),
  resolvableBy: z.enum(['owner', 'lead', 'runtime']),
  remedy: z.string(),
});
const affectedWork = z.object({
  messageId: z.string(),
  runId: z.string().nullable(),
  recipientId: z.string(),
  state: z.string(),
  code: z.string().nullable(),
  projectId: z.string().nullable().optional(),
  acknowledgedAt: z.string().nullable().optional(),
  acceptedAt: z.string().nullable().optional(),
  completionEvidence: z.array(z.string()).optional(),
});
export const TeamReadinessSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(TeamSetupBlockerSchema),
  participants: z.array(
    z.object({
      buddyId: z.string(),
      name: z.string(),
      incoming: z.boolean(),
      dispatch: z.boolean(),
      readAllWork: z.boolean(),
      active: z.boolean(),
    })
  ),
  messages: z.array(
    affectedWork.extend({
      returnBuddyId: z.string().nullable(),
      returnIncoming: z.boolean().nullable(),
    })
  ),
});

const buddyEffect = z.object({
  name: z.string(),
  role: z.string(),
  status: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  soulHash: z.string().optional(),
});
const membershipEffect = z.object({
  present: z.boolean(),
  incoming: z.boolean(),
  dispatch: z.boolean(),
  readAllWork: z.boolean(),
  pausedReason: z.string().nullable(),
  maxActiveRuns: z.number().int(),
});
const relationshipEffect = z.object({
  fromBuddyId: z.string(),
  toBuddyId: z.string(),
  kind: z.enum(['manager', 'consults']),
  present: z.boolean(),
  affectedWorkspaceIds: z.array(z.string()),
});
const grantEffect = z.object({
  granteeId: z.string(),
  targetId: z.string(),
  capabilities: z.array(z.string()),
  revision: z.number().int().nonnegative(),
  expiresAt: z.string().nullable(),
  reason: z.string(),
  createdBuddyIncoming: z.boolean(),
  affectedWorkspaceIds: z.array(z.string()),
});
export const TeamConfigurationEffectSchema = z.discriminatedUnion('resource', [
  z.object({
    resource: z.literal('buddy'),
    id: z.string(),
    before: buddyEffect.nullable(),
    after: buddyEffect.nullable(),
  }),
  z.object({
    resource: z.literal('membership'),
    id: z.string(),
    before: membershipEffect.nullable(),
    after: membershipEffect.nullable(),
  }),
  z.object({
    resource: z.literal('relationship'),
    id: z.string(),
    before: relationshipEffect.nullable(),
    after: relationshipEffect.nullable(),
  }),
  z.object({
    resource: z.literal('grant'),
    id: z.string(),
    before: grantEffect.nullable(),
    after: grantEffect.nullable(),
  }),
]);
export const TeamSetupResultSchema = z.object({
  workspaceId: z.string(),
  contractVersion: z.string(),
  key: z.string(),
  planHash: z.string(),
  canApply: z.boolean(),
  blockers: z.array(TeamSetupBlockerSchema),
  effects: z.array(TeamConfigurationEffectSchema),
  resolvedBuddies: z.array(
    z.object({ ref: BuddyConfigurationRefSchema, id: z.string().nullable(), name: z.string() })
  ),
  affectedWork: z.array(affectedWork),
  receipt: z
    .object({ auditId: z.string(), appliedAt: z.string(), replayed: z.boolean() })
    .nullable(),
  queuedRuns: z.array(
    z.object({
      runId: z.string(),
      inputKind: z.string(),
      inputId: z.string(),
      buddyId: z.string(),
      state: z.string(),
    })
  ),
  readiness: TeamReadinessSchema,
  drift: z.boolean(),
});
