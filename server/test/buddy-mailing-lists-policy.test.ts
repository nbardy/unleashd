import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';

// Registration is not admission: a claimed run enforces its own immutable
// allowed_operations snapshot. A fresh run dispatched under the current
// default employee policy (MESSAGE_BUDDY_OPERATIONS, as dispatch-service
// builds it) admits the mailing-list tools; a pre-change snapshot rejects
// them with "Operation is outside the run policy" by design.
function freshRunFixture(allowedOperations: readonly string[]) {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Team', rootPath: '/tmp/team' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
  const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Implement' });
  for (const buddy of [lead, worker])
    store.setCoordinationMembership(buddy.id, w.id, { background_enabled: true });
  const message = store.sendCoordinatedMessage(
    {
      fromBuddy: lead.id,
      to: worker.id,
      workspace: w.id,
      parentConversationId: 'lead-chat',
      purpose: 'Run the lists proof',
      body: 'Prove list admission end to end',
      key: 'dispatch-1',
    },
    { policy: { allowed_operations: [...allowedOperations] } }
  );
  const run = store.listBuddyRuns({ buddyId: worker.id })[0];
  store.claimBuddyRun(run.id, { claimToken: 'worker-token', conversationId: 'worker-chat' });
  store.startBuddyRun(run.id, 'worker-token');
  return { raw, store, w, lead, worker, message, run };
}

async function claimedClient(
  store: ReturnType<typeof coordinationStore>,
  workerId: string,
  workspaceId: string,
  runId: string
) {
  const mcp = createBuddyMcpServer(
    store,
    {
      buddyId: workerId,
      workspaceId,
      conversationId: 'worker-chat',
      coordinationRunId: runId,
      allowedOperations: MESSAGE_BUDDY_OPERATIONS,
    },
    { automationClaimToken: 'worker-token' }
  );
  const client = new Client({ name: 'mailing-list-admission', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(a), client.connect(b)]);
  return {
    call: async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      return { request: { name, arguments: args }, response: result };
    },
    close: async () => {
      await client.close();
      await mcp.close();
    },
  };
}

test('fresh default-policy run admits new_list, post and get_list through the MCP boundary', async () => {
  const { raw, store, w, worker, run } = freshRunFixture(MESSAGE_BUDDY_OPERATIONS);
  const client = await claimedClient(store, worker.id, w.id, run.id);
  try {
    const created = await client.call('new_list', {
      key: 'standups',
      name: 'Standups',
      purpose: 'Daily notes',
    });
    assert.equal(created.response.isError, undefined, JSON.stringify(created.response));
    const list = (created.response.structuredContent as { data: { list: { id: string } } }).data
      .list;
    assert.match(list.id, /^list_/);

    const posted = await client.call('post', {
      key: 'standup-1',
      listId: list.id,
      purpose: 'standup',
      body: 'Shipped the lists stream',
    });
    assert.equal(posted.response.isError, undefined, JSON.stringify(posted.response));

    const inboxBefore = await client.call('get_inbox', {});
    assert.equal(inboxBefore.response.isError, undefined, JSON.stringify(inboxBefore.response));
    const unreadBefore = (
      inboxBefore.response.structuredContent as {
        data: { lists: Array<{ listId: string; unread: number }> };
      }
    ).data.lists;
    assert.equal(unreadBefore.length, 1);
    assert.equal(unreadBefore[0].unread, 1);

    const read = await client.call('get_list', { listId: list.id });
    assert.equal(read.response.isError, undefined, JSON.stringify(read.response));
    assert.equal(
      (read.response.structuredContent as { data: { posts: Array<{ body: string }> } }).data
        .posts[0].body,
      'Shipped the lists stream'
    );

    const inboxAfter = await client.call('get_inbox', {});
    assert.equal(
      (
        inboxAfter.response.structuredContent as {
          data: { lists: Array<{ unread: number }> };
        }
      ).data.lists[0].unread,
      0
    );
  } finally {
    await client.close();
    raw.close();
  }
});

test('pre-change run snapshot rejects list tools with the run-policy error', async () => {
  const legacy = (MESSAGE_BUDDY_OPERATIONS as readonly string[]).filter(
    (op) => op !== 'buddy.new_list' && op !== 'buddy.post' && op !== 'buddy.get_list'
  );
  const { raw, store, w, worker, run } = freshRunFixture(legacy);
  const client = await claimedClient(store, worker.id, w.id, run.id);
  try {
    const rejected = await client.call('new_list', {
      key: 'standups',
      name: 'Standups',
      purpose: 'Daily notes',
    });
    assert.equal(rejected.response.isError, true);
    assert.equal(
      (rejected.response.structuredContent as { error: string }).error,
      'Operation is outside the run policy'
    );
  } finally {
    await client.close();
    raw.close();
  }
});
