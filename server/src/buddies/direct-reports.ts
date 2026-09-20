import { ProviderSchema } from '@unleashd/shared';
import { z } from 'zod';
import type { BuddiesStorePort } from './contract';
import type { BuddyOperationContext } from './operations';
import { assertBuddyProviderSupportsMcp } from './provider-capability';
import { teamAuthority, teamStore } from './team-access';

export const DirectReportInputSchemas = {
  'buddy.hire_direct_report': z
    .object({
      key: z.string().trim().min(1).max(200),
      name: z.string().trim().min(1).max(160),
      role: z.string().trim().min(1),
      soul: z.string().trim().min(1),
      additionalWorkspaceIds: z.array(z.string().min(1)).optional(),
      provider: ProviderSchema.optional(),
      model: z.string().min(1).optional(),
      reasoningEffort: z.string().min(1).optional(),
    })
    .strict(),
  'buddy.retire_direct_report': z
    .object({
      buddyId: z.string().min(1),
      reason: z.string().trim().min(1),
      reassignOpenWorkToManager: z.boolean().default(false),
    })
    .strict(),
} as const;

export function executeDirectReportOperation(
  store: BuddiesStorePort,
  context: BuddyOperationContext,
  name: keyof typeof DirectReportInputSchemas,
  input: unknown
) {
  // Legacy compatibility tools do not bypass the same owner grants as atoms.
  if (context.automationRunId || context.allowedOperations) {
    throw new Error('Hiring and retirement are unavailable in restricted conversations');
  }
  const manager = store.getBuddy(context.buddyId);
  if (!manager || manager.status !== 'active') {
    throw new Error('Only an active manager can hire or retire direct reports');
  }
  if (name === 'buddy.hire_direct_report') {
    const parsed = DirectReportInputSchemas[name].parse(input);
    if (parsed.provider) assertBuddyProviderSupportsMcp(parsed.provider);
    const team = teamStore(store);
    const authority = teamAuthority(context);
    team.requireBuddyCapability({ ...authority, capability: 'staff.create' });
    if (parsed.additionalWorkspaceIds?.length)
      throw new Error('Additional workspace membership requires the owner membership controls');
    const { key, additionalWorkspaceIds: _unused, ...identity } = parsed;
    const stable = createHash('sha256').update(key).digest('hex');
    const created = team.createTeamBuddy(identity, { ...authority, key: `hire:${stable}` }) as {
      buddy: { id: string };
    };
    team.setTeamRelationship(
      {
        fromBuddyId: context.buddyId,
        toBuddyId: created.buddy.id,
        kind: 'manager',
        key: `attach:${stable}`,
      },
      authority
    );
    return { ...created, outcome: 'hired' };
  }
  const parsed = DirectReportInputSchemas[name].parse(input);
  for (const capability of ['profile.write', 'execution.manage'] as const)
    teamStore(store).requireBuddyCapability({
      ...teamAuthority(context),
      targetBuddyId: parsed.buddyId,
      capability,
    });
  return store.retireDirectReport({
    managerBuddy: context.buddyId,
    subBuddy: parsed.buddyId,
    reason: parsed.reason,
    reassignOpenWorkTo: parsed.reassignOpenWorkToManager ? context.buddyId : undefined,
  });
}
import { createHash } from 'node:crypto';
