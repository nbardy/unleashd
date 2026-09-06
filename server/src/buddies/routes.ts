import {
  type BuddyBuilderResult,
  type BuddyContext,
  ProviderSchema,
  isEffortValidForProvider,
  isModelIdValidForProvider,
  modelValidationHint,
  normalizeModelId,
} from '@unleashd/shared';
import type { Express, Request, Response } from 'express';
import type { BuddiesStorePort, BuddyAutomation, BuddyAutomationRun } from './contract';
import { BUDDY_REVIEW_RESULT_INSTRUCTIONS } from './integration';
import {
  type BuddyOperationContext,
  BuddyOperationsService,
  REVIEW_BUDDY_OPERATIONS,
  resolveDelegatedBuddyOperations,
} from './operations';
import { assertBuddyProviderSupportsMcp } from './provider-capability';
import { publicAutomationRun } from './public-automation-run';

export interface BuddyConversationView {
  id: string;
  toJSON(): unknown;
}

export interface BuddyRouteDependencies {
  getStore(): Promise<BuddiesStorePort>;
  getScheduler(): {
    runNow(automationId: string): Promise<BuddyAutomationRun>;
    cancel(runId: string): Promise<BuddyAutomationRun>;
    health(): { running: boolean; pollIntervalMs: number; activeRunIds: string[] };
  } | null;
  createConversation(input: {
    context: BuddyContext;
    initialMessage: string;
    commandId: string;
    conversationId?: string;
  }): Promise<BuddyConversationView>;
  createBuilderConversation?(input: {
    commandId: string;
    conversationId?: string;
  }): Promise<BuddyConversationView>;
  getBuilderResult?(conversationId: string): Promise<BuddyBuilderResult | null>;
  sendError(response: Response, error: unknown, fallbackStatus: number): void;
  getNextAutomationRunAt(automation: BuddyAutomation, after: Date): string;
  createId(): string;
  /**
   * True when the conversation was durably deleted (tombstoned in the config
   * store). Buddy link rows are never removed, so the detail route has to ask
   * this to avoid listing conversations that no longer open.
   *
   * The link's own `status` cannot answer it: `'cancelled'` is also what a
   * stopped or killed turn writes (`runtime.ts`), so filtering on it would hide
   * live conversations. The tombstone is the only unambiguous signal.
   * See docs/architecture.md 2.1.
   */
  isConversationDeleted(conversationId: string): Promise<boolean>;
}

function memoryPayload(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return {};
  const { workspaceId: _workspaceId, ...payload } = req.body as Record<string, unknown>;
  return payload;
}

function memoryHttpContext(
  buddies: BuddiesStorePort,
  buddyId: string,
  req: Request
): BuddyOperationContext {
  const bodyWorkspaceId =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>).workspaceId
      : undefined;
  const queryWorkspaceId =
    typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const requestedWorkspace =
    typeof bodyWorkspaceId === 'string' && bodyWorkspaceId.trim()
      ? bodyWorkspaceId.trim()
      : queryWorkspaceId;
  const workspaces = buddies.listBuddyWorkspaces(buddyId) as Array<{ id: string }>;
  const workspaceId = requestedWorkspace ?? workspaces[0]?.id;
  if (!workspaceId) throw new Error('Buddy has no authorized memory workspace');
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new Error('Buddy does not belong to the requested memory workspace');
  }
  return { buddyId, workspaceId };
}

function sendMemoryError(
  sendError: BuddyRouteDependencies['sendError'],
  response: Response,
  error: unknown
): void {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const status =
    code === 'MEMORY_STALE'
      ? 409
      : code === 'MEMORY_TOO_LARGE'
        ? 413
        : code === 'WORKSPACE_FORBIDDEN' || code === 'BUDDY_INACTIVE'
          ? 403
          : 400;
  if (code && error && typeof error === 'object' && 'details' in error) {
    response.status(status).json({
      error: error instanceof Error ? error.message : String(error),
      code,
      details: (error as { details?: unknown }).details,
    });
    return;
  }
  sendError(response, error, status);
}

export function registerBuddyRoutes(app: Express, dependencies: BuddyRouteDependencies): void {
  const {
    getStore,
    getScheduler,
    createConversation,
    createBuilderConversation,
    getBuilderResult,
    sendError,
    getNextAutomationRunAt,
    createId,
    isConversationDeleted,
  } = dependencies;

  /**
   * Every route below used to close with the same
   * `} catch (error) { sendError(res, error, N); }` — 30 copies of the same
   * structural branch, saying nothing about the route and holding the happy
   * path two indents deep. `route.<method>(path, fallback, handler)` owns that
   * catch once, so the fallback status reads as a declaration on the route and
   * a handler body is only the path it actually takes.
   *
   * `'memory'` is a fallback, not a status: the memory operations throw errors
   * carrying a `code` that maps to 409/413/403, so they need sendMemoryError.
   * Keeping it in the same sum type means there is still exactly ONE place that
   * decides how a thrown route error reaches the client.
   *
   * The handler must be the LAST argument. Passing a wrapper call instead
   * (`app.get(path, route(400, handler))`) makes biome refuse to hug the
   * callback, which re-explodes every route head across four lines.
   *
   * Three routes are deliberately NOT registered through this: the ones that
   * fail a delegation, fail a review, or return a bespoke 400 body. Their catch
   * does compensating work, not error reporting, so it belongs in the handler.
   */
  type RouteFallback = number | 'memory';
  type RouteHandler = (req: Request, res: Response) => Promise<void> | void;

  const guard =
    (fallback: RouteFallback, handler: RouteHandler) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await handler(req, res);
      } catch (error) {
        if (fallback === 'memory') sendMemoryError(sendError, res, error);
        else sendError(res, error, fallback);
      }
    };

  const route = {
    get: (p: string, f: RouteFallback, h: RouteHandler) => app.get(p, guard(f, h)),
    post: (p: string, f: RouteFallback, h: RouteHandler) => app.post(p, guard(f, h)),
    put: (p: string, f: RouteFallback, h: RouteHandler) => app.put(p, guard(f, h)),
    patch: (p: string, f: RouteFallback, h: RouteHandler) => app.patch(p, guard(f, h)),
    delete: (p: string, f: RouteFallback, h: RouteHandler) => app.delete(p, guard(f, h)),
  };

  route.get('/api/buddies', 500, async (_req, res) => {
    const buddies = await getStore();
    res.json(buddies.dashboard());
  });

  route.get('/api/buddies/overview', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(
      buddies.overview({
        recentSince: typeof req.query.recentSince === 'string' ? req.query.recentSince : undefined,
      })
    );
  });

  route.post('/api/buddies/builder', 400, async (req, res) => {
    if (!createBuilderConversation) {
      res.status(503).json({ error: 'Buddy Builder is unavailable' });
      return;
    }
    const conversationId =
      typeof req.body?.conversationId === 'string' ? req.body.conversationId : undefined;
    const conversation = await createBuilderConversation({
      commandId:
        typeof req.body?.commandId === 'string' && req.body.commandId.trim()
          ? req.body.commandId.trim()
          : createId(),
      conversationId,
    });
    res.status(201).json({
      conversationId: conversation.id,
      conversation: conversation.toJSON(),
    });
  });

  route.get('/api/buddies/builder/:conversationId/result', 400, async (req, res) => {
    if (!getBuilderResult) {
      res.status(503).json({ error: 'Buddy Builder is unavailable' });
      return;
    }
    const result = await getBuilderResult(req.params.conversationId);
    if (!result) {
      res.status(404).json({ error: 'Buddy has not been created yet' });
      return;
    }
    res.json(result);
  });

  route.get('/api/buddies/approvals', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(
      buddies.listApprovalRequests({
        buddy: typeof req.query.buddyId === 'string' ? req.query.buddyId : undefined,
        workspace: typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined,
        project: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
        status:
          req.query.status === 'pending' ||
          req.query.status === 'approved' ||
          req.query.status === 'rejected'
            ? req.query.status
            : undefined,
        limit:
          typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined,
      })
    );
  });

  route.post('/api/buddies/approvals/:approvalId/resolve', 400, async (req, res) => {
    if (req.body?.decision !== 'approved' && req.body?.decision !== 'rejected') {
      res.status(400).json({ error: 'decision must be approved or rejected' });
      return;
    }
    if (typeof req.body?.resolvedBy !== 'string' || !req.body.resolvedBy.trim()) {
      res.status(400).json({ error: 'resolvedBy is required' });
      return;
    }
    const buddies = await getStore();
    res.json(
      buddies.resolveApprovalRequest(req.params.approvalId, {
        decision: req.body.decision,
        resolvedBy: req.body.resolvedBy,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      })
    );
  });

  route.get('/api/buddies/:buddyId', 500, async (req, res) => {
    const buddies = await getStore();
    const buddy = buddies.getBuddy(req.params.buddyId);
    if (!buddy) {
      res.status(404).json({ error: 'Buddy not found' });
      return;
    }
    const automations = buddies.listAutomations({ buddy: buddy.id });
    const reviews = buddies.listReviews({ buddy: buddy.id });
    const reviewConversationIds = new Set(
      reviews
        .map((review) => review.conversation_id)
        .filter((conversationId): conversationId is string => Boolean(conversationId))
    );
    const linked = await Promise.all(
      buddies.listConversationLinks(buddy.id).map(async (value) => {
        const conversation = value as Record<string, unknown>;
        const conversationId =
          typeof conversation.unleashd_conversation_id === 'string'
            ? conversation.unleashd_conversation_id
            : typeof conversation.conversation_id === 'string'
              ? conversation.conversation_id
              : null;
        // Deleting a conversation only terminalizes its link row, so without
        // this the page keeps listing threads that can never be opened again.
        // Links with no conversation id (provider-session only) are kept —
        // there is nothing to tombstone them against.
        if (conversationId && (await isConversationDeleted(conversationId))) {
          return null;
        }
        return {
          ...conversation,
          kind:
            conversationId && buddies.getAutomationRunByConversationId(conversationId)
              ? 'automation'
              : conversationId && reviewConversationIds.has(conversationId)
                ? 'review'
                : 'conversation',
        };
      })
    );
    const conversations = linked.filter((conversation) => conversation !== null);
    res.json({
      buddy,
      workspaces: buddies.listBuddyWorkspaces(buddy.id),
      projects: buddies.listBuddyOwnedProjects({ buddy: buddy.id, includeClosed: true }),
      legacyWorkItems: buddies.listWorkItems({ buddy: buddy.id, includeClosed: true }),
      conversations,
      automations,
      relationships: buddies.listBuddyRelationships(buddy.id),
      skills: buddies.listBuddySkills(buddy.id),
      delegations: buddies.listDelegations({ buddy: buddy.id }),
      reviews,
      approvals: buddies.listApprovalRequests({ buddy: buddy.id }),
    });
  });

  route.patch('/api/buddies/:buddyId/profile', 400, async (req, res) => {
    const providerResult = ProviderSchema.safeParse(req.body?.provider);
    if (!providerResult.success) {
      res.status(400).json({ error: 'A valid provider is required' });
      return;
    }
    const provider = providerResult.data;
    try {
      assertBuddyProviderSupportsMcp(provider);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const model =
      typeof req.body?.model === 'string' && req.body.model.trim()
        ? normalizeModelId(provider, req.body.model.trim())
        : null;
    const reasoningEffort =
      typeof req.body?.reasoningEffort === 'string' && req.body.reasoningEffort.trim()
        ? req.body.reasoningEffort.trim()
        : null;

    if (!isModelIdValidForProvider(provider, model ?? undefined)) {
      res.status(400).json({
        error: `Invalid ${provider} model; expected ${modelValidationHint(provider)}`,
      });
      return;
    }
    if (!isEffortValidForProvider(provider, reasoningEffort)) {
      res.status(400).json({
        error: `Invalid ${provider} reasoning effort`,
      });
      return;
    }

    const buddies = await getStore();
    res.json(
      buddies.updateBuddy(req.params.buddyId, {
        provider,
        model,
        reasoningEffort,
      })
    );
  });

  route.get('/api/buddies/:buddyId/context', 404, async (req, res) => {
    const buddies = await getStore();
    res.json(
      buddies.getBuddyContext(req.params.buddyId, {
        workspace: typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined,
        project: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      })
    );
  });

  route.post('/api/buddies/:buddyId/relationships', 400, async (req, res) => {
    const buddies = await getStore();
    res.status(201).json(
      buddies.setBuddyRelationship({
        fromBuddy: req.params.buddyId,
        toBuddy: req.body?.toBuddyId,
        kind: req.body?.kind,
      })
    );
  });

  route.post('/api/buddies/:buddyId/skills', 400, async (req, res) => {
    const buddies = await getStore();
    res.status(201).json(
      buddies.assignBuddySkill({
        buddy: req.params.buddyId,
        name: req.body?.name,
        instructionPath: req.body?.instructionPath,
        mode: req.body?.mode,
      })
    );
  });

  app.post('/api/buddies/:buddyId/delegations', async (req: Request, res: Response) => {
    const {
      toBuddyId,
      workspaceId,
      buddyProjectId,
      purpose,
      parentConversationId,
      allowedOperations,
    } = req.body ?? {};
    if (
      typeof toBuddyId !== 'string' ||
      typeof workspaceId !== 'string' ||
      typeof purpose !== 'string'
    ) {
      res.status(400).json({ error: 'toBuddyId, workspaceId, and purpose are required' });
      return;
    }
    let delegationId: string | null = null;
    let dispatchToken: string | null = null;
    try {
      const delegatedOperations = resolveDelegatedBuddyOperations(allowedOperations);
      const buddies = await getStore();
      const relationships = buddies.listBuddyRelationships(req.params.buddyId) as Array<{
        from_buddy_id: string;
        to_buddy_id: string;
        kind: string;
      }>;
      const isDirectReport = relationships.some(
        (relationship) =>
          (relationship.from_buddy_id === req.params.buddyId &&
            relationship.to_buddy_id === toBuddyId &&
            relationship.kind === 'manager') ||
          (relationship.from_buddy_id === toBuddyId &&
            relationship.to_buddy_id === req.params.buddyId &&
            relationship.kind === 'reports_to')
      );
      if (!isDirectReport) {
        throw new Error('Target Buddy is not a direct report of this employee');
      }
      const normalizedParent =
        typeof parentConversationId === 'string' ? parentConversationId : null;
      const existing = buddies
        .listDelegations({ buddy: req.params.buddyId, workspace: workspaceId })
        .find(
          (candidate) =>
            candidate.from_buddy_id === req.params.buddyId &&
            candidate.to_buddy_id === toBuddyId &&
            candidate.purpose === purpose &&
            candidate.parent_conversation_id === normalizedParent &&
            (candidate.status === 'pending' || candidate.status === 'active')
        );
      if (existing?.child_conversation_id) {
        res.status(200).json({ delegation: existing, alreadyDispatched: true });
        return;
      }
      const delegation =
        existing ??
        buddies.createDelegation({
          fromBuddy: req.params.buddyId,
          toBuddy: toBuddyId,
          workspace: workspaceId,
          project: typeof buddyProjectId === 'string' ? buddyProjectId : undefined,
          purpose,
          parentConversationId: normalizedParent ?? undefined,
        });
      delegationId = delegation.id;
      dispatchToken = createId();
      const claim = buddies.claimDelegationDispatch(delegation.id, {
        claimToken: dispatchToken,
        leaseSeconds: 300,
      });
      if (!claim.dispatch_claim_acquired) {
        if (claim.child_conversation_id) {
          res.status(200).json({ delegation: claim, alreadyDispatched: true });
        } else {
          res.status(409).json({
            error: 'Delegation dispatch is already claimed by another executor',
            delegation: claim,
          });
        }
        return;
      }
      const conversation = await createConversation({
        context: {
          buddyId: toBuddyId,
          workspaceId,
          // The linked project belongs to the delegating manager. The report
          // returns evidence through the assignment; it does not inherit
          // mutation authority over the manager's project.
          buddyProjectId: null,
          delegatedByBuddyId: req.params.buddyId,
          parentBuddyConversationId:
            typeof parentConversationId === 'string' ? parentConversationId : null,
          allowedBuddyOperations: delegatedOperations,
        },
        commandId: `buddy-delegation-${delegation.id}`,
        initialMessage: [
          `Delegated by Buddy ${req.params.buddyId}.`,
          `Delegation id: ${delegation.id}.`,
          typeof buddyProjectId === 'string'
            ? `Supervising project id: ${buddyProjectId}. The project remains owned by the delegating employee.`
            : 'No supervising Buddy project was selected.',
          `Purpose: ${purpose}`,
          `Allowed Buddy operations: ${delegatedOperations.join(', ')}.`,
          'Own this bounded assignment within that operation policy.',
          'When the definition of done is actually satisfied, call complete_assignment with concrete evidence. A completed model turn alone does not complete the assignment.',
        ].join('\n'),
      });
      const active = buddies.bindDelegationConversation(delegation.id, {
        claimToken: dispatchToken,
        childConversationId: conversation.id,
      });
      res.status(201).json({ delegation: active, conversation: conversation.toJSON() });
    } catch (error) {
      if (delegationId && dispatchToken) {
        try {
          const buddies = await getStore();
          buddies.failDelegationDispatch(delegationId, {
            claimToken: dispatchToken,
            error: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Preserve the original dispatch error; another executor may own the lease.
        }
      }
      sendError(res, error, 400);
    }
  });

  route.patch('/api/buddies/delegations/:delegationId', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.updateDelegation(req.params.delegationId, req.body ?? {}));
  });

  app.post('/api/buddies/:buddyId/review-requests', async (req: Request, res: Response) => {
    const { reviewerBuddyId, subjectBuddyId, workspaceId, buddyProjectId, purpose, evidence } =
      req.body ?? {};
    if (
      typeof reviewerBuddyId !== 'string' ||
      typeof subjectBuddyId !== 'string' ||
      typeof workspaceId !== 'string' ||
      typeof purpose !== 'string'
    ) {
      res.status(400).json({
        error: 'reviewerBuddyId, subjectBuddyId, workspaceId, and purpose are required',
      });
      return;
    }
    let reviewId: string | null = null;
    try {
      const buddies = await getStore();
      const relationships = buddies.listBuddyRelationships(req.params.buddyId) as Array<{
        from_buddy_id: string;
        to_buddy_id: string;
        kind: string;
      }>;
      const manageable = new Set([req.params.buddyId]);
      for (const relationship of relationships) {
        if (relationship.from_buddy_id === req.params.buddyId && relationship.kind === 'manager') {
          manageable.add(relationship.to_buddy_id);
        }
        if (relationship.to_buddy_id === req.params.buddyId && relationship.kind === 'reports_to') {
          manageable.add(relationship.from_buddy_id);
        }
      }
      if (!manageable.has(reviewerBuddyId) || !manageable.has(subjectBuddyId)) {
        throw new Error('Reviewer and subject must be this employee or a direct report');
      }
      if (reviewerBuddyId === subjectBuddyId) throw new Error('A Buddy cannot review itself');

      const conversationId = createId();
      const review = buddies.createReview({
        reviewer: reviewerBuddyId,
        subject: subjectBuddyId,
        workspace: workspaceId,
        project: typeof buddyProjectId === 'string' ? buddyProjectId : undefined,
        conversationId,
        evidence: Array.isArray(evidence) ? evidence : [],
      });
      reviewId = review.id;
      const conversation = await createConversation({
        conversationId,
        context: {
          buddyId: reviewerBuddyId,
          workspaceId,
          buddyProjectId: null,
          delegatedByBuddyId: req.params.buddyId,
          parentBuddyConversationId:
            typeof req.body?.parentConversationId === 'string'
              ? req.body.parentConversationId
              : null,
          allowedBuddyOperations: REVIEW_BUDDY_OPERATIONS,
        },
        commandId: `buddy-review-${review.id}`,
        initialMessage: [
          `Review requested by Buddy ${req.params.buddyId}.`,
          `Review id: ${review.id}.`,
          `Review Buddy ${subjectBuddyId}.`,
          typeof buddyProjectId === 'string'
            ? `Reviewed project id: ${buddyProjectId}.`
            : 'No Buddy project was selected.',
          `Review purpose: ${purpose}`,
          `Input evidence: ${JSON.stringify(Array.isArray(evidence) ? evidence : [])}`,
          `Allowed Buddy operations: ${REVIEW_BUDDY_OPERATIONS.join(', ')}.`,
          'Use the native submit_review operation with a structured verdict, score, summary, concrete evidence, and required actions.',
          'The legacy result block below is a compatibility fallback only.',
          BUDDY_REVIEW_RESULT_INSTRUCTIONS,
        ].join('\n'),
      });
      res.status(201).json({ review, conversation: conversation.toJSON() });
    } catch (error) {
      if (reviewId) {
        try {
          const buddies = await getStore();
          buddies.updateReview(reviewId, { status: 'cancelled' });
        } catch {
          // Preserve the original dispatch error.
        }
      }
      sendError(res, error, 400);
    }
  });

  route.post('/api/buddies/:buddyId/reviews', 400, async (req, res) => {
    const {
      subjectBuddyId,
      workspaceId,
      buddyProjectId,
      purpose = 'Review employee work',
    } = req.body ?? {};
    if (typeof subjectBuddyId !== 'string' || typeof workspaceId !== 'string') {
      res.status(400).json({ error: 'subjectBuddyId and workspaceId are required' });
      return;
    }
    const buddies = await getStore();
    const conversationId = createId();
    const review = buddies.createReview({
      reviewer: req.params.buddyId,
      subject: subjectBuddyId,
      workspace: workspaceId,
      project: typeof buddyProjectId === 'string' ? buddyProjectId : undefined,
      conversationId,
    });
    const conversation = await createConversation({
      conversationId,
      context: {
        buddyId: req.params.buddyId,
        workspaceId,
        // The reviewed project belongs to the subject, not the reviewer.
        buddyProjectId: null,
        allowedBuddyOperations: REVIEW_BUDDY_OPERATIONS,
      },
      commandId: `buddy-review-${review.id}`,
      initialMessage: [
        `Review Buddy ${subjectBuddyId}.`,
        `Review id: ${review.id}.`,
        `Review purpose: ${purpose}`,
        'Use the native submit_review operation with a structured verdict, score, summary, concrete evidence, and required actions.',
        'The legacy result block below is a compatibility fallback only.',
        BUDDY_REVIEW_RESULT_INSTRUCTIONS,
      ].join('\n'),
    });
    res.status(201).json({ review, conversation: conversation.toJSON() });
  });

  route.patch('/api/buddies/reviews/:reviewId', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.updateReview(req.params.reviewId, req.body ?? {}));
  });

  route.get('/api/buddies/:buddyId/memory', 404, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.readBuddyMemory(req.params.buddyId));
  });

  route.put('/api/buddies/:buddyId/memory/:document', 'memory', async (req, res) => {
    const buddies = await getStore();
    const context = memoryHttpContext(buddies, req.params.buddyId, req);
    const document = req.params.document;
    const result = new BuddyOperationsService(buddies, context).execute('buddy.update_memory', {
      ...memoryPayload(req),
      doc: document,
    });
    res.json(result);
  });

  route.post('/api/buddies/:buddyId/memory/notes', 'memory', async (req, res) => {
    const buddies = await getStore();
    const context = memoryHttpContext(buddies, req.params.buddyId, req);
    const result = new BuddyOperationsService(buddies, context).execute('buddy.remember_note', {
      ...memoryPayload(req),
      body:
        typeof req.body?.body === 'string'
          ? req.body.body
          : typeof req.body?.content === 'string'
            ? req.body.content
            : undefined,
    });
    res.status(201).json(result);
  });

  route.post('/api/buddies/:buddyId/memory/recall', 'memory', async (req, res) => {
    const buddies = await getStore();
    const context = memoryHttpContext(buddies, req.params.buddyId, req);
    const result = new BuddyOperationsService(buddies, context).execute('buddy.recall', {
      ...memoryPayload(req),
    });
    res.json(result);
  });

  route.post('/api/buddies/:buddyId/memory', 400, async (req, res) => {
    const { content, kind = 'journal' } = req.body ?? {};
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const buddies = await getStore();
    res.status(201).json(
      buddies.remember(req.params.buddyId, {
        content,
        kind: kind === 'curated' ? 'curated' : 'journal',
      })
    );
  });

  route.get('/api/buddies/:buddyId/projects', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(
      buddies.listBuddyOwnedProjects({
        buddy: req.params.buddyId,
        workspace: typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined,
        includeClosed: req.query.includeClosed === 'true',
      })
    );
  });

  route.post('/api/buddies/:buddyId/projects', 400, async (req, res) => {
    const { workspaceId, title, definitionOfDone, ...optional } = req.body ?? {};
    if (
      typeof workspaceId !== 'string' ||
      typeof title !== 'string' ||
      typeof definitionOfDone !== 'string'
    ) {
      res.status(400).json({ error: 'workspaceId, title, and definitionOfDone are required' });
      return;
    }
    const buddies = await getStore();
    res.status(201).json(
      buddies.newProject({
        ...optional,
        buddy: req.params.buddyId,
        workspace: workspaceId,
        title,
        definitionOfDone,
      })
    );
  });

  route.patch('/api/buddies/projects/:projectId', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.updateProject(req.params.projectId, req.body ?? {}));
  });

  route.get('/api/buddies/:buddyId/automations', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.listAutomations({ buddy: req.params.buddyId }));
  });

  app.get('/api/buddies/automations/health', (_req: Request, res: Response) => {
    const scheduler = getScheduler();
    if (!scheduler) {
      res.status(503).json({ error: 'Buddy scheduler is not ready' });
      return;
    }
    res.json(scheduler.health());
  });

  route.post('/api/buddies/:buddyId/automations', 400, async (req, res) => {
    const buddies = await getStore();
    const scheduleCandidate = {
      schedule_kind: req.body?.scheduleKind,
      schedule_expression: req.body?.scheduleExpression,
      timezone: req.body?.timezone ?? 'UTC',
    } as BuddyAutomation;
    // Validate and compute before persistence. A 400 must never leave an
    // enabled definition whose schedule cannot be evaluated.
    const nextRunAt = getNextAutomationRunAt(scheduleCandidate, new Date());
    const automation = buddies.createAutomation({
      ...req.body,
      buddy: req.params.buddyId,
      workspace: req.body?.workspaceId,
      project: req.body?.projectId,
      nextRunAt,
    });
    res.status(201).json(automation);
  });

  route.patch('/api/buddies/automations/:automationId', 400, async (req, res) => {
    const buddies = await getStore();
    const current = buddies.getAutomation(req.params.automationId);
    if (!current) throw new Error(`automation not found: ${req.params.automationId}`);
    let changes = req.body ?? {};
    if (
      req.body?.nextRunAt === undefined &&
      ((req.body?.enabled === true && current.next_run_at === null) ||
        req.body?.scheduleKind !== undefined ||
        req.body?.scheduleExpression !== undefined ||
        req.body?.timezone !== undefined)
    ) {
      const candidate = {
        ...current,
        schedule_kind: req.body.scheduleKind ?? current.schedule_kind,
        schedule_expression: req.body.scheduleExpression ?? current.schedule_expression,
        timezone: req.body.timezone ?? current.timezone,
      };
      changes = { ...changes, nextRunAt: getNextAutomationRunAt(candidate, new Date()) };
    }
    const automation = buddies.updateAutomation(current.id, changes);
    res.json(automation);
  });

  route.delete('/api/buddies/automations/:automationId', 400, async (req, res) => {
    const buddies = await getStore();
    const activeRuns = buddies
      .listNonterminalAutomationRuns()
      .filter((run) => run.automation_id === req.params.automationId);
    if (activeRuns.length) {
      const scheduler = getScheduler();
      if (!scheduler) {
        res.status(503).json({ error: 'Buddy scheduler is not ready to cancel active work' });
        return;
      }
      for (const run of activeRuns) await scheduler.cancel(run.id);
    }
    res.json(buddies.archiveAutomation(req.params.automationId));
  });

  route.post('/api/buddies/automations/:automationId/run', 400, async (req, res) => {
    const scheduler = getScheduler();
    if (!scheduler) {
      res.status(503).json({ error: 'Buddy scheduler is not ready' });
      return;
    }
    res.status(202).json(publicAutomationRun(await scheduler.runNow(req.params.automationId)));
  });

  route.get('/api/buddies/automations/:automationId/runs', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(
      buddies
        .listAutomationRuns(req.params.automationId, {
          limit:
            typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined,
        })
        .map(publicAutomationRun)
    );
  });

  route.post('/api/buddies/automation-runs/:runId/cancel', 400, async (req, res) => {
    const scheduler = getScheduler();
    if (!scheduler) {
      res.status(503).json({ error: 'Buddy scheduler is not ready' });
      return;
    }
    res.json(publicAutomationRun(await scheduler.cancel(req.params.runId)));
  });

  // Legacy imported campaign status remains writable during the v1 transition.
  route.patch('/api/buddies/work-items/:id', 400, async (req, res) => {
    const { status, blockedReason, nextAction } = req.body ?? {};
    if (typeof status !== 'string') {
      res.status(400).json({ error: 'status is required' });
      return;
    }
    const buddies = await getStore();
    const workItem = buddies.updateWorkItemStatus(req.params.id, status as never, {
      blockedReason: typeof blockedReason === 'string' ? blockedReason : undefined,
      nextAction: typeof nextAction === 'string' ? nextAction : undefined,
    });
    res.json(workItem);
  });
}
