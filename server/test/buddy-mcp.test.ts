import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import {
  buddyBuilderMcpServers,
  buddyMcpServers,
  resolveBuddyMcpLaunch,
} from '../src/buddies/mcp-config';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { assertBuddyProviderSupportsMcp } from '../src/conversations/runtime';

test('Buddy MCP exposes scoped native tools and enforces completion evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-mcp-'));
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: root });
  const lead = store.createBuddy({
    project: workspace.id,
    name: 'Growth Lead',
    role: 'Own GTM closure',
  });
  const project = store.newProject({
    buddy: lead.id,
    workspace: workspace.id,
    title: 'Close proof loop',
    definitionOfDone: 'Evidence-backed decision recorded',
    status: 'in_progress',
    todos: [{ title: 'Record evidence', status: 'in_progress' }],
  });

  const server = createBuddyMcpServer(store as unknown as BuddiesStorePort, {
    buddyId: lead.id,
    workspaceId: workspace.id,
    buddyProjectId: project.id,
  });
  const client = new Client({ name: 'buddy-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      'compact_memory',
      'complete_assignment',
      'complete_delegation',
      'delegate',
      'get_automations',
      'get_current_work',
      'get_inbox',
      'new_project',
      'recall',
      'remember',
      'remember_note',
      'request_human_approval',
      'request_review',
      'set_automation',
      'submit_review',
      'update_memory',
      'update_project',
    ]);

    const current = await client.callTool({
      name: 'get_current_work',
      arguments: {},
    });
    assert.equal(current.isError, undefined);
    assert.match(JSON.stringify(current.structuredContent), /Close proof loop/);

    const inbox = await client.callTool({
      name: 'get_inbox',
      arguments: {},
    });
    assert.equal(inbox.isError, undefined);
    assert.match(JSON.stringify(inbox.structuredContent), /assignedDelegations/);

    const rejected = await client.callTool({
      name: 'update_project',
      arguments: {
        projectId: project.id,
        status: 'done',
      },
    });
    assert.equal(rejected.isError, true);
    assert.match(JSON.stringify(rejected.content), /evidence is required/);

    const completed = await client.callTool({
      name: 'update_project',
      arguments: {
        projectId: project.id,
        status: 'done',
        evidence: ['metric:proof-loop-1'],
        todoOperations: [
          {
            operation: 'update',
            todoId: project.todos[0].id,
            status: 'done',
          },
        ],
      },
    });
    assert.equal(completed.isError, undefined);
    assert.equal(store.getBuddyProject(project.id)?.status, 'done');

    const approval = await client.callTool({
      name: 'request_human_approval',
      arguments: {
        action: 'Publish the proof',
        reason: 'The local evidence is complete.',
        risk: 'Publishing changes public state.',
        projectId: project.id,
      },
    });
    assert.equal(approval.isError, undefined);
    assert.match(JSON.stringify(approval.structuredContent), /"status":"pending"/);
    assert.equal(store.listApprovalRequests({ status: 'pending' }).length, 1);
    assert.equal(store.listAuditEvents({ buddy: lead.id }).length, 4);
  } finally {
    await client.close();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Buddy MCP specification binds trusted context outside tool input', () => {
  const servers = buddyMcpServers(
    {
      buddyId: 'buddy-1',
      workspaceId: 'workspace-1',
      buddyProjectId: 'project-1',
      legacyWorkItemId: null,
      automationRunId: 'run-1',
      delegatedByBuddyId: null,
      parentBuddyConversationId: null,
      allowedBuddyOperations: ['buddy.get_automations', 'buddy.complete_assignment'],
    },
    'conversation-1',
    {
      command: '/usr/bin/node',
      args: ['/app/server/dist/buddies/mcp-server.js'],
      cwd: '/app/server',
    },
    {
      UNLEASHD_BUDDY_CONTROL_URL: 'http://127.0.0.1:9999',
      UNLEASHD_BUDDY_CONTROL_TOKEN: 'scoped-token',
    }
  );

  assert.deepEqual(servers, {
    unleashd_buddy: {
      command: '/usr/bin/node',
      args: [
        '/app/server/dist/buddies/mcp-server.js',
        '--buddy',
        'buddy-1',
        '--workspace',
        'workspace-1',
        '--conversation',
        'conversation-1',
        '--project',
        'project-1',
        '--automation-run',
        'run-1',
        '--allowed-operation',
        'buddy.get_automations',
        '--allowed-operation',
        'buddy.complete_assignment',
      ],
      cwd: '/app/server',
      env: {
        UNLEASHD_BUDDY_CONTROL_URL: 'http://127.0.0.1:9999',
        UNLEASHD_BUDDY_CONTROL_TOKEN: 'scoped-token',
      },
      required: true,
    },
  });
});

test('Buddy MCP exposes memory-v2 tools and preserves structured memory errors', async () => {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const store = {
    getBuddy: () => ({ id: 'buddy-1', name: 'Lead', role: 'Lead', status: 'active' }),
    listBuddyWorkspaces: () => [{ id: 'workspace-1' }],
    recordAuditEvent: (input: { operation: string }) => ({ id: 'audit-1', ...input }),
    updateMemory: () => {
      throw Object.assign(new Error('StaleMemoryWrite: working memory is at revision 3'), {
        code: 'STALE_MEMORY_WRITE',
        currentVersion: 3,
        yourBase: 2,
      });
    },
    rememberNote: (_buddy: string, input: unknown) => {
      calls.push({ operation: 'rememberNote', input });
      return { id: 'note-1', content: 'captured' };
    },
    recall: (_buddy: string, input: unknown) => {
      calls.push({ operation: 'recall', input });
      return { pattern: 'needle', matches: [], truncated: false };
    },
  } as unknown as BuddiesStorePort;
  const server = createBuddyMcpServer(store, {
    buddyId: 'buddy-1',
    workspaceId: 'workspace-1',
    conversationId: 'conversation-1',
  });
  const client = new Client({ name: 'memory-v2-mcp-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const stale = await client.callTool({
      name: 'update_memory',
      arguments: {
        doc: 'working',
        content: 'new body',
        reasoning: 'test conflict',
        baseVersion: 2,
      },
    });
    assert.equal(stale.isError, true);
    assert.match(JSON.stringify(stale.structuredContent), /MEMORY_STALE/);
    assert.match(JSON.stringify(stale.structuredContent), /current_version/);

    const note = await client.callTool({
      name: 'remember_note',
      arguments: { body: 'captured', topic: 'test' },
    });
    assert.equal(note.isError, undefined);
    const recall = await client.callTool({
      name: 'recall',
      arguments: { pattern: 'needle' },
    });
    assert.equal(recall.isError, undefined);
    assert.deepEqual(
      calls.map(({ operation }) => operation),
      ['rememberNote', 'recall']
    );
  } finally {
    await client.close();
    await server.close();
  }
});

test('Buddy Builder MCP specification is required and conversation-scoped', () => {
  assert.deepEqual(
    buddyBuilderMcpServers('conversation-builder', {
      command: '/usr/bin/node',
      args: ['/app/server/dist/buddies/mcp-server.js'],
      cwd: '/app/server',
    }),
    {
      unleashd_buddy: {
        command: '/usr/bin/node',
        args: [
          '/app/server/dist/buddies/mcp-server.js',
          '--builder',
          '--conversation',
          'conversation-builder',
        ],
        cwd: '/app/server',
        required: true,
      },
    }
  );
});

test('Buddy conversations fail closed when a provider cannot inject required MCP', () => {
  assert.doesNotThrow(() => assertBuddyProviderSupportsMcp('codex'));
  assert.throws(
    () => assertBuddyProviderSupportsMcp('claude'),
    /cannot start Buddy conversations.*cannot guarantee required Buddy state tools/
  );
  assert.throws(
    () => assertBuddyProviderSupportsMcp('opencode'),
    /cannot start Buddy conversations.*cannot guarantee required Buddy state tools/
  );
  assert.throws(
    () => assertBuddyProviderSupportsMcp('muse'),
    /cannot start Buddy conversations.*cannot guarantee required Buddy state tools/
  );
  assert.throws(
    () => assertBuddyProviderSupportsMcp('gemini'),
    /cannot start Buddy conversations.*cannot guarantee required Buddy state tools/
  );
  assert.throws(
    () => assertBuddyProviderSupportsMcp('cursor'),
    /cannot start Buddy conversations.*cannot guarantee required Buddy state tools/
  );
});

test('resolved stdio Buddy MCP entrypoint opens the current durable schema', async () => {
  const home = mkdtempSync(join(tmpdir(), 'buddy-mcp-stdio-'));
  const workspaceRoot = join(home, 'workspace');
  const database = join(home, 'buddies.sqlite');
  const store = new BuddiesStore(database);
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: workspaceRoot });
  const lead = store.createBuddy({
    project: workspace.id,
    name: 'Growth Lead',
    role: 'Own GTM closure',
  });
  store.newProject({
    buddy: lead.id,
    workspace: workspace.id,
    title: 'Durable MCP project',
    definitionOfDone: 'Native tool can read it after process launch',
  });
  store.close();

  const fixtureDatabase = new DatabaseSync(database, { readOnly: true });
  const schemaVersion = fixtureDatabase.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  fixtureDatabase.close();
  assert.equal(
    schemaVersion.user_version,
    16,
    'the vendored Buddy package must understand the live schema'
  );

  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  env.BUDDIES_HOME = home;
  const launch = resolveBuddyMcpLaunch();
  Object.assign(env, launch.env);
  const transport = new StdioClientTransport({
    command: launch.command,
    args: [
      ...launch.args,
      '--buddy',
      lead.id,
      '--workspace',
      workspace.id,
      '--conversation',
      'conversation-stdio',
    ],
    cwd: launch.cwd,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'buddy-mcp-stdio-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const current = await client.callTool({ name: 'get_current_work', arguments: {} });
    assert.equal(current.isError, undefined);
    assert.match(JSON.stringify(current.structuredContent), /Durable MCP project/);
  } finally {
    await client.close();
    rmSync(home, { recursive: true, force: true });
  }
});
