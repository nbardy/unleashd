import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import {
  BuddyBuilderResultSchema,
  BuddyBuilderResultsSchema,
  createDefaultConversationConfig,
} from '@unleashd/shared';
import express from 'express';
import { BuddyBuilderService, type BuddyBuilderStore } from '../src/buddies/builder';
import { createBuddyBuilderMcpServer } from '../src/buddies/builder-mcp-server';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { ConversationConfigStore } from '../src/conversations/config-store';

const CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440000';

test('Builder MCP creates a team with safe retries, scoped edits and restart recovery', async () => {
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
    soul: 'Verify every claim against primary sources before reporting it.',
  };
  try {
    const tools = await mcpClient.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'create_buddy',
      'get_soul',
      'list_buddies',
      'list_created_buddies',
      'list_workspaces',
      'update_soul',
    ]);
    const created = await mcpClient.callTool({ name: 'create_buddy', arguments: request });
    assert.equal(created.isError, undefined);
    const result = BuddyBuilderResultSchema.parse(created.structuredContent?.result);
    assert.equal(result.buddy.model, 'gpt-5.6-luna');
    assert.equal(result.buddy.reasoning_effort, 'high');
    for (const creationKey of ['designer', 'engineer']) {
      const args = { ...request, creationKey, name: creationKey, soul: `Own ${creationKey} work.` };
      const failed = await mcpClient.callTool({
        name: 'create_buddy',
        arguments: { ...args, workspaceId: 'missing' },
      });
      assert.equal(failed.isError, true);
      const hire = await mcpClient.callTool({ name: 'create_buddy', arguments: args });
      assert.equal(hire.isError, undefined);
      const retry = await mcpClient.callTool({ name: 'create_buddy', arguments: args });
      assert.equal(
        BuddyBuilderResultSchema.parse(retry.structuredContent?.result).buddy.id,
        BuddyBuilderResultSchema.parse(hire.structuredContent?.result).buddy.id
      );
    }
    const list = await mcpClient.callTool({ name: 'list_created_buddies', arguments: {} });
    const team = BuddyBuilderResultsSchema.parse(list.structuredContent?.result);
    assert.equal(team.results.length, 3);
    assert.equal(new Set(team.results.map((hire) => hire.buddy.slug)).size, 3);
    assert.equal((await mcpClient.callTool({ name: 'get_soul', arguments: {} })).isError, true);
    const buddyId = team.results[1].buddy.id;
    const read = await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId } });
    const soul = read.structuredContent?.soul as { body: string; revision: number };
    assert.match(soul.body, /Own designer work/);
    const edit = {
      buddyId,
      content: 'Design accessible interfaces.',
      baseVersion: soul.revision,
      reasoning: 'Owner preference.',
    };
    assert.equal(
      (await mcpClient.callTool({ name: 'update_soul', arguments: edit })).isError,
      undefined
    );
    assert.equal(
      (await mcpClient.callTool({ name: 'update_soul', arguments: edit })).isError,
      true
    );
    const readBack = await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId } });
    assert.equal((readBack.structuredContent?.soul as { body: string }).body, edit.content);
    assert.equal(
      (await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId: 'outside' } })).isError,
      true
    );
    assert.equal(
      (
        await mcpClient.callTool({
          name: 'update_soul',
          arguments: { ...edit, buddyId: 'outside' },
        })
      ).isError,
      true
    );
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
    assert.equal(store.listBuddies().length, 3);
    assert.deepEqual(
      builder.getResults().results.map((hire) => hire.creationKey),
      ['default', 'designer', 'engineer']
    );

    const persisted = (
      store as unknown as {
        getBuddyContext(buddy: string, input: { workspace?: string }): { soul: string };
      }
    ).getBuddyContext(recovered.buddy.id, { workspace: workspace.id });
    assert.ok(
      persisted.soul.includes(request.soul),
      `creation soul should persist, got: ${persisted.soul}`
    );

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
      getBuilderResults: async (conversationId) =>
        new BuddyBuilderService(store as unknown as BuddyBuilderStore, conversationId).getResults(),
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
      const all = await fetch(
        `http://127.0.0.1:${port}/api/buddies/builder/${CONVERSATION_ID}/results`
      );
      assert.equal(all.status, 200);
      assert.deepEqual(
        BuddyBuilderResultsSchema.parse(await all.json()).results.map((hire) => hire.buddy.id),
        builder.getResults().results.map((hire) => hire.buddy.id)
      );
      const empty = await fetch(`http://127.0.0.1:${port}/api/buddies/builder/no-hires/results`);
      assert.deepEqual(BuddyBuilderResultsSchema.parse(await empty.json()).results, []);
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

test('owner PUT soul stages text and rejects oversize payloads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'unleashd-buddy-soul-'));
  const workspaceRoot = join(root, 'workspace');
  const database = join(root, 'buddies.sqlite');
  mkdirSync(workspaceRoot);

  const store = new BuddiesStore(database);
  try {
    const workspace = store.createWorkspace({ name: 'Growth', rootPath: workspaceRoot });
    const buddy = store.createBuddy({
      project: workspace.id,
      name: 'Soul Owner',
      role: 'Holds a staged soul',
    });

    const app = express();
    app.use(express.json());
    registerBuddyRoutes(app, {
      getStore: async () => store as unknown as BuddiesStorePort,
      getScheduler: () => null,
      createConversation: async () => {
        throw new Error('not used');
      },
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
      const base = `http://127.0.0.1:${port}/api/buddies/${buddy.id}/soul`;
      const putSoul = (body: unknown) =>
        fetch(base, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });

      const soul = 'Act with steady focus and cite primary sources.';
      const updated = await putSoul({ soul });
      assert.equal(updated.status, 200);
      const context = (
        store as unknown as {
          getBuddyContext(buddy: string, input: { workspace?: string }): { soul: string };
        }
      ).getBuddyContext(buddy.id, { workspace: workspace.id });
      assert.ok(context.soul.includes(soul), `PUT soul should persist, got: ${context.soul}`);

      const replacement = 'Keep every answer short and verifiable.';
      const replaced = await putSoul({ soul: replacement });
      assert.equal(replaced.status, 200);
      const replacedContext = (
        store as unknown as {
          getBuddyContext(buddy: string, input: { workspace?: string }): { soul: string };
        }
      ).getBuddyContext(buddy.id, { workspace: workspace.id });
      assert.ok(replacedContext.soul.includes(replacement));

      const oversize = await putSoul({ soul: 'x'.repeat(10_001) });
      assert.equal(oversize.status, 413);

      const empty = await putSoul({ soul: '   ' });
      assert.equal(empty.status, 400);

      const missing = await fetch(
        `http://127.0.0.1:${port}/api/buddies/buddy_does_not_exist/soul`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ soul }),
        }
      );
      assert.equal(missing.status, 404);
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
