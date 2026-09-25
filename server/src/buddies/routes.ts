import fs from 'node:fs';
import type {
  BuddyChanges,
  ChannelRef,
  DocKind,
  DocScope,
  Post,
  PostQuery,
  RunQuery,
  TaskQuery,
} from '@unleashd/buddies-core';
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
import { type BuddiesCore, OWNER, buddyActor, coreError, httpStatus, settingOf } from './core';
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
    // null clears the field back to the server default (Settings' "Default" choice).
    provider: z.string().min(1).nullable().optional(),
    model: z.string().min(1).nullable().optional(),
    reasoningEffort: z.string().min(1).nullable().optional(),
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
    backgroundEnabled: z.boolean(),
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
    // The owner writes as one of its Buddies (a standup, a handoff), as the Messages tab did before
    // T11. The crate authorizes the Buddy as the author; its @mentions start no turn.
    asBuddyId: z.string().min(1).optional(),
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
const WorkspaceSchema = z
  .object({ name: z.string().trim().min(1), rootPath: z.string().min(1) })
  .strict();
const ChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(500),
    key,
  })
  .strict();
const DirectPostSchema = PostBodySchema.extend({ members: z.array(z.string().min(1)).min(1) });
const AnswerSchema = z
  .object({ body: z.string().trim().min(1).max(32_000), evidence, key })
  .strict();
const ReadSchema = z.object({ postId: z.string().min(1) }).strict();
// Keyset pages on the post's ordered id (`Post.ord`, a UUIDv7), never on timestamps.
// `from` (a post id) is a permalink's page instead: that post and everything newer (T22).
const CursorSchema = z.object({
  before: z.string().optional(),
  from: z.string().min(1).optional(),
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

type Handler = (req: Request) => Promise<unknown>;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

// Pattern: table-driven (docs/patterns.md#table-driven) — one row per route, one registration loop.
// Pattern: idempotency-keys (docs/patterns.md#idempotency-keys) — every owner write carries `key`.
export function registerBuddyRoutes(app: Express, deps: BuddyRouteDeps): void {
  const { core, events, runner, channels } = deps;
  // A write changes Buddy state: clients refresh, and the runner wakes (it may have enqueued a run).
  const write = <T>(result: Promise<T>) =>
    result.then((value) => {
      events.emit({ kind: 'changed' });
      return value;
    });
  const p = (req: Request, name: string) => String(req.params[name]);
  const q = (req: Request, name: string) =>
    typeof req.query[name] === 'string' ? (req.query[name] as string) : undefined;
  // One feed page: keyset `before` an ordered id, or `from` a linked post (never both).
  const feedPage = (req: Request, query: PostQuery) => {
    const cursor = CursorSchema.parse(req.query);
    if (cursor.from !== undefined && cursor.before !== undefined)
      throw new Error('a page is `before` a cursor or `from` a post, not both');
    return cursor.from === undefined
      ? core.listPosts(
          OWNER,
          query,
          cursor.before === undefined ? null : { ord: cursor.before },
          cursor.limit
        )
      : core.listPostsFrom(OWNER, query, cursor.from, cursor.limit);
  };
  const posted = async <T extends Post>(post: Promise<T>) => {
    const written = await write(post);
    const channel = await core.openChannel(OWNER, { kind: 'id', id: written.channelId });
    events.emit({ kind: 'posted', post: written, channel });
    return { written, channel };
  };
  const ownerPost = async (raw: unknown, ref: ChannelRef) => {
    const { asBuddyId, ...input } = PostBodySchema.parse(raw);
    const chosen = mentionConfigsByBuddy(input.body, input.mentionConfigs);
    const author = asBuddyId === undefined ? OWNER : buddyActor(asBuddyId);
    const target = await core.openChannel(OWNER, ref);
    const body = requireCanonicalPostMedia(input.body, {
      uploadsRoot: deps.uploadsRoot(),
      channelId: target.id,
    });
    const { written: post, channel } = await posted(
      core.post(author, { kind: 'id', id: target.id }, { ...input, body })
    );
    // Only the owner's own @mentions start turns, and only in a public channel's thread seats.
    const mentions =
      channel.kind.type === 'public' && post.author.kind === 'owner'
        ? await channels.respondToOwnerPost(channel, post, chosen)
        : [];
    return { post, mentions };
  };
  const archive = async (buddyId: string, changes: BuddyChanges, changeKey: string) => {
    const buddy = await write(core.updateBuddy(OWNER, { buddyId, changes, key: changeKey }));
    if (buddy.status === 'archived') deps.onBuddyArchived(buddy.id);
    return buddy;
  };
  const putSchedule = (req: Request, id: string | undefined) =>
    write(
      core.putSchedule(OWNER, {
        ...ScheduleSchema.parse(req.body),
        id,
        buddyId: p(req, 'buddyId'),
        limits: '{}',
      })
    );
  const runQueries: Array<[string, (id: string) => RunQuery]> = [
    ['buddyId', (id) => ({ kind: 'buddy', buddyId: id })],
    ['taskId', (id) => ({ kind: 'task', taskId: id })],
    ['conversationId', (id) => ({ kind: 'conversation', conversationId: id })],
    ['liveInWorkspace', (id) => ({ kind: 'live', workspaceId: id })],
  ];

  const routes: Array<[Method, string, Handler, number?]> = [
    // ---- team -----------------------------------------------------------------------------------
    [
      'get',
      '/api/buddies/overview',
      async () =>
        Promise.all(
          (await core.listWorkspaces()).map(async (w) => ({
            ...w,
            buddies: await core.listBuddies(w.id),
          }))
        ),
    ],
    [
      'post',
      '/api/buddies/workspaces',
      (req) => write(core.createWorkspace(OWNER, WorkspaceSchema.parse(req.body))),
      201,
    ],
    ['post', '/api/buddies/builder', () => deps.createBuilderConversation(), 201],
    [
      'post',
      '/api/buddies',
      async (req) => {
        const { managerId, ...input } = BuddyCreateSchema.parse(req.body);
        return write(core.createBuddy(OWNER, { ...input, manager: manager(managerId) }));
      },
      201,
    ],
    ['post', '/api/buddies/:buddyId/direct', (req) => channels.openDirect(p(req, 'buddyId'))],
    ['post', '/api/buddies/:buddyId/wake', (req) => channels.wake(p(req, 'buddyId')), 202],
    // ---- docs -----------------------------------------------------------------------------------
    [
      'get',
      '/api/buddies/:buddyId/docs/:kind',
      async (req) => {
        const buddyId = p(req, 'buddyId');
        const kind = docKind.parse(p(req, 'kind')) as DocKind;
        if (q(req, 'all') === '1') return core.listDocs(OWNER, buddyId, kind);
        const scope = scopeOf(q(req, 'scope') ?? 'buddy', q(req, 'scopeId'), buddyId);
        return core.readDoc(OWNER, { buddyId, scope, kind, name: q(req, 'name') ?? '' });
      },
    ],
    [
      'put',
      '/api/buddies/:buddyId/docs/:kind',
      async (req) => {
        const buddyId = p(req, 'buddyId');
        const { scope, scopeId, name, ...write_ } = DocWriteSchema.parse(req.body);
        const kind = docKind.parse(p(req, 'kind')) as DocKind;
        const doc = { buddyId, scope: scopeOf(scope, scopeId, buddyId), kind, name };
        return write(core.writeDoc(OWNER, { doc, ...write_ }));
      },
    ],
    [
      'get',
      '/api/buddies/docs/:docId/revisions',
      (req) => core.docRevisions(OWNER, p(req, 'docId')),
    ],
    // ---- tasks (todos are child tasks) ----------------------------------------------------------
    [
      'get',
      '/api/buddies/tasks',
      async (req) => {
        const buddyId = q(req, 'buddyId');
        const parentId = q(req, 'parentId');
        const query: TaskQuery = buddyId
          ? { kind: 'owner', buddyId }
          : parentId
            ? { kind: 'children', parentId }
            : { kind: 'workspace', workspaceId: z.string().min(1).parse(q(req, 'workspaceId')) };
        return core.listTasks(query);
      },
    ],
    [
      'get',
      '/api/buddies/tasks/:taskId',
      async (req) => {
        const task = await core.getTask(p(req, 'taskId'));
        const channel = await core.openChannel(OWNER, { kind: 'task', taskId: task.id });
        const [children, comments, runs] = await Promise.all([
          core.listTasks({ kind: 'children', parentId: task.id }),
          core.listPosts(OWNER, { kind: 'channel', channelId: channel.id }, null, 100),
          core.listRuns({ kind: 'task', taskId: task.id }, 20),
        ]);
        return { task, channel, children, comments: comments.posts, runs };
      },
    ],
    // The channel browser's Task filter: one Task's posts across every channel (T22).
    [
      'get',
      '/api/buddies/tasks/:taskId/posts',
      (req) => {
        const cursor = CursorSchema.parse(req.query);
        const before = cursor.before === undefined ? null : { ord: cursor.before };
        return core.taskPosts(OWNER, p(req, 'taskId'), before, cursor.limit);
      },
    ],
    [
      'post',
      '/api/buddies/tasks',
      (req) =>
        write(core.upsertTask(OWNER, { kind: 'create', ...TaskCreateSchema.parse(req.body) })),
      201,
    ],
    [
      'patch',
      '/api/buddies/tasks/:taskId',
      (req) =>
        write(
          core.upsertTask(OWNER, {
            kind: 'update',
            taskId: p(req, 'taskId'),
            ...TaskUpdateSchema.parse(req.body),
          })
        ),
    ],
    // ---- runs -----------------------------------------------------------------------------------
    [
      'get',
      '/api/buddies/runs',
      async (req) => {
        const found = runQueries.find(([name]) => q(req, name));
        if (!found) throw new Error('runs need buddyId, taskId, conversationId or liveInWorkspace');
        return core.listRuns(found[1](q(req, found[0])!), 100);
      },
    ],
    ['get', '/api/buddies/runs/:runId', (req) => core.getRun(p(req, 'runId'))],
    ['post', '/api/buddies/runs/:runId/cancel', (req) => runner.cancel(p(req, 'runId'))],
    // ---- schedules ------------------------------------------------------------------------------
    ['get', '/api/buddies/:buddyId/schedules', (req) => core.listSchedules(p(req, 'buddyId'))],
    ['post', '/api/buddies/:buddyId/schedules', (req) => putSchedule(req, undefined), 201],
    [
      'put',
      '/api/buddies/:buddyId/schedules/:scheduleId',
      (req) => putSchedule(req, p(req, 'scheduleId')),
    ],
    [
      'post',
      '/api/buddies/:buddyId/schedules/:scheduleId/run',
      (req) =>
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
      202,
    ],
    // ---- channels, DMs and the owner's inbox (everything is a post in a channel) ----------------
    [
      'get',
      '/api/buddies/workspaces/:workspaceId/inbox',
      (req) => core.inbox(OWNER, p(req, 'workspaceId')),
    ],
    [
      'get',
      '/api/buddies/workspaces/:workspaceId/search',
      (req) =>
        core.searchPosts(
          OWNER,
          p(req, 'workspaceId'),
          z.string().trim().min(1).parse(q(req, 'q')),
          50
        ),
    ],
    [
      'post',
      '/api/buddies/workspaces/:workspaceId/channels',
      (req) =>
        write(
          core.createChannel(OWNER, {
            ...ChannelSchema.parse(req.body),
            workspaceId: p(req, 'workspaceId'),
          })
        ),
      201,
    ],
    [
      'get',
      '/api/buddies/channels/:channelId',
      (req) => core.openChannel(OWNER, { kind: 'id', id: p(req, 'channelId') }),
    ],
    [
      'get',
      '/api/buddies/channels/:channelId/posts',
      // Each root carries its reply count and newest reply (T22: channel rows lost "3 replies ·
      // last reply 2m ago" in the T11 migration). One indexed query per page.
      async (req) => {
        const channelId = p(req, 'channelId');
        const page = await feedPage(req, { kind: 'channel', channelId });
        const roots = page.posts.map((post) => post.id);
        return { ...page, threads: await core.threadStats(OWNER, channelId, roots) };
      },
    ],
    [
      'get',
      '/api/buddies/posts/:postId/thread',
      async (req) => {
        const root = await core.getPost(OWNER, p(req, 'postId'));
        return { root, ...(await feedPage(req, { kind: 'thread', rootId: root.id })) };
      },
    ],
    [
      'post',
      '/api/buddies/channels/:channelId/posts',
      (req) => ownerPost(req.body, { kind: 'id', id: p(req, 'channelId') }),
      201,
    ],
    [
      'post',
      '/api/buddies/direct/posts',
      (req) => {
        const { members, ...body } = DirectPostSchema.parse(req.body);
        return ownerPost(body, { kind: 'direct', members: [OWNER, ...members.map(buddyActor)] });
      },
      201,
    ],
    [
      'post',
      '/api/buddies/posts/:postId/answer',
      async (req) => {
        const input = AnswerSchema.parse(req.body);
        return (await posted(core.answer(OWNER, { requestId: p(req, 'postId'), ...input })))
          .written;
      },
      201,
    ],
    // Read through `postId`, the newest post the client rendered: a post that landed after the
    // render stays unread. The push clears the channel on the owner's other devices.
    [
      'post',
      '/api/buddies/channels/:channelId/read',
      async (req) => {
        const { postId } = ReadSchema.parse(req.body);
        await core.markRead(OWNER, p(req, 'channelId'), postId);
        deps.channelChanged(p(req, 'channelId'));
        return { ok: true };
      },
    ],
    [
      'get',
      '/api/buddies/channels/:channelId/responding',
      async (req) => channels.responding(p(req, 'channelId')),
    ],
    // ---- one buddy: last, so `/api/buddies/tasks` and friends never read as a buddy id ----------
    [
      'get',
      '/api/buddies/:buddyId',
      async (req) => {
        const buddyId = p(req, 'buddyId');
        const [buddy, tasks, schedules, runs] = await Promise.all([
          core.getBuddy(buddyId),
          core.listTasks({ kind: 'owner', buddyId }),
          core.listSchedules(buddyId),
          core.listRuns({ kind: 'buddy', buddyId }, 30),
        ]);
        return { buddy, tasks, schedules, runs };
      },
    ],
    [
      'patch',
      '/api/buddies/:buddyId',
      (req) => {
        const {
          key: changeKey,
          managerId,
          provider,
          model,
          reasoningEffort,
          ...changes
        } = BuddyChangesSchema.parse(req.body);
        const managerChange = managerId === undefined ? undefined : manager(managerId);
        const profile = {
          provider: settingOf(provider),
          model: settingOf(model),
          reasoningEffort: settingOf(reasoningEffort),
        };
        return archive(
          p(req, 'buddyId'),
          { ...changes, ...profile, manager: managerChange },
          changeKey
        );
      },
    ],
    [
      'delete',
      '/api/buddies/:buddyId',
      (req) => archive(p(req, 'buddyId'), { status: 'archived' }, `archive:${p(req, 'buddyId')}`),
    ],
  ];

  for (const [method, path, handle, status = 200] of routes) {
    app[method](path, (req: Request, res: Response) => {
      handle(req).then(
        (body) => res.status(status).json(body ?? null),
        (error: unknown) => {
          const typed = coreError(error);
          const code = typed ? httpStatus(typed) : error instanceof z.ZodError ? 400 : 500;
          if (code >= 500) console.error('[buddies] request failed:', error);
          const message = error instanceof Error ? error.message : String(error);
          res.status(code).json({ error: typed?.message ?? message });
        }
      );
    });
  }

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
  app.post('/api/buddies/channels/:channelId/media', upload.array('files', 10), (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (files.length === 0)
      return void res
        .status(400)
        .json({ error: `No supported media: ${[...MEDIA].join(' ')} up to 50 MB` });
    const saved = files.map((f) => ({
      originalName: f.originalname,
      absolutePath: f.path,
      mimeType: f.mimetype,
      size: f.size,
    }));
    res.status(201).json({ files: saved });
  });
}
