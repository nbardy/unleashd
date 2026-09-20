import assert from 'node:assert/strict';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { BuddyOperationsService, MESSAGE_BUDDY_OPERATIONS } from '../src/buddies/operations';

test('native inbox pages older audience-visible work compactly and expands exact evidence', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'CEO inbox', rootPath: '/tmp/ceo-inbox' });
  const chief = raw.createBuddy({ project: w.id, name: 'CEO', role: 'Review' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Coordinate' });
  raw.reparentBuddy(lead.id, { managerId: chief.id, key: 'reporting-line' });
  for (const b of [chief, lead])
    store.setCoordinationMembership(b.id, w.id, {
      background_enabled: true,
      max_sends_per_hour: 10000,
      max_pending_runs: 10000,
    });
  const project = raw.newProject({
    buddy: lead.id,
    workspace: w.id,
    title: 'M0',
    definitionOfDone: 'Fixture evidence',
  });
  for (let i = 0; i < 205; i++)
    raw.sendMessage({
      fromBuddy: chief.id,
      to: lead.id,
      workspace: w.id,
      purpose: 'PRIVATE_CANARY',
      body: 'PRIVATE_CANARY',
    });
  const body = 'Review exact fixture. '.repeat(1000).trim();
  const evidence = Array.from({ length: 32 }, (_, i) => `artifact:${i}:${'e'.repeat(1000)}`);
  const root = store.sendCoordinatedMessage(
    {
      fromBuddy: chief.id,
      to: lead.id,
      workspace: w.id,
      project: project.id,
      key: 'root',
      parentConversationId: 'ceo',
      purpose: 'Review M0',
      body,
      evidence,
    },
    { policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
  );
  const run = store.listBuddyRuns({ buddyId: lead.id })[0];
  store.claimBuddyRun(run.id, { claimToken: 'lead-token', conversationId: 'lead' });
  store.startBuddyRun(run.id, 'lead-token');
  const child = store.sendCoordinatedMessage(
    {
      fromBuddy: lead.id,
      to: chief.id,
      workspace: w.id,
      key: 'progress',
      parentConversationId: 'lead',
      purpose: 'Review progress',
      body: 'Saved checkpoint',
      expectsReply: false,
    },
    { runId: run.id, policy: { allowed_operations: MESSAGE_BUDDY_OPERATIONS } }
  );
  const context = {
    buddyId: lead.id,
    workspaceId: w.id,
    conversationId: 'lead',
    buddyProjectId: project.id,
    coordinationRunId: run.id,
    delegatedByBuddyId: chief.id,
    knowledgeScope: { kind: 'project' as const, projectId: project.id },
    allowedOperations: MESSAGE_BUDDY_OPERATIONS,
  };
  const mcp = createBuddyMcpServer(store, context, { automationClaimToken: 'lead-token' });
  const client = new Client({ name: 'inbox-scenario', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    return (result.structuredContent as { data: any }).data;
  };
  try {
    const catalog = await client.listTools();
    assert.ok(catalog.tools.find((t) => t.name === 'get_inbox')?.inputSchema.properties?.cursor);
    const first = await call('get_inbox', { limit: 1 });
    const second = await call('get_inbox', { limit: 1, cursor: first.nextCursor });
    assert.equal(first.nextCursor, 'inbox:1');
    assert.equal(second.nextCursor, null);
    assert.deepEqual(
      new Set([first.messages[0].id, second.messages[0].id]),
      new Set([root.id, child.id])
    );
    const all = await call('get_inbox', {});
    assert.equal(all.messages.length, 2);
    assert.doesNotMatch(
      JSON.stringify(all),
      /PRIVATE_CANARY|return_policy|allowed_operations|lead-token/
    );
    assert.ok(
      JSON.stringify(all).length < 5000,
      'summary size stays bounded despite 32KB evidence'
    );
    const summary = all.messages.find((m: { id: string }) => m.id === root.id);
    assert.equal(summary.bodyPreview.length, 240);
    assert.equal(summary.evidenceCount, 32);
    assert.equal(summary.body, undefined);
    const expanded = await call('get_message', { messageId: root.id });
    assert.equal(expanded.body, body);
    assert.deepEqual(expanded.evidence, evidence);
    const legacy = new BuddyOperationsService(store, context, {
      automationClaimToken: 'lead-token',
    }).execute('buddy.get_inbox', {}).data as { messages: Array<{ body: string }> };
    assert.equal(legacy.messages.length, 2);
    assert.ok(
      legacy.messages.some((m) => m.body === body),
      'full service consumer remains compatible'
    );
    const invalid = await client.callTool({
      name: 'get_inbox',
      arguments: { cursor: 'inbox:999999999999999999999999' },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await mcp.close();
    raw.close();
  }
});
