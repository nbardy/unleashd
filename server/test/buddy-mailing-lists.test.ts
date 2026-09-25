import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import { OwnerChannelUnreadSchema } from '@unleashd/shared';
import express from 'express';
import { createBuddyDirect } from '../src/buddies/buddy-direct';
import { createChannelResponder } from '../src/buddies/channel-responder';
import { registerChannelRoutes } from '../src/buddies/channel-routes';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { BUDDY_AUTOMATION_CLAIM_TOKEN_ENV, resolveBuddyMcpLaunch } from '../src/buddies/mcp-config';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import {
  BuddyOperationInputSchemas,
  BuddyOperationsService,
  MESSAGE_BUDDY_OPERATIONS,
} from '../src/buddies/operations';
import { ownerChannelReads } from '../src/buddies/owner-channel-reads';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { startChatRun } from './fixtures/chat-run';

type Id = { id: string };

function fixture() {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Team', rootPath: '/tmp/team' });
  const a = raw.createBuddy({ project: w.id, name: 'Author', role: 'Write' });
  const b = raw.createBuddy({ project: w.id, name: 'Reader', role: 'Read' });
  return { raw, store, w, a, b };
}

function db(raw: BuddiesStore): DatabaseSync {
  return (raw as unknown as { db: DatabaseSync }).db;
}

function count(raw: BuddiesStore, sql: string): number {
  return (db(raw).prepare(sql).get() as { n: number }).n;
}

function ownProject(
  raw: BuddiesStore,
  buddyId: string,
  workspaceId: string,
  title: string
): string {
  return (
    raw.newProject({
      buddy: buddyId,
      workspace: workspaceId,
      title,
      definitionOfDone: 'Done',
    }) as Id
  ).id;
}

function turn(buddyId: string, workspaceId: string, projectId: string, conversationId: string) {
  return {
    buddyId,
    workspaceId,
    conversationId,
    buddyProjectId: projectId,
    knowledgeScope: { kind: 'project' as const, projectId },
    allowedOperations: MESSAGE_BUDDY_OPERATIONS,
  };
}

async function linkedClient(
  store: ReturnType<typeof coordinationStore>,
  context: Parameters<typeof createBuddyMcpServer>[1]
) {
  const mcp = createBuddyMcpServer(store, context);
  const client = new Client({ name: 'mailing-list-scenario', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(a), client.connect(b)]);
  return {
    call: async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return (result.structuredContent as { data: unknown }).data;
    },
    fail: async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, `expected ${name} to fail`);
      return result.structuredContent as { error: string; code?: string };
    },
    close: async () => {
      await client.close();
      await mcp.close();
    },
  };
}

function routeTestApp(
  store: BuddiesStorePort,
  ownerReads = ownerChannelReads(join(mkdtempSync(join(tmpdir(), 'owner-reads-')), 'reads.json'))
) {
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    sendError(response, error, fallbackStatus) {
      response
        .status(fallbackStatus)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    getNextAutomationRunAt: () => new Date().toISOString(),
    createId: () => 'test-id',
    isConversationDeleted: async () => false,
  });
  registerChannelRoutes(app, {
    getStore: async () => store,
    uploadsRoot: mkdtempSync(join(tmpdir(), 'lists-uploads-')),
    ownerReads,
    channelChanged: () => undefined,
    sendError(response, error, fallbackStatus) {
      response
        .status(fallbackStatus)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    responder: createChannelResponder({
      getStore: async () => store,
      createConversation: async () => {
        throw new Error('not used');
      },
      uploadsRoot: () => tmpdir(),
      channelChanged: () => undefined,
    }),
    direct: createBuddyDirect({
      getStore: async () => store,
      getConversation: () => undefined,
      ensureConversationReady: async () => {
        throw new Error('not used');
      },
      createConversation: async () => {
        throw new Error('not used');
      },
      isConversationDeleted: async () => false,
    }),
  });
  return app;
}

test('public read without a forward: project-scoped peers share a standup, owner reads over HTTP, nothing dispatches', async () => {
  const { raw, store, w, a, b } = fixture();
  try {
    const projectA = ownProject(raw, a.id, w.id, 'A work');
    const projectB = ownProject(raw, b.id, w.id, 'B work');
    const author = await linkedClient(store, turn(a.id, w.id, projectA, 'chat-a'));
    const reader = await linkedClient(store, turn(b.id, w.id, projectB, 'chat-b'));
    const messagesBefore = count(raw, 'SELECT COUNT(*) AS n FROM buddy_messages');
    const runsBefore = store.listBuddyRuns({}).length;
    try {
      const { list } = (await author.call('new_list', {
        key: 'standups',
        name: 'Standups',
        purpose: 'Daily notes',
      })) as unknown as { list: Id };
      await author.call('post', {
        key: 'standup-1',
        listId: list.id,
        purpose: 'standup',
        body: 'Shipped the lists stream',
      });
      const inbox = (await reader.call('get_inbox', {})) as unknown as {
        lists: Array<{ listId: string; name: string; unread: number }>;
      };
      assert.equal(inbox.lists.length, 1);
      assert.equal(inbox.lists[0].unread, 1);
      const read = (await reader.call('get_list', { listId: list.id })) as unknown as {
        posts: Array<{ body: string }>;
      };
      assert.equal(read.posts[0].body, 'Shipped the lists stream');
      assert.equal(count(raw, 'SELECT COUNT(*) AS n FROM buddy_messages'), messagesBefore);
      assert.equal(store.listBuddyRuns({}).length, runsBefore);

      const app = routeTestApp(store);
      const server = app.listen(0, '127.0.0.1');
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('listening', resolve);
          server.once('error', reject);
        });
        const { port } = server.address() as AddressInfo;
        const response = await fetch(`http://127.0.0.1:${port}/api/buddies/lists/${list.id}/posts`);
        assert.equal(response.status, 200);
        const posts = (await response.json()) as Array<{ body: string }>;
        assert.equal(posts[0].body, 'Shipped the lists stream');
        // Owner HTTP reads move no read mark: the author's own unread count is untouched.
        const authorInbox = (await author.call('get_inbox', {})) as unknown as {
          lists: Array<{ unread: number }>;
        };
        assert.equal(authorInbox.lists[0].unread, 1);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    } finally {
      await author.close();
      await reader.close();
    }
  } finally {
    raw.close();
  }
});

test('workspace boundary: a foreign Buddy learns nothing from get_list', async () => {
  const { raw, store, w, a } = fixture();
  try {
    const other = raw.createWorkspace({ name: 'Other', rootPath: '/tmp/other' });
    const c = raw.createBuddy({ project: other.id, name: 'Outsider', role: 'Other' });
    const ops = new BuddyOperationsService(
      store,
      turn(a.id, w.id, ownProject(raw, a.id, w.id, 'A work'), 'chat-a')
    );
    const { list } = ops.execute('buddy.new_list', {
      key: 'standups',
      name: 'Standups',
      purpose: 'Daily notes',
    }).data as { list: Id };
    ops.execute('buddy.post', {
      key: 's1',
      listId: list.id,
      purpose: 'standup',
      body: 'Secret standup body',
    });
    const foreign = await linkedClient(
      store,
      turn(c.id, other.id, ownProject(raw, c.id, other.id, 'C work'), 'chat-c')
    );
    try {
      const failure = await foreign.fail('get_list', { listId: list.id });
      assert.equal(failure.code, 'list_outside_workspace');
      assert.doesNotMatch(JSON.stringify(failure), /Standups|Secret standup body/);
      const missing = await foreign.fail('get_list', { listId: 'list_missing' });
      assert.equal(missing.code, 'list_outside_workspace');
    } finally {
      await foreign.close();
    }
  } finally {
    raw.close();
  }
});

test('cursor rule: fresh reads advance, history paging moves nothing', () => {
  const { raw, store, w, a, b } = fixture();
  try {
    const opsA = new BuddyOperationsService(store, {
      buddyId: a.id,
      workspaceId: w.id,
      conversationId: 'chat-a',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    const opsB = new BuddyOperationsService(store, {
      buddyId: b.id,
      workspaceId: w.id,
      conversationId: 'chat-b',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    const { list } = opsA.execute('buddy.new_list', {
      key: 'l',
      name: 'Standups',
      purpose: 'Notes',
    }).data as { list: Id };
    opsA.execute('buddy.post', { key: 'p1', listId: list.id, purpose: 'standup', body: 'One' });
    const unreadOf = () =>
      (opsB.execute('buddy.get_inbox', {}).data as { lists: Array<{ unread: number }> }).lists[0]
        .unread;
    assert.equal(unreadOf(), 1);
    opsB.execute('buddy.get_list', { listId: list.id });
    assert.equal(unreadOf(), 0);
    const two = opsA.execute('buddy.post', {
      key: 'p2',
      listId: list.id,
      purpose: 'standup',
      body: 'Two',
    }).data as { post: Id };
    assert.equal(unreadOf(), 1);
    const page = opsB.execute('buddy.get_list', { listId: list.id, before: two.post.id }).data as {
      posts: Array<{ body: string }>;
    };
    assert.equal(page.posts.length, 1);
    assert.equal(page.posts[0].body, 'One');
    assert.equal(unreadOf(), 1);
  } finally {
    raw.close();
  }
});

test('idempotency and conflict: key replays hold, changed payloads fail, names stay unique', () => {
  const { raw, store, w, a } = fixture();
  try {
    const ops = new BuddyOperationsService(store, {
      buddyId: a.id,
      workspaceId: w.id,
      conversationId: 'chat-a',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    const { list } = ops.execute('buddy.new_list', {
      key: 'l',
      name: 'Standups',
      purpose: 'Notes',
    }).data as { list: Id };
    const input = { key: 'p1', listId: list.id, purpose: 'standup', body: 'One' };
    const first = ops.execute('buddy.post', input).data as { post: Id };
    assert.equal((ops.execute('buddy.post', input).data as { post: Id }).post.id, first.post.id);
    assert.equal(count(raw, 'SELECT COUNT(*) AS n FROM buddy_list_posts'), 1);
    assert.throws(() => ops.execute('buddy.post', { ...input, body: 'Changed' }), /conflicts/);
    try {
      ops.execute('buddy.new_list', { key: 'other', name: 'standups', purpose: 'Other' });
      assert.fail('taken name must fail');
    } catch (error) {
      assert.equal((error as { code?: string }).code, 'list_name_taken');
    }
  } finally {
    raw.close();
  }
});

test('inbox stays bounded: 500 posts across 25 lists surface as 20 rows with no bodies', async () => {
  const { raw, store, w, a, b } = fixture();
  try {
    const ops = new BuddyOperationsService(store, {
      buddyId: a.id,
      workspaceId: w.id,
      conversationId: 'chat-a',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    for (let i = 0; i < 25; i++) {
      const { list } = ops.execute('buddy.new_list', {
        key: `list-${i}`,
        name: `Stream ${i}`,
        purpose: 'Load',
      }).data as { list: Id };
      for (let j = 0; j < 20; j++)
        ops.execute('buddy.post', {
          key: `post-${i}-${j}`,
          listId: list.id,
          purpose: 'load',
          body: `FILLER_BODY_CANARY ${i}/${j} ${'x'.repeat(200)}`,
        });
    }
    const reader = await linkedClient(
      store,
      turn(b.id, w.id, ownProject(raw, b.id, w.id, 'B'), 'chat-b')
    );
    try {
      const inbox = (await reader.call('get_inbox', {})) as unknown as {
        lists: Array<{ listId: string; name: string; unread: number; latestPostAt: string }>;
      };
      assert.equal(inbox.lists.length, 20);
      const serialized = JSON.stringify(inbox);
      assert.doesNotMatch(serialized, /FILLER_BODY_CANARY/);
      assert.ok(serialized.length < 10000, `lists section stays bounded: ${serialized.length}`);
      assert.ok(inbox.lists.every((row) => row.unread === 20));
    } finally {
      await reader.close();
    }
  } finally {
    raw.close();
  }
});

test('migration preserves messages and runs and lands on the lists schema version', () => {
  const root = mkdtempSync(join(tmpdir(), 'buddies-server-lists-migrate-'));
  const database = join(root, 'buddies.sqlite');
  const policy = { allowed_operations: MESSAGE_BUDDY_OPERATIONS };
  let store = new BuddiesStore(database);
  try {
    const opened = store as unknown as BuddiesStore & {
      sendCoordinatedMessage(input: Record<string, unknown>, authority: unknown): Id;
      listBuddyRuns(filter: Record<string, unknown>): Id[];
      getMessage(id: string): { body: string };
      getBuddyRun(id: string): Id;
    };
    const workspace = opened.createWorkspace({ name: 'Team', rootPath: root });
    const chief = opened.createBuddy({ project: workspace.id, name: 'Chief', role: 'Coordinate' });
    const lead = opened.createBuddy({ project: workspace.id, name: 'Lead', role: 'Deliver' });
    const coordination = coordinationStore(store as unknown as BuddiesStorePort);
    for (const buddy of [chief, lead])
      coordination.setCoordinationMembership(buddy.id, workspace.id, { background_enabled: true });
    const message = opened.sendCoordinatedMessage(
      {
        fromBuddy: chief.id,
        to: lead.id,
        workspace: workspace.id,
        parentConversationId: 'chief-chat',
        purpose: 'deliver',
        body: 'Ship it',
        key: 'chief-1',
      },
      { policy }
    );
    const runId = opened.listBuddyRuns({ buddyId: lead.id })[0].id;
    const before = (db(store).prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    store.close();
    const legacy = new DatabaseSync(database);
    legacy.exec(
      'DROP TABLE buddy_lists; DROP TABLE buddy_list_posts; DROP TABLE buddy_list_reads; PRAGMA user_version = 30;'
    );
    legacy.close();
    store = new BuddiesStore(database);
    const reopened = store as unknown as typeof opened;
    assert.equal(reopened.getMessage(message.id).body, 'Ship it');
    assert.equal(reopened.getBuddyRun(runId).id, runId);
    assert.equal(
      (db(store).prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
      before
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// Registration is not admission. On 2026-09-21 16:58Z the Lead's owner-thread
// call to new_list returned "Operation is outside the run policy" while the
// tool was registered: the MCP child is spawned from source per turn, but the
// run policy is persisted by the long-lived server when the turn begins. This
// scenario drives the REAL entrypoint process under both default policies the
// server issues (owner thread: every operation; delegated worker: the message
// policy) and proves the run-authority gate admits the three list operations.
test('real MCP boundary: default owner-thread and delegated policies admit new_list, post and get_list', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'buddies-lists-boundary-'));
  const raw = new BuddiesStore(join(home, 'buddies.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Team', rootPath: home });
  const a = raw.createBuddy({ project: w.id, name: 'Author', role: 'Write' });
  const b = raw.createBuddy({ project: w.id, name: 'Reader', role: 'Read' });
  for (const buddy of [a, b])
    store.setCoordinationMembership(buddy.id, w.id, { background_enabled: true });
  // chatRunAdmission (server.ts): an owner thread carries no allowed list, so the
  // chat run is issued with every known operation.
  const ownerRun = startChatRun(store, {
    buddyId: a.id,
    workspaceId: w.id,
    conversationId: 'owner-thread',
    allowedOperations: Object.keys(BuddyOperationInputSchemas),
    maxRuntimeSeconds: 600,
  }) as { id: string; claim_token: string };
  // A chat run issued before the operations existed: the tool registers, the
  // run policy rejects. This is the exact shape of the 16:58Z failure.
  const staleRun = startChatRun(store, {
    buddyId: a.id,
    workspaceId: w.id,
    conversationId: 'stale-thread',
    allowedOperations: Object.keys(BuddyOperationInputSchemas).filter(
      (op) => !['buddy.new_list', 'buddy.post', 'buddy.get_list'].includes(op)
    ),
    maxRuntimeSeconds: 600,
  }) as { id: string; claim_token: string };
  // dispatch-service.ts issues delegated work with MESSAGE_BUDDY_OPERATIONS.
  (
    store as unknown as {
      sendCoordinatedMessage(input: Record<string, unknown>, authority: unknown): Id;
    }
  ).sendCoordinatedMessage(
    {
      fromBuddy: a.id,
      to: b.id,
      workspace: w.id,
      parentConversationId: 'owner-thread',
      purpose: 'standup',
      body: 'Read the standups list',
      key: 'standup-request',
    },
    { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
  );
  const queued = store.listBuddyRuns({ buddyId: b.id })[0];
  const workerRun = store.claimBuddyRun(queued.id, {
    claimToken: 'worker-claim',
    conversationId: 'buddy-run-worker',
  }) as { id: string; policy: { allowed_operations: string[] } };
  store.startBuddyRun(workerRun.id, 'worker-claim');
  raw.close();

  const launch = resolveBuddyMcpLaunch();
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !entry[0].startsWith('UNLEASHD_BUDDY_')
    )
  );
  const transcript: Array<{ conversation: string; request: unknown; response: unknown }> = [];
  const spawn = async (
    conversation: string,
    buddyId: string,
    run: { id: string; claimToken: string },
    extraArgs: string[]
  ) => {
    const transport = new StdioClientTransport({
      command: launch.command,
      args: [
        ...launch.args,
        '--buddy',
        buddyId,
        '--workspace',
        w.id,
        '--conversation',
        conversation,
        ...extraArgs,
      ],
      cwd: launch.cwd,
      env: {
        ...baseEnv,
        ...launch.env,
        BUDDIES_HOME: home,
        UNLEASHD_BUDDY_COORDINATION_RUN_ID: run.id,
        [BUDDY_AUTOMATION_CLAIM_TOKEN_ENV]: run.claimToken,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: `lists-boundary-${conversation}`, version: '1' });
    await client.connect(transport);
    return {
      call: async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        transcript.push({
          conversation,
          request: { name, args },
          response: result.structuredContent,
        });
        return result as { isError?: boolean; structuredContent: Record<string, unknown> };
      },
      close: () => client.close(),
    };
  };

  const owner = await spawn(
    'owner-thread',
    a.id,
    { id: ownerRun.id, claimToken: ownerRun.claim_token },
    []
  );
  const stale = await spawn(
    'stale-thread',
    a.id,
    { id: staleRun.id, claimToken: staleRun.claim_token },
    []
  );
  const worker = await spawn(
    'buddy-run-worker',
    b.id,
    { id: workerRun.id, claimToken: 'worker-claim' },
    [
      '--delegated-by',
      a.id,
      ...workerRun.policy.allowed_operations.flatMap((op) => ['--allowed-operation', op]),
    ]
  );
  try {
    const rejected = await stale.call('new_list', {
      key: 'standups',
      name: 'Standups',
      purpose: 'Daily notes',
    });
    assert.equal(rejected.isError, true);
    assert.equal(rejected.structuredContent.error, 'Operation is outside the run policy');

    const created = await owner.call('new_list', {
      key: 'standups',
      name: 'Standups',
      purpose: 'Daily notes',
    });
    assert.equal(created.isError, undefined, JSON.stringify(created.structuredContent));
    const list = (created.structuredContent.data as { list: Id }).list;
    const posted = await owner.call('post', {
      key: 'standup-1',
      listId: list.id,
      purpose: 'standup',
      body: 'Shipped the lists stream',
    });
    assert.equal(posted.isError, undefined, JSON.stringify(posted.structuredContent));

    const unreadOf = async () => {
      const inbox = await worker.call('get_inbox', {});
      assert.equal(inbox.isError, undefined, JSON.stringify(inbox.structuredContent));
      const lists = (
        inbox.structuredContent.data as { lists: Array<{ listId: string; unread: number }> }
      ).lists;
      assert.equal(lists.length, 1);
      assert.equal(lists[0].listId, list.id);
      return lists[0].unread;
    };
    assert.equal(await unreadOf(), 1);
    const read = await worker.call('get_list', { listId: list.id });
    assert.equal(read.isError, undefined, JSON.stringify(read.structuredContent));
    assert.equal(
      (read.structuredContent.data as { posts: Array<{ body: string }> }).posts[0].body,
      'Shipped the lists stream'
    );
    assert.equal(await unreadOf(), 0);
  } finally {
    await Promise.all([owner.close(), stale.close(), worker.close()]);
    t.diagnostic(`mailing-list boundary transcript: ${JSON.stringify(transcript)}`);
    rmSync(home, { recursive: true, force: true });
  }
});

test('instance provenance: two conversations as one buddy stamp distinguishable ids', async () => {
  const home = mkdtempSync(join(tmpdir(), 'buddies-lists-provenance-'));
  const raw = new BuddiesStore(join(home, 'buddies.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Team', rootPath: home });
  const a = raw.createBuddy({ project: w.id, name: 'Author', role: 'Write' });
  store.setCoordinationMembership(a.id, w.id, { background_enabled: true });
  const projectA = ownProject(raw, a.id, w.id, 'A work');
  const opsFor = (conversationId: string) =>
    new BuddyOperationsService(store, {
      buddyId: a.id,
      workspaceId: w.id,
      conversationId,
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
  const opsOne = opsFor('conv-one');
  const opsTwo = opsFor('conv-two');
  try {
    const { list } = opsOne.execute('buddy.new_list', {
      key: 'l',
      name: 'Standups',
      purpose: 'Notes',
    }).data as { list: Id };
    const postOne = (
      opsOne.execute('buddy.post', {
        key: 'p1',
        listId: list.id,
        purpose: 'standup',
        body: 'One',
        projectId: projectA,
      }).data as { post: Id }
    ).post;
    const postTwo = (
      opsTwo.execute('buddy.post', {
        key: 'p2',
        listId: list.id,
        purpose: 'standup',
        body: 'Two',
      }).data as { post: Id }
    ).post;
    type Stamped = { id: string; senderConversationId: string | null; senderRunId: string | null };
    const posts = (
      opsOne.execute('buddy.get_list', { listId: list.id }).data as { posts: Stamped[] }
    ).posts;
    const byId = new Map(posts.map((post) => [post.id, post]));
    assert.equal(byId.get(postOne.id)?.senderConversationId, 'conv-one');
    assert.equal(byId.get(postTwo.id)?.senderConversationId, 'conv-two');
    assert.equal(byId.get(postOne.id)?.senderRunId, null);
    assert.equal(byId.get(postTwo.id)?.senderRunId, null);
    // Caller-supplied ids are never trusted: the input schema stays strict.
    assert.throws(
      () =>
        opsOne.execute('buddy.post', {
          key: 'p3',
          listId: list.id,
          purpose: 'standup',
          body: 'Three',
          senderConversationId: 'forged',
        }),
      /Unrecognized key/
    );

    // The run stamp flows from the real MCP boundary: server-stamped from the
    // spawned turn context, never from the tool arguments.
    const run = startChatRun(store, {
      buddyId: a.id,
      workspaceId: w.id,
      conversationId: 'prov-conv',
      allowedOperations: Object.keys(BuddyOperationInputSchemas),
      maxRuntimeSeconds: 600,
    }) as unknown as { id: string; claim_token: string };
    const launch = resolveBuddyMcpLaunch();
    const baseEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && !entry[0].startsWith('UNLEASHD_BUDDY_')
      )
    );
    const transport = new StdioClientTransport({
      command: launch.command,
      args: [...launch.args, '--buddy', a.id, '--workspace', w.id, '--conversation', 'prov-conv'],
      cwd: launch.cwd,
      env: {
        ...baseEnv,
        ...launch.env,
        BUDDIES_HOME: home,
        UNLEASHD_BUDDY_COORDINATION_RUN_ID: run.id,
        [BUDDY_AUTOMATION_CLAIM_TOKEN_ENV]: run.claim_token,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'lists-provenance', version: '1' });
    await client.connect(transport);
    try {
      const posted = await client.callTool({
        name: 'post',
        arguments: { key: 'p-run', listId: list.id, purpose: 'standup', body: 'Run post' },
      });
      assert.equal(posted.isError, undefined, JSON.stringify(posted));
      const stamped = (posted.structuredContent as { data: { post: Stamped } }).data.post;
      assert.equal(stamped.senderConversationId, 'prov-conv');
      assert.equal(stamped.senderRunId, run.id);
    } finally {
      await client.close();
    }

    // Owner HTTP posts carry no conversation context: reads return nulls.
    const app = routeTestApp(store);
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const { port } = server.address() as AddressInfo;
      const created = await fetch(`http://127.0.0.1:${port}/api/buddies/lists/${list.id}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          author: { kind: 'buddy', buddyId: a.id },
          key: 'p-owner',
          purpose: 'note',
          body: 'Owner note',
        }),
      });
      assert.equal(created.status, 201);
      const ownerPost = (await created.json()) as { post: Stamped };
      assert.equal(ownerPost.post.senderConversationId, null);
      assert.equal(ownerPost.post.senderRunId, null);
      const response = await fetch(`http://127.0.0.1:${port}/api/buddies/lists/${list.id}/posts`);
      assert.equal(response.status, 200);
      const wire = (await response.json()) as Stamped[];
      for (const post of wire) {
        assert.ok('senderConversationId' in post);
        assert.ok('senderRunId' in post);
      }
      const wireById = new Map(wire.map((post) => [post.id, post]));
      assert.equal(wireById.get(postOne.id)?.senderConversationId, 'conv-one');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  } finally {
    raw.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test('task channel feed: project posts across lists, newest-first, owner reads unmarked', async () => {
  const { raw, store, w, a, b } = fixture();
  try {
    const projectA = ownProject(raw, a.id, w.id, 'A work');
    const projectB = ownProject(raw, b.id, w.id, 'B work');
    const ops = new BuddyOperationsService(store, {
      buddyId: a.id,
      workspaceId: w.id,
      conversationId: 'chat-a',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    const reader = new BuddyOperationsService(store, {
      buddyId: b.id,
      workspaceId: w.id,
      conversationId: 'chat-b',
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    });
    const first = ops.execute('buddy.new_list', {
      key: 'one',
      name: 'One',
      purpose: 'First',
    }).data as { list: Id };
    const second = ops.execute('buddy.new_list', {
      key: 'two',
      name: 'Two',
      purpose: 'Second',
    }).data as { list: Id };
    ops.execute('buddy.post', {
      key: 'linked-old',
      listId: first.list.id,
      purpose: 'standup',
      body: 'Linked old',
      projectId: projectA,
    });
    // Same-millisecond posts tie on created_at and fall back to random-id order,
    // which made this newest-first assertion flaky; step the clock first.
    for (const start = Date.now(); Date.now() === start; ) {}
    ops.execute('buddy.post', {
      key: 'linked-new',
      listId: second.list.id,
      purpose: 'standup',
      body: 'Linked new',
      projectId: projectA,
    });
    ops.execute('buddy.post', {
      key: 'other-task',
      listId: first.list.id,
      purpose: 'standup',
      body: 'Other task',
      projectId: projectB,
    });
    ops.execute('buddy.post', {
      key: 'unlinked',
      listId: first.list.id,
      purpose: 'standup',
      body: 'No task',
    });
    const unreadBefore = (
      reader.execute('buddy.get_inbox', {}).data as { lists: Array<{ unread: number }> }
    ).lists.reduce((sum, row) => sum + row.unread, 0);

    const app = routeTestApp(store);
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const { port } = server.address() as AddressInfo;
      const get = (query: string) => fetch(`http://127.0.0.1:${port}/api/buddies/posts${query}`);
      const response = await get(`?workspaceId=${w.id}&projectId=${projectA}`);
      assert.equal(response.status, 200);
      const feed = (await response.json()) as Array<{
        body: string;
        projectId: string | null;
        listId: string;
        senderConversationId: string | null;
        senderRunId: string | null;
      }>;
      assert.deepEqual(
        feed.map((post) => post.body),
        ['Linked new', 'Linked old']
      );
      assert.ok(feed.every((post) => post.projectId === projectA));
      assert.deepEqual(
        feed.map((post) => post.listId).sort(),
        [first.list.id, second.list.id].sort()
      );
      for (const post of feed) {
        assert.equal(post.senderConversationId, 'chat-a');
        assert.equal(post.senderRunId, null);
      }
      const limited = await get(`?workspaceId=${w.id}&projectId=${projectA}&limit=1`);
      assert.equal(limited.status, 200);
      assert.equal(((await limited.json()) as unknown[]).length, 1);
      const other = await get(`?workspaceId=${w.id}&projectId=${projectB}`);
      assert.equal(other.status, 200);
      assert.deepEqual(
        ((await other.json()) as Array<{ body: string }>).map((post) => post.body),
        ['Other task']
      );
      const missing = await get(`?workspaceId=${w.id}&projectId=project_missing`);
      assert.equal(missing.status, 404);
      // Owner feed reads move no read mark.
      const unreadAfter = (
        reader.execute('buddy.get_inbox', {}).data as { lists: Array<{ unread: number }> }
      ).lists.reduce((sum, row) => sum + row.unread, 0);
      assert.equal(unreadAfter, unreadBefore);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  } finally {
    raw.close();
  }
});

// Until 2026-09-25 the owner's channel view read the newest 50 posts and
// nothing else, so a channel's 51st-oldest post was unreachable in the UI.
// The view now pages this route by keyset; offsets would repeat a post
// whenever one lands between two page reads.
test('owner channel paging: every root reachable once by keyset, even with a post landing mid-read; from= holds the window', async () => {
  const { raw, store, w, a } = fixture();
  try {
    const author = { kind: 'buddy' as const, buddyId: a.id };
    const { list } = store.createList({
      workspace: w.id,
      author,
      key: 'busy',
      name: 'Busy',
      purpose: 'Paging',
    });
    const root = (key: string) =>
      store.createPost({ list: list.id, author, key, purpose: 'standup', body: key }).post;
    // 250 roots: more than the package's 200-row read ceiling, so a `from`
    // read of the whole channel has to chunk.
    const roots = Array.from({ length: 250 }, (_, index) => root(`root-${index}`));
    const reply = store.createPost({
      list: list.id,
      author,
      key: 'reply',
      purpose: 'reply',
      body: 'reply',
      threadRoot: roots[10].id,
    }).post;

    const app = routeTestApp(store);
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const { port } = server.address() as AddressInfo;
      type Wire = { id: string; createdAt: string; threadRootId: string | null };
      const read = async (query: string) => {
        const response = await fetch(
          `http://127.0.0.1:${port}/api/buddies/lists/${list.id}/posts${query}`
        );
        return { status: response.status, posts: (await response.json()) as Wire[] };
      };
      const page = async (query: string) => {
        const result = await read(query);
        assert.equal(result.status, 200, JSON.stringify(result.posts));
        return result.posts;
      };

      const walked: Wire[] = [];
      let current = await page('?limit=50');
      walked.push(...current);
      const late = root('late');
      while (current.length === 50) {
        current = await page(`?before=${walked[walked.length - 1].id}&limit=50`);
        walked.push(...current);
      }
      const ids = walked.map((post) => post.id);
      assert.equal(new Set(ids).size, ids.length, 'a post repeated across pages');
      assert.deepEqual(new Set(ids), new Set(roots.map((post) => post.id)));
      for (let index = 1; index < walked.length; index++) {
        const [newer, older] = [walked[index - 1], walked[index]];
        assert.ok(
          newer.createdAt > older.createdAt ||
            (newer.createdAt === older.createdAt && newer.id > older.id),
          'pages must read newest-first'
        );
      }

      // The oldest root as floor: the whole channel, the late post included.
      const whole = await page(`?from=${ids[ids.length - 1]}`);
      assert.deepEqual(
        whole.map((post) => post.id),
        [late.id, ...ids]
      );
      const middle = await page(`?from=${ids[100]}`);
      assert.deepEqual(
        middle.map((post) => post.id),
        [late.id, ...ids.slice(0, 101)]
      );

      assert.equal((await read(`?from=${reply.id}`)).status, 400);
      assert.equal((await read(`?before=${reply.id}`)).status, 400);
      assert.equal((await read(`?from=${ids[5]}&before=${ids[6]}`)).status, 400);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  } finally {
    raw.close();
  }
});

// Owner decision 2026-09-25: the owner's read state is separate from the
// Buddies'. Owner reads must never move a Buddy's package read mark (that
// would silently hide posts from its get_list/get_inbox), and a Buddy reading
// must never clear the owner's unread. Also pins what the rail counts: the
// owner's own posts never count, and the badge is replies in the owner's threads.
test('owner channel unread is separate from Buddy read marks, forward-only and durable', async () => {
  const { raw, store, w, a, b } = fixture();
  const readsFile = join(mkdtempSync(join(tmpdir(), 'owner-reads-')), 'reads.json');
  const app = routeTestApp(store, ownerChannelReads(readsFile));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address() as AddressInfo;
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, json: (await response.json()) as unknown };
    };
    const { list } = store.createList({
      workspace: w.id,
      author: { kind: 'buddy', buddyId: a.id },
      key: 'general',
      name: 'general',
      purpose: 'Talk',
    });
    const listUnread = async () => {
      const { json } = await call('/api/buddies/channels/unread');
      const unread = OwnerChannelUnreadSchema.parse(json);
      const lists = unread.workspaces.find((workspace) => workspace.workspaceId === w.id)!.lists;
      return lists.find((entry) => entry.listId === list.id)!;
    };
    // A channel that predates owner read state starts read: the baseline.
    const before = store.createPost({
      list: list.id,
      author: { kind: 'buddy', buddyId: a.id },
      key: 'old',
      purpose: 'message',
      body: 'before owner reads existed',
    }).post;
    assert.equal((await listUnread()).unread, 0);
    await new Promise((resolve) => setTimeout(resolve, 5));

    let key = 0;
    const post = (
      author: { kind: 'owner' } | { kind: 'buddy'; buddyId: string },
      threadRoot: string | null = null
    ) =>
      store.createPost({
        list: list.id,
        author,
        key: `k${key++}`,
        purpose: 'message',
        body: 'hello',
        threadRoot,
      }).post;
    const buddyRoot = post({ kind: 'buddy', buddyId: a.id });
    const ownerRoot = post({ kind: 'owner' });
    post({ kind: 'buddy', buddyId: b.id }, ownerRoot.id);
    post({ kind: 'buddy', buddyId: a.id }, buddyRoot.id);

    const fresh = await listUnread();
    assert.equal(fresh.unread, 1, "the owner's own root is never unread");
    assert.equal(fresh.repliesToYou, 1, "only the reply in the owner's thread is waiting on them");
    assert.deepEqual(new Set(fresh.unreadThreads), new Set([buddyRoot.id, ownerRoot.id]));

    const buddyMarkBefore = store.listUnread({ buddy: b.id, workspace: w.id });
    const marked = await call(`/api/buddies/lists/${list.id}/owner-read`, {
      postId: fresh.newestPostId,
    });
    assert.equal(marked.status, 200, JSON.stringify(marked.json));
    const caughtUp = await listUnread();
    assert.deepEqual([caughtUp.unread, caughtUp.repliesToYou, caughtUp.unreadThreads], [0, 0, []]);
    assert.deepEqual(
      store.listUnread({ buddy: b.id, workspace: w.id }),
      buddyMarkBefore,
      "the owner catching up moved a Buddy's read mark"
    );

    // A Buddy reading does not clear the owner's unread.
    const late = post({ kind: 'buddy', buddyId: a.id });
    store.markListRead({ buddy: b.id, list: list.id, post: late.id });
    assert.equal((await listUnread()).unread, 1);

    // Forward only: a stale tab echoing an older post un-reads nothing.
    await call(`/api/buddies/lists/${list.id}/owner-read`, { postId: late.id });
    await call(`/api/buddies/lists/${list.id}/owner-read`, { postId: before.id });
    assert.deepEqual((await listUnread()).readThrough, {
      kind: 'post',
      postId: late.id,
      createdAt: late.createdAt,
    });
    assert.equal(
      (await call(`/api/buddies/lists/${list.id}/owner-read`, { postId: 'post_missing' })).status,
      404
    );

    // Durable: a restarted server reads the same marks from disk.
    const reloaded = ownerChannelReads(readsFile).unread(store);
    const entry = reloaded.workspaces
      .find((workspace) => workspace.workspaceId === w.id)!
      .lists.find((candidate) => candidate.listId === list.id)!;
    assert.equal(entry.unread, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    raw.close();
  }
});

// ── Paging the owner's other feeds: a thread's replies, a Task's posts ──

type WirePost = { id: string; createdAt: string };

async function withServer(app: express.Express, body: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const { port } = server.address() as AddressInfo;
    await body(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

// Posts in one millisecond tie on createdAt and order by random id; a post
// that lands later must sort newest, so wait for the clock to move first.
function nextMillisecond(): void {
  for (const start = Date.now(); Date.now() === start; ) {}
}

// Walk a feed back from its newest page by `before`, the way the client pages.
// `land` runs once, after the first page: a post arriving mid-walk.
async function walkBack<T>(page: (query: string) => Promise<WirePost[]>, land: () => T) {
  const walked: WirePost[] = [];
  let current = await page('limit=50');
  walked.push(...current);
  const landed = land();
  while (current.length === 50) {
    current = await page(`before=${walked[walked.length - 1].id}&limit=50`);
    walked.push(...current);
  }
  for (let index = 1; index < walked.length; index++) {
    const [newer, older] = [walked[index - 1], walked[index]];
    assert.ok(
      newer.createdAt > older.createdAt ||
        (newer.createdAt === older.createdAt && newer.id > older.id),
      'pages must read newest-first'
    );
  }
  const ids = walked.map((post) => post.id);
  assert.equal(new Set(ids).size, ids.length, 'a post repeated across pages');
  return { ids, landed };
}

// Until 2026-09-25 the thread route returned a thread's first 200 replies and
// nothing past them, so reply 201 on never reached the owner. It now pages
// like a channel, back from the newest reply, with the root on every read.
test('owner thread paging: 250 replies walked back by keyset, each once, a reply landing mid-walk; from= holds the window', async () => {
  const { raw, store, w, a } = fixture();
  try {
    const author = { kind: 'buddy' as const, buddyId: a.id };
    const { list } = store.createList({
      workspace: w.id,
      author,
      key: 'long',
      name: 'Long',
      purpose: 'Threads',
    });
    let key = 0;
    const post = (threadRoot: string | null) =>
      store.createPost({
        list: list.id,
        author,
        key: `p${key++}`,
        purpose: 'reply',
        body: 'text',
        threadRoot,
      }).post;
    const root = post(null);
    const foreign = post(post(null).id);
    const replies = Array.from({ length: 250 }, () => post(root.id));

    await withServer(routeTestApp(store), async (base) => {
      const thread = `${base}/api/buddies/lists/${list.id}/threads/${root.id}`;
      const read = async (query: string) => {
        const response = await fetch(`${thread}?${query}`);
        return {
          status: response.status,
          json: (await response.json()) as { root: WirePost; replies: WirePost[] },
        };
      };
      const page = async (query: string) => {
        const { status, json } = await read(query);
        assert.equal(status, 200, JSON.stringify(json));
        assert.equal(json.root.id, root.id, 'every read carries the root');
        return json.replies;
      };

      const { ids, landed } = await walkBack(page, () => {
        nextMillisecond();
        return post(root.id);
      });
      assert.deepEqual(new Set(ids), new Set(replies.map((reply) => reply.id)));
      // The reply that landed mid-walk sits above the first page, so walking
      // back never meets it; the window the reader then holds has it once.
      const window = async (floor: string) =>
        (await page(`from=${floor}`)).map((reply) => reply.id);
      assert.deepEqual(await window(ids[ids.length - 1]), [landed.id, ...ids]);
      assert.deepEqual(await window(ids[120]), [landed.id, ...ids.slice(0, 121)]);

      // An anchor outside this thread is a 400, never someone else's replies.
      assert.equal((await read(`before=${foreign.id}`)).status, 400);
      assert.equal((await read(`from=${root.id}`)).status, 400);
      assert.equal((await read(`from=${ids[3]}&limit=50`)).status, 400);
      // A reply is not a thread.
      const replyAsRoot = await fetch(`${base}/api/buddies/lists/${list.id}/threads/${ids[0]}`);
      assert.equal(replyAsRoot.status, 404);
    });
  } finally {
    raw.close();
  }
});

// The Task filter read one page (by offset), so a Task's older posts were out
// of reach. It now pages like a channel. The package reads a Task's posts
// only by offset, so the route keeps the keyset itself (channel-pages.ts
// offsetOlder). A post landing between two of its store reads inside one
// request, which another process writing the database can do, shifts every
// offset by one: forced here once, since nothing else reaches that path.
test('task feed paging: every post once across channels and threads, with posts landing between and within reads', async () => {
  const { raw, store, w, a } = fixture();
  try {
    const author = { kind: 'buddy' as const, buddyId: a.id };
    const task = ownProject(raw, a.id, w.id, 'Long task');
    const otherTask = ownProject(raw, a.id, w.id, 'Other task');
    const channel = (name: string) =>
      store.createList({ workspace: w.id, author, key: name, name, purpose: name }).list.id;
    const [one, two] = [channel('one'), channel('two')];
    let key = 0;
    const post = (list: string, project: string | null, threadRoot: string | null = null) =>
      store.createPost({
        list,
        author,
        key: `t${key++}`,
        purpose: 'standup',
        body: 'text',
        project,
        threadRoot,
      }).post;
    const root = post(one, task);
    const taskPosts = [root];
    for (let index = 0; index < 130; index++) {
      taskPosts.push(index % 2 === 0 ? post(two, task) : post(one, task, root.id));
      post(one, index % 3 === 0 ? otherTask : null);
    }

    let landWithinNextRead = false;
    const racing = new Proxy(store, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property !== 'listPosts')
          return typeof value === 'function' ? value.bind(target) : value;
        return (input: Parameters<typeof store.listPosts>[0]) => {
          const rows = target.listPosts(input);
          if (landWithinNextRead) {
            landWithinNextRead = false;
            nextMillisecond();
            post(two, task);
          }
          return rows;
        };
      },
    });

    await withServer(routeTestApp(racing), async (base) => {
      const feed = `${base}/api/buddies/posts?workspaceId=${w.id}&projectId=${task}`;
      const read = async (query: string) => {
        const response = await fetch(`${feed}&${query}`);
        return { status: response.status, posts: (await response.json()) as WirePost[] };
      };
      const page = async (query: string) => {
        const { status, posts } = await read(query);
        assert.equal(status, 200, JSON.stringify(posts));
        return posts;
      };

      const { ids, landed } = await walkBack(page, () => {
        nextMillisecond();
        return post(one, task);
      });
      assert.deepEqual(new Set(ids), new Set(taskPosts.map((entry) => entry.id)));

      // The window from the oldest post takes three store reads of 50; a post
      // lands after the first. Nothing repeats and nothing already there drops.
      landWithinNextRead = true;
      const window = (await page(`from=${ids[ids.length - 1]}`)).map((entry) => entry.id);
      assert.equal(landWithinNextRead, false, 'the landing was never forced');
      assert.deepEqual(window, [landed.id, ...ids]);
      // The post that landed mid-read is in the next read, once, on top.
      const next = (await page(`from=${ids[ids.length - 1]}`)).map((entry) => entry.id);
      assert.deepEqual(next.slice(1), window);
      assert.equal(new Set(next).size, window.length + 1);

      const outside = post(one, otherTask);
      assert.equal((await read(`before=${outside.id}&limit=50`)).status, 400);
      assert.equal((await read('offset=50')).status, 400);
    });
  } finally {
    raw.close();
  }
});
