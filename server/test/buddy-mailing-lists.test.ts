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
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { BUDDY_AUTOMATION_CLAIM_TOKEN_ENV, resolveBuddyMcpLaunch } from '../src/buddies/mcp-config';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import {
  BuddyOperationInputSchemas,
  BuddyOperationsService,
  MESSAGE_BUDDY_OPERATIONS,
} from '../src/buddies/operations';
import { registerBuddyRoutes } from '../src/buddies/routes';

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

function routeTestApp(store: BuddiesStorePort) {
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('not used');
    },
    sendError(response, error, fallbackStatus) {
      response
        .status(fallbackStatus)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    getNextAutomationRunAt: () => new Date().toISOString(),
    createId: () => 'test-id',
    isConversationDeleted: async () => false,
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
    opsA.execute('buddy.post', { key: 'p2', listId: list.id, purpose: 'standup', body: 'Two' });
    assert.equal(unreadOf(), 1);
    const page = opsB.execute('buddy.get_list', { listId: list.id, cursor: 'list:1' }).data as {
      posts: Array<{ body: string }>;
      nextCursor: string | null;
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
  // server.ts beginBuddyChatRun: an owner thread carries no allowed list, so the
  // chat run is issued with every known operation.
  const ownerRun = store.beginBuddyChatRun({
    buddyId: a.id,
    workspaceId: w.id,
    conversationId: 'owner-thread',
    allowedOperations: Object.keys(BuddyOperationInputSchemas),
    maxRuntimeSeconds: 600,
  }) as { id: string; claim_token: string };
  // A chat run issued before the operations existed: the tool registers, the
  // run policy rejects. This is the exact shape of the 16:58Z failure.
  const staleRun = store.beginBuddyChatRun({
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
