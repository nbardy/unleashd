import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServerSpec } from '@nbardy/agent-cli';
import type { Actor, ChannelRef, DocRef, DocScope } from '@unleashd/buddies-core';
import { z } from 'zod';
import { requireCanonicalPostMedia } from './channel-media';
import { type BuddiesCore, OWNER, buddyActor, coreError, settingOf } from './core';
import type { BuddyEvents } from './events';
import type { BuddyGrant, Grants, Role, TurnGrant } from './grants';

/**
 * The one Buddy tool endpoint: stateless streamable HTTP on its own loopback listener, NOT the
 * auth-gated Express app (the owner secret never reaches a turn; a turn's bearer never reaches
 * the owner routes). Each request builds a fresh McpServer from the grant its bearer names.
 * Replaces the per-turn stdio helpers (mcp-server, owner-mcp, builder-mcp-server,
 * memory-review-mcp) and the control server they relayed through: 0 processes per turn, and
 * every write runs in this process, next to the change bus (B2).
 */
export const MCP_SERVER_NAME = 'unleashd_buddy';

export interface ToolDeps {
  core: BuddiesCore;
  events: BuddyEvents;
  uploadsRoot(): string;
}

type Tool<G extends TurnGrant> = {
  description: string;
  schema: z.AnyZodObject;
  /** Writes emit `changed`, which also wakes the runner (a write may enqueue a run). */
  writes: boolean;
  handler(deps: ToolDeps, grant: G, input: never): Promise<unknown>;
};

type ToolSpec<G extends TurnGrant, S extends z.AnyZodObject> = {
  description: string;
  schema: S;
  writes: boolean;
  handler(deps: ToolDeps, grant: G, input: z.infer<S>): Promise<unknown>;
};
// The handler's input type is the schema's; the SDK validates against the same schema first.
const buddyTool = <S extends z.AnyZodObject>(t: ToolSpec<BuddyGrant, S>) =>
  t as unknown as Tool<BuddyGrant>;
const teamTool = <S extends z.AnyZodObject>(t: ToolSpec<TurnGrant, S>) =>
  t as unknown as Tool<TurnGrant>;

const key = z.string().min(1).describe('Idempotency key: the same key replays the first result');
const evidence = z.array(z.string()).max(32).default([]);
const actorOf = (id: string): Actor => (id === 'owner' ? OWNER : buddyActor(id));

const channelRef = z.union([
  z.object({ id: z.string().min(1) }).describe('A channel id (public, direct or task)'),
  z
    .object({ direct: z.array(z.string().min(1)).min(1) })
    .describe("A direct channel with these members (buddy ids, 'owner'); you are always in it"),
  z.object({ task: z.string().min(1) }).describe("A task's channel (its comments)"),
]);

function toChannelRef(author: Actor, ref: z.infer<typeof channelRef>): ChannelRef {
  if ('id' in ref) return { kind: 'id', id: ref.id };
  if ('task' in ref) return { kind: 'task', taskId: ref.task };
  return { kind: 'direct', members: [author, ...ref.direct.map(actorOf)] };
}

const docKind = z.enum(['soul', 'working', 'long_term', 'note', 'shared']);
const memoryKind = z.enum(['working', 'long_term', 'note']);
const docScopeInput = z
  .enum(['turn', 'buddy'])
  .default('turn')
  .describe("'turn': this conversation's audience (default); 'buddy': the portable doc");

type DocInput = { buddyId?: string; kind: DocRef['kind']; scope: 'turn' | 'buddy'; name?: string };
type DocReadInput = DocInput & { query?: string };
type DocWriteInput = DocInput & {
  content: string;
  baseRevision: number;
  reason: string;
  key: string;
};

function docRef(grant: BuddyGrant, input: DocInput): DocRef {
  const scope: DocScope = input.scope === 'buddy' ? { kind: 'buddy' } : grant.scope;
  return {
    buddyId: input.buddyId ?? grant.buddyId,
    scope,
    kind: input.kind,
    name: input.name ?? '',
  };
}

type Kinds = z.ZodType<DocRef['kind']>;
const docReadSchema = (kinds: Kinds) =>
  z.object({
    buddyId: z.string().optional().describe('Default: you'),
    kind: kinds,
    scope: docScopeInput,
    name: z.string().optional(),
    query: z.string().max(500).optional().describe('Notes only: one literal substring to find'),
  });
const docWriteSchema = (kinds: Kinds) =>
  z.object({
    buddyId: z.string().optional().describe('Default: you'),
    kind: kinds,
    scope: docScopeInput,
    name: z.string().optional(),
    content: z.string().max(40_000),
    baseRevision: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'The revision you read (0 = new). A stale write is a conflict: re-read and reconcile'
      ),
    reason: z.string().min(1).max(2000),
    key,
  });

async function readDocs(deps: ToolDeps, grant: BuddyGrant, input: DocReadInput) {
  const ref = docRef(grant, input);
  if (input.kind !== 'note') return deps.core.readDoc(grant.principal, ref);
  const needle = input.query?.toLowerCase() ?? '';
  const notes = await deps.core.listDocs(grant.principal, ref.buddyId, 'note');
  return notes
    .filter((note) => JSON.stringify(note.scope) === JSON.stringify(ref.scope))
    .filter((note) => note.content.toLowerCase().includes(needle))
    .slice(0, 8);
}

async function writeDoc(deps: ToolDeps, grant: BuddyGrant, input: DocWriteInput) {
  // A note is append-only: each write is a new note doc, named by time (as imported notes are).
  const name = input.kind === 'note' ? `${new Date().toISOString()}:${input.key}` : input.name;
  return deps.core.writeDoc(grant.principal, {
    doc: docRef(grant, { ...input, name }),
    content: input.content,
    baseRevision: input.kind === 'note' ? 0 : input.baseRevision,
    reason: input.reason,
    key: input.key,
  });
}

const taskWriteSchema = () =>
  z.object({
    write: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('create'),
        ownerId: z.string().optional().describe('Default: you'),
        parentId: z.string().optional(),
        title: z.string().min(1).max(300),
        doneCriteria: z.string().min(1).max(4000),
      }),
      z.object({
        kind: z.literal('update'),
        taskId: z.string().min(1),
        baseRevision: z.number().int().positive(),
        changes: z.object({
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
        }),
      }),
      z.object({
        kind: z.literal('comment'),
        taskId: z.string().min(1),
        body: z.string().min(1).max(32_000),
        evidence,
      }),
    ]),
    key,
  });

/** Task writes, shared by Buddy turns and the Builder (which has no Buddy to default to). */
async function writeTask(
  deps: ToolDeps,
  grant: TurnGrant,
  input: z.infer<ReturnType<typeof taskWriteSchema>>,
  defaultOwner: string | null
) {
  // A Builder create names its owner (schema); a Buddy's defaults to the Buddy itself.
  const ownerOf = (id: string | undefined) => {
    const owner = id ?? defaultOwner;
    if (owner === null) throw new Error('a task needs an ownerId');
    return owner;
  };
  const write = input.write;
  switch (write.kind) {
    case 'create':
      return deps.core.upsertTask(grant.principal, {
        kind: 'create',
        ownerId: ownerOf(write.ownerId),
        parentId: write.parentId,
        title: write.title,
        doneCriteria: write.doneCriteria,
        key: input.key,
      });
    case 'update':
      return deps.core.upsertTask(grant.principal, { ...write, key: input.key });
    case 'comment': {
      const post = await deps.core.post(
        grant.author,
        { kind: 'task', taskId: write.taskId },
        {
          kind: 'inform',
          body: write.body,
          evidence: write.evidence,
          taskId: write.taskId,
          fromConversationId: grant.conversationId,
          key: input.key,
        }
      );
      const channel = await deps.core.openChannel(grant.author, {
        kind: 'id',
        id: post.channelId,
      });
      deps.events.emit({ kind: 'posted', post, channel });
      return post;
    }
  }
}

async function taskDetail(deps: ToolDeps, grant: TurnGrant, taskId: string) {
  const task = await deps.core.getTask(taskId);
  const channel = await deps.core.openChannel(grant.author, { kind: 'task', taskId: task.id });
  const [children, comments] = await Promise.all([
    deps.core.listTasks({ kind: 'children', parentId: task.id }),
    deps.core.listPosts(grant.author, { kind: 'channel', channelId: channel.id }, null, 20),
  ]);
  return { task, children, comments: comments.posts };
}

// Pattern: table-driven (docs/patterns.md#table-driven)
const BUDDY_TOOLS = {
  post: buddyTool({
    description:
      "Write a post. `channel`: a channel id, {direct:[members]} (a DM, created on first use), or {task}. kind 'request' (DMs only) asks the other members for an answer and starts their turn; 'inform' wakes nobody. Reply in a thread with replyToId. Embed media as ![alt](/absolute/path).",
    writes: true,
    schema: z.object({
      channel: channelRef,
      body: z.string().min(1).max(32_000),
      kind: z.enum(['inform', 'request']).default('inform'),
      replyToId: z.string().optional(),
      taskId: z.string().optional(),
      purpose: z.string().max(200).optional(),
      evidence,
      key,
    }),
    async handler(deps, grant, input) {
      const channel = await deps.core.openChannel(
        grant.author,
        toChannelRef(grant.author, input.channel)
      );
      const body = requireCanonicalPostMedia(input.body, {
        uploadsRoot: deps.uploadsRoot(),
        channelId: channel.id,
      });
      const post = await deps.core.post(
        grant.author,
        { kind: 'id', id: channel.id },
        { ...input, body, fromConversationId: grant.conversationId }
      );
      deps.events.emit({ kind: 'posted', post, channel });
      return post;
    },
  }),
  answer: buddyTool({
    description:
      'Answer a request you owe (inbox.requests): the answer is posted in its thread and the requester is woken with it. One answer per request.',
    writes: true,
    schema: z.object({
      requestId: z.string().min(1),
      body: z.string().min(1).max(32_000),
      evidence,
      key,
    }),
    async handler(deps, grant, input) {
      const post = await deps.core.answer(grant.author, input);
      const channel = await deps.core.openChannel(grant.author, { kind: 'id', id: post.channelId });
      deps.events.emit({ kind: 'posted', post, channel });
      return post;
    },
  }),
  inbox: buddyTool({
    description:
      'Requests you owe an answer, your own open requests, and your channels here with unread counts.',
    writes: false,
    schema: z.object({}),
    handler: (deps, grant) => deps.core.inbox(grant.author, grant.workspaceId),
  }),
  channel_read: buddyTool({
    description:
      'Read a channel (top-level posts, newest first) or one thread, or search every channel you can read here for posts containing all the given words. Page older with `before` from the previous page. Reading a channel from its newest post marks it read.',
    writes: false,
    schema: z.object({
      read: z.union([
        z.object({ channelId: z.string().min(1) }),
        z.object({ threadId: z.string().min(1) }),
        z.object({ search: z.string().min(1).max(200).describe('Words that must all appear') }),
      ]),
      before: z.object({ ord: z.string() }).optional().describe('next from the previous page'),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    async handler(deps, grant, input) {
      if ('search' in input.read)
        return deps.core.searchPosts(
          grant.author,
          grant.workspaceId,
          input.read.search,
          input.limit
        );
      const query =
        'channelId' in input.read
          ? ({ kind: 'channel', channelId: input.read.channelId } as const)
          : ({ kind: 'thread', rootId: input.read.threadId } as const);
      const page = await deps.core.listPosts(grant.author, query, input.before, input.limit);
      const newest = page.posts[0];
      if (query.kind === 'channel' && !input.before && newest)
        await deps.core.markRead(grant.author, query.channelId, newest.id);
      return page;
    },
  }),
  tasks: buddyTool({
    description:
      "Read tasks: yours, another buddy's, the workspace's, or one task with its subtasks and latest comments.",
    writes: false,
    schema: z.object({
      view: z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('mine') }),
          z.object({ kind: z.literal('owner'), buddyId: z.string().min(1) }),
          z.object({ kind: z.literal('workspace') }),
          z.object({ kind: z.literal('task'), taskId: z.string().min(1) }),
        ])
        .default({ kind: 'mine' }),
    }),
    async handler(deps, grant, input) {
      switch (input.view.kind) {
        case 'mine':
          return deps.core.listTasks({ kind: 'owner', buddyId: grant.buddyId });
        case 'owner':
          return deps.core.listTasks({ kind: 'owner', buddyId: input.view.buddyId });
        case 'workspace':
          return deps.core.listTasks({ kind: 'workspace', workspaceId: grant.workspaceId });
        case 'task':
          return taskDetail(deps, grant, input.view.taskId);
      }
    },
  }),
  task_write: buddyTool({
    description:
      'Create a task (a subtask with parentId), update one (compare-and-swap on baseRevision; pausing, cancelling or reassigning cancels its queued runs), or comment on one.',
    writes: true,
    schema: taskWriteSchema(),
    handler: (deps, grant, input) => writeTask(deps, grant, input, grant.buddyId),
  }),
  doc_read: buddyTool({
    description:
      'Read a doc: soul, working or long-term memory, shared docs, or notes (with `query`, a literal substring; at most 8). Returns its revision for doc_write.',
    writes: false,
    schema: docReadSchema(docKind),
    handler: readDocs,
  }),
  doc_write: buddyTool({
    description:
      'Replace a doc with complete content (compare-and-swap on baseRevision; every revision is kept) or append a note. Tasks own current work: never copy task status into memory.',
    writes: true,
    schema: docWriteSchema(docKind),
    handler: writeDoc,
  }),
  runs: buddyTool({
    description: "List a buddy's runs (default: yours), read one, or cancel one.",
    writes: true,
    schema: z.object({
      action: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('list'), buddyId: z.string().optional() }),
        z.object({ kind: z.literal('get'), runId: z.string().min(1) }),
        z.object({ kind: z.literal('cancel'), runId: z.string().min(1) }),
      ]),
    }),
    async handler(deps, grant, input) {
      switch (input.action.kind) {
        case 'list':
          return deps.core.listRuns(
            { kind: 'buddy', buddyId: input.action.buddyId ?? grant.buddyId },
            20
          );
        case 'get':
          return deps.core.getRun(input.action.runId);
        case 'cancel':
          return deps.core.cancelRun(grant.principal, input.action.runId);
      }
    },
  }),
  schedule: buddyTool({
    description:
      'List schedules, or create/update one (cron + IANA timezone + prompt). A due slot starts a run.',
    writes: true,
    schema: z.object({
      action: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('list'), buddyId: z.string().optional() }),
        z.object({
          kind: z.literal('put'),
          id: z.string().optional().describe('Absent: create'),
          buddyId: z.string().optional(),
          taskId: z.string().optional(),
          name: z.string().min(1).max(120),
          cron: z.string().min(1),
          timezone: z.string().min(1),
          prompt: z.string().min(1).max(16_000),
          enabled: z.boolean(),
          key,
        }),
      ]),
    }),
    async handler(deps, grant, input) {
      const action = input.action;
      switch (action.kind) {
        case 'list':
          return deps.core.listSchedules(action.buddyId ?? grant.buddyId);
        case 'put':
          return deps.core.putSchedule(grant.principal, {
            ...action,
            buddyId: action.buddyId ?? grant.buddyId,
            limits: '{}',
          });
      }
    },
  }),
};

const TEAM_TOOLS = {
  team: teamTool({
    description: 'The team directory: workspaces and their buddies (role, manager, model, status).',
    writes: false,
    schema: z.object({ workspaceId: z.string().optional().describe('Default: every workspace') }),
    async handler(deps, _grant, input) {
      const workspaces = (await deps.core.listWorkspaces()).filter(
        (workspace) => !input.workspaceId || workspace.id === input.workspaceId
      );
      return Promise.all(
        workspaces.map(async (workspace) => ({
          ...workspace,
          buddies: await deps.core.listBuddies(workspace.id),
        }))
      );
    },
  }),
  team_admin: teamTool({
    description:
      'Owner only: hire a buddy, or change one (profile, manager, model, limits, archive).',
    writes: true,
    schema: z.object({
      change: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('create'),
          workspaceId: z.string().min(1),
          slug: z.string().regex(/^[a-z0-9-]+$/),
          name: z.string().min(1),
          role: z.string().min(1),
          managerId: z.string().optional(),
          provider: z.string().optional(),
          model: z.string().optional(),
          reasoningEffort: z.string().optional(),
          backgroundEnabled: z
            .boolean()
            .describe('Whether requests and schedules may start its turns (off: they wait)'),
          soul: z
            .string()
            .max(10_000)
            .optional()
            .describe("The new buddy's soul: its identity and role"),
        }),
        z.object({
          kind: z.literal('update'),
          buddyId: z.string().min(1),
          name: z.string().optional(),
          role: z.string().optional(),
          managerId: z.string().nullable().optional().describe('null: reports to nobody'),
          provider: z.string().nullable().optional().describe('null: back to the default'),
          model: z.string().nullable().optional().describe('null: back to the default'),
          reasoningEffort: z.string().nullable().optional().describe('null: back to the default'),
          backgroundEnabled: z.boolean().optional(),
          maxActiveRuns: z.number().int().positive().optional(),
          status: z.enum(['active', 'archived']).optional(),
        }),
      ]),
      key,
    }),
    async handler(deps, grant, input) {
      const change = input.change;
      const manager = (id: string | null) =>
        id === null ? ({ kind: 'nobody' } as const) : ({ kind: 'buddy', id } as const);
      switch (change.kind) {
        case 'create': {
          const { soul, ...profile } = change;
          const buddy = await deps.core.createBuddy(grant.principal, {
            ...profile,
            manager: manager(change.managerId ?? null),
            key: input.key,
          });
          if (soul)
            await deps.core.writeDoc(grant.principal, {
              doc: { buddyId: buddy.id, scope: { kind: 'buddy' }, kind: 'soul', name: '' },
              content: soul,
              baseRevision: 0,
              reason: 'hired',
              key: `${input.key}:soul`,
            });
          return buddy;
        }
        case 'update': {
          const {
            kind: _kind,
            buddyId,
            managerId,
            provider,
            model,
            reasoningEffort,
            ...changes
          } = change;
          return deps.core.updateBuddy(grant.principal, {
            buddyId,
            changes: {
              ...changes,
              provider: settingOf(provider),
              model: settingOf(model),
              reasoningEffort: settingOf(reasoningEffort),
              manager: managerId === undefined ? undefined : manager(managerId),
            },
            key: input.key,
          });
        }
      }
    },
  }),
};

// The Builder saves work for the staff it hires (as the owner's old Builder tools did). It has no
// Buddy of its own, so every view and every new task names its Buddy.
const BUILDER_TOOLS = {
  tasks: teamTool({
    description: "Read a buddy's tasks, a workspace's, or one task with its subtasks and comments.",
    writes: false,
    schema: z.object({
      view: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('owner'), buddyId: z.string().min(1) }),
        z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1) }),
        z.object({ kind: z.literal('task'), taskId: z.string().min(1) }),
      ]),
    }),
    async handler(deps, grant, input) {
      switch (input.view.kind) {
        case 'owner':
          return deps.core.listTasks({ kind: 'owner', buddyId: input.view.buddyId });
        case 'workspace':
          return deps.core.listTasks({ kind: 'workspace', workspaceId: input.view.workspaceId });
        case 'task':
          return taskDetail(deps, grant, input.view.taskId);
      }
    },
  }),
  task_write: teamTool({
    description:
      'Create a task for a buddy (ownerId required), update one (compare-and-swap on baseRevision), or comment on one.',
    writes: true,
    schema: taskWriteSchema(),
    handler: (deps, grant, input) => writeTask(deps, grant, input, null),
  }),
};

const REVIEWER_TOOLS = {
  doc_read: {
    ...BUDDY_TOOLS.doc_read,
    schema: docReadSchema(z.enum(['soul', 'working', 'long_term', 'note'])),
  },
  // The reviewer curates memory and notes; its schema has no soul or shared docs.
  doc_write: { ...BUDDY_TOOLS.doc_write, schema: docWriteSchema(memoryKind) },
};

/** Which tools a role is shown. Presentation only: the crate's `authorize` decides every call. */
export function toolsFor(role: Role): Record<string, Tool<TurnGrant>> {
  const { team_admin, team } = TEAM_TOOLS;
  const buddy = BUDDY_TOOLS as Record<string, Tool<TurnGrant>>;
  switch (role) {
    case 'worker':
      return { ...buddy, team };
    case 'owner':
      return { ...buddy, team, team_admin };
    case 'reviewer':
      return REVIEWER_TOOLS as Record<string, Tool<TurnGrant>>;
    case 'builder':
      return { ...TEAM_TOOLS, ...BUILDER_TOOLS } as Record<string, Tool<TurnGrant>>;
  }
}

/** The tool list a role's turn loads, as JSON (the context meter counts it). */
export function toolManifest(role: Role): string {
  return JSON.stringify(
    Object.entries(toolsFor(role)).map(([name, t]) => ({ name, description: t.description }))
  );
}

/** One tool call under a grant: typed errors come back as a tool error, never a crash. */
// Pattern: idempotency-keys (docs/patterns.md#idempotency-keys) — every writing tool takes a `key`
// the crate records once per (actor, workspace); a retried call replays the first result.
export async function callTool(deps: ToolDeps, grant: TurnGrant, name: string, input: unknown) {
  const selected = toolsFor(grant.role)[name];
  if (!selected)
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `[denied] ${name} is not available to this turn` }],
    };
  try {
    grant.observe(name, input);
    const result = await selected.handler(deps, grant, input as never);
    if (selected.writes) deps.events.emit({ kind: 'changed' });
    return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null) }] };
  } catch (error) {
    const typed = coreError(error);
    const text = typed ? typed.message : error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text' as const, text }] };
  }
}

// The SDK's registerTool generics instantiate every zod schema type deeply (TS2589); tools are
// registered through this narrow view instead.
type ToolRegistry = {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.AnyZodObject },
    callback: (input: unknown) => Promise<unknown>
  ): unknown;
};

function mcpServerFor(deps: ToolDeps, grant: TurnGrant): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: '3' });
  const registry = server as unknown as ToolRegistry;
  for (const [name, entry] of Object.entries(toolsFor(grant.role))) {
    registry.registerTool(
      name,
      { description: entry.description, inputSchema: entry.schema },
      (input: unknown) => callTool(deps, grant, name, input)
    );
  }
  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : undefined;
}

export type McpEndpoint = {
  url: string;
  close(): Promise<void>;
  spec(grant: TurnGrant): McpServerSpec;
};

/** Serve `/mcp` on 127.0.0.1 at an OS-assigned port. */
export async function startMcpEndpoint(deps: ToolDeps & { grants: Grants }): Promise<McpEndpoint> {
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const grant = bearer ? deps.grants.lookup(bearer) : null;
    if (!grant) return void res.writeHead(401).end('unknown, expired or revoked turn grant');
    if (req.method !== 'POST' || req.url !== '/mcp') return void res.writeHead(405).end();
    const server = mcpServerFor(deps, grant);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, await readJson(req));
  };
  const http: Server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('[buddies-mcp] request failed:', error);
      if (!res.headersSent) res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  return {
    url,
    spec: (grant) => ({
      kind: 'http',
      url,
      headers: { Authorization: `Bearer ${grant.token}` },
      required: true,
    }),
    close: () => new Promise((resolve) => http.close(() => resolve())),
  };
}
