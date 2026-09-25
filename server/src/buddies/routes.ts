import { type BuddyKnowledgeScope, BuddyKnowledgeScopeSchema } from '@unleashd/shared';
import {
  BuddyInactiveAccessSchema,
  BuddyProjectExecutionViewSchema,
  BuddyProjectRunInputSchema,
  BuddyTaskCommentInputSchema,
  BuddyTaskCommentSchema,
  BuddyTaskCommentsPageSchema,
  BuddyTaskCommentsQuerySchema,
  BuddyTeamAccessViewSchema,
  BuddyWorkProjectSchema,
} from '@unleashd/shared';
import {
  type BuddyBuilderResult,
  type BuddyBuilderResults,
  type BuddyContext,
  BuddyMessageReplySchema,
  type BuddyRun,
  BuddyWorkspaceActivitySchema,
  ProviderSchema,
  isEffortValidForProvider,
  isModelIdValidForProvider,
  modelValidationHint,
  normalizeModelId,
  parseTeamConfigurationProposal,
} from '@unleashd/shared';
import {
  BUDDY_SOUL_MAX_CHARACTERS,
  BuddyMembershipSettingsSchema,
  BuddyRunSchema,
} from '@unleashd/shared';
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import {
  buddyExecutionPreferences,
  configFromProviderPreferences,
} from '../conversations/config-mapping';
import { type FeedRead, type OwnerFeed, inFeed, readFeed } from './channel-pages';
import { ListAuthorSchema } from './channel-routes';
import type { BuddiesStorePort, BuddyAutomation, BuddyAutomationRun } from './contract';
import { coordinationStore } from './coordination-store';
import { knowledgeStore, recallKnowledge, scopedDocumentOperation, scopedNote } from './knowledge';
import {
  type BuddyOperationContext,
  BuddyOperationInputSchemas,
  BuddyOperationsService,
  type PreparedBuddyMessage,
  dropEmptyEvidenceArrays,
  withPostProvenanceFields,
} from './operations';
import { type OwnerResourceName, executeOwnerResource } from './owner-resources';
import {
  configureOwnerTeam,
  getOwnerTeamConfiguration,
  ownerWorkspaceIds,
} from './owner-team-configuration';
import { assertBuddyProviderSupportsMcp } from './provider-capability';
import { publicAutomationRun } from './public-automation-run';
import { readBuddySoul, updateBuddySoul } from './soul';
import { getTeamCapabilities, messageExecution, teamStore } from './team-access';
import { observeBuddyTeam } from './team-observation';
import { visibleBuddyPayload } from './visibility';

/** Upper bound on one inactive-access read; the response counts what it left out. */
const INACTIVE_ACCESS_LIMIT = 200;

export interface BuddyConversationView {
  id: string;
  toJSON(): unknown;
}

export interface BuddyRouteDependencies {
  getStore(): Promise<BuddiesStorePort>;
  onBuddyArchived?(buddyId: string): Promise<void>;
  getScheduler(): {
    runNow(automationId: string, key?: string): Promise<BuddyAutomationRun | BuddyRun>;
    cancel(runId: string): Promise<BuddyAutomationRun>;
    health(): { running: boolean; pollIntervalMs: number; activeRunIds: string[] };
  } | null;
  createConversation(input: {
    context: BuddyContext;
    initialMessage: string;
    commandId: string;
    conversationId?: string;
  }): Promise<BuddyConversationView>;
  dispatchMessage?(
    context: BuddyContext,
    input: PreparedBuddyMessage,
    automationClaimToken?: string,
    signal?: AbortSignal
  ): Promise<unknown>;
  createBuilderConversation?(input: {
    commandId: string;
    conversationId?: string;
  }): Promise<BuddyConversationView>;
  getBuilderResult?(conversationId: string): Promise<BuddyBuilderResult | null>;
  getBuilderResults?(conversationId: string): Promise<BuddyBuilderResults>;
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

// The page query every owner feed route reads (channel-pages.ts FeedRead).
const FeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  before: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
});

// κ for an owner feed read. An anchor or floor that is not a post in this
// feed is a 400, not an empty or foreign page.
function feedRead(
  buddies: BuddiesStorePort,
  feed: OwnerFeed,
  query: z.infer<typeof FeedQuerySchema>
): FeedRead {
  const member = (postId: string) => {
    const post = buddies.getPost(postId);
    if (!post || !inFeed(feed, post)) throw new Error(`Post ${postId} is not in this feed`);
    return post;
  };
  if (query.from === undefined)
    return {
      kind: 'older',
      anchor: query.before === undefined ? null : member(query.before),
      limit: query.limit ?? 20,
    };
  if (query.before !== undefined || query.limit !== undefined)
    throw new Error('`from` reads everything from one post on; it takes no `before` or `limit`');
  return { kind: 'from', floor: member(query.from) };
}

function memoryPayload(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return {};
  const {
    workspaceId: _workspaceId,
    knowledgeScope: _scope,
    ...payload
  } = req.body as Record<string, unknown>;
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

function memoryAudience(req: Request): BuddyKnowledgeScope | undefined {
  const scope = req.body?.knowledgeScope ?? req.query.knowledgeScope;
  return scope === undefined
    ? undefined
    : BuddyKnowledgeScopeSchema.parse(typeof scope === 'string' ? JSON.parse(scope) : scope);
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
    createBuilderConversation,
    getBuilderResult,
    getBuilderResults,
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
  type RouteGuardOptions = Readonly<{ allowArchivedBuddy?: boolean }>;

  const guard =
    (fallback: RouteFallback, handler: RouteHandler, options: RouteGuardOptions = {}) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        const store = await getStore();
        if (
          req.params.buddyId &&
          req.method !== 'DELETE' &&
          !options.allowArchivedBuddy &&
          store.getBuddy(req.params.buddyId)?.status === 'archived'
        ) {
          res.status(404).json({ error: 'Buddy not found' });
          return;
        }
        const json = res.json.bind(res);
        res.json = (body: unknown) => json(visibleBuddyPayload(body, store));
        await handler(req, res);
      } catch (error) {
        if (fallback === 'memory') sendMemoryError(sendError, res, error);
        else sendError(res, error, fallback);
      }
    };

  const route = {
    get: (p: string, f: RouteFallback, h: RouteHandler, options?: RouteGuardOptions) =>
      app.get(p, guard(f, h, options)),
    post: (p: string, f: RouteFallback, h: RouteHandler) => app.post(p, guard(f, h)),
    put: (p: string, f: RouteFallback, h: RouteHandler) => app.put(p, guard(f, h)),
    patch: (p: string, f: RouteFallback, h: RouteHandler) => app.patch(p, guard(f, h)),
    delete: (p: string, f: RouteFallback, h: RouteHandler) => app.delete(p, guard(f, h)),
  };

  // These are owner routes behind the normal auth/reload gates, not employee fallbacks.
  route.post('/api/buddies/team-configuration', 'memory', async (req, res) => {
    const store = await getStore();
    res.json(
      configureOwnerTeam(store, req.body, {
        ownerInputId: createId(),
        conversationId: null,
        workspaceIds: ownerWorkspaceIds(store),
      })
    );
  });
  route.get('/api/buddies/team-configuration', 'memory', async (req, res) => {
    const store = await getStore();
    const input = z
      .object({ workspaceId: z.string().min(1), key: z.string().min(1).max(200) })
      .strict()
      .parse(req.query);
    res.json(
      getOwnerTeamConfiguration(store, input, {
        ownerInputId: createId(),
        conversationId: null,
        workspaceIds: ownerWorkspaceIds(store),
      })
    );
  });

  route.get('/api/buddies/capabilities/archive', 500, (_req, res) => {
    res.json({ available: true });
  });

  route.get(
    '/api/buddies/:buddyId/access/:workspaceId',
    400,
    async (req, res) => {
      const store = teamStore(await getStore());
      const { buddyId, workspaceId } = req.params;
      const grants = store.listBuddyAccess(buddyId, workspaceId);
      const granteeEligible =
        store.getBuddy(buddyId)?.status === 'active' &&
        !!store.getCoordinationMembership(buddyId, workspaceId);
      if (!granteeEligible && !grants.length) throw new Error('Buddy is outside workspace');
      const savedTargets = new Set(grants.map((grant) => grant.target_id));
      const targets = store
        .listBuddies()
        .filter(
          (b) =>
            savedTargets.has(b.id) ||
            (b.status === 'active' && store.getCoordinationMembership(b.id, workspaceId))
        )
        .map((b) => ({
          id: b.id,
          name: b.name,
          managerId: store.getBuddyTeamState(b.id).manager?.id ?? null,
          backgroundEnabled: !!store.getCoordinationMembership(b.id, workspaceId)
            ?.background_enabled,
          permissionsEditable:
            granteeEligible &&
            b.status === 'active' &&
            !!store.getCoordinationMembership(b.id, workspaceId),
        }));
      res.json(
        BuddyTeamAccessViewSchema.parse({
          targets,
          grants,
        })
      );
    },
    // This owner-only diagnostic is also the revocation read path. Archived
    // identities remain hidden from every generic Buddy route and projection.
    { allowArchivedBuddy: true }
  );
  // Owner-only, read-only inventory of saved grants the per-Buddy settings
  // cannot reach: a grant whose grantee or target is archived or detached from
  // this workspace. Each entry names the exact pair the access read above and
  // the existing team-configuration preview/apply need to revoke it; this route
  // never writes. Revoked grants keep their row with no capabilities, so they
  // drop out here. Bounded: newest first, capped, the remainder counted.
  route.get('/api/buddies/workspaces/:workspaceId/inactive-access', 400, async (req, res) => {
    const store = teamStore(await getStore());
    const { workspaceId } = req.params;
    const buddies = store.listBuddies();
    const parties = new Map(
      buddies.map((buddy) => [
        buddy.id,
        {
          id: buddy.id,
          name: buddy.name,
          standing:
            buddy.status === 'archived'
              ? 'archived'
              : store.getCoordinationMembership(buddy.id, workspaceId)
                ? 'member'
                : 'detached',
        } as const,
      ])
    );
    const entries = buddies
      .flatMap((grantee) => store.listBuddyAccess(grantee.id, workspaceId))
      .filter((grant) => grant.capabilities.length > 0)
      .map((grant) => ({
        grant,
        grantee: parties.get(grant.grantee_id),
        target:
          grant.target_id === workspaceId
            ? { kind: 'workspace' as const }
            : { kind: 'buddy' as const, ...parties.get(grant.target_id) },
      }))
      .filter(
        (entry) =>
          entry.grantee?.standing !== 'member' ||
          (entry.target.kind === 'buddy' && entry.target.standing !== 'member')
      )
      .sort((a, b) => b.grant.updated_at.localeCompare(a.grant.updated_at));
    res.json(
      BuddyInactiveAccessSchema.parse({
        entries: entries.slice(0, INACTIVE_ACCESS_LIMIT),
        omitted: Math.max(0, entries.length - INACTIVE_ACCESS_LIMIT),
      })
    );
  });
  route.get('/api/buddies/:buddyId/capabilities/:workspaceId', 400, async (req, res) => {
    const target =
      typeof req.query.targetBuddyId === 'string' ? req.query.targetBuddyId : undefined;
    res.json(
      getTeamCapabilities(
        await getStore(),
        { buddyId: req.params.buddyId, workspaceId: req.params.workspaceId },
        target
      )
    );
  });

  route.post('/api/buddies/:buddyId/reparent', 400, async (req, res) => {
    const input = z
      .object({ managerId: z.string().min(1), key: z.string().min(1).max(200) })
      .strict()
      .parse(req.body);
    res.json(coordinationStore(await getStore()).reparentBuddy(req.params.buddyId, input));
  });
  route.get('/api/buddies/:buddyId/team-state', 400, async (req, res) => {
    const source = await getStore();
    const buddy = source.getBuddy(req.params.buddyId);
    if (!buddy) throw new Error('Buddy not found');
    const workspaceId =
      typeof req.query.workspaceId === 'string'
        ? req.query.workspaceId
        : (source.listBuddyWorkspaces(buddy.id) as Array<{ id: string }>)[0]?.id;
    if (!workspaceId) throw new Error('Workspace is required');
    res.json(
      observeBuddyTeam(
        source,
        { buddyId: buddy.id, workspaceId, owner: true },
        {
          limit: Number(req.query.limit) || 20,
          offset: Number(req.query.offset) || 0,
          ...(typeof req.query.runId === 'string' ? { runId: req.query.runId } : {}),
          checkpointOffset: Number(req.query.checkpointOffset) || 0,
          checkpointLimit: Number(req.query.checkpointLimit) || 3,
          deliveryOffset: Number(req.query.deliveryOffset) || 0,
          deliveryLimit: Number(req.query.deliveryLimit) || 3,
          ...(typeof req.query.rootMessageId === 'string'
            ? { rootMessageId: req.query.rootMessageId }
            : {}),
          ...(typeof req.query.targetBuddyId === 'string'
            ? { targetBuddyId: req.query.targetBuddyId }
            : {}),
        }
      )
    );
  });
  route.get('/api/buddies/:buddyId/coordination', 400, async (req, res) => {
    const store = coordinationStore(await getStore());
    res.json({
      projects: store.listBuddyOwnedProjects({ buddy: req.params.buddyId, includeClosed: false }),
      buddies: store
        .listBuddies()
        .filter((b) => b.status !== 'archived')
        .map((b) => ({ id: b.id, name: b.name })),
      conversations: store.listConversationLinks(req.params.buddyId),
      memberships: (
        store.listBuddyWorkspaces(req.params.buddyId) as Array<{ id: string; name: string }>
      ).map((w) => ({
        ...store.getCoordinationMembership(req.params.buddyId, w.id),
        name: w.name,
      })),
      runs: store
        .listBuddyRuns({
          buddyId: req.params.buddyId,
          limit: 100,
          offset: Number(req.query.offset) || 0,
        })
        .map((r) => BuddyRunSchema.parse(r)),
    });
  });
  route.patch('/api/buddies/:buddyId/memberships/:workspaceId', 400, async (req, res) => {
    res.json(
      coordinationStore(await getStore()).setCoordinationMembership(
        req.params.buddyId,
        req.params.workspaceId,
        BuddyMembershipSettingsSchema.parse(req.body)
      )
    );
  });
  route.post('/api/buddies/runs/:runId/cancel', 400, async (req, res) => {
    const run = coordinationStore(await getStore()).cancelBuddyRun(req.params.runId);
    if (!run) throw new Error('Run not found');
    res.json(BuddyRunSchema.parse(run));
  });
  route.post('/api/buddies/runs/:runId/repair', 400, async (req, res) => {
    const input = z
      .object({ key: z.string().min(1).max(200), conversationId: z.string().min(1) })
      .strict()
      .parse(req.body);
    if (await isConversationDeleted(input.conversationId))
      throw new Error('Destination was deleted');
    res.json(
      BuddyRunSchema.parse(
        coordinationStore(await getStore()).repairBuddyRun(req.params.runId, input)
      )
    );
  });
  route.post('/api/buddies/runs/:runId/retry', 400, async (req, res) => {
    const input = z
      .object({
        key: z.string().min(1).max(200),
        reason: z.string().min(1).optional(),
        checkpointId: z.string().min(1).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      BuddyRunSchema.parse(
        coordinationStore(await getStore()).retryBuddyRun(req.params.runId, input)
      )
    );
  });
  route.post('/api/buddies/messages/:messageId/stop', 400, async (req, res) => {
    res.json(
      coordinationStore(await getStore())
        .stopBuddyMessageRoot(req.params.messageId)
        .map((r) => BuddyRunSchema.parse(r))
    );
  });
  const projectExecutionView = (buddies: BuddiesStorePort, projectId: string) => {
    const project = buddies.getBuddyProject(projectId);
    if (!project) throw new Error('Project not found');
    const work = teamStore(buddies).getProjectBackgroundExecution(projectId);
    return BuddyProjectExecutionViewSchema.parse({
      project,
      message: work
        ? { ...work.message, execution: messageExecution(buddies, work.message.id) }
        : null,
      runs: work?.runs ?? [],
    });
  };
  route.get('/api/buddies/projects/:projectId/execution', 400, async (req, res) => {
    res.json(projectExecutionView(await getStore(), req.params.projectId));
  });
  route.post('/api/buddies/projects/:projectId/run', 400, async (req, res) => {
    const input = BuddyProjectRunInputSchema.parse(req.body);
    const buddies = await getStore();
    teamStore(buddies);
    const project = BuddyWorkProjectSchema.parse(buddies.getBuddyProject(req.params.projectId));
    if (input.parentConversationId) {
      const links = buddies.listConversationLinks(project.buddy_id) as Array<{
        conversation_id?: string;
        unleashd_conversation_id?: string;
        workspace_id: string;
      }>;
      if (
        !links.some(
          (link) =>
            (link.unleashd_conversation_id ?? link.conversation_id) ===
              input.parentConversationId && link.workspace_id === project.workspace_id
        ) ||
        (await isConversationDeleted(input.parentConversationId))
      )
        throw new Error(
          'Return conversation must belong to the project Buddy and workspace and must not be deleted'
        );
    }
    if (!dependencies.dispatchMessage)
      throw new Error('Background dispatch runtime is unavailable');
    await dependencies.dispatchMessage(
      {
        buddyId: project.buddy_id,
        workspaceId: project.workspace_id,
        buddyProjectId: project.id,
      },
      {
        key: input.key,
        to: project.buddy_id,
        projectId: project.id,
        parentConversationId: input.parentConversationId,
        purpose: 'project_work',
        body: 'Work on this project until its current project and task completion criteria are satisfied. Record evidence on the work records.',
        execution: {
          mode: 'until_done',
          maxRuns: input.maxRuns,
          maxDurationSeconds: input.maxDurationSeconds,
        },
        evidence: [],
        expectsReply: true,
        wait: false,
        timeoutSeconds: 120,
      }
    );
    res.json(projectExecutionView(buddies, project.id));
  });
  route.patch('/api/buddies/projects/:projectId/execution', 400, async (req, res) => {
    const input = z
      .object({
        key: z.string().min(1).max(200),
        baseRevision: z.number().int().positive(),
        ownerId: z.string().min(1).optional(),
        executionState: z.enum(['enabled', 'paused', 'cancelled']).optional(),
      })
      .strict()
      .parse(req.body);
    res.json(
      coordinationStore(await getStore()).updateCoordinatedProject(req.params.projectId, input, {
        actor: 'owner',
        key: input.key,
      })
    );
  });

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

  route.get('/api/buddies/workspaces/:workspaceId/activity', 400, async (req, res) => {
    const buddies = await getStore();
    const workspaceId = req.params.workspaceId;
    const members = buddies
      .listBuddies()
      .filter((buddy) => buddy.status !== 'archived')
      .map((buddy) => ({
        buddy,
        workspace: (
          buddies.listBuddyWorkspaces(buddy.id) as Array<{
            id: string;
            name: string;
            root_path?: string;
          }>
        ).find((workspace) => workspace.id === workspaceId),
      }))
      .filter(
        (
          entry
        ): entry is typeof entry & {
          workspace: { id: string; name: string; root_path?: string };
        } => entry.workspace !== undefined
      );
    const workspace = members[0]?.workspace;
    if (!workspace) {
      res.status(404).json({ error: 'Buddy workspace not found' });
      return;
    }

    const activeStatuses = ['claimed', 'running', 'cancel_requested'] as const;
    const jobsByBuddy = new Map<string, Array<Record<string, unknown>>>(
      members.map(({ buddy }) => [buddy.id, []])
    );
    const coordination = coordinationStore(buddies);
    for (const status of activeStatuses) {
      for (const run of coordination.listBuddyRuns({ workspaceId, status, limit: 100 })) {
        const foreground = run.policy.foreground === true;
        jobsByBuddy.get(run.buddy_id)?.push({
          id: run.id,
          buddyId: run.buddy_id,
          kind: foreground ? 'foreground' : 'background',
          source:
            run.input_kind === 'message_request'
              ? 'delegation'
              : foreground
                ? 'conversation'
                : 'delegation',
          status: run.status,
          conversationId: run.conversation_id,
          label: foreground
            ? 'Conversation'
            : run.input_kind === 'message_request'
              ? 'Delegated work'
              : 'Background work',
          startedAt: run.started_at,
          deadline: run.deadline,
        });
      }
    }

    const automations = new Map<string, BuddyAutomation>();
    for (const { buddy } of members) {
      for (const automation of buddies.listAutomations({
        buddy: buddy.id,
        includeArchived: true,
      })) {
        if (automation.workspace_id === workspaceId) automations.set(automation.id, automation);
      }
    }
    for (const run of buddies.listNonterminalAutomationRuns()) {
      const automation = automations.get(run.automation_id);
      if (!automation || !activeStatuses.some((status) => status === run.status)) continue;
      jobsByBuddy.get(automation.buddy_id)?.push({
        id: run.id,
        buddyId: automation.buddy_id,
        kind: 'background',
        source: 'automation',
        status: run.status,
        conversationId: run.conversation_id,
        label: automation.name,
        startedAt: run.started_at ?? run.claimed_at,
        deadline: null,
      });
    }

    res.json(
      BuddyWorkspaceActivitySchema.parse({
        generatedAt: new Date().toISOString(),
        workspace: {
          id: workspace.id,
          name: workspace.name,
          rootPath: workspace.root_path ?? null,
        },
        members: members
          .map(({ buddy }) => ({
            id: buddy.id,
            name: buddy.name,
            role: buddy.role,
            status: buddy.status,
            execution: {
              kind: 'profile',
              config: configFromProviderPreferences(buddyExecutionPreferences(buddy)),
            },
            jobs: jobsByBuddy
              .get(buddy.id)!
              .sort((left, right) =>
                String(right.startedAt ?? '').localeCompare(String(left.startedAt ?? ''))
              ),
          }))
          .sort(
            (left, right) =>
              right.jobs.length - left.jobs.length || left.name.localeCompare(right.name)
          ),
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

  route.get('/api/buddies/builder/:conversationId/results', 400, async (req, res) => {
    if (!getBuilderResults) {
      res.status(503).json({ error: 'Buddy Builder is unavailable' });
      return;
    }
    res.json(await getBuilderResults(req.params.conversationId));
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

  const sendMessageFromRequest = async (req: Request, input: unknown) => {
    if (!dependencies.dispatchMessage) throw new Error('Message dispatch is unavailable');
    const buddies = await getStore();
    const scope = memoryHttpContext(buddies, req.params.buddyId, req);
    const operations = new BuddyOperationsService(buddies, scope);
    const prepared = operations.prepareMessage(input);
    return dependencies.dispatchMessage(
      {
        buddyId: scope.buddyId,
        workspaceId: scope.workspaceId,
        buddyProjectId: null,
        delegatedByBuddyId: null,
        parentBuddyConversationId: null,
      },
      prepared
    );
  };

  route.post('/api/buddies/:buddyId/messages', 400, async (req, res) => {
    const { workspaceId: _workspace, ...input } = req.body ?? {};
    res.status(201).json(await sendMessageFromRequest(req, input));
  });

  route.get('/api/buddies/messages', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(
      buddies
        .listMessages({
          buddy: typeof req.query.buddyId === 'string' ? req.query.buddyId : undefined,
          workspace: typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined,
          toOwner: req.query.to === 'owner',
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        })
        .map((message) => ({
          ...message,
          execution: messageExecution(buddies, message.id),
        }))
    );
  });

  // Mailing lists are public workspace streams. Owner reads move no read mark.
  // Writes name their author: the owner as themself, or a chosen Buddy (the
  // Mailbox tab's composer posts as the Buddy being viewed).
  route.get('/api/buddies/lists', 400, async (req, res) => {
    const buddies = await getStore();
    const input = z
      .object({ workspaceId: z.string().min(1) })
      .strict()
      .parse(req.query);
    res.json(buddies.listLists({ workspace: input.workspaceId }));
  });

  route.post('/api/buddies/lists', 400, async (req, res) => {
    const buddies = await getStore();
    const input = z
      .object({
        workspaceId: z.string().min(1),
        author: ListAuthorSchema,
        key: z.string().trim().min(1).max(200),
        name: z.string().trim().min(1).max(80),
        purpose: z.string().trim().min(1).max(400),
      })
      .strict()
      .parse(req.body);
    const { workspaceId, ...rest } = input;
    res.status(201).json(buddies.createList({ workspace: workspaceId, ...rest }));
  });

  // Top-level posts, newest-first: the newest page, `before=<post>` for the
  // page older than it, or `from=<post>` for that post and everything newer
  // (channel-pages.ts FeedRead). Keyset, never offsets: an offset read of
  // the next page repeats a post whenever one lands between the two reads.
  route.get('/api/buddies/lists/:listId/posts', 400, async (req, res) => {
    const buddies = await getStore();
    const list = buddies.getList(req.params.listId);
    if (!list) {
      res.status(404).json({ error: 'Mailing list not found' });
      return;
    }
    const feed: OwnerFeed = { kind: 'channel', list: list.id };
    const read = feedRead(buddies, feed, FeedQuerySchema.strict().parse(req.query));
    res.json(readFeed(buddies, feed, read).map(withPostProvenanceFields));
  });

  // One thread: its root, with its replies paged by the same query as a
  // channel's posts, newest-first like them. A thread reads the other way up,
  // root on top and oldest reply first, but pages the same way: it opens on
  // its newest replies, beside the composer where new ones land, and pages
  // back (`before`) toward the root, which comes with every read so it is
  // never out of reach. Paging forward from the root would open a long thread
  // on its oldest replies, pages away from the live end, where a reply landing
  // mid-read could not show until the reader caught up.
  // Until 2026-09-25 this read the first 200 replies and nothing past them.
  route.get('/api/buddies/lists/:listId/threads/:postId', 400, async (req, res) => {
    const buddies = await getStore();
    const root = buddies.getPost(req.params.postId);
    if (!root || root.listId !== req.params.listId || root.threadRootId !== null) {
      res.status(404).json({ error: 'Thread not found in this list' });
      return;
    }
    const feed: OwnerFeed = { kind: 'thread', root: root.id };
    const read = feedRead(buddies, feed, FeedQuerySchema.strict().parse(req.query));
    res.json({
      root: withPostProvenanceFields(root),
      replies: readFeed(buddies, feed, read).map(withPostProvenanceFields),
    });
  });

  // POST /api/buddies/lists/:listId/posts lives in channel-routes.ts: owner
  // posts canonicalize media and dispatch @mentions, which need the responder.

  // Task channel feed: newest-first posts across every workspace list linked
  // to one Task, paged like a channel (FeedRead). Owner reads move no read
  // mark; Buddy MCP reads keep the single-list get_list cursor rule, so there
  // is no MCP equivalent.
  route.get('/api/buddies/posts', 400, async (req, res) => {
    const buddies = await getStore();
    const { workspaceId, projectId, ...page } = FeedQuerySchema.extend({
      workspaceId: z.string().min(1),
      projectId: z.string().min(1),
    })
      .strict()
      .parse(req.query);
    const project = buddies.getBuddyProject(projectId);
    if (!project || project.workspace_id !== workspaceId) {
      res.status(404).json({ error: 'Task project not found in this workspace' });
      return;
    }
    const feed: OwnerFeed = { kind: 'task', workspace: workspaceId, project: project.id };
    const read = feedRead(buddies, feed, page);
    res.json(readFeed(buddies, feed, read).map(withPostProvenanceFields));
  });

  // The attachment is untrusted proposal data; the authenticated click supplies authority.
  // A configuration receipt commits before the normal reply. Repeating repairs a lost
  // acknowledgement without applying configuration twice or enqueueing a second reply.
  route.post('/api/buddies/messages/:messageId/team-configuration', 'memory', async (req, res) => {
    const input = z
      .object({ preview: z.boolean(), expectedPlanHash: z.string().optional() })
      .strict()
      .parse(req.body);
    const store = await getStore();
    const message = store.getMessage(req.params.messageId);
    const attachment =
      message?.to_buddy_id === null ? parseTeamConfigurationProposal(message.body) : null;
    if (!message || !attachment)
      throw Object.assign(new Error('This is not an owner team configuration proposal.'), {
        code: 'TEAM_PROPOSAL_NOT_FOUND',
      });
    if (
      !['pending', 'active', 'replied'].includes(message.status) ||
      (message.status === 'replied' && message.outcome !== 'team_configuration_applied')
    )
      throw Object.assign(new Error('This team proposal is no longer actionable.'), {
        code: 'TEAM_PROPOSAL_CLOSED',
      });
    if (attachment.proposal.configuration.workspaceId !== message.workspace_id)
      throw Object.assign(new Error('Proposal workspace differs from its source message.'), {
        code: 'TEAM_PROPOSAL_SCOPE_MISMATCH',
      });
    const result = configureOwnerTeam(
      store,
      { ...attachment.proposal, ...input },
      {
        ownerInputId: createId(),
        conversationId: null,
        workspaceIds: ownerWorkspaceIds(store),
      }
    );
    if (!input.preview && result.receipt && message.status !== 'replied') {
      store.replyToOwnerMessage(message.id, {
        outcome: 'team_configuration_applied',
        body: `Owner applied team configuration ${result.key}. Recheck current capabilities and original queued work. Remaining blockers: ${result.readiness.blockers.map((b) => `${b.code}: ${b.remedy}`).join('; ') || 'none reported'}. This receipt does not authorize training, spending or external actions.`,
        evidence: [result.receipt.auditId],
      });
    }
    res.json(result);
  });

  // This route runs behind the application's authenticated owner gate. Buddy MCP
  // has no owner actor field and cannot use this route through its scoped capability.
  route.post('/api/buddies/messages/:messageId/reply', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(
      buddies.replyToOwnerMessage(req.params.messageId, BuddyMessageReplySchema.parse(req.body))
    );
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
    const approval = buddies.getApprovalRequest(req.params.approvalId) as {
      message_id?: string;
    } | null;
    if (approval?.message_id) {
      buddies.replyToOwnerMessage(approval.message_id, {
        outcome: req.body.decision,
        body: req.body.note ?? req.body.decision,
        evidence: [`owner:${req.body.resolvedBy}`],
      });
      res.json(buddies.getApprovalRequest(req.params.approvalId));
      return;
    }
    res.json(
      buddies.resolveApprovalRequest(req.params.approvalId, {
        decision: req.body.decision,
        resolvedBy: req.body.resolvedBy,
        note: typeof req.body?.note === 'string' ? req.body.note : undefined,
      })
    );
  });

  route.delete('/api/buddies/:buddyId', 400, async (req, res) => {
    const store = await getStore();
    const buddy = store.getBuddy(req.params.buddyId);
    if (!buddy) {
      res.status(404).json({ error: 'Buddy not found' });
      return;
    }
    const automations = store.listAutomations({ buddy: buddy.id });
    const automationIds = new Set(automations.map((automation) => automation.id));
    const runs = store
      .listNonterminalAutomationRuns()
      .filter((run) => automationIds.has(run.automation_id));
    const scheduler = getScheduler();
    if (runs.length && !scheduler) {
      res.status(503).json({ error: 'Buddy scheduler is not ready to cancel active work' });
      return;
    }
    // Revoke new dispatches before awaiting cancellation. Repeating DELETE safely
    // finishes cleanup after an interrupted request; the durable archive is retained.
    store.updateBuddy(buddy.id, { status: 'archived' });
    for (const automation of automations) {
      store.updateAutomation(automation.id, { enabled: false, nextRunAt: null });
    }
    await dependencies.onBuddyArchived?.(buddy.id);
    for (const run of runs) await scheduler!.cancel(run.id);
    store.recordAuditEvent({
      buddy: buddy.id,
      workspace: (store.listBuddyWorkspaces(buddy.id)[0] as { id: string }).id,
      operation: 'buddy.archive',
      payload: { source: 'owner:settings' },
    });
    res.json({ archived: true });
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
      ...buddies.getBuddyTeamState(buddy.id),
      messages: buddies.listMessages({ buddy: buddy.id }).map((message) => ({
        ...message,
        execution: messageExecution(buddies, message.id),
      })),
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
    if (req.body?.hireQuota !== undefined) {
      res
        .status(400)
        .json({ error: 'Hiring quotas are no longer used; configure relationships instead' });
      return;
    }

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

  route.get('/api/buddies/:buddyId/soul', 404, async (req, res) => {
    res.json(readBuddySoul(await getStore(), req.params.buddyId));
  });

  // The caller supplies the revision it actually read. Never replace it with
  // the server's latest revision, which silently overwrites concurrent edits.
  route.put('/api/buddies/:buddyId/soul', 'memory', async (req, res) => {
    if (
      typeof req.body?.content === 'string' &&
      req.body.content.trim().length > BUDDY_SOUL_MAX_CHARACTERS
    ) {
      res.status(413).json({ error: `Soul exceeds ${BUDDY_SOUL_MAX_CHARACTERS} characters` });
      return;
    }
    const buddies = await getStore();
    if (!buddies.getBuddy(req.params.buddyId)) {
      res.status(404).json({ error: 'Buddy not found' });
      return;
    }
    res.json(
      updateBuddySoul(buddies, req.params.buddyId, req.body, 'owner:http', {
        source: 'http-soul-route',
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

  // Compatibility adapters for already-loaded clients. All new work uses messages.
  route.post('/api/buddies/:buddyId/delegations', 400, async (req, res) => {
    const input = req.body ?? {};
    res.status(201).json(
      await sendMessageFromRequest(req, {
        to: input.toBuddyId,
        purpose: 'delegation',
        body: input.purpose,
        projectId: input.buddyProjectId,
        evidence: [],
      })
    );
  });

  route.patch('/api/buddies/delegations/:delegationId', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.updateDelegation(req.params.delegationId, req.body ?? {}));
  });

  route.post('/api/buddies/:buddyId/review-requests', 400, async (req, res) => {
    const input = req.body ?? {};
    const evidence = Array.isArray(input.evidence)
      ? input.evidence.map((item: unknown) =>
          typeof item === 'string' ? item : JSON.stringify(item)
        )
      : [];
    res.status(201).json(
      await sendMessageFromRequest(req, {
        to: input.reviewerBuddyId,
        purpose: 'review',
        body: `Review Buddy ${String(input.subjectBuddyId)}. ${String(input.purpose ?? 'Review employee work')}`,
        evidence: [
          ...evidence,
          ...(typeof input.buddyProjectId === 'string' ? [`project:${input.buddyProjectId}`] : []),
        ],
      })
    );
  });

  // Direct review creation previously impersonated its recipient as the sender.
  // Clients now choose a sender and use /messages or /review-requests.
  route.post('/api/buddies/:buddyId/reviews', 410, async (_req, res) => {
    res.status(410).json({ error: 'Choose a sender and use /api/buddies/:buddyId/messages' });
  });

  route.patch('/api/buddies/reviews/:reviewId', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.updateReview(req.params.reviewId, req.body ?? {}));
  });

  route.get('/api/buddies/:buddyId/memory/scopes', 'memory', async (req, res) => {
    const store = await getStore();
    const context = memoryHttpContext(store, req.params.buddyId, req);
    const scopes = knowledgeStore(store).listKnowledgeScopes(context.buddyId, {
      actor: 'owner',
      workspaceId: context.workspaceId,
    });
    const projects = store.listBuddyOwnedProjects({
      buddy: context.buddyId,
      workspace: context.workspaceId,
      includeClosed: true,
    }) as Array<{ id: string; title: string }>;
    for (const project of projects)
      if (!scopes.some((s) => s.kind === 'project' && s.projectId === project.id))
        scopes.push({ kind: 'project', projectId: project.id });
    res.json([
      { label: 'Owner memory', scope: null },
      ...scopes.map((scope) => ({
        scope,
        label:
          scope.kind === 'workspace'
            ? 'Workspace work'
            : scope.kind === 'project'
              ? `Project: ${projects.find((p) => p.id === scope.projectId)?.title ?? scope.projectId}`
              : `Owner conversation: ${scope.conversationId}`,
      })),
    ]);
  });

  route.get('/api/buddies/:buddyId/memory', 404, async (req, res) => {
    const buddies = await getStore();
    const scope = memoryAudience(req);
    if (!scope) return void res.json(buddies.readBuddyMemory(req.params.buddyId));
    const { buddyId, workspaceId } = memoryHttpContext(buddies, req.params.buddyId, req);
    const ledger = knowledgeStore(buddies);
    const authority = { actor: 'owner', workspaceId };
    const read = (kind: 'working' | 'long_term') =>
      ledger.readKnowledgeDocument({ targetBuddyId: buddyId, scope, kind }, authority);
    const working = read('working');
    const longTerm = read('long_term');
    res.json({
      working: working.content,
      longTerm: longTerm.content,
      workingRevision: working.revision,
      longTermRevision: longTerm.revision,
      generation: Math.max(working.revision, longTerm.revision),
      operations: { updateMemory: true, rememberNote: true, recall: true },
      notes: ledger
        .listKnowledgeDocuments(
          { targetBuddyId: buddyId, scope, kinds: ['note'], limit: 20 },
          authority
        )
        .filter((note) => note.ref.targetBuddyId === buddyId)
        .map((note) => ({
          id: note.id,
          topic: note.ref.name,
          kind: 'note',
          content: note.content,
        })),
    });
  });

  route.put('/api/buddies/:buddyId/memory/:document', 'memory', async (req, res) => {
    const buddies = await getStore();
    const context = memoryHttpContext(buddies, req.params.buddyId, req);
    const document = req.params.document;
    const scope = memoryAudience(req);
    if (scope) {
      const parsed = BuddyOperationInputSchemas['buddy.update_memory'].parse({
        ...memoryPayload(req),
        doc: document,
      });
      res.json(
        scopedDocumentOperation(
          buddies,
          { targetBuddyId: context.buddyId, kind: parsed.doc, scope },
          { ...parsed, key: parsed.key ?? createId() },
          { actor: 'owner', workspaceId: context.workspaceId }
        )
      );
      return;
    }
    const result = new BuddyOperationsService(buddies, context).execute('buddy.update_memory', {
      ...memoryPayload(req),
      doc: document,
    });
    res.json(result);
  });

  route.post('/api/buddies/:buddyId/memory/notes', 'memory', async (req, res) => {
    const buddies = await getStore();
    const context = memoryHttpContext(buddies, req.params.buddyId, req);
    const scope = memoryAudience(req);
    if (scope) {
      const input = BuddyOperationInputSchemas['buddy.remember_note'].parse(memoryPayload(req));
      res.status(201).json({
        data: scopedNote(
          buddies,
          { actor: 'owner', workspaceId: context.workspaceId, scope },
          input,
          context.buddyId
        ),
      });
      return;
    }
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
    const scope = memoryAudience(req);
    if (scope) {
      const input = BuddyOperationInputSchemas['buddy.recall'].parse(memoryPayload(req));
      res.json({
        data: recallKnowledge(
          buddies,
          { actor: 'owner', workspaceId: context.workspaceId, scope },
          input,
          context.buddyId
        ),
      });
      return;
    }
    const result = new BuddyOperationsService(buddies, context).execute('buddy.recall', {
      ...memoryPayload(req),
    });
    res.json(result);
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
      coordinationStore(buddies).createCoordinatedProject(
        {
          ...BuddyOperationInputSchemas['buddy.new_project'].parse({
            ...optional,
            title,
            definitionOfDone,
          }),
          workspaceId,
          ownerId: optional.ownerId ?? req.params.buddyId,
        },
        { actor: 'owner', key: req.get('Idempotency-Key') ?? optional.key ?? createId() }
      )
    );
  });

  route.get('/api/buddies/projects/:projectId/comments', 400, async (req, res) => {
    const store = coordinationStore(await getStore());
    const project = store.getBuddyProject(req.params.projectId) as { workspace_id: string } | null;
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const query = BuddyTaskCommentsQuerySchema.parse({
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      cursor: req.query.cursor,
    });
    res.json(
      BuddyTaskCommentsPageSchema.parse(
        store.listTaskComments(
          { ...query, projectId: req.params.projectId },
          { actor: 'owner', workspaceId: project.workspace_id }
        )
      )
    );
  });

  route.post('/api/buddies/projects/:projectId/comments', 400, async (req, res) => {
    const store = coordinationStore(await getStore());
    const project = store.getBuddyProject(req.params.projectId) as { workspace_id: string } | null;
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const input = BuddyTaskCommentInputSchema.parse(req.body);
    res
      .status(201)
      .json(
        BuddyTaskCommentSchema.parse(
          store.appendTaskComment(
            { ...input, projectId: req.params.projectId },
            { actor: 'owner', workspaceId: project.workspace_id }
          )
        )
      );
  });

  route.patch('/api/buddies/projects/:projectId', 400, async (req, res) => {
    const buddies = await getStore();
    const project = buddies.getBuddyProject(req.params.projectId) as { revision: number } | null;
    if (!project) throw new Error('Project not found');
    const changes = BuddyOperationInputSchemas['buddy.update_project'].parse(req.body ?? {});
    dropEmptyEvidenceArrays(changes);
    res.json(
      coordinationStore(buddies).updateCoordinatedProject(
        req.params.projectId,
        { ...changes, baseRevision: changes.baseRevision ?? project.revision },
        { actor: 'owner', key: req.get('Idempotency-Key') ?? changes.key ?? createId() }
      )
    );
  });

  route.get('/api/buddies/:buddyId/automations', 400, async (req, res) => {
    const buddies = await getStore();
    res.json(buddies.listAutomations({ buddy: req.params.buddyId }));
  });

  app.post('/api/buddies/resources/:operation', async (request, response) => {
    try {
      const store = await dependencies.getStore();
      const result = executeOwnerResource(
        store,
        request.params.operation as OwnerResourceName,
        request.body,
        {
          ownerInputId: `http:${dependencies.createId()}`,
          conversationId: null,
          workspaceIds: ownerWorkspaceIds(store),
        }
      );
      response.json(result);
    } catch (error) {
      dependencies.sendError(response, error, 400);
    }
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
    if (buddies.getBuddy(current.buddy_id)?.status === 'archived') {
      res.status(404).json({ error: 'Buddy not found' });
      return;
    }
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
    const run = await scheduler.runNow(
      req.params.automationId,
      typeof req.body?.key === 'string' ? req.body.key : undefined
    );
    res
      .status(202)
      .json('input_kind' in run ? BuddyRunSchema.parse(run) : publicAutomationRun(run));
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
