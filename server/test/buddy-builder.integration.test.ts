import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import {
  BuddyBuilderResultSchema,
  createDefaultConversationConfig,
  formatBuddyBuilderToolResult,
  parseBuddyBuilderToolResult,
} from '@unleashd/shared';
import express from 'express';
import { createParser } from '../../vendor/agent-cli-tool/src/parsers/index';
import {
  extractMessagesFromCodexEntries,
  extractMessagesFromEntries,
  parseCodexJsonlFile,
  parseMuseSessionFile,
  parseOpenCodeSessionDirectory,
} from '../src/adapters/jsonl';
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
    soul: 'Verify every claim against primary sources before reporting it.',
  };
  try {
    const tools = await mcpClient.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'create_buddy',
      'get_soul',
      'list_buddies',
      'list_workspaces',
      'update_soul',
    ]);
    const created = await mcpClient.callTool({ name: 'create_buddy', arguments: request });
    assert.equal(created.isError, undefined);
    const result = BuddyBuilderResultSchema.parse(created.structuredContent?.result);
    assert.equal(result.buddy.model, 'gpt-5.6-luna');
    assert.equal(result.buddy.reasoning_effort, 'high');
    const read = await mcpClient.callTool({ name: 'get_soul', arguments: {} });
    const soul = read.structuredContent?.soul as { body: string; revision: number };
    assert.match(soul.body, /Verify every claim/);
    const refinement = await mcpClient.callTool({
      name: 'update_soul',
      arguments: {
        content: `${soul.body}\nLead with the Buddy name.`,
        baseVersion: soul.revision,
        reasoning: 'Owner asked for a stronger identity.',
      },
    });
    assert.equal(refinement.isError, undefined);
    // Successful MCP outputs survive both live normalization and disk reload at
    // their original position, while reads and rejected edits produce no card.
    const createdMarker = formatBuddyBuilderToolResult(created)!;
    const updatedMarker = formatBuddyBuilderToolResult(refinement)!;
    assert.equal(parseBuddyBuilderToolResult(created)?.action, 'created');
    const updatedEvent = parseBuddyBuilderToolResult(refinement);
    assert.equal(updatedEvent?.action, 'updated');
    assert.equal(updatedEvent?.result.buddy.id, result.buddy.id);
    assert.equal(formatBuddyBuilderToolResult(read), null);
    const stale = await mcpClient.callTool({
      name: 'update_soul',
      arguments: {
        content: 'Must not replace the new brief',
        reasoning: 'Stale retry',
        baseVersion: soul.revision,
      },
    });
    assert.equal(stale.isError, true);
    assert.equal(formatBuddyBuilderToolResult(stale), null);
    const foreign = await mcpClient.callTool({
      name: 'update_soul',
      arguments: {
        buddyId: 'another-buddy',
        content: 'Forbidden',
        reasoning: 'Invalid scope',
        baseVersion: soul.revision + 1,
      },
    });
    assert.equal(foreign.isError, true);
    for (const output of [created, refinement]) {
      const expected = formatBuddyBuilderToolResult(output);
      const native = [
        [
          'codex',
          {
            type: 'item.completed',
            item: { type: 'mcp_tool_call', name: 'create_buddy', result: output },
          },
        ],
        [
          'claude',
          {
            type: 'user',
            message: { content: [{ type: 'tool_result', content: output.content }] },
          },
        ],
        [
          'opencode',
          {
            type: 'tool_use',
            part: {
              tool: 'create_buddy',
              state: { status: 'completed', output: JSON.stringify(output) },
            },
          },
        ],
        [
          'muse',
          {
            payload_type: 'tool.result',
            payload: { text: JSON.stringify(output), correlation_facts: { outcome: 'success' } },
          },
        ],
      ] as const;
      for (const [provider, record] of native) {
        const event = createParser(provider)(record).find((event) => event.type === 'tool.result');
        assert.ok(event?.type === 'tool.result', provider);
        assert.equal(formatBuddyBuilderToolResult(event.output), expected, provider);
      }
    }
    const transcript = [
      { type: 'event_msg', payload: { type: 'user_message', message: 'Create a researcher.' } },
      {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'create',
          output: JSON.stringify(created),
        },
      },
      {
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'The researcher is ready.' },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'update',
          output: JSON.stringify(refinement),
        },
      },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'The brief is updated.' } },
    ].map((entry, index) => ({ ...entry, timestamp: `2026-09-08T00:00:0${index}.000Z` }));
    const transcriptPath = join(root, `${CONVERSATION_ID}.jsonl`);
    writeFileSync(transcriptPath, transcript.map((entry) => JSON.stringify(entry)).join('\n'));
    const history = extractMessagesFromCodexEntries(
      (await parseCodexJsonlFile(transcriptPath)).entries
    );
    assert.deepEqual(
      history.map((message) => message.content),
      [
        'Create a researcher.',
        createdMarker,
        'The researcher is ready.',
        updatedMarker,
        'The brief is updated.',
      ]
    );
    const claudeHistory = extractMessagesFromEntries([
      {
        type: 'user',
        timestamp: transcript[1].timestamp,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'create', content: created.content }],
        },
      },
      {
        type: 'user',
        timestamp: transcript[3].timestamp,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'update', content: refinement.content }],
        },
      },
    ] as Parameters<typeof extractMessagesFromEntries>[0]);
    assert.deepEqual(
      claudeHistory.map((message) => [message.role, message.content]),
      [
        ['assistant', createdMarker],
        ['assistant', updatedMarker],
      ]
    );
    const musePath = join(root, 'muse.jsonl');
    writeFileSync(
      musePath,
      [created, refinement]
        .map((output, index) =>
          JSON.stringify({
            payload_type: 'runtime.session',
            recorded_at: transcript[index].timestamp,
            payload: {
              kind: 'run',
              event: {
                kind: 'tool_result_batch_committed',
                results: [{ text: JSON.stringify(output) }],
              },
            },
          })
        )
        .join('\n')
    );
    assert.deepEqual(
      (await parseMuseSessionFile(musePath)).messages.map((message) => message.content),
      [createdMarker, updatedMarker]
    );

    const openCodeMessages = join(root, 'message', 'session');
    const openCodeParts = join(root, 'part');
    mkdirSync(openCodeMessages, { recursive: true });
    mkdirSync(join(openCodeParts, 'msg1'), { recursive: true });
    writeFileSync(
      join(openCodeMessages, 'msg1.json'),
      JSON.stringify({ id: 'msg1', role: 'assistant', time: { created: Date.now() } })
    );
    const parts = [
      { type: 'text', text: 'Before' },
      {
        type: 'tool',
        tool: 'create_buddy',
        state: { status: 'completed', output: JSON.stringify(created) },
      },
      { type: 'text', text: 'Between' },
      {
        type: 'tool',
        tool: 'update_soul',
        state: { status: 'completed', output: JSON.stringify(refinement) },
      },
      { type: 'text', text: 'After' },
      {
        type: 'tool',
        tool: 'update_soul',
        state: { status: 'error', output: JSON.stringify(refinement) },
      },
    ];
    parts.forEach((part, index) =>
      writeFileSync(
        join(openCodeParts, 'msg1', `${index}.json`),
        JSON.stringify({ ...part, time: { start: index } })
      )
    );
    const openCodeHistory = await parseOpenCodeSessionDirectory(openCodeMessages, openCodeParts);
    const openCodeContent = openCodeHistory.messages[0].content;
    assert.equal(openCodeContent.split(createdMarker).length, 2);
    assert.equal(openCodeContent.split(updatedMarker).length, 2);
    assert.ok(openCodeContent.indexOf('Before') < openCodeContent.indexOf(createdMarker));
    assert.ok(openCodeContent.indexOf(createdMarker) < openCodeContent.indexOf('Between'));
    assert.ok(openCodeContent.indexOf('Between') < openCodeContent.indexOf(updatedMarker));
    assert.ok(openCodeContent.indexOf(updatedMarker) < openCodeContent.indexOf('After'));
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
