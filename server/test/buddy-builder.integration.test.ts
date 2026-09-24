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
  BuddyBuilderResultsSchema,
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
} from '../src/adapters/jsonl';
import { BuddyBuilderService, type BuddyBuilderStore } from '../src/buddies/builder';
import { createLegacyBuddyBuilderMcpServer as createBuddyBuilderMcpServer } from '../src/buddies/builder-mcp-server';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { ConversationConfigStore } from '../src/conversations/config-store';

const CONVERSATION_ID = '550e8400-e29b-41d4-a716-446655440000';

test('Builder MCP creates a team, retries each hire and recovers scoped results across restart', async () => {
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
      'new_project',
      'set_relationship',
      'update_profile',
      'update_soul',
    ]);
    const blank = await mcpClient.callTool({
      name: 'create_buddy',
      arguments: { ...request, soul: '   ' },
    });
    assert.equal(blank.isError, true);
    assert.equal(store.listBuddies().length, 0);
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
    assert.equal(formatBuddyBuilderToolResult(blank), null);
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

    assert.equal(store.listBuddies().length, 1);

    const emptyTeam = await mcpClient.callTool({ name: 'list_created_buddies', arguments: {} });
    assert.deepEqual(
      BuddyBuilderResultsSchema.parse(emptyTeam.structuredContent?.result).results.map(
        (hire) => hire.buddy.id
      ),
      [result.buddy.id]
    );
    const members = [
      {
        ...request,
        creationKey: 'designer',
        name: 'Growth Designer',
        soul: 'Design clear experiments from research findings.',
      },
      {
        ...request,
        creationKey: 'engineer',
        name: 'Growth Engineer',
        soul: 'Ship and measure the approved experiments.',
      },
    ];
    const failed = await mcpClient.callTool({
      name: 'create_buddy',
      arguments: { ...members[0], workspaceId: 'missing-workspace' },
    });
    assert.equal(failed.isError, true);
    assert.equal(store.listBuddies().length, 1);
    for (const member of members) {
      const hire = await mcpClient.callTool({ name: 'create_buddy', arguments: member });
      assert.equal(hire.isError, undefined);
      const saved = BuddyBuilderResultSchema.parse(hire.structuredContent?.result);
      const retry = await mcpClient.callTool({ name: 'create_buddy', arguments: member });
      assert.equal(
        BuddyBuilderResultSchema.parse(retry.structuredContent?.result).buddy.id,
        saved.buddy.id
      );
    }
    const savedTeam = BuddyBuilderResultsSchema.parse(
      (await mcpClient.callTool({ name: 'list_created_buddies', arguments: {} })).structuredContent
        ?.result
    );
    assert.equal(savedTeam.results.length, 3);
    assert.equal(new Set(savedTeam.results.map((hire) => hire.buddy.slug)).size, 3);
    assert.equal((await mcpClient.callTool({ name: 'get_soul', arguments: {} })).isError, true);
    assert.equal(
      (
        await mcpClient.callTool({
          name: 'update_soul',
          arguments: { content: 'Ambiguous edit', baseVersion: 1, reasoning: 'Missing target' },
        })
      ).isError,
      true
    );

    const designer = savedTeam.results[1].buddy;
    const designerSoul = (
      await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId: designer.id } })
    ).structuredContent?.soul as { body: string; revision: number };
    assert.ok(designerSoul.body.includes(members[0].soul));
    const edit = {
      buddyId: designer.id,
      content: 'Design accessible experiments.',
      baseVersion: designerSoul.revision,
      reasoning: 'Owner prioritizes accessibility.',
    };
    assert.equal(
      (await mcpClient.callTool({ name: 'update_soul', arguments: edit })).isError,
      undefined
    );
    assert.equal(
      (await mcpClient.callTool({ name: 'update_soul', arguments: edit })).isError,
      true
    );
    const readBack = (
      await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId: designer.id } })
    ).structuredContent?.soul as { body: string };
    assert.equal(readBack.body, edit.content);
    const unchanged = (
      await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId: result.buddy.id } })
    ).structuredContent?.soul as { body: string };
    assert.equal(unchanged.body, `${soul.body}\nLead with the Buddy name.`);

    const profileArgs = { buddyId: result.buddy.id, model: 'gpt-6-astra' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const updated = await mcpClient.callTool({ name: 'update_profile', arguments: profileArgs });
      assert.equal(updated.isError, undefined);
      const buddy = updated.structuredContent?.buddy as typeof result.buddy;
      assert.equal(buddy.id, result.buddy.id);
      assert.equal(buddy.model, 'gpt-6-astra');
      assert.equal(buddy.reasoning_effort, 'high');
      assert.equal(buddy.provider, 'codex');
    }
    for (const invalid of [
      { buddyId: result.buddy.id },
      { model: 'gpt-6-astra' },
      { ...profileArgs, hireQuota: 10 },
      { ...profileArgs, reasoningEffort: 'invalid-effort' },
    ]) {
      assert.equal(
        (await mcpClient.callTool({ name: 'update_profile', arguments: invalid })).isError,
        true
      );
    }
    assert.equal(store.getBuddy(designer.id)?.model, 'gpt-5.6-luna');
    const switched = await mcpClient.callTool({
      name: 'update_profile',
      arguments: { buddyId: designer.id, provider: 'claude' },
    });
    assert.equal(switched.isError, undefined);
    const switchedBuddy = switched.structuredContent?.buddy as typeof designer;
    assert.equal(switchedBuddy.provider, 'claude');
    assert.equal(switchedBuddy.model, null);
    assert.equal(switchedBuddy.reasoning_effort, null);
    const cleared = await mcpClient.callTool({
      name: 'update_profile',
      arguments: { buddyId: designer.id, model: null, reasoningEffort: null },
    });
    assert.equal(cleared.isError, undefined);

    assert.deepEqual(
      (await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId: result.buddy.id } }))
        .structuredContent?.soul,
      { body: unchanged.body, revision: 2 }
    );

    const other = new BuddyBuilderService(
      store as unknown as BuddyBuilderStore,
      'other-builder'
    ).createBuddy({ ...request, name: 'Outside this team' });
    assert.equal(
      (
        await mcpClient.callTool({
          name: 'update_profile',
          arguments: { ...profileArgs, buddyId: other.buddy.id },
        })
      ).isError,
      true
    );
    assert.equal(
      (await mcpClient.callTool({ name: 'get_soul', arguments: { buddyId: other.buddy.id } }))
        .isError,
      true
    );
    assert.equal(
      (
        await mcpClient.callTool({
          name: 'update_soul',
          arguments: { ...edit, buddyId: other.buddy.id },
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
    assert.equal(recovered.buddy.model, 'gpt-6-astra');
    assert.equal(builder.createBuddy(request).buddy.id, recovered.buddy.id);
    assert.throws(
      () => builder.createBuddy({ ...request, name: 'Different Buddy' }),
      /already created a different Buddy/
    );
    assert.equal(store.listBuddies().length, 4);
    const team = builder.getResults();
    assert.deepEqual(
      team.results.map((hire) => hire.creationKey),
      ['default', 'designer', 'engineer']
    );
    assert.equal(
      builder.createBuddy({
        ...request,
        creationKey: 'designer',
        name: 'Growth Designer',
        soul: 'Design clear experiments from research findings.',
      }).buddy.id,
      team.results[1].buddy.id
    );
    assert.equal(builder.getSoulTarget(team.results[1].buddy.id).id, team.results[1].buddy.id);
    assert.deepEqual(
      new BuddyBuilderService(store as unknown as BuddyBuilderStore, 'empty-builder').getResults()
        .results,
      []
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
        BuddyBuilderResultsSchema.parse(await all.json()),
        BuddyBuilderResultsSchema.parse(team)
      );
      const empty = await fetch(
        `http://127.0.0.1:${port}/api/buddies/builder/empty-builder/results`
      );
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

      const readSoul = async () =>
        (await fetch(base)).json() as Promise<{ body: string; revision: number }>;
      const initial = await readSoul();
      const soul = 'Act with steady focus and cite primary sources.';
      const updated = await putSoul({
        content: soul,
        baseVersion: initial.revision,
        reasoning: 'Owner sets identity.',
      });
      assert.equal(updated.status, 200);
      const context = (
        store as unknown as {
          getBuddyContext(buddy: string, input: { workspace?: string }): { soul: string };
        }
      ).getBuddyContext(buddy.id, { workspace: workspace.id });
      assert.ok(context.soul.includes(soul), `PUT soul should persist, got: ${context.soul}`);

      const replacement = 'Keep every answer short and verifiable.';
      const replaced = await putSoul({
        content: replacement,
        baseVersion: (await readSoul()).revision,
        reasoning: 'Owner refines style.',
      });
      assert.equal(replaced.status, 200);
      const replacedContext = (
        store as unknown as {
          getBuddyContext(buddy: string, input: { workspace?: string }): { soul: string };
        }
      ).getBuddyContext(buddy.id, { workspace: workspace.id });
      assert.ok(replacedContext.soul.includes(replacement));

      const stale = await putSoul({
        content: 'Obsolete draft',
        baseVersion: initial.revision,
        reasoning: 'Stale editor.',
      });
      assert.equal(stale.status, 409);
      assert.equal((await readSoul()).body, replacement);
      const missingVersion = await putSoul({
        content: 'Must not overwrite',
        reasoning: 'No base.',
      });
      assert.equal(missingVersion.status, 400);
      const oversize = await putSoul({
        content: 'x'.repeat(10_001),
        baseVersion: (await readSoul()).revision,
        reasoning: 'Too big.',
      });
      assert.equal(oversize.status, 413);

      const empty = await putSoul({
        content: '   ',
        baseVersion: (await readSoul()).revision,
        reasoning: 'Empty.',
      });
      assert.equal(empty.status, 400);

      const missing = await fetch(
        `http://127.0.0.1:${port}/api/buddies/buddy_does_not_exist/soul`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: soul, baseVersion: 0, reasoning: 'Missing Buddy.' }),
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
