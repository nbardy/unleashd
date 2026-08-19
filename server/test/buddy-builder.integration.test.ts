import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import { BuddyBuilderResultSchema, createDefaultConversationConfig } from '@unleashd/shared';
import express from 'express';
import { BuddyBuilderService, type BuddyBuilderStore } from '../src/buddies/builder';
import { createBuddyBuilderMcpServer } from '../src/buddies/builder-mcp-server';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { ConversationConfigStore } from '../src/conversations/config-store';

const CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440000';

test('Builder MCP creates one durable Buddy and canonical result across restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'unleashd-buddy-builder-'));
  const workspaceRoot = join(root, 'workspace');
  const database = join(root, 'buddies.sqlite');
  mkdirSync(workspaceRoot);

  let store = new BuddiesStore(database);
  const workspace = store.createWorkspace({ name: 'Growth', rootPath: workspaceRoot });
  const mcpServer = createBuddyBuilderMcpServer(
    store as unknown as BuddyBuilderStore,
    CONVERSATION_ID
  );
  const mcpClient = new Client({ name: 'buddy-builder-integration', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);

  const request = {
    workspaceId: workspace.id,
    name: 'Growth Researcher',
    role: 'Research campaigns and competitors',
  };
  try {
    const tools = await mcpClient.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'create_buddy',
      'list_buddies',
      'list_workspaces',
    ]);
    const created = await mcpClient.callTool({ name: 'create_buddy', arguments: request });
    assert.equal(created.isError, undefined);
    const result = BuddyBuilderResultSchema.parse(created.structuredContent?.result);
    assert.equal(result.buddy.model, 'gpt-5.6-luna');
    assert.equal(result.buddy.reasoning_effort, 'high');
  } finally {
    await mcpClient.close();
    await mcpServer.close();
    store.close();
  }

  store = new BuddiesStore(database);
  try {
    const builder = new BuddyBuilderService(store as unknown as BuddyBuilderStore, CONVERSATION_ID);
    const recovered = builder.getResult();
    assert.ok(recovered);
    assert.equal(recovered.buddy.name, request.name);
    assert.equal(builder.createBuddy(request).buddy.id, recovered.buddy.id);
    assert.throws(
      () => builder.createBuddy({ ...request, name: 'Different Buddy' }),
      /already created a different Buddy/
    );
    assert.equal(store.listBuddies().length, 1);

    const app = express();
    app.use(express.json());
    registerBuddyRoutes(app, {
      getStore: async () => store as unknown as BuddiesStorePort,
      getScheduler: () => null,
      createConversation: async () => {
        throw new Error('not used');
      },
      getBuilderResult: async (conversationId) =>
        new BuddyBuilderService(store as unknown as BuddyBuilderStore, conversationId).getResult(),
      sendError(response, error, status) {
        response
          .status(status)
          .json({ error: error instanceof Error ? error.message : String(error) });
      },
      getNextAutomationRunAt: () => '2026-07-29T00:00:00.000Z',
      createId: () => 'not-used',
      isConversationDeleted: async () => false,
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${port}/api/buddies/builder/${CONVERSATION_ID}/result`
      );
      assert.equal(response.status, 200);
      assert.equal(
        BuddyBuilderResultSchema.parse(await response.json()).buddy.id,
        recovered.buddy.id
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('blank Builder purpose is durable before a provider transcript exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'unleashd-builder-config-'));
  try {
    const first = new ConversationConfigStore({ appDataRoot: root });
    await first.create({
      conversationId: CONVERSATION_ID,
      workingDirectory: root,
      config: createDefaultConversationConfig('codex'),
      creation: {
        commandId: 'builder-command',
        fingerprint: 'builder-fingerprint',
        purpose: 'buddy_builder',
      },
      provenance: 'user',
    });

    const reopened = new ConversationConfigStore({ appDataRoot: root });
    const record = await reopened.getByConversationId(CONVERSATION_ID);
    assert.equal(record?.creation?.purpose, 'buddy_builder');
    assert.equal(record?.workingDirectory, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
