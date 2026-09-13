import { BuddyCheckpointInputSchema, BuddyTeamObservationInputSchema } from '@unleashd/shared';
import { observeBuddyTeam } from './team-observation';
import { MEMORY_NOTE_MAX_BYTES } from '@nbardy/buddies';
import { BuddyDocumentRefSchema } from '@unleashd/shared';
import {
  BuddyBackgroundExecutionSchema,
  BuddyMessageReplySchema,
  BuddyRunSchema,
  BuddySoulUpdateSchema,
  TeamConfigurationProposalSchema,
  BuddyTodoOperationSchema as TodoOperationSchema,
  formatTeamConfigurationProposal,
} from '@unleashd/shared';
import { z } from 'zod';
import { type BuddiesStorePort, type BuddyAutomation, BuddyMemoryOperationError } from './contract';
import { type PrivateBuddyRun, coordinationStore } from './coordination-store';
import { DirectReportInputSchemas, executeDirectReportOperation } from './direct-reports';
import { BuddyDirectoryInputSchema, listBuddyContacts } from './directory';
import { previewBuddyDocument } from './document-preview';
import {
  knowledgeAuthority,
  recallKnowledge,
  scopedDocumentOperation,
  scopedNote,
} from './knowledge';
import { assertBuddyProviderSupportsMcp } from './provider-capability';
import { publicAutomationRun } from './public-automation-run';
import { nextAutomationRunAt } from './scheduler';
import { readBuddySoul, updateBuddySoul } from './soul';
import { validateProfileChange } from './team-access';
import {
  TeamOperationSchemas,
  isRestrictedBuddyContext,
  messageExecution,
  teamAuthority,
  teamStore,
} from './team-access';
import { inspectTeamReadiness } from './team-readiness';

export const BuddyOperationContextSchema = z.object({
  ownerControlAvailable: z.boolean().optional(),
  ownerControlContractVersion: z.string().optional(),
  coordinationRunId: z.string().nullish(),
  buddyId: z.string().min(1),
  workspaceId: z.string().min(1),
  buddyProjectId: z.string().min(1).nullable().optional(),
  automationRunId: z.string().min(1).nullable().optional(),
  conversationId: z.string().min(1).nullable().optional(),
  delegatedByBuddyId: z.string().min(1).nullable().optional(),
  allowedOperations: z.array(z.string().min(1)).min(1).optional(),
});

const AutomationPolicyInputSchema = z
  .object({
    maxRuntimeSeconds: z.number().int().positive().optional(),
    maxIterations: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    maxCostUsd: z.number().positive().optional(),
    allowedOperations: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const SetAutomationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('enable'),
      automationId: z.string().min(1),
      key: z.string().min(1).max(200),
      baseRevision: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('create'),
      key: z.string().min(1).max(200).optional(),
      conversationId: z.string().min(1).optional(),
      prompt: z.string().min(1).max(32000).optional(),
      targetBuddyId: z.string().min(1).optional(),
      projectId: z.string().min(1).optional(),
      name: z.string().min(1),
      scheduleKind: z.enum(['cron', 'interval']),
      scheduleExpression: z.string().min(1),
      timezone: z.string().min(1).default('UTC'),
      jobKind: z.enum(['prompt', 'sequence', 'loop']).default('prompt'),
      jobPayload: z.record(z.string(), z.unknown()).optional(),
      policy: AutomationPolicyInputSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      key: z.string().min(1).max(200).optional(),
      baseRevision: z.string().min(1).optional(),
      automationId: z.string().min(1),
      name: z.string().min(1).optional(),
      scheduleKind: z.enum(['cron', 'interval']).optional(),
      scheduleExpression: z.string().min(1).optional(),
      timezone: z.string().min(1).optional(),
      jobKind: z.enum(['prompt', 'sequence', 'loop']).optional(),
      jobPayload: z.record(z.string(), z.unknown()).optional(),
      policy: AutomationPolicyInputSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('disable'),
      key: z.string().min(1).max(200).optional(),
      automationId: z.string().min(1),
    })
    .strict(),
]);

export const BuddyOperationInputSchemas = {
  ...DirectReportInputSchemas,
  'buddy.get_team_state': BuddyTeamObservationInputSchema,
  'buddy.checkpoint': BuddyCheckpointInputSchema,
  ...TeamOperationSchemas,
  'buddy.get_soul': z.object({ targetBuddyId: z.string().min(1).optional() }).strict(),
  'buddy.update_soul': BuddySoulUpdateSchema.extend({
    targetBuddyId: z.string().min(1).optional(),
    key: z.string().min(1).max(200).optional(),
    preview: z.boolean().optional(),
  }),
  'buddy.get_current_work': z
    .object({
      targetBuddyId: z.string().min(1).optional(),
      workspaceId: z.string().min(1).optional(),
      buddyId: z.string().min(1).optional(),
      projectId: z.string().min(1).optional(),
      includeClosed: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),
  'buddy.get_inbox': z
    .object({
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),
  'buddy.list_buddies': BuddyDirectoryInputSchema,
  'buddy.get_message': z.object({ messageId: z.string().min(1) }).strict(),
  'buddy.get_runs': z
    .object({
      projectId: z.string().min(1).optional(),
      rootMessageId: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    })
    .strict(),
  'buddy.stop': z
    .object({
      runId: z.string().min(1).optional(),
      rootMessageId: z.string().min(1).optional(),
      reason: z.string().min(1),
      key: z.string().min(1).max(200),
    })
    .strict(),
  'buddy.retry_run': z
    .object({
      checkpointId: z.string().min(1).optional(),
      runId: z.string().min(1),
      reason: z.string().min(1),
      key: z.string().min(1).max(200),
    })
    .strict(),
  'buddy.get_automations': z
    .object({
      targetBuddyId: z.string().min(1).optional(),
    })
    .strict(),
  'buddy.set_automation': SetAutomationSchema,
  'buddy.new_project': z.object({
    key: z.string().min(1).max(200).optional(),
    ownerId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    parentProjectId: z.string().min(1).optional(),
    title: z.string().min(1),
    objective: z.string().min(1).optional(),
    definitionOfDone: z.string().min(1),
    sprint: z.string().min(1).optional(),
    status: z
      .enum(['backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled'])
      .optional(),
    priority: z.number().int().optional(),
    nextAction: z.string().min(1).optional(),
    blockedReason: z.string().min(1).optional(),
    sourcePath: z.string().min(1).optional(),
    externalKey: z.string().min(1).optional(),
    todos: z.array(TodoOperationSchema.options[0].omit({ operation: true })).optional(),
  }),
  'buddy.update_project': z.object({
    approvalId: z.string().min(1).optional(),
    key: z.string().min(1).max(200).optional(),
    baseRevision: z.number().int().positive().optional(),
    ownerId: z.string().min(1).optional(),
    executionState: z.enum(['enabled', 'paused', 'cancelled']).optional(),
    projectId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    objective: z.string().nullable().optional(),
    definitionOfDone: z.string().min(1).optional(),
    status: z
      .enum(['backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled'])
      .optional(),
    priority: z.number().int().optional(),
    nextAction: z.string().nullable().optional(),
    blockedReason: z.string().nullable().optional(),
    sprint: z.string().nullable().optional(),
    sourcePath: z.string().nullable().optional(),
    todoOperations: z.array(TodoOperationSchema).optional(),
    evidence: z.array(z.string().min(1)).optional(),
  }),
  'buddy.update_memory': z
    .object({
      doc: z.enum(['working', 'long_term']),
      targetBuddyId: z.string().min(1).optional(),
      key: z.string().min(1).max(200).optional(),
      preview: z.boolean().optional(),
      content: z.string(),
      reasoning: z.string().min(1),
      baseVersion: z.number().int().nonnegative(),
    })
    .strict(),
  'buddy.remember_note': z
    .object({
      topic: z.string().min(1).max(160).optional(),
      kind: z.string().min(1).max(80).optional(),
      body: z
        .string()
        .min(1)
        .refine(
          (body) => Buffer.byteLength(body, 'utf8') <= MEMORY_NOTE_MAX_BYTES,
          `Note body exceeds ${MEMORY_NOTE_MAX_BYTES} UTF-8 bytes`
        ),
      evidence: z.array(z.unknown()).max(32).optional(),
      scope: z.enum(['current', 'home', 'all']).optional(),
    })
    .strict(),
  'buddy.recall': z
    .object({
      pattern: z.string().min(1).max(500),
      scope: z.enum(['current', 'home', 'all']).optional(),
      since: z.string().datetime().optional(),
      limit: z.number().int().positive().max(100).optional(),
      regex: z.boolean().optional(),
    })
    .strict(),
  'buddy.send': z
    .object({
      preview: z.boolean().optional(),
      execution: BuddyBackgroundExecutionSchema.optional(),
      teamConfiguration: TeamConfigurationProposalSchema.optional(),
      key: z.string().trim().min(1).max(200).optional(),
      workspaceId: z.string().min(1).optional(),
      continueFrom: z.string().min(1).optional(),
      inReplyTo: z.string().min(1).optional(),
      notBefore: z.string().datetime().optional(),
      expectsReply: z.boolean().default(true),
      visibility: z.enum(['participants', 'project']).optional(),
      approval: z
        .object({
          operation: z.literal('buddy.update_project'),
          arguments: z
            .object({
              projectId: z.string().min(1),
              baseRevision: z.number().int().positive(),
              ownerId: z.string().min(1).optional(),
              executionState: z.enum(['enabled', 'paused', 'cancelled']).optional(),
            })
            .strict(),
          expiresAt: z.string().datetime(),
        })
        .strict()
        .optional(),
      to: z.string().trim().min(1),
      purpose: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(32_000),
      evidence: z.array(z.string().trim().min(1).max(4_000)).max(32).default([]),
      projectId: z.string().min(1).nullable().optional(),
      wait: z.boolean().default(false),
      timeoutSeconds: z.number().int().min(1).max(600).default(120),
    })
    .strict(),
  'buddy.reply': BuddyMessageReplySchema.extend({ messageId: z.string().min(1) }),
  'buddy.delegate': z.object({
    toBuddyId: z.string().min(1),
    purpose: z.string().min(1),
    projectId: z.string().min(1).optional(),
    parentConversationId: z.string().min(1).optional(),
    allowedOperations: z.array(z.string().min(1)).min(1).optional(),
  }),
  'buddy.request_review': z.object({
    reviewerBuddyId: z.string().min(1),
    subjectBuddyId: z.string().min(1),
    purpose: z.string().min(1),
    projectId: z.string().min(1).optional(),
    parentConversationId: z.string().min(1).optional(),
    evidence: z
      .array(
        z.object({
          kind: z.enum(['file', 'conversation', 'project', 'metric']),
          reference: z.string().min(1),
          observation: z.string().min(1),
        })
      )
      .default([]),
  }),
  'buddy.complete_delegation': z.object({
    delegationId: z.string().min(1),
    status: z.enum(['complete', 'failed', 'cancelled']).default('complete'),
    outcome: z.string().min(1),
  }),
  'buddy.complete_assignment': z.object({
    delegationId: z.string().min(1).optional(),
    status: z.enum(['complete', 'failed', 'cancelled']).default('complete'),
    outcome: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
  }),
  'buddy.submit_review': z.object({
    reviewId: z.string().min(1),
    verdict: z.enum(['needs_work', 'pass', 'fail']),
    score: z.number().min(0).max(100).nullable().optional(),
    summary: z.string().min(1),
    evidence: z
      .array(
        z.object({
          kind: z.enum(['file', 'conversation', 'project', 'metric']),
          reference: z.string().min(1),
          observation: z.string().min(1),
        })
      )
      .min(1),
    requiredActions: z.array(z.string().min(1)).default([]),
  }),
  'buddy.request_human_approval': z.object({
    action: z.string().min(1),
    reason: z.string().min(1),
    risk: z.string().min(1),
    projectId: z.string().min(1).optional(),
  }),
} as const;

export type BuddyOperationName = keyof typeof BuddyOperationInputSchemas;
export type BuddyOperationContext = z.infer<typeof BuddyOperationContextSchema>;
export type PreparedBuddyMessage = z.infer<(typeof BuddyOperationInputSchemas)['buddy.send']> & {
  parentConversationId?: string;
};

export const MESSAGE_BUDDY_OPERATIONS: BuddyOperationName[] = [
  ...(Object.keys(TeamOperationSchemas) as Array<keyof typeof TeamOperationSchemas>),
  'buddy.get_soul',
  'buddy.update_soul',
  'buddy.set_automation',
  'buddy.list_buddies',
  'buddy.get_message',
  'buddy.get_runs',
  'buddy.get_team_state',
  'buddy.checkpoint',
  'buddy.new_project',
  'buddy.stop',
  'buddy.retry_run',
  'buddy.get_current_work',
  'buddy.get_inbox',
  'buddy.get_automations',
  'buddy.update_project',
  'buddy.update_memory',
  'buddy.remember_note',
  'buddy.recall',
  'buddy.send',
  'buddy.reply',
];

export type PreparedBuddyDelegation = {
  toBuddyId: string;
  purpose: string;
  projectId?: string;
  parentConversationId?: string;
  allowedOperations: BuddyOperationName[];
};

export type PreparedBuddyReviewRequest = {
  reviewerBuddyId: string;
  subjectBuddyId: string;
  purpose: string;
  projectId?: string;
  parentConversationId?: string;
  evidence: Array<{
    kind: 'file' | 'conversation' | 'project' | 'metric';
    reference: string;
    observation: string;
  }>;
};

export interface BuddyPrivateExecutionAuthority {
  /** Server-issued claim token. Never persist this in BuddyContext or expose it as tool input. */
  automationClaimToken?: string;
}

export const DEFAULT_DELEGATED_BUDDY_OPERATIONS: BuddyOperationName[] = [
  'buddy.get_current_work',
  'buddy.get_inbox',
  'buddy.get_automations',
  'buddy.update_project',
  'buddy.update_memory',
  'buddy.remember_note',
  'buddy.recall',
  'buddy.complete_assignment',
  'buddy.request_human_approval',
];

export const REVIEW_BUDDY_OPERATIONS: BuddyOperationName[] = [
  'buddy.get_current_work',
  'buddy.get_inbox',
  'buddy.get_automations',
  'buddy.update_memory',
  'buddy.remember_note',
  'buddy.recall',
  'buddy.submit_review',
  'buddy.request_human_approval',
];

export function resolveDelegatedBuddyOperations(input: unknown): BuddyOperationName[] {
  const requested =
    input === undefined
      ? DEFAULT_DELEGATED_BUDDY_OPERATIONS
      : z.array(z.string().min(1)).parse(input);
  const allowedOperations = requested.map((operation) => {
    if (!(operation in BuddyOperationInputSchemas)) {
      throw new Error(`Unknown Buddy operation in delegation policy: ${operation}`);
    }
    return operation as BuddyOperationName;
  });
  if (!allowedOperations.includes('buddy.complete_assignment')) {
    throw new Error('Delegated Buddy operations must include buddy.complete_assignment');
  }
  return [...new Set(allowedOperations)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMemoryError(error: unknown): unknown {
  if (error instanceof BuddyMemoryOperationError) return error;
  const candidate = error as {
    code?: unknown;
    currentVersion?: unknown;
    yourBase?: unknown;
    currentBody?: unknown;
    documentKind?: unknown;
  };
  if (candidate.code === 'STALE_MEMORY_WRITE' || /StaleMemoryWrite/i.test(String(error))) {
    return new BuddyMemoryOperationError(
      'MEMORY_STALE',
      error instanceof Error ? error.message : 'Memory revision is stale',
      {
        current_version: candidate.currentVersion,
        supplied_base: candidate.yourBase,
        current_content: candidate.currentBody,
        document_kind: candidate.documentKind,
      }
    );
  }
  if (/exceeds .*characters|exceeds .*bytes/i.test(String(error))) {
    return new BuddyMemoryOperationError(
      'MEMORY_TOO_LARGE',
      error instanceof Error ? error.message : 'Memory content exceeds its limit'
    );
  }
  if (/no configured memory path|not initialized/i.test(String(error))) {
    return new BuddyMemoryOperationError(
      'MEMORY_UNCONFIGURED',
      error instanceof Error ? error.message : 'Buddy memory is not configured'
    );
  }
  if (/does not belong to the workspace|requested note workspace/i.test(String(error))) {
    return new BuddyMemoryOperationError(
      'WORKSPACE_FORBIDDEN',
      error instanceof Error ? error.message : 'Memory workspace is outside the Buddy scope'
    );
  }
  return error;
}

export const BuddyOperationResultSchema = z.object({
  operation: z.string().min(1),
  data: z.unknown(),
  audit: z.unknown(),
});
export type BuddyOperationResult = z.infer<typeof BuddyOperationResultSchema>;

export class BuddyOperationsService {
  readonly context: BuddyOperationContext;
  private automationAuthorityDepth = 0;

  constructor(
    private readonly store: BuddiesStorePort,
    context: BuddyOperationContext,
    private readonly authority: BuddyPrivateExecutionAuthority = {}
  ) {
    this.context = BuddyOperationContextSchema.parse(context);
    const buddy = this.store.getBuddy(this.context.buddyId);
    if (!buddy) throw new Error('Buddy not found');
    const workspaces = this.store.listBuddyWorkspaces(this.context.buddyId) as Array<{
      id: string;
    }>;
    if (!workspaces.some((workspace) => workspace.id === this.context.workspaceId)) {
      throw new Error('Buddy does not belong to the conversation workspace');
    }
    if (this.context.buddyProjectId) this.requireScopedProject(this.context.buddyProjectId);
  }

  execute(name: BuddyOperationName, input: unknown = {}): BuddyOperationResult {
    if (this.context.allowedOperations && !this.context.allowedOperations.includes(name)) {
      throw new Error(`${name} is not allowed in this delegated conversation`);
    }
    if (this.context.coordinationRunId && this.automationAuthorityDepth === 0) {
      return coordinationStore(this.store).withBuddyRunAuthority(
        this.context.coordinationRunId,
        this.authority.automationClaimToken ?? '',
        name,
        () => {
          this.automationAuthorityDepth += 1;
          try {
            return this.execute(name, input);
          } finally {
            this.automationAuthorityDepth -= 1;
          }
        }
      );
    }
    if (this.context.automationRunId && this.automationAuthorityDepth === 0) {
      // One synchronous SQLite transaction encloses both the ownership check
      // and the operation/audit writes below. A check followed by a separate
      // transaction lets cancellation win between them. See
      // agent_notes/2026-08-24_automation-execution-ownership-design.md I2.
      return this.store.withAutomationRunAuthority(
        this.context.automationRunId,
        name,
        this.authority.automationClaimToken ?? '',
        () => {
          this.automationAuthorityDepth += 1;
          try {
            return this.execute(name, input);
          } finally {
            this.automationAuthorityDepth -= 1;
          }
        }
      );
    }
    if (
      ['buddy.get_memory', 'buddy.get_soul', 'buddy.update_memory', 'buddy.update_soul'].includes(
        name
      ) &&
      input &&
      typeof input === 'object' &&
      'knowledgeRef' in input
    ) {
      const params = z
        .object({
          knowledgeRef: BuddyDocumentRefSchema,
          targetBuddyId: z.string(),
          doc: z.enum(['working', 'long_term']).optional(),
          content: z.string().max(32000).optional(),
          baseVersion: z.number().int().nonnegative().optional(),
          reasoning: z.string().min(1).optional(),
          key: z.string().min(1).optional(),
          preview: z.boolean().optional(),
        })
        .strict()
        .parse(input);
      let ref = params.knowledgeRef;
      if (!ref.scope) {
        if (
          ref.kind === 'soul' ||
          ref.targetBuddyId !== this.context.buddyId ||
          !this.context.conversationId
        ) {
          const { knowledgeRef: _ref, ...legacy } = params;
          return this.execute(name, legacy);
        }
        ref = { ...ref, scope: knowledgeAuthority(this.store, this.context).scope! };
      }
      if (
        !ref.scope ||
        params.targetBuddyId !== ref.targetBuddyId ||
        name.endsWith('_soul') !== (ref.kind === 'soul')
      )
        throw new Error('Document operation does not match its reference');
      if (
        name.startsWith('buddy.update_') &&
        (params.content === undefined ||
          params.baseVersion === undefined ||
          !params.reasoning ||
          !params.key)
      )
        throw new Error('Document replacement requires content, revision, reason and key');
      if (name.startsWith('buddy.get_') && params.content !== undefined)
        throw new Error('Read operations cannot write documents');
      return this.result(
        name,
        scopedDocumentOperation(
          this.store,
          ref,
          params,
          knowledgeAuthority(this.store, this.context)
        ).data,
        { ref }
      );
    }
    switch (name) {
      case 'buddy.get_capabilities': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        return this.result(
          name,
          inspectTeamReadiness(this.store, this.context, parsed, (message) =>
            this.messageInAudience(message)
          ),
          parsed
        );
      }
      case 'buddy.create_buddy': {
        const { key, ...parsed } = BuddyOperationInputSchemas[name].parse(input);
        if (parsed.provider) assertBuddyProviderSupportsMcp(parsed.provider);
        return this.result(
          name,
          teamStore(this.store).createTeamBuddy(parsed, { ...teamAuthority(this.context), key }),
          { key, name: parsed.name }
        );
      }
      case 'buddy.set_relationship': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        return this.result(
          name,
          teamStore(this.store).setTeamRelationship(parsed, teamAuthority(this.context)),
          parsed
        );
      }
      case 'buddy.get_profile': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        const store = teamStore(this.store);
        if (targetBuddyId !== this.context.buddyId)
          store.requireBuddyCapability({
            ...teamAuthority(this.context),
            targetBuddyId,
            capability: 'profile.read',
          });
        return this.result(
          name,
          {
            ...store.getTeamProfile(targetBuddyId),
            execution: {
              backgroundEnabled: !!store.getCoordinationMembership(
                targetBuddyId,
                this.context.workspaceId
              )?.background_enabled,
            },
          },
          parsed
        );
      }
      case 'buddy.update_profile': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        validateProfileChange(this.store, parsed.targetBuddyId, parsed.changes);
        return this.result(
          name,
          teamStore(this.store).updateTeamProfile(parsed, teamAuthority(this.context)),
          { targetBuddyId: parsed.targetBuddyId, key: parsed.key }
        );
      }
      case 'buddy.get_memory': {
        if (knowledgeAuthority(this.store, this.context).scope?.kind !== 'owner_thread')
          throw new Error(
            'Legacy global knowledge is unavailable to team turns; use an explicitly scoped document.'
          );
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        if (targetBuddyId !== this.context.buddyId)
          return this.result(
            name,
            teamStore(this.store).readTeamDocument(
              { ...parsed, targetBuddyId },
              teamAuthority(this.context)
            ),
            parsed
          );
        const memory = this.store.readBuddyMemory(targetBuddyId);
        return this.result(
          name,
          {
            buddyId: targetBuddyId,
            doc: parsed.doc,
            content: parsed.doc === 'working' ? memory.working : memory.longTerm,
            revision: parsed.doc === 'working' ? memory.workingRevision : memory.longTermRevision,
          },
          parsed
        );
      }
      case 'buddy.get_soul': {
        if (knowledgeAuthority(this.store, this.context).scope?.kind !== 'owner_thread')
          throw new Error(
            'Legacy global knowledge is unavailable to team turns; use an explicitly scoped document.'
          );
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        if (targetBuddyId !== this.context.buddyId)
          teamStore(this.store).requireBuddyCapability({
            ...teamAuthority(this.context),
            targetBuddyId,
            capability: 'soul.read',
          });
        return this.result(name, readBuddySoul(this.store, targetBuddyId), parsed);
      }
      case 'buddy.update_soul': {
        if (knowledgeAuthority(this.store, this.context).scope?.kind !== 'owner_thread')
          throw new Error(
            'Legacy global knowledge is unavailable to team turns; use an explicitly scoped document.'
          );
        this.requireActiveBuddy();
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        if (targetBuddyId !== this.context.buddyId || isRestrictedBuddyContext(this.context)) {
          teamStore(this.store).requireBuddyCapability({
            ...teamAuthority(this.context),
            targetBuddyId,
            capability: 'soul.write',
          });
          if (!parsed.key && !parsed.preview)
            throw new Error('Team document updates require a stable key');
          return this.result(
            name,
            teamStore(this.store).updateTeamDocument(
              {
                targetBuddyId,
                doc: 'soul',
                content: parsed.content,
                baseVersion: parsed.baseVersion,
                reasoning: parsed.reasoning,
                key: parsed.key ?? 'preview',
                preview: parsed.preview,
              },
              teamAuthority(this.context)
            ),
            {
              targetBuddyId,
              key: parsed.key,
              baseVersion: parsed.baseVersion,
              reasoning: parsed.reasoning,
            }
          );
        }
        if (!this.context.conversationId)
          throw new Error('Soul editing requires a direct owner conversation or an owner grant');
        const selfUpdate = {
          content: parsed.content,
          baseVersion: parsed.baseVersion,
          reasoning: parsed.reasoning,
        };
        if (parsed.preview) {
          const head = readBuddySoul(this.store, targetBuddyId);
          return this.result(
            name,
            previewBuddyDocument(
              { buddyId: targetBuddyId, doc: 'soul', content: head.body, revision: head.revision },
              parsed.content,
              parsed.baseVersion
            ),
            { preview: true }
          );
        }
        const apply = () =>
          updateBuddySoul(
            this.store,
            this.context.buddyId,
            selfUpdate,
            `owner:conversation:${this.context.conversationId}`,
            {
              source: 'owner-directed-buddy-chat',
              buddy_id: this.context.buddyId,
              conversation_id: this.context.conversationId,
              workspace_id: this.context.workspaceId,
            }
          );
        const soul = parsed.key
          ? coordinationStore(this.store).coordinationCommand(
              {
                actor: this.context.buddyId,
                workspaceId: this.context.workspaceId,
                key: parsed.key,
                payload: { operation: name, ...parsed },
              },
              apply
            )
          : apply();
        return this.result(name, soul, {
          baseVersion: parsed.baseVersion,
          reasoning: parsed.reasoning,
        });
      }
      case 'buddy.hire_direct_report':
      case 'buddy.retire_direct_report': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        return this.result(
          name,
          executeDirectReportOperation(this.store, this.context, name, parsed),
          parsed
        );
      }

      case 'buddy.list_buddies': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        return this.result(name, listBuddyContacts(this.store, this.context, parsed), parsed);
      }
      case 'buddy.get_message': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const message = this.store.getMessage(parsed.messageId);
        if (
          !message ||
          (message.from_buddy_id !== this.context.buddyId &&
            message.to_buddy_id !== this.context.buddyId &&
            (message.visibility !== 'project' ||
              !message.buddy_project_id ||
              !coordinationStore(this.store).canReadCoordinationProject(
                this.context.buddyId,
                message.buddy_project_id
              )))
        )
          throw new Error('Message is outside participant scope');
        if (!this.messageInAudience(message))
          throw new Error('Message is unavailable in this audience');
        return this.result(
          name,
          { ...message, execution: messageExecution(this.store, message.id) },
          parsed
        );
      }
      case 'buddy.get_team_state': {
        return this.result(
          name,
          observeBuddyTeam(
            this.store,
            {
              ...this.context,
              messageInAudience: (m) => this.messageInAudience(m),
              projectInAudience: (id) => this.projectInAudience(id),
            },
            input
          ),
          input
        );
      }
      case 'buddy.checkpoint': {
        const parsed = BuddyCheckpointInputSchema.parse(input);
        if (!this.context.coordinationRunId)
          throw new Error('A checkpoint requires an active coordinated attempt');
        return this.result(
          name,
          coordinationStore(this.store).checkpointBuddyRun(this.context.coordinationRunId, {
            ...parsed,
            claimToken: this.authority.automationClaimToken,
          }),
          parsed
        );
      }
      case 'buddy.get_runs': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const store = coordinationStore(this.store);
        if (
          parsed.projectId &&
          !store.canReadCoordinationProject(this.context.buddyId, parsed.projectId)
        )
          throw new Error('Project is outside readable scope');
        if (parsed.rootMessageId) this.requireControllableRunRoot(parsed.rootMessageId);
        return this.result(
          name,
          store
            .listBuddyRuns({
              ...(!parsed.projectId && !parsed.rootMessageId
                ? { buddyId: this.context.buddyId, workspaceId: this.context.workspaceId }
                : {}),
              ...parsed,
              workspaceId: this.context.workspaceId,
              accept: (run: PrivateBuddyRun) =>
                this.projectInAudience(run.project_id) &&
                (knowledgeAuthority(this.store, this.context).scope?.kind === 'owner_thread' ||
                  run.input_kind !== 'chat'),
            })
            .map((run) => {
              const visible = BuddyRunSchema.parse(run);
              visible.policy = { allowed_operations: visible.policy.allowed_operations };
              const message = this.store.getMessage(run.root_message_id ?? run.input_id);
              const readable = message
                ? this.messageInAudience(message) &&
                  (message.from_buddy_id === this.context.buddyId ||
                    message.to_buddy_id === this.context.buddyId ||
                    message.visibility === 'project')
                : run.buddy_id === this.context.buddyId &&
                  knowledgeAuthority(this.store, this.context).scope?.kind === 'owner_thread';
              return {
                ...visible,
                outcome: readable && run.buddy_id === this.context.buddyId ? visible.outcome : null,
                error: readable ? visible.error : null,
                execution:
                  readable && run.input_kind === 'message_request'
                    ? messageExecution(this.store, run.input_id)
                    : null,
              };
            }),
          parsed
        );
      }
      case 'buddy.stop': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        if (Number(!!parsed.runId) + Number(!!parsed.rootMessageId) !== 1)
          throw new Error('Choose one run or root');
        const store = coordinationStore(this.store);
        if (parsed.rootMessageId) {
          this.requireControllableRunRoot(parsed.rootMessageId);
          return this.result(
            name,
            store.stopBuddyMessageRoot(parsed.rootMessageId).map((r) => BuddyRunSchema.parse(r)),
            parsed
          );
        }
        const run = store.getBuddyRun(parsed.runId!);
        if (!run) throw new Error('Run not found');
        if (run.buddy_id !== this.context.buddyId)
          this.requireControllableRunRoot(run.root_message_id);
        return this.result(name, BuddyRunSchema.parse(store.cancelBuddyRun(run.id)), parsed);
      }
      case 'buddy.retry_run': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const store = coordinationStore(this.store);
        const run = store.getBuddyRun(parsed.runId);
        if (!run) throw new Error('Run not found');
        const origin = run.input_kind === 'failure_notice' ? store.getBuddyRun(run.input_id) : run;
        const message = origin ? store.getMessage(origin.input_id) : null;
        if (
          run.workspace_id !== this.context.workspaceId ||
          !message ||
          !this.messageInAudience(message) ||
          !this.projectInAudience(run.project_id)
        )
          throw new Error('Recovery is outside the current audience');
        const recovery = store.getBuddyRunRecovery(run.id, this.context.buddyId);
        if (!recovery.controllerBuddyIds.includes(this.context.buddyId))
          throw new Error(
            'Only the original input sender or root requester can recover this branch'
          );
        return this.result(
          name,
          BuddyRunSchema.parse(
            store.retryBuddyRun(run.id, {
              key: parsed.key,
              actor: this.context.buddyId,
              reason: parsed.reason,
              checkpointId: parsed.checkpointId,
            })
          ),
          parsed
        );
      }
      case 'buddy.get_current_work': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        if (parsed.workspaceId || parsed.projectId || parsed.buddyId) {
          const workspaceId = parsed.workspaceId ?? this.context.workspaceId;
          const store = coordinationStore(this.store);
          if (!store.getCoordinationMembership(this.context.buddyId, workspaceId))
            throw new Error('Workspace membership is required');
          const work = this.store.listBuddyOwnedProjects({
            workspace: workspaceId,
            includeClosed: parsed.includeClosed,
          }) as Array<{ id: string; buddy_id: string }>;
          return this.result(
            name,
            work
              .filter(
                (p) =>
                  (!parsed.projectId || p.id === parsed.projectId) &&
                  (!(parsed.targetBuddyId ?? parsed.buddyId) ||
                    p.buddy_id === (parsed.targetBuddyId ?? parsed.buddyId)) &&
                  store.canReadCoordinationProject(this.context.buddyId, p.id) &&
                  this.projectInAudience(p.id)
              )
              .slice(parsed.offset, parsed.offset + parsed.limit),
            parsed
          );
        }
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        if (
          !coordinationStore(this.store).getCoordinationMembership(
            targetBuddyId,
            this.context.workspaceId
          )
        )
          throw new Error('Target Buddy is outside the conversation workspace');
        if (
          !coordinationStore(this.store).getCoordinationMembership(
            this.context.buddyId,
            this.context.workspaceId
          )?.read_all_work
        )
          this.requireReadableBuddy(targetBuddyId);
        return this.result(
          name,
          this.store
            .listBuddyOwnedProjects({
              buddy: targetBuddyId,
              workspace: this.context.workspaceId,
              includeClosed: parsed.includeClosed,
            })
            .filter((p) => this.projectInAudience((p as { id: string }).id))
            .slice(parsed.offset, parsed.offset + parsed.limit),
          parsed
        );
      }
      case 'buddy.get_inbox': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const relationships = this.store.listBuddyRelationships(this.context.buddyId) as Array<{
          from_buddy_id: string;
          to_buddy_id: string;
          kind: string;
        }>;
        const managedBuddyIds = new Set([this.context.buddyId]);
        for (const relationship of relationships) {
          if (
            relationship.from_buddy_id === this.context.buddyId &&
            relationship.kind === 'manager'
          ) {
            managedBuddyIds.add(relationship.to_buddy_id);
          }
          if (
            relationship.to_buddy_id === this.context.buddyId &&
            relationship.kind === 'reports_to'
          ) {
            managedBuddyIds.add(relationship.from_buddy_id);
          }
        }
        const delegations = this.store.listDelegations({
          buddy: this.context.buddyId,
          workspace: this.context.workspaceId,
        });
        const reviews = this.store
          .listReviews({
            workspace: this.context.workspaceId,
          })
          .filter(
            (review) =>
              review.reviewer_buddy_id === this.context.buddyId ||
              (managedBuddyIds.has(review.reviewer_buddy_id) &&
                managedBuddyIds.has(review.subject_buddy_id))
          );
        const automations = [...managedBuddyIds].flatMap((buddyId) =>
          this.store
            .listAutomations({ buddy: buddyId })
            .filter((automation) => automation.workspace_id === this.context.workspaceId)
        );
        const delegationOutcomes = delegations
          .filter(
            (delegation) =>
              delegation.from_buddy_id === this.context.buddyId &&
              ['complete', 'failed', 'cancelled'].includes(delegation.status)
          )
          .slice(0, 20);
        const completionAudits = this.store
          .listAuditEvents({ workspace: this.context.workspaceId, limit: 200 })
          .filter((event) => event.operation === 'buddy.complete_assignment');
        return this.result(
          name,
          {
            messages: this.store
              .listMessages({
                buddy: this.context.buddyId,
                workspace: this.context.workspaceId,
                limit: parsed.limit,
                offset: parsed.offset,
                accept: (message) => this.messageInAudience(message),
              })
              .map((message) => ({
                ...message,
                execution: messageExecution(this.store, message.id),
              })),
            assignedDelegations: delegations.filter(
              (delegation) =>
                delegation.to_buddy_id === this.context.buddyId &&
                (delegation.status === 'pending' || delegation.status === 'active')
            ),
            delegatedWork: delegations.filter(
              (delegation) =>
                delegation.from_buddy_id === this.context.buddyId &&
                (delegation.status === 'pending' || delegation.status === 'active')
            ),
            delegationOutcomes: delegationOutcomes.map((delegation) => ({
              ...delegation,
              completionAudit:
                completionAudits.find((event) => event.payload.delegationId === delegation.id) ??
                null,
            })),
            assignedReviews: reviews.filter(
              (review) =>
                review.reviewer_buddy_id === this.context.buddyId &&
                review.status !== 'complete' &&
                review.status !== 'cancelled'
            ),
            teamReviewQueue: reviews.filter(
              (review) => review.status !== 'complete' && review.status !== 'cancelled'
            ),
            reviewOutcomes: reviews.filter((review) => review.status === 'complete').slice(0, 20),
            pendingApprovals: this.store
              .listApprovalRequests({
                workspace: this.context.workspaceId,
                status: 'pending',
              })
              .filter((approval) => managedBuddyIds.has(approval.buddy_id)),
            blockedProjects: [...managedBuddyIds].flatMap((buddyId) =>
              this.store
                .listBuddyOwnedProjects({
                  buddy: buddyId,
                  workspace: this.context.workspaceId,
                  includeClosed: false,
                })
                .filter(
                  (project): project is Record<string, unknown> =>
                    typeof project === 'object' &&
                    project !== null &&
                    (project as { status?: unknown }).status === 'blocked'
                )
            ),
            failedAutomations: automations.flatMap((automation) => {
              const latest = this.store.listAutomationRuns(automation.id, { limit: 1 })[0];
              if (latest?.status !== 'failed') return [];
              return [{ automation, latestRun: publicAutomationRun(latest) }];
            }),
          },
          parsed
        );
      }
      case 'buddy.get_automations': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        this.requireReadableBuddy(targetBuddyId);
        return this.result(
          name,
          this.store
            .listAutomations({ buddy: targetBuddyId })
            .filter((automation) => automation.workspace_id === this.context.workspaceId),
          parsed
        );
      }
      case 'buddy.set_automation': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        if (parsed.action === 'enable' || isRestrictedBuddyContext(this.context)) {
          const targetBuddyId =
            parsed.action === 'create'
              ? (parsed.targetBuddyId ?? this.context.buddyId)
              : this.store.getAutomation(parsed.automationId)?.buddy_id;
          if (!targetBuddyId) throw new Error('Automation not found');
          teamStore(this.store).requireBuddyCapability({
            ...teamAuthority(this.context),
            targetBuddyId,
            capability: 'schedule.manage',
          });
        }
        if (parsed.key && this.commandDepth === 0)
          return coordinationStore(this.store).coordinationCommand(
            {
              actor: this.context.buddyId,
              workspaceId: this.context.workspaceId,
              key: parsed.key,
              payload: parsed,
            },
            () => {
              this.commandDepth++;
              try {
                return this.execute(name, parsed);
              } finally {
                this.commandDepth--;
              }
            }
          );
        if (parsed.action === 'create') {
          const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
          if (
            !teamStore(this.store).buddyCapability({
              ...teamAuthority(this.context),
              targetBuddyId,
              capability: 'schedule.manage',
            }).allowed
          )
            this.requireManageableBuddy(targetBuddyId);
          const conversationId =
            parsed.conversationId ?? (parsed.prompt ? this.context.conversationId : undefined);
          if (parsed.prompt && !conversationId)
            throw new Error('Thread schedule requires a destination conversation');
          if (conversationId) {
            const links = this.store.listConversationLinks(targetBuddyId) as Array<{
              unleashd_conversation_id?: string;
              workspace_id?: string;
            }>;
            if (
              !links.some(
                (link) =>
                  link.unleashd_conversation_id === conversationId &&
                  link.workspace_id === this.context.workspaceId
              )
            )
              throw new Error('Schedule destination is outside target Buddy scope');
          }
          const jobPayload = parsed.prompt
            ? { prompt: parsed.prompt, conversationId }
            : parsed.jobPayload;
          if (!jobPayload) throw new Error('A schedule prompt or jobPayload is required');
          const project = parsed.projectId
            ? this.requireAutomationProject(parsed.projectId, targetBuddyId)
            : undefined;
          // Schedule validation precedes the first durable write. Creating a
          // disabled placeholder and repairing it afterward leaves malformed
          // definitions behind when validation throws. See invariant I10 in
          // agent_notes/2026-08-24_automation-execution-ownership-design.md.
          const nextRunAt = nextAutomationRunAt(
            {
              schedule_kind: parsed.scheduleKind,
              schedule_expression: parsed.scheduleExpression,
              timezone: parsed.timezone,
            } as BuddyAutomation,
            new Date()
          );
          const automation = this.store.createAutomation({
            buddy: targetBuddyId,
            workspace: this.context.workspaceId,
            project: project?.id,
            name: parsed.name,
            scheduleKind: parsed.scheduleKind,
            scheduleExpression: parsed.scheduleExpression,
            timezone: parsed.timezone,
            jobKind: parsed.jobKind,
            jobPayload,
            policy: parsed.policy,
            enabled: false,
            nextRunAt,
          });
          return this.result(
            name,
            automation,
            {
              ...parsed,
              targetBuddyId,
              enabled: false,
              note: 'Created disabled; owner review is required before enabling.',
            },
            project?.buddy_id === this.context.buddyId ? project.id : undefined
          );
        }

        const automation = this.store.getAutomation(parsed.automationId);
        if (!automation) throw new Error('Automation not found');
        if (
          !teamStore(this.store).buddyCapability({
            ...teamAuthority(this.context),
            targetBuddyId: automation.buddy_id,
            capability: 'schedule.manage',
          }).allowed
        )
          this.requireManageableBuddy(automation.buddy_id);
        if (automation.workspace_id !== this.context.workspaceId) {
          throw new Error('Automation is outside the conversation workspace');
        }
        if (
          (parsed.action === 'update' || parsed.action === 'enable') &&
          parsed.baseRevision &&
          parsed.baseRevision !== automation.updated_at
        )
          throw new Error(`Schedule revision conflict: current ${automation.updated_at}`);
        if (parsed.action === 'enable') {
          const nextRunAt = nextAutomationRunAt(automation, new Date());
          return this.result(
            name,
            this.store.updateAutomation(automation.id, { enabled: true, nextRunAt }),
            parsed
          );
        }
        if (parsed.action === 'disable') {
          const disabled = this.store.updateAutomation(automation.id, { enabled: false });
          return this.result(name, disabled, parsed);
        }
        if (automation.enabled) {
          throw new Error(
            'Enabled automations must be disabled before an employee can change their definition'
          );
        }
        const { action: _action, automationId: _automationId, ...changes } = parsed;
        let nextRunAt: string | undefined;
        if (
          parsed.scheduleKind !== undefined ||
          parsed.scheduleExpression !== undefined ||
          parsed.timezone !== undefined
        ) {
          nextRunAt = nextAutomationRunAt(
            {
              ...automation,
              schedule_kind: parsed.scheduleKind ?? automation.schedule_kind,
              schedule_expression: parsed.scheduleExpression ?? automation.schedule_expression,
              timezone: parsed.timezone ?? automation.timezone,
            },
            new Date()
          );
        }
        const updated = this.store.updateAutomation(automation.id, {
          ...changes,
          ...(nextRunAt ? { nextRunAt } : {}),
        });
        return this.result(name, updated, parsed);
      }
      case 'buddy.new_project': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        if (this.context.coordinationRunId && !parsed.key)
          throw new Error('Creating work requires a stable command key');
        if (parsed.key) {
          const project = coordinationStore(this.store).createCoordinatedProject(
            { ...parsed, workspaceId: parsed.workspaceId ?? this.context.workspaceId },
            { actor: this.context.buddyId, key: parsed.key }
          );
          return this.result(name, project, parsed);
        }
        if (parsed.ownerId || parsed.workspaceId || parsed.parentProjectId)
          throw new Error('Assigned projects require a command key');
        const project = this.store.newProject({
          ...parsed,
          buddy: this.context.buddyId,
          workspace: this.context.workspaceId,
        });
        return this.result(name, project, parsed);
      }
      case 'buddy.update_project': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        if (this.context.coordinationRunId && !parsed.key)
          throw new Error('Updating work requires a stable command key and baseRevision');
        const projectId = parsed.projectId ?? this.context.buddyProjectId ?? undefined;
        if (!projectId)
          throw new Error('projectId is required outside a project-scoped conversation');
        if (parsed.key) {
          const project = coordinationStore(this.store).updateCoordinatedProject(
            projectId,
            parsed,
            {
              actor: this.context.buddyId,
              key: parsed.key,
              runId: this.context.coordinationRunId ?? undefined,
            }
          );
          return this.result(name, project, parsed);
        }
        if (parsed.approvalId || parsed.baseRevision || parsed.ownerId || parsed.executionState)
          throw new Error('Coordinated updates require a command key and baseRevision');
        this.requireScopedProject(projectId);
        if (parsed.status === 'done') {
          if (!parsed.evidence?.length)
            throw new Error('evidence is required to complete a project');
        }
        const { projectId: _projectId, evidence: _evidence, ...changes } = parsed;
        const project = this.store.updateProject(projectId, changes);
        return this.result(name, project, parsed);
      }
      case 'buddy.update_memory': {
        if (knowledgeAuthority(this.store, this.context).scope?.kind !== 'owner_thread')
          throw new Error(
            'Legacy global knowledge is unavailable to team turns; use an explicitly scoped document.'
          );
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        this.requireActiveBuddy();
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        if (targetBuddyId !== this.context.buddyId) {
          if (!parsed.key && !parsed.preview)
            throw new Error('Team document updates require a stable key');
          return this.result(
            name,
            teamStore(this.store).updateTeamDocument(
              { ...parsed, targetBuddyId, key: parsed.key ?? 'preview' },
              teamAuthority(this.context)
            ),
            {
              targetBuddyId,
              doc: parsed.doc,
              key: parsed.key,
              baseVersion: parsed.baseVersion,
              reasoning: parsed.reasoning,
            }
          );
        }
        if (parsed.preview) {
          const memory = this.store.readBuddyMemory(targetBuddyId);
          return this.result(
            name,
            previewBuddyDocument(
              {
                buddyId: targetBuddyId,
                doc: parsed.doc,
                content: parsed.doc === 'working' ? memory.working : memory.longTerm,
                revision:
                  parsed.doc === 'working' ? memory.workingRevision : memory.longTermRevision,
              },
              parsed.content,
              parsed.baseVersion
            ),
            { preview: true, doc: parsed.doc }
          );
        }
        if (!this.store.updateMemory) {
          throw new BuddyMemoryOperationError(
            'MEMORY_CAPABILITY_MISSING',
            'The installed Buddies package does not expose memory-v2 update_memory'
          );
        }
        try {
          const apply = () =>
            this.store.updateMemory!(this.context.buddyId, {
              documentKind: parsed.doc,
              content: parsed.content,
              reasoning: parsed.reasoning,
              baseVersion: parsed.baseVersion,
              authorKind: 'buddy',
              requestedBy: null,
              provenance: {
                workspace_id: this.context.workspaceId,
                conversation_id: this.context.conversationId ?? null,
                automation_run_id: this.context.automationRunId ?? null,
              },
            });
          const memory = parsed.key
            ? coordinationStore(this.store).coordinationCommand(
                {
                  actor: this.context.buddyId,
                  workspaceId: this.context.workspaceId,
                  key: parsed.key,
                  payload: { operation: name, ...parsed },
                },
                apply
              )
            : apply();
          return this.result(
            name,
            memory,
            { doc: parsed.doc, baseVersion: parsed.baseVersion, reasoning: parsed.reasoning },
            this.context.buddyProjectId ?? undefined
          );
        } catch (error) {
          throw normalizeMemoryError(error);
        }
      }
      case 'buddy.remember_note': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const audience = knowledgeAuthority(this.store, this.context);
        if (this.context.conversationId || audience.scope?.kind !== 'owner_thread')
          return this.result(name, scopedNote(this.store, audience, parsed), {
            scope: audience.scope,
          });
        if (isRestrictedBuddyContext(this.context) && parsed.scope && parsed.scope !== 'current')
          throw new Error('This execution can access notes only in its current workspace');
        this.requireActiveBuddy();
        if (!this.store.rememberNote) {
          throw new BuddyMemoryOperationError(
            'MEMORY_CAPABILITY_MISSING',
            'The installed Buddies package does not expose memory-v2 remember-note'
          );
        }
        try {
          const note = this.store.rememberNote(this.context.buddyId, {
            topic: parsed.topic,
            kind: parsed.kind,
            body: parsed.body,
            evidence: parsed.evidence,
            workspace: this.context.workspaceId,
            scope: parsed.scope ?? 'current',
          });
          return this.result(name, note, parsed, this.context.buddyProjectId ?? undefined);
        } catch (error) {
          throw normalizeMemoryError(error);
        }
      }
      case 'buddy.recall': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const audience = knowledgeAuthority(this.store, this.context);
        if (this.context.conversationId || audience.scope?.kind !== 'owner_thread')
          return this.result(name, recallKnowledge(this.store, audience, parsed), {
            scope: audience.scope,
          });
        if (isRestrictedBuddyContext(this.context) && parsed.scope && parsed.scope !== 'current')
          throw new Error('This execution can access notes only in its current workspace');
        if (!this.store.recall) {
          throw new BuddyMemoryOperationError(
            'MEMORY_CAPABILITY_MISSING',
            'The installed Buddies package does not expose memory-v2 recall'
          );
        }
        try {
          const result = this.store.recall(this.context.buddyId, {
            pattern: parsed.regex ? parsed.pattern : escapeRegExp(parsed.pattern),
            workspace: this.context.workspaceId,
            scope: parsed.scope ?? (isRestrictedBuddyContext(this.context) ? 'current' : 'all'),
            since: parsed.since,
            limit: parsed.limit ?? 20,
          });
          // The package currently returns the matcher it received. Restore the
          // user-facing literal so escaping remains an implementation detail.
          return this.result(name, { ...result, pattern: parsed.pattern }, parsed);
        } catch (error) {
          throw normalizeMemoryError(error);
        }
      }
      case 'buddy.send': {
        throw new Error('buddy.send requires the owning server dispatch capability');
      }
      case 'buddy.reply': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const message = this.store.getMessage(parsed.messageId);
        if (!message || message.workspace_id !== this.context.workspaceId)
          throw new Error('Message is outside the conversation workspace');
        if (message.to_buddy_id !== this.context.buddyId || !this.messageInAudience(message))
          throw new Error('Message reply is outside this Buddy audience');
        const replied = this.store.replyMessage(parsed.messageId, {
          buddy: this.context.buddyId,
          conversationId: message.child_conversation_id ?? this.context.conversationId ?? '',
          outcome: parsed.outcome,
          body: parsed.body,
          evidence: parsed.evidence,
        });
        return BuddyOperationResultSchema.parse({
          operation: name,
          data: replied,
          audit: { recordedAtomicallyByStore: true },
        });
      }
      case 'buddy.delegate': {
        const parsed = this.prepareDelegation(input);
        const delegation = this.store.createDelegation({
          fromBuddy: this.context.buddyId,
          toBuddy: parsed.toBuddyId,
          workspace: this.context.workspaceId,
          project: parsed.projectId,
          purpose: parsed.purpose,
          parentConversationId: parsed.parentConversationId,
        });
        return this.recordDelegationDispatch(parsed, delegation);
      }
      case 'buddy.request_review': {
        const parsed = this.prepareReviewRequest(input);
        const review = this.store.createReview({
          reviewer: parsed.reviewerBuddyId,
          subject: parsed.subjectBuddyId,
          workspace: this.context.workspaceId,
          project: parsed.projectId,
          evidence: parsed.evidence,
        });
        return this.recordReviewDispatch(parsed, review);
      }
      case 'buddy.complete_delegation': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const delegation = this.store.getDelegation(parsed.delegationId);
        if (!delegation) throw new Error('Delegation not found');
        if (
          delegation.from_buddy_id !== this.context.buddyId ||
          delegation.workspace_id !== this.context.workspaceId
        ) {
          throw new Error('Delegation is outside the conversation scope');
        }
        const updated = this.store.updateDelegation(delegation.id, {
          status: parsed.status,
          outcome: parsed.outcome,
        });
        return this.result(name, updated, parsed, delegation.buddy_project_id ?? undefined);
      }
      case 'buddy.complete_assignment': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const candidates = parsed.delegationId
          ? [this.store.getDelegation(parsed.delegationId)].filter(
              (delegation): delegation is NonNullable<typeof delegation> => delegation !== null
            )
          : this.store
              .listDelegations({
                buddy: this.context.buddyId,
                workspace: this.context.workspaceId,
              })
              .filter(
                (delegation) =>
                  delegation.to_buddy_id === this.context.buddyId &&
                  delegation.child_conversation_id === this.context.conversationId &&
                  !['complete', 'failed', 'cancelled'].includes(delegation.status)
              );
        if (candidates.length !== 1) {
          throw new Error(
            candidates.length === 0
              ? 'No active delegation is bound to this Buddy conversation'
              : 'More than one active delegation is bound to this Buddy conversation'
          );
        }
        const delegation = candidates[0];
        if (
          delegation.to_buddy_id !== this.context.buddyId ||
          delegation.workspace_id !== this.context.workspaceId ||
          delegation.child_conversation_id !== this.context.conversationId
        ) {
          throw new Error('Delegation assignment is outside the conversation scope');
        }
        if (
          this.context.buddyProjectId &&
          delegation.buddy_project_id !== this.context.buddyProjectId
        ) {
          throw new Error('Delegation assignment is outside the selected project');
        }
        const updated = this.store.updateDelegation(delegation.id, {
          status: parsed.status,
          outcome: parsed.outcome,
        });
        return this.result(
          name,
          updated,
          {
            ...parsed,
            delegationId: delegation.id,
          },
          delegation.buddy_project_id ?? undefined,
          true
        );
      }
      case 'buddy.submit_review': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const review = this.store.getReview(parsed.reviewId);
        if (!review) throw new Error('Review not found');
        if (
          review.reviewer_buddy_id !== this.context.buddyId ||
          review.workspace_id !== this.context.workspaceId
        ) {
          throw new Error('Review is outside the conversation scope');
        }
        const evidence = [
          ...parsed.evidence,
          ...parsed.requiredActions.map((action) => ({
            kind: 'required_action',
            reference: review.buddy_project_id ?? review.subject_buddy_id,
            observation: action,
          })),
        ];
        const updated = this.store.updateReview(review.id, {
          status: 'complete',
          verdict: parsed.verdict,
          score: parsed.score,
          summary: parsed.summary,
          evidence,
        });
        return this.result(name, updated, parsed, review.buddy_project_id ?? undefined, true);
      }
      case 'buddy.request_human_approval': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const project = parsed.projectId ?? this.context.buddyProjectId ?? undefined;
        if (project) this.requireScopedProject(project);
        const approval = this.store.createApprovalRequest({
          buddy: this.context.buddyId,
          workspace: this.context.workspaceId,
          project,
          automationRun: this.context.automationRunId ?? undefined,
          conversationId: this.context.conversationId ?? undefined,
          action: parsed.action,
          reason: parsed.reason,
          risk: parsed.risk,
        });
        return BuddyOperationResultSchema.parse({
          operation: name,
          data: approval,
          audit: { recordedAtomicallyByStore: true },
        });
      }
    }
  }

  prepareMessage(input: unknown): PreparedBuddyMessage {
    if (this.context.allowedOperations && !this.context.allowedOperations.includes('buddy.send')) {
      throw new Error('buddy.send is not allowed in this conversation');
    }
    if (this.context.automationRunId)
      this.store.assertAutomationOperationAllowed(
        this.context.automationRunId,
        'buddy.send',
        this.authority.automationClaimToken ?? ''
      );
    const { teamConfiguration, ...parsed } = BuddyOperationInputSchemas['buddy.send'].parse(input);
    if (teamConfiguration) {
      if (
        parsed.to !== 'owner' ||
        !parsed.key ||
        parsed.execution ||
        parsed.approval ||
        parsed.visibility === 'project'
      )
        throw new Error(
          'A team configuration proposal requires a stable key and a participant-only owner message; it cannot launch work or combine an approval.'
        );
      const configuration = teamConfiguration.configuration;
      if (
        configuration.workspaceId !== this.context.workspaceId ||
        (parsed.workspaceId && parsed.workspaceId !== this.context.workspaceId)
      )
        throw new Error('Team configuration proposals must use the current workspace.');
      const refs = [
        ...(configuration.memberships ?? []).map((entry) => entry.buddy),
        ...(configuration.relationships ?? []).flatMap((entry) => [entry.from, entry.to]),
        ...(configuration.access ?? []).flatMap((entry) => [entry.grantee, entry.target]),
        ...(configuration.staffing ?? []).map((entry) => entry.grantee),
      ];
      const creations = new Set((configuration.create ?? []).map((entry) => entry.creationKey));
      for (const ref of refs) {
        if (
          'id' in ref &&
          !coordinationStore(this.store).getCoordinationMembership(ref.id, this.context.workspaceId)
        )
          throw new Error('Proposal contains an identity unavailable in the current workspace.');
        if ('creationKey' in ref && !creations.has(ref.creationKey))
          throw new Error('Proposal references an undeclared creation key.');
      }
      if (parsed.body.includes('<!--buddy_team_proposal:'))
        throw new Error(
          'A structured proposal cannot be combined with an embedded proposal marker.'
        );
      parsed.body = formatTeamConfigurationProposal(parsed.body, teamConfiguration);
      if (parsed.body.length > 32000 || Buffer.byteLength(parsed.body, 'utf8') > 32000)
        throw new Error(
          'Encoded team proposal exceeds the 32 KiB message limit; use smaller scoped proposals.'
        );
    }
    if (parsed.execution) {
      teamStore(this.store);
      if (
        !parsed.key ||
        !parsed.projectId ||
        parsed.to === 'owner' ||
        parsed.continueFrom ||
        parsed.inReplyTo ||
        parsed.wait ||
        !parsed.expectsReply
      )
        throw new Error(
          'Background execution requires a stable key, recipient-owned project, fresh route and final reply; it cannot wait synchronously.'
        );
    }
    // Keep explicit null through MCP -> control server preparation. It starts a
    // new work scope while the durable message retains the source project.
    const projectId =
      parsed.projectId === undefined
        ? parsed.expectsReply
          ? (this.context.buddyProjectId ?? undefined)
          : null
        : parsed.projectId;
    if (parsed.key) {
      const store = coordinationStore(this.store);
      const workspace = parsed.workspaceId ?? this.context.workspaceId;
      if (!store.getCoordinationMembership(this.context.buddyId, workspace)?.dispatch)
        throw new Error('Workspace dispatch is not granted');
      if (
        projectId &&
        (!this.projectInAudience(projectId) ||
          (parsed.expectsReply
            ? !store.canManageCoordinationProject(this.context.buddyId, projectId)
            : !store.canReadCoordinationProject(this.context.buddyId, projectId) ||
              (parsed.to !== 'owner' && !store.canReadCoordinationProject(parsed.to, projectId))))
      )
        throw new Error('Project is outside sender or recipient context scope');
      return {
        ...parsed,
        projectId,
        parentConversationId: this.context.conversationId ?? undefined,
      };
    }
    if (
      parsed.approval ||
      parsed.execution ||
      parsed.workspaceId ||
      parsed.continueFrom ||
      parsed.inReplyTo ||
      parsed.notBefore ||
      !parsed.expectsReply
    )
      throw new Error('Coordination commands require an idempotency key');
    if (projectId) this.requireScopedProject(projectId);
    if (parsed.to !== 'owner') {
      const recipient = this.store.getBuddy(parsed.to);
      if (!recipient || recipient.status !== 'active')
        throw new Error('Recipient Buddy is not active');
      const memberships = this.store.listBuddyWorkspaces(parsed.to) as Array<{ id: string }>;
      if (!memberships.some((workspace) => workspace.id === this.context.workspaceId))
        throw new Error('Recipient Buddy is outside the conversation workspace');
    }
    return { ...parsed, projectId, parentConversationId: this.context.conversationId ?? undefined };
  }

  prepareDelegation(input: unknown): PreparedBuddyDelegation {
    const parsed = BuddyOperationInputSchemas['buddy.delegate'].parse(input);
    const allowedOperations = resolveDelegatedBuddyOperations(parsed.allowedOperations);
    this.requireManageableBuddy(parsed.toBuddyId);
    // A delegation may be attached to the delegating employee's project for
    // supervision, but ownership is not transferred to the report.
    const projectId = parsed.projectId ?? this.context.buddyProjectId ?? undefined;
    if (projectId) this.requireScopedProject(projectId);
    return {
      ...parsed,
      allowedOperations,
      projectId,
      parentConversationId: parsed.parentConversationId ?? this.context.conversationId ?? undefined,
    };
  }

  recordDelegationDispatch(input: PreparedBuddyDelegation, data: unknown) {
    return this.result('buddy.delegate', data, input, input.projectId);
  }

  prepareReviewRequest(input: unknown): PreparedBuddyReviewRequest {
    const parsed = BuddyOperationInputSchemas['buddy.request_review'].parse(input);
    this.requireManageableBuddy(parsed.reviewerBuddyId);
    this.requireManageableBuddy(parsed.subjectBuddyId);
    if (parsed.reviewerBuddyId === parsed.subjectBuddyId) {
      throw new Error('A Buddy cannot review itself');
    }
    if (parsed.projectId) {
      const project = this.store.getBuddyProject(parsed.projectId);
      if (!project) throw new Error('Buddy project not found');
      if (
        project.buddy_id !== parsed.subjectBuddyId ||
        project.workspace_id !== this.context.workspaceId
      ) {
        throw new Error('Review project is outside the reviewed employee scope');
      }
    }
    return {
      ...parsed,
      parentConversationId: parsed.parentConversationId ?? this.context.conversationId ?? undefined,
    };
  }

  recordReviewDispatch(input: PreparedBuddyReviewRequest, data: unknown) {
    return this.result('buddy.request_review', data, input, input.projectId, true);
  }

  private commandDepth = 0;

  private requireControllableRunRoot(rootId: string | null) {
    const root = rootId ? this.store.getMessage(rootId) : null;
    if (!root || root.from_buddy_id !== this.context.buddyId)
      throw new Error('Only the original requester can control this chain');
    if (
      root.buddy_project_id &&
      !coordinationStore(this.store).canManageCoordinationProject(
        this.context.buddyId,
        root.buddy_project_id
      )
    )
      throw new Error('Project supervision is required');
  }

  private requireScopedProject(projectId: string) {
    const project = this.store.getBuddyProject(projectId);
    if (!project) throw new Error('Buddy project not found');
    if (
      project.buddy_id !== this.context.buddyId ||
      project.workspace_id !== this.context.workspaceId
    ) {
      throw new Error('Buddy project is outside the conversation scope');
    }
    return project;
  }

  private requireActiveBuddy() {
    const buddy = this.store.getBuddy(this.context.buddyId);
    if (!buddy) throw new Error('Buddy not found');
    if (buddy.status !== 'active') {
      throw new BuddyMemoryOperationError(
        'BUDDY_INACTIVE',
        `Buddy is ${buddy.status}; memory writes are available only to active Buddies`,
        { status: buddy.status }
      );
    }
    return buddy;
  }

  private requireManageableBuddy(targetBuddyId: string) {
    const target = this.store.getBuddy(targetBuddyId);
    if (!target) throw new Error('Target Buddy not found');
    const targetWorkspaces = this.store.listBuddyWorkspaces(targetBuddyId) as Array<{ id: string }>;
    if (!targetWorkspaces.some((workspace) => workspace.id === this.context.workspaceId)) {
      throw new Error('Target Buddy does not belong to the conversation workspace');
    }
    if (targetBuddyId === this.context.buddyId) return target;
    const relationships = this.store.listBuddyRelationships(this.context.buddyId) as Array<{
      from_buddy_id: string;
      to_buddy_id: string;
      kind: string;
    }>;
    const isDirectReport = relationships.some(
      (relationship) =>
        (relationship.from_buddy_id === this.context.buddyId &&
          relationship.to_buddy_id === targetBuddyId &&
          relationship.kind === 'manager') ||
        (relationship.from_buddy_id === targetBuddyId &&
          relationship.to_buddy_id === this.context.buddyId &&
          relationship.kind === 'reports_to')
    );
    if (!isDirectReport) {
      throw new Error('Target Buddy is not a direct report of this employee');
    }
    return target;
  }

  private requireReadableBuddy(targetBuddyId: string) {
    try {
      return this.requireManageableBuddy(targetBuddyId);
    } catch (error) {
      const relationships = this.store.listBuddyRelationships(this.context.buddyId) as Array<{
        from_buddy_id: string;
        to_buddy_id: string;
        kind: string;
      }>;
      const canReview = relationships.some(
        (relationship) =>
          relationship.from_buddy_id === this.context.buddyId &&
          relationship.to_buddy_id === targetBuddyId &&
          relationship.kind === 'reviews'
      );
      if (!canReview) throw error;
      const target = this.store.getBuddy(targetBuddyId);
      if (!target) throw new Error('Target Buddy not found');
      const targetWorkspaces = this.store.listBuddyWorkspaces(targetBuddyId) as Array<{
        id: string;
      }>;
      if (!targetWorkspaces.some((workspace) => workspace.id === this.context.workspaceId)) {
        throw new Error('Target Buddy does not belong to the conversation workspace');
      }
      return target;
    }
  }

  private requireAutomationProject(projectId: string, targetBuddyId: string) {
    const project = this.store.getBuddyProject(projectId);
    if (!project) throw new Error('Buddy project not found');
    if (project.buddy_id !== targetBuddyId || project.workspace_id !== this.context.workspaceId) {
      throw new Error('Automation project is outside the target employee scope');
    }
    return project;
  }

  private projectInAudience(projectId: string | null | undefined): boolean {
    const scope = knowledgeAuthority(this.store, this.context).scope;
    if (scope?.kind !== 'project') return true;
    const visited = new Set<string>();
    let id = projectId;
    while (id && !visited.has(id)) {
      if (id === scope.projectId) return true;
      visited.add(id);
      id = (
        coordinationStore(this.store).getBuddyProject(id) as {
          parent_project_id?: string | null;
        } | null
      )?.parent_project_id;
    }
    return false;
  }
  private messageInAudience(message: {
    id: string;
    buddy_project_id?: string | null;
    root_message_id?: string | null;
    workspace_id?: string;
    visibility?: string;
  }): boolean {
    const authority = knowledgeAuthority(this.store, this.context);
    if (authority.scope?.kind === 'owner_thread') return true;
    if (message.workspace_id !== this.context.workspaceId) return false;
    const run = this.context.coordinationRunId
      ? coordinationStore(this.store).getBuddyRun(this.context.coordinationRunId)
      : null;
    const source = run ? this.store.getMessage(run.root_message_id ?? run.input_id) : null;
    if (
      source &&
      (message.id === source.id ||
        (message.root_message_id ?? message.id) === (source.root_message_id ?? source.id))
    )
      return true;
    return (
      message.visibility === 'project' &&
      !!message.buddy_project_id &&
      this.projectInAudience(message.buddy_project_id)
    );
  }
  private result(
    operation: BuddyOperationName,
    data: unknown,
    payload: unknown,
    project?: string,
    allowExternalProject = false
  ) {
    if (project && !allowExternalProject) this.requireScopedProject(project);
    const audience = knowledgeAuthority(this.store, this.context).scope;
    if (audience?.kind !== 'owner_thread') {
      if (operation === 'buddy.get_inbox') {
        const inbox = data as {
          messages: Array<{
            id: string;
            buddy_project_id?: string | null;
            root_message_id?: string | null;
            workspace_id?: string;
          }>;
          blockedProjects: Array<{ id: string }>;
        };
        data = {
          messages: inbox.messages.filter((m) => this.messageInAudience(m)),
          blockedProjects: inbox.blockedProjects.filter((p) =>
            this.projectInAudience((p as { id: string }).id)
          ),
        };
      }
    }
    const audit = this.store.recordAuditEvent({
      buddy: this.context.buddyId,
      workspace: this.context.workspaceId,
      project,
      operation,
      payload: {
        ...(payload && typeof payload === 'object' ? payload : { input: payload }),
        conversation_id: this.context.conversationId ?? null,
        automation_run_id: this.context.automationRunId ?? null,
      },
    });
    return BuddyOperationResultSchema.parse({ operation, data, audit });
  }
}
