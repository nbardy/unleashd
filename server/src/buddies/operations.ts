import { z } from 'zod';
import { type BuddiesStorePort, type BuddyAutomation, BuddyMemoryOperationError } from './contract';
import { publicAutomationRun } from './public-automation-run';
import { nextAutomationRunAt } from './scheduler';

export const BuddyOperationContextSchema = z.object({
  buddyId: z.string().min(1),
  workspaceId: z.string().min(1),
  buddyProjectId: z.string().min(1).nullable().optional(),
  automationRunId: z.string().min(1).nullable().optional(),
  conversationId: z.string().min(1).nullable().optional(),
  allowedOperations: z.array(z.string().min(1)).min(1).optional(),
});

const TodoOperationSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('add'),
    title: z.string().min(1),
    status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
    definitionOfDone: z.string().min(1).optional(),
    nextAction: z.string().min(1).optional(),
    blockedReason: z.string().min(1).optional(),
  }),
  z.object({
    operation: z.literal('update'),
    todoId: z.string().min(1),
    title: z.string().min(1).optional(),
    status: z.enum(['open', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
    position: z.number().int().nonnegative().optional(),
    definitionOfDone: z.string().min(1).nullable().optional(),
    nextAction: z.string().min(1).nullable().optional(),
    blockedReason: z.string().min(1).nullable().optional(),
  }),
]);

const AutomationPolicyInputSchema = z
  .object({
    maxRuntimeSeconds: z.number().int().positive().optional(),
    maxIterations: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    maxCostUsd: z.number().positive().optional(),
    allowedOperations: z.array(z.string().min(1)).optional(),
  })
  .strict();

const SetAutomationSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      targetBuddyId: z.string().min(1).optional(),
      projectId: z.string().min(1).optional(),
      name: z.string().min(1),
      scheduleKind: z.enum(['cron', 'interval']),
      scheduleExpression: z.string().min(1),
      timezone: z.string().min(1).default('UTC'),
      jobKind: z.enum(['prompt', 'sequence', 'loop']),
      jobPayload: z.record(z.string(), z.unknown()),
      policy: AutomationPolicyInputSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
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
      automationId: z.string().min(1),
    })
    .strict(),
]);

export const BuddyOperationInputSchemas = {
  'buddy.get_current_work': z
    .object({
      targetBuddyId: z.string().min(1).optional(),
    })
    .strict(),
  'buddy.get_inbox': z.object({}).strict(),
  'buddy.get_automations': z
    .object({
      targetBuddyId: z.string().min(1).optional(),
    })
    .strict(),
  'buddy.set_automation': SetAutomationSchema,
  'buddy.new_project': z.object({
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
      content: z.string(),
      reasoning: z.string().min(1),
      baseVersion: z.number().int().nonnegative(),
    })
    .strict(),
  'buddy.remember_note': z
    .object({
      topic: z.string().min(1).max(160).optional(),
      kind: z.string().min(1).max(80).optional(),
      body: z.string().min(1).max(32_000),
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
  'buddy.remember': z.object({
    content: z.string().min(1),
    kind: z.enum(['journal', 'curated']).optional(),
  }),
  'buddy.compact_memory': z.object({
    summary: z.string().min(1),
    retainDays: z.number().int().nonnegative().optional(),
    maxActiveCharacters: z.number().int().nonnegative().optional(),
    dryRun: z.boolean().optional(),
  }),
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
  'buddy.remember',
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
  'buddy.remember',
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
  const candidate = error as { code?: unknown; currentVersion?: unknown; yourBase?: unknown };
  if (candidate.code === 'STALE_MEMORY_WRITE' || /StaleMemoryWrite/i.test(String(error))) {
    return new BuddyMemoryOperationError(
      'MEMORY_STALE',
      error instanceof Error ? error.message : 'Memory revision is stale',
      {
        current_version: candidate.currentVersion,
        supplied_base: candidate.yourBase,
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
    switch (name) {
      case 'buddy.get_current_work': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
        this.requireReadableBuddy(targetBuddyId);
        return this.result(
          name,
          this.store.listBuddyOwnedProjects({
            buddy: targetBuddyId,
            workspace: this.context.workspaceId,
            includeClosed: false,
          }),
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
        if (parsed.action === 'create') {
          const targetBuddyId = parsed.targetBuddyId ?? this.context.buddyId;
          this.requireManageableBuddy(targetBuddyId);
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
            jobPayload: parsed.jobPayload,
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
        this.requireManageableBuddy(automation.buddy_id);
        if (automation.workspace_id !== this.context.workspaceId) {
          throw new Error('Automation is outside the conversation workspace');
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
        const project = this.store.newProject({
          ...parsed,
          buddy: this.context.buddyId,
          workspace: this.context.workspaceId,
        });
        return this.result(name, project, parsed, (project as { id: string }).id);
      }
      case 'buddy.update_project': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        const projectId = parsed.projectId ?? this.context.buddyProjectId ?? undefined;
        if (!projectId)
          throw new Error('projectId is required outside a project-scoped conversation');
        this.requireScopedProject(projectId);
        if (parsed.status === 'done') {
          if (!parsed.evidence?.length)
            throw new Error('evidence is required to complete a project');
        }
        const { projectId: _projectId, evidence: _evidence, ...changes } = parsed;
        const project = this.store.updateProject(projectId, changes);
        return this.result(name, project, parsed, projectId);
      }
      case 'buddy.update_memory': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        this.requireActiveBuddy();
        if (!this.store.updateMemory) {
          throw new BuddyMemoryOperationError(
            'MEMORY_CAPABILITY_MISSING',
            'The installed Buddies package does not expose memory-v2 update_memory'
          );
        }
        try {
          const memory = this.store.updateMemory(this.context.buddyId, {
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
          return this.result(name, memory, parsed, this.context.buddyProjectId ?? undefined);
        } catch (error) {
          throw normalizeMemoryError(error);
        }
      }
      case 'buddy.remember_note': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
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
            scope: parsed.scope ?? 'all',
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
      case 'buddy.remember': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        this.requireActiveBuddy();
        return this.result(
          name,
          this.store.remember(this.context.buddyId, parsed),
          parsed,
          this.context.buddyProjectId ?? undefined
        );
      }
      case 'buddy.compact_memory': {
        const parsed = BuddyOperationInputSchemas[name].parse(input);
        this.requireActiveBuddy();
        return this.result(
          name,
          this.store.compactMemory(this.context.buddyId, parsed),
          parsed,
          this.context.buddyProjectId ?? undefined
        );
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

  private result(
    operation: BuddyOperationName,
    data: unknown,
    payload: unknown,
    project?: string,
    allowExternalProject = false
  ) {
    if (project && !allowExternalProject) this.requireScopedProject(project);
    const audit = this.store.recordAuditEvent({
      buddy: this.context.buddyId,
      workspace: this.context.workspaceId,
      project,
      operation,
      payload,
    });
    return BuddyOperationResultSchema.parse({ operation, data, audit });
  }
}
