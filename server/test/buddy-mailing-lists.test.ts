import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';
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
