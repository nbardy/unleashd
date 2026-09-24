import fs from 'node:fs';
import { type ConversationConfig, OwnerPostMentionConfigSchema } from '@unleashd/shared';
import type { Express, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { BuddyDirect } from './buddy-direct';
import {
  CHANNEL_IMAGE_EXTENSIONS,
  CHANNEL_MEDIA_MAX_BYTES,
  CHANNEL_VIDEO_EXTENSIONS,
  channelMediaDirectory,
  requireCanonicalPostMedia,
} from './channel-media';
import { announceChannelPost } from './channel-post-feed';
import type { ChannelResponder } from './channel-responder';
import { mentionedBuddyIds } from './channel-text';
import type { BuddiesStorePort } from './contract';
import { withPostProvenanceFields } from './operations';

// Owner-facing channel routes: posting (with media canonicalization and
// @mention dispatch), who is replying, the workspace Task index for chips and
// the @ picker, channel media upload, and a Buddy's DM / wake-up. Reads of lists/posts/threads stay in
// routes.ts; this module owns everything that needs the responder or disk.

export interface ChannelRouteDependencies {
  getStore(): Promise<BuddiesStorePort>;
  responder: ChannelResponder;
  direct: BuddyDirect;
  uploadsRoot: string;
  sendError(response: Response, error: unknown, fallbackStatus: number): void;
}

export const ListAuthorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner') }).strict(),
  z.object({ kind: z.literal('buddy'), buddyId: z.string().min(1) }).strict(),
]);

const OwnerPostSchema = z
  .object({
    author: ListAuthorSchema,
    key: z.string().trim().min(1).max(200),
    purpose: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(32000),
    evidence: z.array(z.string().trim().min(1).max(4000)).max(32).optional(),
    projectId: z.string().min(1).nullable().optional(),
    threadRootId: z.string().min(1).nullable().optional(),
    mentionConfigs: z.array(OwnerPostMentionConfigSchema).max(32).default([]),
  })
  .strict();

// κ for the owner's per-mention model choices: one entry per Buddy, and only
// for a Buddy the body actually mentions. A choice for anyone else would be
// dropped without a trace, so it is a 400 instead.
function mentionConfigsByBuddy(
  body: string,
  entries: readonly { buddyId: string; config: ConversationConfig }[]
): ReadonlyMap<string, ConversationConfig> {
  const mentioned = new Set(mentionedBuddyIds(body));
  const byBuddy = new Map<string, ConversationConfig>();
  for (const entry of entries) {
    if (!mentioned.has(entry.buddyId))
      throw new Error(`mentionConfigs names ${entry.buddyId}, who is not mentioned in the post`);
    if (byBuddy.has(entry.buddyId))
      throw new Error(`mentionConfigs names ${entry.buddyId} more than once`);
    byBuddy.set(entry.buddyId, entry.config);
  }
  return byBuddy;
}

// The Task index the channel needs for chips and the @ picker: identity,
// live status, owner and todo progress. Not the full project record.
export type ChannelTaskSummary = {
  id: string;
  title: string;
  status: string;
  ownerBuddyId: string;
  ownerName: string;
  todosDone: number;
  todosTotal: number;
  nextAction: string | null;
  updatedAt: string;
};

type OwnedProjectRow = {
  id: string;
  title: string;
  status: string;
  buddy_id: string;
  buddy_name: string;
  next_action: string | null;
  updated_at: string;
  todos: Array<{ status: string }>;
};

function taskSummary(row: OwnedProjectRow): ChannelTaskSummary {
  const counted = row.todos.filter((todo) => todo.status !== 'cancelled');
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    ownerBuddyId: row.buddy_id,
    ownerName: row.buddy_name,
    todosDone: counted.filter((todo) => todo.status === 'done').length,
    todosTotal: counted.length,
    nextAction: row.next_action,
    updatedAt: row.updated_at,
  };
}

const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  ...CHANNEL_IMAGE_EXTENSIONS,
  ...CHANNEL_VIDEO_EXTENSIONS,
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

export function registerChannelRoutes(app: Express, dependencies: ChannelRouteDependencies): void {
  const { getStore, responder, direct, uploadsRoot, sendError } = dependencies;
  const handle =
    (fallback: number, handler: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response) =>
      void handler(req, res).catch((error: unknown) => sendError(res, error, fallback));

  app.post(
    '/api/buddies/lists/:listId/posts',
    handle(400, async (req, res) => {
      const buddies = await getStore();
      const list = buddies.getList(req.params.listId);
      if (!list) {
        res.status(404).json({ error: 'Mailing list not found' });
        return;
      }
      const input = OwnerPostSchema.parse(req.body);
      if (input.author.kind === 'buddy' && input.mentionConfigs.length > 0)
        throw new Error('mentionConfigs apply to owner posts only; Buddy mentions start no turn');
      const mentionConfigs = mentionConfigsByBuddy(input.body, input.mentionConfigs);
      const { post } = buddies.createPost({
        list: list.id,
        author: input.author,
        key: input.key,
        purpose: input.purpose,
        body: requireCanonicalPostMedia(input.body, { uploadsRoot, listId: list.id }),
        evidence: input.evidence ?? [],
        project: input.projectId ?? null,
        threadRoot: input.threadRootId ?? null,
        // Owner HTTP posts carry no conversation context: provenance stays null.
        conversationId: null,
        runId: null,
      });
      announceChannelPost(post);
      // Only the owner's own mentions start turns (channel-responder.ts).
      const mentions =
        input.author.kind === 'owner'
          ? await responder.respondToOwnerPost(list, post, mentionConfigs)
          : [];
      res.status(201).json({ post: withPostProvenanceFields(post), mentions });
    })
  );

  // DM: the one ongoing owner conversation with a Buddy (buddy-direct.ts).
  const DirectSchema = z.object({ workspaceId: z.string().min(1) }).strict();
  app.post(
    '/api/buddies/:buddyId/direct',
    handle(400, async (req, res) => {
      const { workspaceId } = DirectSchema.parse(req.body);
      res.json(await direct.open(req.params.buddyId, workspaceId));
    })
  );

  // Wake: the Buddy catches up on the channels inside its DM and decides what to do.
  app.post(
    '/api/buddies/:buddyId/wake',
    handle(400, async (req, res) => {
      const { workspaceId } = DirectSchema.parse(req.body);
      res.status(202).json(await direct.wake(req.params.buddyId, workspaceId));
    })
  );

  app.get(
    '/api/buddies/lists/:listId/responding',
    handle(400, async (req, res) => {
      res.json(responder.responding(req.params.listId));
    })
  );

  app.get(
    '/api/buddies/workspaces/:workspaceId/tasks',
    handle(400, async (req, res) => {
      const buddies = await getStore();
      const rows = buddies.listBuddyOwnedProjects({
        workspace: req.params.workspaceId,
        includeClosed: true,
      }) as OwnedProjectRow[];
      res.json(rows.map(taskSummary));
    })
  );

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, callback) => {
        try {
          callback(null, channelMediaDirectory(uploadsRoot, String(req.params.listId)));
        } catch (error) {
          callback(error as Error, '');
        }
      },
      filename: (_req, file, callback) => {
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        callback(null, `${Date.now()}_${sanitized}`);
      },
    }),
    limits: { fileSize: CHANNEL_MEDIA_MAX_BYTES, files: 10 },
    fileFilter: (_req, file, callback) =>
      callback(null, MEDIA_EXTENSIONS.has(extensionOf(file.originalname))),
  });

  // Upload lands directly in the channel's media directory, so the composer
  // inserts ![name](absolutePath) and the post passes canonicalization as-is.
  app.post(
    '/api/buddies/lists/:listId/media',
    (req, res, next) => {
      void getStore()
        .then((buddies) => {
          if (!buddies.getList(req.params.listId)) {
            res.status(404).json({ error: 'Mailing list not found' });
            return;
          }
          next();
        })
        .catch((error: unknown) => sendError(res, error, 400));
    },
    (req, _res, next) => {
      fs.mkdirSync(channelMediaDirectory(uploadsRoot, req.params.listId), { recursive: true });
      next();
    },
    upload.array('files', 10),
    (req: Request, res: Response) => {
      const files = req.files as Express.Multer.File[];
      if (files.length === 0) {
        res.status(400).json({
          error: `No supported media: images (${CHANNEL_IMAGE_EXTENSIONS.join(' ')}) or videos (${CHANNEL_VIDEO_EXTENSIONS.join(' ')}) up to 50 MB`,
        });
        return;
      }
      res.status(201).json({
        files: files.map((file) => ({
          originalName: file.originalname,
          absolutePath: file.path,
          mimeType: file.mimetype,
          size: file.size,
        })),
      });
    }
  );
}
