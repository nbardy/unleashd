import fs from 'node:fs';
import type { ChannelRef, DocKind, DocScope, RunQuery, TaskQuery } from '@unleashd/buddies-core';
import { type ConversationConfig, OwnerPostMentionConfigSchema } from '@unleashd/shared';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  CHANNEL_IMAGE_EXTENSIONS,
  CHANNEL_MEDIA_MAX_BYTES,
  CHANNEL_VIDEO_EXTENSIONS,
  channelMediaDirectory,
  requireCanonicalPostMedia,
} from './channel-media';
import { type Channels, mentionedBuddyIds } from './channels';
import { type BuddiesCore, OWNER, buddyActor, coreError, httpStatus } from './core';
import type { BuddyEvents } from './events';
import type { Runner } from './runner';

/**
 * The owner's Buddy API over the crate, mounted behind the auth gate (server.ts registers it after
 * the gate, like every /api route). About 35 routes replace ~75. Every call acts as the Owner;
 * the crate authorizes. Bodies are parsed once here (κ); the core never sees unparsed input.
 */
export interface BuddyRouteDeps {
  core: BuddiesCore;
  events: BuddyEvents;
  runner: Runner;
  channels: Channels;
  uploadsRoot(): string;
  channelChanged(channelId: string): void;
  onBuddyArchived(buddyId: string): void;
  createBuilderConversation(): Promise<{ conversationId: string }>;
}

const key = z.string().trim().min(1).max(200);
const evidence = z.array(z.string().min(1).max(4000)).max(32).default([]);
const docKind = z.enum(['soul', 'working', 'long_term', 'note', 'shared']);
const manager = (id: string | null) =>
  id === null ? ({ kind: 'nobody' } as const) : ({ kind: 'buddy', id } as const);

const BuddyChangesSchema = z
  .object({
    name: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    managerId: z.string().min(1).nullable().optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.string().min(1).optional(),
    backgroundEnabled: z.boolean().optional(),
    maxActiveRuns: z.number().int().positive().optional(),
    status: z.enum(['active', 'archived']).optional(),
    key,
  })
  .strict();
const BuddyCreateSchema = z
  .object({
    workspaceId: z.string().min(1),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    role: z.string().min(1),
    managerId: z.string().min(1).nullable().default(null),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.string().min(1).optional(),
    key,
  })
  .strict();
const TaskCreateSchema = z
  .object({
    ownerId: z.string().min(1),
    parentId: z.string().min(1).optional(),
    title: z.string().min(1),
    doneCriteria: z.string().min(1),
    key,
  })
  .strict();
const TaskUpdateSchema = z
  .object({
    baseRevision: z.number().int().positive(),
    changes: z
      .object({
        title: z.string().optional(),
        doneCriteria: z.string().optional(),
        status: z
          .enum(['open', 'in_progress', 'blocked', 'review', 'done', 'cancelled'])
          .optional(),
        nextAction: z.string().optional(),
        blockedReason: z.string().optional(),
        evidence: z.array(z.string()).optional(),
        paused: z.boolean().optional(),
        position: z.number().int().optional(),
        ownerId: z.string().optional(),
      })
      .strict(),
    key,
  })
  .strict();
const PostBodySchema = z
  .object({
    body: z.string().trim().min(1).max(32_000),
    kind: z.enum(['inform', 'request']).default('inform'),
    replyToId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    purpose: z.string().trim().min(1).max(200).optional(),
    evidence,
    mentionConfigs: z.array(OwnerPostMentionConfigSchema).max(32).default([]),
    key,
  })
  .strict();
const DocWriteSchema = z
  .object({
    scope: z.enum(['buddy', 'workspace', 'task', 'thread']).default('buddy'),
    scopeId: z.string().min(1).optional(),
    name: z.string().default(''),
    content: z.string().max(40_000),
    baseRevision: z.number().int().nonnegative(),
    reason: z.string().min(1),
    key,
  })
  .strict();
const ScheduleSchema = z
  .object({
    taskId: z.string().min(1).optional(),
    name: z.string().min(1).max(120),
    cron: z.string().min(1),
    timezone: z.string().min(1),
    prompt: z.string().min(1).max(16_000),
    enabled: z.boolean(),
    key,
  })
  .strict();
const CursorSchema = z.object({
  before: z.string().optional(),
  beforeId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** A doc scope from the query string: the portable doc by default. */
function scopeOf(scope: string, scopeId: string | undefined, buddyId: string): DocScope {
  const id = () => {
    if (!scopeId) throw new Error(`scope ${scope} needs a scopeId`);
    return scopeId;
  };
  switch (scope) {
    case 'workspace':
      return { kind: 'workspace', workspaceId: id() };
    case 'task':
      return { kind: 'task', taskId: id() };
    case 'thread':
      return { kind: 'thread', threadId: id() };
    case 'buddy':
      return { kind: 'buddy' };
    default:
      throw new Error(`unknown doc scope ${scope} for ${buddyId}`);
  }
}

/** κ for the owner's per-mention model picks: one per Buddy, and only for a mentioned Buddy. */
function mentionConfigsByBuddy(
  body: string,
  entries: readonly { buddyId: string; config: ConversationConfig }[]
) {
  const mentioned = new Set(mentionedBuddyIds(body));
  const byBuddy = new Map<string, ConversationConfig>();
  for (const entry of entries) {
    if (!mentioned.has(entry.buddyId) || byBuddy.has(entry.buddyId))
      throw new Error(
        `mentionConfigs must name each mentioned Buddy at most once (${entry.buddyId})`
      );
    byBuddy.set(entry.buddyId, entry.config);
  }
  return byBuddy;
}

const MEDIA = new Set<string>([...CHANNEL_IMAGE_EXTENSIONS, ...CHANNEL_VIDEO_EXTENSIONS]);

export function registerBuddyRoutes(app: Express, deps: BuddyRouteDeps): void {
  const { core, events, runner, channels } = deps;
  const route =
    (handler: (req: Request, res: Response) => Promise<unknown>, status = 200) =>
    (req: Request, res: Response) => {
      handler(req, res).then(
        (body) => res.status(status).json(body ?? null),
        (error: unknown) => {
          const typed = coreError(error);
          const code = typed ? httpStatus(typed) : error instanceof z.ZodError ? 400 : 500;
          if (code >= 500) console.error('[buddies] request failed:', error);
          res
            .status(code)
            .json({
              error: typed?.message ?? (error instanceof Error ? error.message : String(error)),
            });
        }
      );
    };
  // A write changes Buddy state: clients refresh, and the runner wakes (it may have enqueued a run).
  const write = <T>(result: Promise<T>) =>
    result.then((value) => {
      events.emit({ kind: 'changed' });
      return value;
    });
  const p = (req: Request, name: string) => String(req.params[name]);
  const q = (req: Request, name: string) =>
    typeof req.query[name] === 'string' ? (req.query[name] as string) : undefined;

  // ---- team ----------------------------------------------------------------------------------
  app.get(
    '/api/buddies/overview',
    route(async () => {
      const workspaces = await core.listWorkspaces();
      return Promise.all(
        workspaces.map(async (w) => ({ ...w, buddies: await core.listBuddies(w.id) }))
      );
    })
  );
  app.post(
    '/api/buddies/builder',
    route(() => deps.createBuilderConversation(), 201)
  );
  app.post(
    '/api/buddies',
    route(async (req) => {
      const { managerId, ...input } = BuddyCreateSchema.parse(req.body);
      return write(core.createBuddy(OWNER, { ...input, manager: manager(managerId) }));
    }, 201)
  );
  app.get(
    '/api/buddies/:buddyId',
    route(async (req) => {
      const buddyId = p(req, 'buddyId');
      const [buddy, tasks, schedules, runs] = await Promise.all([
        core.getBuddy(buddyId),
        core.listTasks({ kind: 'owner', buddyId }),
        core.listSchedules(buddyId),
        core.listRuns({ kind: 'buddy', buddyId }, 30),
      ]);
      return { buddy, tasks, schedules, runs };
    })
  );
  app.patch(
    '/api/buddies/:buddyId',
    route(async (req) => {
      const { key: changeKey, managerId, ...changes } = BuddyChangesSchema.parse(req.body);
      const buddy = await write(
        core.updateBuddy(OWNER, {
          buddyId: p(req, 'buddyId'),
          changes: {
            ...changes,
            manager: managerId === undefined ? undefined : manager(managerId),
          },
          key: changeKey,
        })
      );
      if (buddy.status === 'archived') deps.onBuddyArchived(buddy.id);
      return buddy;
    })
  );
  app.delete(
    '/api/buddies/:buddyId',
    route(async (req) => {
      const buddyId = p(req, 'buddyId');
      const buddy = await write(
        core.updateBuddy(OWNER, {
          buddyId,
          changes: { status: 'archived' },
          key: `archive:${buddyId}`,
        })
      );
      deps.onBuddyArchived(buddyId);
      return buddy;
    })
  );
  app.post(
    '/api/buddies/:buddyId/direct',
    route((req) => channels.openDirect(p(req, 'buddyId')))
  );
  app.post(
    '/api/buddies/:buddyId/wake',
    route((req) => channels.wake(p(req, 'buddyId')), 202)
  );

  // ---- docs ----------------------------------------------------------------------------------
  app.get(
    '/api/buddies/:buddyId/docs/:kind',
    route(async (req) => {
      const buddyId = p(req, 'buddyId');
      const kind = docKind.parse(p(req, 'kind')) as DocKind;
      const scope = scopeOf(q(req, 'scope') ?? 'buddy', q(req, 'scopeId'), buddyId);
      if (q(req, 'all') === '1') return core.listDocs(OWNER, buddyId, kind);
      return core.readDoc(OWNER, { buddyId, scope, kind, name: q(req, 'name') ?? '' });
    })
  );
  app.put(
    '/api/buddies/:buddyId/docs/:kind',
    route(async (req) => {
      const buddyId = p(req, 'buddyId');
      const input = DocWriteSchema.parse(req.body);
      return write(
        core.writeDoc(OWNER, {
          doc: {
            buddyId,
            scope: scopeOf(input.scope, input.scopeId, buddyId),
            kind: docKind.parse(p(req, 'kind')) as DocKind,
            name: input.name,
          },
          content: input.content,
          baseRevision: input.baseRevision,
          reason: input.reason,
          key: input.key,
        })
      );
    })
  );
  app.get(
    '/api/buddies/docs/:docId/revisions',
    route((req) => core.docRevisions(OWNER, p(req, 'docId')))
  );

  // ---- tasks ---------------------------------------------------------------------------------
  app.get(
    '/api/buddies/tasks',
    route(async (req) => {
      const buddyId = q(req, 'buddyId');
      const parentId = q(req, 'parentId');
      const query: TaskQuery = buddyId
        ? { kind: 'owner', buddyId }
        : parentId
          ? { kind: 'children', parentId }
          : { kind: 'workspace', workspaceId: z.string().min(1).parse(q(req, 'workspaceId')) };
      return core.listTasks(query);
    })
  );
  app.get(
    '/api/buddies/tasks/:taskId',
    route(async (req) => {
      const task = await core.getTask(p(req, 'taskId'));
      const channel = await core.openChannel(OWNER, { kind: 'task', taskId: task.id });
      const [children, comments, runs] = await Promise.all([
        core.listTasks({ kind: 'children', parentId: task.id }),
        core.listPosts(OWNER, { kind: 'channel', channelId: channel.id }, null, 100),
        core.listRuns({ kind: 'task', taskId: task.id }, 20),
      ]);
      return { task, channel, children, comments: comments.posts, runs };
    })
  );
  app.post(
    '/api/buddies/tasks',
    route(
      async (req) =>
        write(core.upsertTask(OWNER, { kind: 'create', ...TaskCreateSchema.parse(req.body) })),
      201
    )
  );
  app.patch(
    '/api/buddies/tasks/:taskId',
    route(async (req) =>
      write(
        core.upsertTask(OWNER, {
          kind: 'update',
          taskId: p(req, 'taskId'),
          ...TaskUpdateSchema.parse(req.body),
        })
      )
    )
  );

  // ---- runs ----------------------------------------------------------------------------------
  app.get(
    '/api/buddies/runs',
    route(async (req) => {
      const pick: Array<[string, (id: string) => RunQuery]> = [
        ['buddyId', (id) => ({ kind: 'buddy', buddyId: id })],
        ['taskId', (id) => ({ kind: 'task', taskId: id })],
        ['conversationId', (id) => ({ kind: 'conversation', conversationId: id })],
        ['liveInWorkspace', (id) => ({ kind: 'live', workspaceId: id })],
      ];
      const found = pick.find(([name]) => q(req, name));
      if (!found)
        throw new Error('runs need one of buddyId, taskId, conversationId, liveInWorkspace');
      return core.listRuns(found[1](q(req, found[0])!), 100);
    })
  );
  app.get(
    '/api/buddies/runs/:runId',
    route((req) => core.getRun(p(req, 'runId')))
  );
  app.post(
    '/api/buddies/runs/:runId/cancel',
    route((req) => runner.cancel(p(req, 'runId')))
  );

  // ---- schedules -----------------------------------------------------------------------------
  app.get(
    '/api/buddies/:buddyId/schedules',
    route((req) => core.listSchedules(p(req, 'buddyId')))
  );
  const putSchedule = (req: Request, id: string | undefined) =>
    write(
      core.putSchedule(OWNER, {
        ...ScheduleSchema.parse(req.body),
        id,
        buddyId: p(req, 'buddyId'),
        limits: '{}',
      })
    );
  app.post(
    '/api/buddies/:buddyId/schedules',
    route((req) => putSchedule(req, undefined), 201)
  );
  app.put(
    '/api/buddies/:buddyId/schedules/:scheduleId',
    route((req) => putSchedule(req, p(req, 'scheduleId')))
  );
  app.post(
    '/api/buddies/:buddyId/schedules/:scheduleId/run',
    route(
      async (req) =>
        write(
          core.enqueueRun(OWNER, {
            buddyId: p(req, 'buddyId'),
            input: {
              kind: 'schedule',
              scheduleId: p(req, 'scheduleId'),
              slot: new Date().toISOString(),
            },
          })
        ),
      202
    )
  );

  // ---- channels, DMs and the owner's inbox ---------------------------------------------------
  app.get(
    '/api/buddies/workspaces/:workspaceId/inbox',
    route((req) => core.inbox(OWNER, p(req, 'workspaceId')))
  );
  app.post(
    '/api/buddies/workspaces/:workspaceId/channels',
    route(async (req) => {
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          purpose: z.string().trim().min(1).max(500),
          key,
        })
        .strict()
        .parse(req.body);
      return write(core.createChannel(OWNER, { ...input, workspaceId: p(req, 'workspaceId') }));
    }, 201)
  );
  app.get(
    '/api/buddies/channels/:channelId',
    route((req) => core.openChannel(OWNER, { kind: 'id', id: p(req, 'channelId') }))
  );
  app.get(
    '/api/buddies/channels/:channelId/posts',
    route(async (req) => {
      const page = CursorSchema.parse(req.query);
      const before =
        page.before && page.beforeId ? { createdAt: page.before, id: page.beforeId } : undefined;
      return core.listPosts(
        OWNER,
        { kind: 'channel', channelId: p(req, 'channelId') },
        before,
        page.limit
      );
    })
  );
  app.get(
    '/api/buddies/posts/:postId/thread',
    route(async (req) => {
      const root = await core.getPost(OWNER, p(req, 'postId'));
      const page = CursorSchema.parse(req.query);
      const before =
        page.before && page.beforeId ? { createdAt: page.before, id: page.beforeId } : undefined;
      return {
        root,
        ...(await core.listPosts(OWNER, { kind: 'thread', rootId: root.id }, before, page.limit)),
      };
    })
  );
  const ownerPost = async (req: Request, ref: ChannelRef) => {
    const input = PostBodySchema.parse(req.body);
    const chosen = mentionConfigsByBuddy(input.body, input.mentionConfigs);
    const channel = await core.openChannel(OWNER, ref);
    const body = requireCanonicalPostMedia(input.body, {
      uploadsRoot: deps.uploadsRoot(),
      channelId: channel.id,
    });
    const post = await write(core.post(OWNER, { kind: 'id', id: channel.id }, { ...input, body }));
    events.emit({ kind: 'posted', post, channel });
    // Only the owner's own @mentions start turns, and only in a public channel's thread seats.
    const mentions =
      channel.kind.type === 'public'
        ? await channels.respondToOwnerPost(channel, post, chosen)
        : [];
    return { post, mentions };
  };
  app.post(
    '/api/buddies/channels/:channelId/posts',
    route((req) => ownerPost(req, { kind: 'id', id: p(req, 'channelId') }), 201)
  );
  app.post(
    '/api/buddies/direct/posts',
    route(async (req) => {
      const members = z.array(z.string().min(1)).min(1).parse(req.body?.members);
      const { members: _members, ...body } = req.body;
      req.body = body;
      return ownerPost(req, { kind: 'direct', members: [OWNER, ...members.map(buddyActor)] });
    }, 201)
  );
  app.post(
    '/api/buddies/posts/:postId/answer',
    route(async (req) => {
      const input = z
        .object({ body: z.string().trim().min(1).max(32_000), evidence, key })
        .strict()
        .parse(req.body);
      const post = await write(core.answer(OWNER, { requestId: p(req, 'postId'), ...input }));
      events.emit({
        kind: 'posted',
        post,
        channel: await core.openChannel(OWNER, { kind: 'id', id: post.channelId }),
      });
      return post;
    }, 201)
  );
  // Read through `postId`, the newest post the client rendered: a post that landed after the
  // render stays unread. The push clears the channel on the owner's other devices.
  app.post(
    '/api/buddies/channels/:channelId/read',
    route(async (req) => {
      const { postId } = z
        .object({ postId: z.string().min(1) })
        .strict()
        .parse(req.body);
      await core.markRead(OWNER, p(req, 'channelId'), postId);
      deps.channelChanged(p(req, 'channelId'));
      return { ok: true };
    })
  );
  app.get(
    '/api/buddies/channels/:channelId/responding',
    route(async (req) => channels.responding(p(req, 'channelId')))
  );

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, callback) => {
        try {
          const directory = channelMediaDirectory(deps.uploadsRoot(), String(req.params.channelId));
          fs.mkdirSync(directory, { recursive: true });
          callback(null, directory);
        } catch (error) {
          callback(error as Error, '');
        }
      },
      filename: (_req, file, callback) =>
        callback(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`),
    }),
    limits: { fileSize: CHANNEL_MEDIA_MAX_BYTES, files: 10 },
    fileFilter: (_req, file, callback) =>
      callback(
        null,
        MEDIA.has(file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase())
      ),
  });
  // Lands in the channel's media directory, so the composer's ![name](absolutePath) passes as-is.
  app.post(
    '/api/buddies/channels/:channelId/media',
    upload.array('files', 10),
    (req: Request, res: Response) => {
      const files = req.files as Express.Multer.File[];
      if (files.length === 0)
        return void res
          .status(400)
          .json({ error: `No supported media: ${[...MEDIA].join(' ')} up to 50 MB` });
      res
        .status(201)
        .json({
          files: files.map((f) => ({
            originalName: f.originalname,
            absolutePath: f.path,
            mimeType: f.mimetype,
            size: f.size,
          })),
        });
    }
  );
}
