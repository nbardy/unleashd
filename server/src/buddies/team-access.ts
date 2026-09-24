import {
  BUDDY_TEAM_CONTRACT_VERSION,
  type BuddyAccessGrant,
  type BuddyCapabilityDecision,
  type BuddyMessageExecution,
  type BuddyTeamCapability,
  BuddyTeamCapabilitySchema,
  ProviderSchema,
} from '@unleashd/shared';
import { isEffortValidForProvider, isModelIdValidForProvider } from '@unleashd/shared';
import { z } from 'zod';
import type { BuddiesStorePort } from './contract';
import { type CoordinationStore, coordinationStore } from './coordination-store';
import type { BuddyOperationContext } from './operations';
import { assertBuddyProviderSupportsMcp } from './provider-capability';

export function validateProfileChange(
  store: BuddiesStorePort,
  targetBuddyId: string,
  changes: { provider?: string; model?: string | null; reasoningEffort?: string | null }
) {
  const current = store.getBuddy(targetBuddyId);
  if (!current) throw new Error('Profile unavailable');
  const provider = ProviderSchema.parse(changes.provider ?? current.provider ?? 'codex');
  assertBuddyProviderSupportsMcp(provider);
  const model = changes.model === undefined ? current.model : changes.model;
  const effort =
    changes.reasoningEffort === undefined ? current.reasoning_effort : changes.reasoningEffort;
  if (!isModelIdValidForProvider(provider, model ?? undefined))
    throw new Error('Model is unavailable for this provider');
  if (!isEffortValidForProvider(provider, effort ?? null))
    throw new Error('Reasoning effort is unavailable for this provider');
}

const target = z.string().min(1).optional();
const key = z.string().trim().min(1).max(200);
export const TeamOperationSchemas = {
  'buddy.get_capabilities': z
    .object({
      targetBuddyId: target,
      targetBuddyIds: z.array(z.string().min(1)).min(1).max(32).optional(),
      messageIds: z.array(z.string().min(1)).min(1).max(32).optional(),
      workspaceId: z.string().min(1).optional(),
      intent: z
        .enum(['coordinate', 'maintain_profiles', 'maintain_documents', 'schedule'])
        .optional(),
    })
    .strict()
    .refine((input) => !input.targetBuddyId || !input.targetBuddyIds, {
      message: 'Choose targetBuddyId or targetBuddyIds, not both',
    }),
  'buddy.create_buddy': z
    .object({
      key,
      name: z.string().trim().min(1).max(200),
      role: z.string().trim().min(1).max(4000),
      soul: z.string().trim().min(1).max(32000),
      provider: ProviderSchema.optional(),
      model: z.string().optional(),
      reasoningEffort: z.string().optional(),
      backgroundEnabled: z.boolean().optional(),
      employmentMode: z.enum(['standing', 'worker']).optional(),
    })
    .strict(),
  'buddy.set_relationship': z
    .object({
      key,
      fromBuddyId: z.string().min(1),
      toBuddyId: z.string().min(1),
      kind: z.enum(['manager', 'consults']),
      present: z.boolean().optional(),
    })
    .strict(),
  'buddy.get_profile': z.object({ targetBuddyId: target }).strict(),
  'buddy.update_profile': z
    .object({
      targetBuddyId: z.string().min(1),
      key,
      baseRevision: z.number().int().positive(),
      reason: z.string().trim().min(1),
      changes: z
        .object({
          name: z.string().trim().min(1).max(200).optional(),
          role: z.string().trim().min(1).max(4000).optional(),
          provider: ProviderSchema.optional(),
          model: z.string().nullable().optional(),
          reasoningEffort: z.string().nullable().optional(),
          backgroundEnabled: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  'buddy.get_memory': z
    .object({ doc: z.enum(['working', 'long_term']), targetBuddyId: target })
    .strict(),
};
export interface TeamAuthority {
  actor: string;
  workspaceId: string;
  conversationId?: string | null;
}
export interface TeamDocument {
  buddyId: string;
  doc: string;
  content: string;
  revision: number;
}
export interface TeamStore extends CoordinationStore {
  getTeamContractVersion(): string;
  isCoordinationManager(managerId: string, reportId: string): boolean;
  setBuddyAccess(input: {
    granteeId: string;
    workspaceId: string;
    targetBuddyId?: string;
    capabilities: BuddyTeamCapability[];
    baseRevision: number;
    key: string;
    reason: string;
    expiresAt?: string;
  }): BuddyAccessGrant;
  getBuddyAccess(granteeId: string, workspaceId: string, targetId: string): BuddyAccessGrant | null;
  listBuddyAccess(granteeId: string, workspaceId: string): BuddyAccessGrant[];
  buddyCapability(
    input: TeamAuthority & { targetBuddyId?: string; capability: BuddyTeamCapability }
  ): BuddyCapabilityDecision;
  requireBuddyCapability(
    input: TeamAuthority & { targetBuddyId?: string; capability: BuddyTeamCapability }
  ): BuddyCapabilityDecision;
  createTeamBuddy(
    input: Omit<z.infer<(typeof TeamOperationSchemas)['buddy.create_buddy']>, 'key'>,
    authority: TeamAuthority & { key: string }
  ): unknown;
  setTeamRelationship(
    input: z.infer<(typeof TeamOperationSchemas)['buddy.set_relationship']>,
    authority: TeamAuthority
  ): unknown;
  getTeamProfile(targetBuddyId: string): {
    buddyId: string;
    name: string;
    role: string;
    provider: string | null;
    model: string | null;
    reasoningEffort: string | null;
    revision: number;
  };
  updateTeamProfile(
    input: z.infer<(typeof TeamOperationSchemas)['buddy.update_profile']>,
    authority: TeamAuthority
  ): unknown;
  readTeamDocument(
    input: { targetBuddyId: string; doc: 'soul' | 'working' | 'long_term' },
    authority: TeamAuthority
  ): TeamDocument;
  updateTeamDocument(
    input: {
      targetBuddyId: string;
      doc: 'soul' | 'working' | 'long_term';
      content: string;
      baseVersion: number;
      reasoning: string;
      key: string;
      preview?: boolean;
    },
    authority: TeamAuthority
  ): unknown;
  getMessageExecution(messageId: string): BuddyMessageExecution;
}
/** Reads remain diagnostic even when an old package cannot perform team mutations. */
export function inspectTeamContract(store: BuddiesStorePort) {
  const candidate = store as Partial<TeamStore>;
  const packageVersion = candidate.getTeamContractVersion?.() ?? null;
  const available = typeof candidate.buddyCapability === 'function' && packageVersion !== null;
  const compatible = available && packageVersion === BUDDY_TEAM_CONTRACT_VERSION;
  return {
    expectedVersion: BUDDY_TEAM_CONTRACT_VERSION,
    packageVersion,
    compatible,
    code: compatible ? null : available ? 'TEAM_CONTRACT_MISMATCH' : 'TEAM_CONTRACT_UNAVAILABLE',
    reason: compatible
      ? null
      : `Team runtime is incompatible: app ${BUDDY_TEAM_CONTRACT_VERSION}, package ${packageVersion ?? 'unversioned'}.`,
    remedy: compatible
      ? null
      : 'Install the matching package, allow the server to reload after active work drains, then start a fresh MCP session in the existing conversation. Preserve queued messages; do not resend them.',
  };
}

export function messageExecution(
  store: BuddiesStorePort,
  messageId: string
): BuddyMessageExecution {
  const contract = inspectTeamContract(store);
  if (contract.compatible) {
    const execution = teamStore(store).getMessageExecution(messageId);
    return {
      ...execution,
      delivery: execution.delivery?.map((delivery) => ({
        ...delivery,
        // Old receipts may have no admission timestamp. Only an explicit
        // mailbox disposition establishes that we deliberately kept a chat quiet.
        mailboxOnly:
          delivery.state === 'complete' &&
          !delivery.acknowledgedAt &&
          coordinationStore(store).getBuddyRun(delivery.runId)?.outcome === 'mailbox_only',
      })),
    };
  }
  const message = store.getMessage(messageId);
  if (!message) throw new Error('Message not found');
  return {
    messageId,
    runId: null,
    projectId: message.buddy_project_id,
    state: 'unknown',
    code: contract.code,
    reason: contract.reason,
    remedy: contract.remedy,
    conversationId: message.child_conversation_id,
    acknowledgedAt: message.replied_at,
    acceptedBy: null,
    acceptedAt: null,
    completionEvidence: [],
    outcome: message.outcome,
    error: null,
  };
}

export function teamStore(store: BuddiesStorePort): TeamStore {
  const contract = inspectTeamContract(store);
  if (!contract.compatible)
    throw Object.assign(new Error(`${contract.reason} ${contract.remedy}`), {
      code: contract.code,
      details: contract,
    });
  return coordinationStore(store) as TeamStore;
}
export function teamAuthority(context: BuddyOperationContext): TeamAuthority {
  return {
    actor: context.buddyId,
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
  };
}
export function isRestrictedBuddyContext(context: BuddyOperationContext): boolean {
  return !!(context.automationRunId || context.allowedOperations || context.delegatedByBuddyId);
}
const OPERATION_CAPABILITIES: Record<string, string> = {
  get_profile: 'profile.read',
  update_profile: 'profile.write',
  get_soul: 'soul.read',
  update_soul: 'soul.write',
  get_memory: 'memory.read',
  update_memory: 'memory.write',
  create_buddy: 'staff.create',
  hire_direct_report: 'staff.create',
  set_relationship: 'relationship.write',
  new_project: 'project.write',
  get_current_work: 'project.read',
  send: 'dispatch',
  set_automation: 'schedule.manage',
};
export function getTeamCapabilities(
  source: BuddiesStorePort,
  context: BuddyOperationContext,
  targetBuddyId = context.buddyId
) {
  const contract = inspectTeamContract(source);
  const ownerSetupUrl = `/buddies/${encodeURIComponent(context.buddyId)}/settings?workspaceId=${encodeURIComponent(context.workspaceId)}&targetBuddyId=${encodeURIComponent(targetBuddyId)}`;
  if (!contract.compatible) {
    const unavailable = {
      allowed: false,
      code: contract.code!,
      reason: contract.reason!,
      remedy: contract.remedy,
    };
    return {
      contractVersion: BUDDY_TEAM_CONTRACT_VERSION,
      contract,
      actorBuddyId: context.buddyId,
      workspaceId: context.workspaceId,
      targetBuddyId,
      ownerSetupUrl,
      relationships: null,
      execution: null,
      capabilities: Object.fromEntries(
        BuddyTeamCapabilitySchema.options.map((cap) => [cap, unavailable])
      ),
      operations: Object.fromEntries(
        [
          ...Object.keys(OPERATION_CAPABILITIES),
          'update_profile.backgroundEnabled',
          'set_automation.enable',
          'set_automation.configure_disabled',
          'retire_direct_report',
        ].map((op) => [op, unavailable])
      ),
      restrictions: [
        'Team permissions and execution state are unknown until the loaded runtime matches. No access grant can repair a package mismatch.',
      ],
    };
  }
  const store = teamStore(source);
  const auth = teamAuthority(context);
  const membership = store.getCoordinationMembership(context.buddyId, context.workspaceId);
  const targetMember = store.getCoordinationMembership(targetBuddyId, context.workspaceId);
  const self = targetBuddyId === context.buddyId;
  const decision = (allowed: boolean, reason: string): BuddyCapabilityDecision => ({
    allowed,
    code: allowed ? 'scope_allowed' : 'scope_denied',
    reason,
    remedy: allowed ? null : 'Owner can inspect workspace membership and reporting relationships.',
  });
  const capabilities: Record<string, BuddyCapabilityDecision> = Object.fromEntries(
    BuddyTeamCapabilitySchema.options.map((capability) => [
      capability,
      store.buddyCapability({
        ...auth,
        targetBuddyId: capability === 'staff.create' ? undefined : targetBuddyId,
        capability,
      }),
    ])
  );
  // Self reads and ordinary owner-directed self edits retain their established scope.
  if (self) {
    for (const c of ['profile.read', 'soul.read', 'memory.read', 'memory.write'])
      capabilities[c] = decision(true, 'This Buddy owns its profile and memory.');
    if (!isRestrictedBuddyContext(context) && context.conversationId)
      capabilities['soul.write'] = decision(
        true,
        'Direct owner conversation; edits require owner direction.'
      );
  }
  const active =
    store.getBuddy(context.buddyId)?.status === 'active' &&
    store.getBuddy(targetBuddyId)?.status === 'active';
  const manages =
    !!targetMember && (self || store.isCoordinationManager(context.buddyId, targetBuddyId));
  capabilities['project.write'] = decision(
    manages,
    'Project ownership or a direct reporting relationship is required; per-project gates still apply.'
  );
  capabilities['project.read'] = decision(
    !!targetMember && (manages || !!membership?.read_all_work),
    'Owned, supervised or explicitly shared projects are readable.'
  );
  capabilities.dispatch = decision(
    active && !!targetMember && !!membership?.dispatch,
    'Workspace membership and dispatch permission are required; execution admission is separate.'
  );
  const operations: Record<
    string,
    BuddyCapabilityDecision & {
      prerequisites?: Array<BuddyCapabilityDecision & { capability: string }>;
    }
  > = {};
  const required = (operation: string, names: string[]) => {
    const prerequisites = names.map((capability) => ({ capability, ...capabilities[capability] }));
    if (context.allowedOperations && !context.allowedOperations.includes(`buddy.${operation}`))
      prerequisites.push({
        capability: 'run_policy',
        allowed: false,
        code: 'run_policy',
        reason: 'This execution policy excludes the operation.',
        remedy: 'Owner must authorize a new execution with the intended tool scope.',
      });
    return {
      ...(prerequisites.find((entry) => !entry.allowed) ?? prerequisites[0]),
      prerequisites,
    };
  };
  for (const [op, cap] of Object.entries(OPERATION_CAPABILITIES)) {
    const reads: Record<string, string> = {
      update_profile: 'profile.read',
      update_soul: 'soul.read',
      update_memory: 'memory.read',
    };
    operations[op] = required(op, reads[op] ? [reads[op], cap] : [cap]);
  }
  operations['update_profile.backgroundEnabled'] = required('update_profile', [
    'profile.read',
    'execution.manage',
  ]);
  // A Buddy schedules ITSELF without a grant, bounded by SELF_SCHEDULE_LIMITS
  // in operations.ts (owner decision 2026-09-24). The run policy still applies.
  if (self && !capabilities['schedule.manage'].allowed) {
    const selfSchedule = {
      capability: 'schedule.self',
      ...decision(
        manages,
        'A Buddy creates and turns on its own schedules without a grant: at most once an hour and 5 enabled. schedule.manage lifts both limits.'
      ),
    };
    const policy = operations.set_automation.prerequisites?.find(
      (entry) => entry.capability === 'run_policy'
    );
    operations.set_automation = policy
      ? { ...policy, prerequisites: [selfSchedule, policy] }
      : { ...selfSchedule, prerequisites: [selfSchedule] };
  }
  operations['set_automation.enable'] = operations.set_automation;
  operations.retire_direct_report = isRestrictedBuddyContext(context)
    ? decision(false, 'Retirement is available only in a direct owner conversation.')
    : !capabilities['profile.write'].allowed
      ? capabilities['profile.write']
      : !capabilities['execution.manage'].allowed
        ? capabilities['execution.manage']
        : decision(
            manages && !self,
            'Retirement requires a direct report and explicit profile/execution grants.'
          );
  if (isRestrictedBuddyContext(context))
    operations.hire_direct_report = decision(
      false,
      'Use create_buddy and set_relationship within explicit grants in restricted runs.'
    );
  operations['set_automation.configure_disabled'] =
    context.allowedOperations && !context.allowedOperations.includes('buddy.set_automation')
      ? operations.set_automation
      : decision(
          manages &&
            (self || !isRestrictedBuddyContext(context) || capabilities['schedule.manage'].allowed),
          'A Buddy prepares its own schedules anywhere; for another Buddy, restricted runs require schedule.manage.'
        );
  return {
    contractVersion: BUDDY_TEAM_CONTRACT_VERSION,
    contract,
    ownerSetupUrl,
    actorBuddyId: context.buddyId,
    workspaceId: context.workspaceId,
    targetBuddyId,
    relationships: targetMember ? store.listBuddyRelationships(targetBuddyId) : [],
    capabilities,
    operations,
    execution: targetMember
      ? {
          backgroundEnabled: !!targetMember.background_enabled,
          pausedReason: targetMember.background_paused_reason,
          maxActiveRuns: targetMember.max_active_runs,
        }
      : null,
    restrictions: [
      'No hiring quotas. Staff creation requires an owner grant.',
      'Profile and document grants affect this identity across its workspaces.',
      'Training, spending and external actions retain separate approval requirements.',
    ],
  };
}
