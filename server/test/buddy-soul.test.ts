import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddiesIntegration } from '../src/buddies/integration';
import { createLegacyBuddyMcpServer as createBuddyMcpServer } from '../src/buddies/mcp-server';
import { BuddyOperationsService } from '../src/buddies/operations';

test('owner chat soul edits persist, reject stale writes and refresh new conversation identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-soul-'));
  const store = new BuddiesStore(join(root, 'buddies.sqlite'));
  const workspace = store.createWorkspace({ name: 'Animal Fights', rootPath: root });
  const buddy = store.createBuddy({
    project: workspace.id,
    name: 'Animal Fights Lead',
    role: 'Lead video production',
  });
  const port = store as unknown as BuddiesStorePort;
  const context = { buddyId: buddy.id, workspaceId: workspace.id, conversationId: 'owner-chat' };
  const server = createBuddyMcpServer(port, context);
  const client = new Client({ name: 'soul-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  let reader: BuddiesStore | undefined;
  const integration = createBuddiesIntegration({
    getConversation: () => undefined,
    loadModule: async () => ({
      BuddiesStore: class extends BuddiesStore {
        constructor() {
          super(join(root, 'buddies.sqlite'));
          reader = this;
        }
      },
    }),
  });
  try {
    await Promise.all([client.connect(a), server.connect(b)]);
    const before = await integration.resolveConversation(context);
    assert.match(before.briefing, /^You are Animal Fights Lead\./);
    assert.match(before.briefing, /lead with "I am Animal Fights Lead\."/);
    const initial = await client.callTool({ name: 'get_soul', arguments: {} });
    const head = initial.structuredContent?.data as { body: string; revision: number };
    const content = 'I am Animal Fights Lead. Commit prompts before each bake.';
    const input = {
      content,
      baseVersion: head.revision,
      reasoning: 'Owner requested persistent Buddy identity.',
    };
    const changed = await client.callTool({ name: 'update_soul', arguments: input });
    assert.equal(changed.isError, undefined, JSON.stringify(changed));
    assert.equal(store.readBuddySoul(buddy.id).body, content);
    const savedPath = store.getBuddy(buddy.id)!.soul_path!;
    const savedFile = readFileSync(savedPath, 'utf8');
    assert.match(savedFile, /Commit prompts before each bake/);
    assert.equal(store.getBuddy(buddy.id)!.hire_quota, 0);
    const stale = await client.callTool({
      name: 'update_soul',
      arguments: { ...input, content: 'Stale edit' },
    });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent?.code, 'MEMORY_STALE');
    assert.equal(readFileSync(savedPath, 'utf8'), savedFile);
    const spoofed = await client.callTool({
      name: 'update_soul',
      arguments: { ...input, buddyId: 'another-buddy', hireQuota: 99 },
    });
    assert.equal(spoofed.isError, true);
    const after = integration.readCurrentConversation(context);
    assert.match(after.briefing, /Commit prompts before each bake/);
    assert.notEqual(after.memoryGeneration, before.memoryGeneration);

    for (const restriction of [
      { automationRunId: 'scheduled' },
      { allowedOperations: ['buddy.update_soul'] },
      { delegatedByBuddyId: 'another-buddy' },
    ]) {
      const restricted = { ...context, ...restriction };
      const operations = new BuddyOperationsService(port, restricted);
      assert.throws(
        () => operations.execute('buddy.update_soul', input),
        /direct owner conversation|No owner grant|automation run not found|not allowed|Legacy global knowledge is unavailable/
      );
      const restrictedServer = createBuddyMcpServer(port, restricted);
      const restrictedClient = new Client({ name: 'restricted-soul-test', version: '1' });
      const [c, d] = InMemoryTransport.createLinkedPair();
      try {
        await Promise.all([restrictedClient.connect(c), restrictedServer.connect(d)]);
        assert.ok(
          (await restrictedClient.listTools()).tools.some((tool) => tool.name === 'update_soul')
        );
      } finally {
        await restrictedClient.close();
        await restrictedServer.close();
      }
    }
  } finally {
    reader?.close();
    await client.close();
    await server.close();
    store.close();
  }
  const reopened = new BuddiesStore(join(root, 'buddies.sqlite'));
  try {
    assert.match(reopened.readBuddySoul(buddy.id).body, /Commit prompts before each bake/);
  } finally {
    reopened.close();
    rmSync(root, { recursive: true, force: true });
  }
});
