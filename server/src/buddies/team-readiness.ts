import {
  BUDDY_TEAM_CONTRACT_VERSION,
  type BuddyCapabilityDecision,
  type BuddyMessage,
  ProviderSchema,
} from '@unleashd/shared';
import type { z } from 'zod';
import type { BuddiesStorePort } from './contract';
import { type CoordinationStore, coordinationStore } from './coordination-store';
import type { BuddyOperationContext } from './operations';
import { assertBuddyProviderSupportsMcp } from './provider-capability';
import {
  type TeamOperationSchemas,
  getTeamCapabilities,
  inspectTeamContract,
  messageExecution,
  teamStore,
} from './team-access';

type Input = z.infer<(typeof TeamOperationSchemas)['buddy.get_capabilities']>;
type Blocker = {
  code: string;
  path: string;
  reason: string;
  remedy: string;
  resolvableBy: 'owner' | 'lead' | 'runtime';
};

/** Readiness is a projection of current grants, memberships, policies and original receipts. */
export function inspectTeamReadiness(
  source: BuddiesStorePort,
  originalContext: BuddyOperationContext,
  input: Input,
  messageInAudience: (message: BuddyMessage) => boolean
) {
  const context = {
    ...originalContext,
    workspaceId: input.workspaceId ?? originalContext.workspaceId,
  };
  const contract = inspectTeamContract(source);
  const coordination = contract.compatible
    ? coordinationStore(source)
    : (source as Partial<CoordinationStore>);
  if (coordination.getCoordinationMembership) {
    if (!coordination.getCoordinationMembership(context.buddyId, context.workspaceId))
      throw new Error('Workspace membership is required');
  } else if (context.workspaceId !== originalContext.workspaceId) {
    throw new Error(
      'Workspace membership cannot be inspected until the matching runtime is loaded'
    );
  }
  const blockers: Blocker[] = [];
  const add = (
    path: string,
    code: string,
    reason: string,
    remedy: string,
    resolvableBy: Blocker['resolvableBy'] = 'owner'
  ) => {
    if (!blockers.some((entry) => entry.path === path && entry.code === code))
      blockers.push({ path, code, reason, remedy, resolvableBy });
  };
  const ownerControls = {
    available: !!context.ownerControlAvailable,
    compatible:
      !!context.ownerControlAvailable &&
      context.ownerControlContractVersion === BUDDY_TEAM_CONTRACT_VERSION,
    contractVersion: context.ownerControlContractVersion ?? null,
    code: !context.ownerControlAvailable
      ? 'owner_control_unavailable'
      : context.ownerControlContractVersion !== BUDDY_TEAM_CONTRACT_VERSION
        ? 'owner_control_mismatch'
        : null,
    remedy:
      context.ownerControlAvailable &&
      context.ownerControlContractVersion === BUDDY_TEAM_CONTRACT_VERSION
        ? null
        : 'Team setup requires the matching host owner adapter on a fresh authenticated owner-input turn. Employee grants cannot repair that adapter.',
  };
  const messages = (input.messageIds ?? []).flatMap((messageId) => {
    const message = source.getMessage(messageId);
    if (
      !message ||
      !messageInAudience(message) ||
      (message.from_buddy_id !== context.buddyId &&
        message.to_buddy_id !== context.buddyId &&
        (message.visibility !== 'project' ||
          !message.buddy_project_id ||
          !coordination.canReadCoordinationProject?.(context.buddyId, message.buddy_project_id)))
    ) {
      add(
        `messages.${messageId}`,
        'message_scope',
        'Message is unavailable in this participant scope.',
        'Inspect a message shared with this Buddy.'
      );
      return [];
    }
    if (message.workspace_id !== context.workspaceId) {
      add(
        `messages.${messageId}`,
        'workspace_scope',
        'Message is unavailable in the selected workspace.',
        'Inspect the original message in a workspace where this Buddy is a member.'
      );
      return [];
    }
    return [message];
  });
  const targets = [
    ...new Set([
      ...(input.targetBuddyIds ??
        (input.targetBuddyId
          ? [input.targetBuddyId]
          : input.messageIds?.length
            ? []
            : [context.buddyId])),
      ...messages.flatMap((message) => (message.to_buddy_id ? [message.to_buddy_id] : [])),
    ]),
  ];
  const inspections = targets.map((target) => getTeamCapabilities(source, context, target));
  const single =
    inspections.find(
      (inspection) => inspection.targetBuddyId === (input.targetBuddyId ?? context.buddyId)
    ) ??
    inspections[0] ??
    getTeamCapabilities(source, context);
  if (!contract.compatible)
    add('runtime.contract', contract.code!, contract.reason!, contract.remedy!, 'runtime');
  const receiptViews = messages.map((message) => ({
    messageId: message.id,
    execution: messageExecution(source, message.id),
  }));
  if (contract.compatible) {
    const store = teamStore(source);
    const checkDecision = (path: string, decision: BuddyCapabilityDecision) => {
      if (!decision.allowed)
        add(
          path,
          decision.code,
          decision.reason,
          decision.remedy ?? 'Inspect the exact target and current owner configuration.'
        );
    };
    const requireOperation = (inspection: (typeof inspections)[number], operation: string) => {
      const result = inspection.operations[operation] as BuddyCapabilityDecision & {
        prerequisites?: Array<BuddyCapabilityDecision & { capability: string }>;
      };
      for (const prerequisite of result?.prerequisites ??
        (result ? [{ ...result, capability: operation }] : []))
        checkDecision(
          `targets.${inspection.targetBuddyId}.operations.${operation}.${prerequisite.capability}`,
          prerequisite
        );
    };
    const admission = (
      buddyId: string,
      path: string,
      workspaceId = context.workspaceId,
      runId?: string,
      conversationId?: string
    ) => {
      if (
        !store.getCoordinationMembership(context.buddyId, workspaceId) ||
        !store.getCoordinationMembership(buddyId, workspaceId)
      ) {
        add(
          path,
          'workspace_scope',
          'The intended route is unavailable in this participant’s inspection scope.',
          'Inspect the route from its permitted workspace; owner may explicitly admit the intended identity.'
        );
        return;
      }
      for (const blocker of store.inspectBuddyAdmission({
        buddyId,
        workspaceId,
        runId,
        conversationId,
      }).blockers)
        add(path, blocker.code, blocker.reason, blocker.remedy, blocker.resolvableBy);
      const provider = source.getBuddy(buddyId)?.provider;
      if (provider) {
        try {
          assertBuddyProviderSupportsMcp(ProviderSchema.parse(provider));
        } catch {
          add(
            path,
            'provider_unavailable',
            'The configured provider cannot guarantee required Buddy tools.',
            'Select a provider with required Buddy MCP support.',
            'runtime'
          );
        }
      }
    };
    for (const inspection of inspections) {
      const target = inspection.targetBuddyId;
      if (!store.getCoordinationMembership(target, context.workspaceId)) {
        add(
          `targets.${target}`,
          'workspace_scope',
          'The intended participant is unavailable in this workspace.',
          'Owner must admit the intended identity to this workspace.'
        );
        continue;
      }
      const intent = input.intent;
      if (intent === 'maintain_profiles') requireOperation(inspection, 'update_profile');
      if (intent === 'maintain_documents') {
        requireOperation(inspection, 'update_soul');
        requireOperation(inspection, 'update_memory');
      }
      if (intent === 'schedule') requireOperation(inspection, 'set_automation.enable');
      if (intent === 'coordinate') {
        for (const operation of ['new_project', 'get_current_work', 'send'])
          requireOperation(inspection, operation);
        if (target !== context.buddyId && !store.isCoordinationManager(context.buddyId, target)) {
          requireOperation(inspection, 'set_relationship');
          // Exactly the actor-as-manager exemption used by setTeamRelationship: no self grant.
          for (const workspace of source.listBuddyWorkspaces(target) as Array<{ id: string }>) {
            if (workspace.id === context.workspaceId) continue;
            if (!store.getCoordinationMembership(context.buddyId, workspace.id)) {
              add(
                `targets.${target}.relationship`,
                'manager_workspace_scope',
                'Appointment also affects a workspace the actor cannot inspect.',
                'Owner must explicitly admit the manager in every report workspace.'
              );
            } else
              checkDecision(
                `targets.${target}.relationship.${workspace.id}`,
                store.buddyCapability({
                  actor: context.buddyId,
                  workspaceId: workspace.id,
                  targetBuddyId: target,
                  capability: 'relationship.write',
                })
              );
          }
        }
        if (!store.getCoordinationMembership(target, context.workspaceId)?.background_enabled)
          requireOperation(inspection, 'update_profile.backgroundEnabled');
      }
      if (intent === 'coordinate' || intent === 'schedule')
        admission(target, `targets.${target}.admission`);
    }
    if (input.intent === 'coordinate' || messages.some((message) => message.expects_reply))
      admission(context.buddyId, 'returnPath.admission');
    for (const message of messages) {
      const receipt = receiptViews.find((view) => view.messageId === message.id)!.execution;
      if (message.to_buddy_id)
        admission(
          message.to_buddy_id,
          `messages.${message.id}.admission`,
          message.workspace_id,
          receipt.runId && store.getBuddyRun(receipt.runId)?.status === 'queued'
            ? receipt.runId
            : undefined
        );
      if (receipt.code && !['awaiting_admission', 'owner_reply'].includes(receipt.code))
        add(
          `messages.${message.id}.execution`,
          receipt.code,
          receipt.reason ?? receipt.code,
          receipt.remedy ?? 'Inspect the original run receipt.',
          'runtime'
        );
      const run = receipt.runId ? store.getBuddyRun(receipt.runId) : null;
      const required =
        input.intent === 'maintain_documents'
          ? ['buddy.get_memory', 'buddy.update_memory', 'buddy.get_soul', 'buddy.update_soul']
          : input.intent === 'maintain_profiles'
            ? ['buddy.get_profile', 'buddy.update_profile']
            : input.intent === 'schedule'
              ? ['buddy.set_automation']
              : ['buddy.get_current_work', 'buddy.update_project', 'buddy.reply'];
      for (const operation of required)
        if (run && !run.policy.allowed_operations.includes(operation))
          add(
            `messages.${message.id}.policy.${operation}`,
            'run_policy',
            `The original run policy excludes ${operation}.`,
            'Keep the existing run restrictions. If broader work is authorized, finish or stop this attempt and explicitly dispatch a new bounded task.'
          );
      if (message.expects_reply && message.from_buddy_id)
        admission(
          message.from_buddy_id,
          `messages.${message.id}.returnPath`,
          message.source_workspace_id ?? message.workspace_id,
          undefined,
          message.parent_conversation_id ?? undefined
        );
    }
  }
  return {
    ...single,
    ownerControls,
    targets: inspections,
    readiness: {
      intent: input.intent ?? null,
      state: input.intent || messages.length ? 'evaluated' : 'not_evaluated',
      ready:
        Boolean(input.intent || messages.length) && contract.compatible && blockers.length === 0,
      blockers,
      messages: receiptViews,
      // Settings prove admission prerequisites, not an executor heartbeat or project completion.
      runtimeObservation:
        'Inspect original message/run receipts for actual starts; runtime health is not inferred from configuration.',
    },
  };
}
