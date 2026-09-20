import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { executeOwnerResource } from '../src/buddies/owner-resources';

test('native work summaries bound large evidence, expand unchanged history, and detect paging changes', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Summaries', rootPath: '/tmp/buddy-read-summary' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Read' });
  const other = raw.createBuddy({ project: w.id, name: 'Other', role: 'Private' });
  const projects = Array.from(
    { length: 4 },
    (_, i) =>
      store.createCoordinatedProject(
        {
          workspaceId: w.id,
          buddyId: lead.id,
          title: `Project ${i}`,
          definitionOfDone: 'Read the complete artifact before acceptance. '.repeat(150),
          nextAction: 'Inspect full evidence. '.repeat(100),
          todos: [
            {
              title: 'Inspect',
              evidence: ['todo-history'],
              definitionOfDone: 'Check actual output',
            },
          ],
        },
        { actor: lead.id, key: `project-${i}` }
      ) as { id: string; revision: number }
  );
  for (const p of projects)
    store.updateCoordinatedProject(
      p.id,
      {
        baseRevision: p.revision,
        evidence: Array.from({ length: 32 }, (_, i) => `${i}:${'artifact-evidence'.repeat(240)}`),
      },
      { actor: lead.id, key: `evidence-${p.id}` }
    );
  const hidden = store.createCoordinatedProject(
    {
      workspaceId: w.id,
      buddyId: other.id,
      title: 'PRIVATE_PROJECT',
      definitionOfDone: 'PRIVATE_CRITERIA',
    },
    { actor: other.id, key: 'private' }
  ) as { id: string };
  const server = createBuddyMcpServer(store, {
    buddyId: lead.id,
    workspaceId: w.id,
    conversationId: 'owner',
  });
  const client = new Client({ name: 'read-contract', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const measurements: Array<{ envelopeCharacters: number; elapsedMs: number }> = [];
  const call = async (args: Record<string, unknown>) => {
    const start = performance.now();
    const result = await client.callTool({ name: 'get_current_work', arguments: args });
    measurements.push({
      envelopeCharacters: JSON.stringify(result).length,
      elapsedMs: performance.now() - start,
    });
    assert.ok(!result.isError, JSON.stringify(result));
    const text = (result.content as Array<{ type: string; text?: string }>).find(
      (part) => part.type === 'text'
    )?.text;
    assert.ok(text);
    assert.deepEqual(JSON.parse(text), result.structuredContent);
    return result.structuredContent as { data: { items: any[]; nextCursor: string | null } };
  };
  try {
    const full = await call({});
    const summary = await call({ view: 'summary' });
    const fullSize = JSON.stringify(full).length;
    const summarySize = JSON.stringify(summary).length;
    assert.ok(summarySize < 15000, `${summarySize} characters`);
    assert.ok(summarySize < fullSize / 20, `${fullSize} -> ${summarySize}`);
    console.log(`Work fixture: full=${fullSize}, summary=${summarySize} serialized characters`);
    console.log(
      `Work MCP transport: ${JSON.stringify({ full: measurements[0], summary: measurements[1] })}`
    );
    assert.ok(measurements[1].envelopeCharacters < 15000);
    assert.equal(summary.data.items.length, 4);
    for (const p of summary.data.items) {
      assert.equal(p.evidenceCount, 32);
      assert.equal(p.todoEvidenceCount, 1);
      assert.equal(p.todoCounts.open, 1);
      assert.ok(p.truncatedFields.includes('next_action'));
      assert.equal(p.todos, undefined);
      const detail = await call({ projectId: p.id, view: 'full' });
      assert.deepEqual(
        detail.data.items[0],
        full.data.items.find((x) => x.id === p.id)
      );
    }
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_PROJECT|PRIVATE_CRITERIA/);
    assert.equal((await call({ view: 'summary', limit: 99 })).data.items.length, 4);
    for (const invalid of [{ limit: 0 }, { limit: 100 }, { limit: 1.5 }, { cursor: 'invalid' }]) {
      const rejected = await client.callTool({ name: 'get_current_work', arguments: invalid });
      assert.equal(rejected.isError, true, JSON.stringify(invalid));
    }
    assert.equal((await call({ projectId: hidden.id, view: 'summary' })).data.items.length, 0);
    const first = await call({ view: 'summary', limit: 2 });
    const second = await call({ view: 'summary', limit: 2, cursor: first.data.nextCursor });
    assert.equal(new Set([...first.data.items, ...second.data.items].map((p) => p.id)).size, 4);
    const id = first.data.items[0].id;
    const current = raw.getBuddyProject(id)!;
    store.updateCoordinatedProject(
      id,
      { baseRevision: current.revision, status: 'cancelled' },
      { actor: lead.id, key: 'close' }
    );
    const stale = await client.callTool({
      name: 'get_current_work',
      arguments: { limit: 2, cursor: first.data.nextCursor },
    });
    assert.equal(stale.isError, true);
    assert.equal((stale.structuredContent as any).code, 'STALE_WORK_CURSOR');
    const closed = await call({
      includeClosed: true,
      statuses: ['cancelled'],
      order: 'recent',
      updatedSince: raw.getBuddyProject(id)!.updated_at,
    });
    assert.deepEqual(
      closed.data.items.map((p) => p.id),
      [id],
      'inclusive updated-since exposes closure'
    );
    const owner = executeOwnerResource(
      store,
      'get_current_work',
      { workspaceId: w.id, targetBuddyId: lead.id, view: 'summary', includeClosed: true },
      { ownerInputId: 'owner', conversationId: 'owner', workspaceIds: [w.id] }
    ) as any;
    assert.equal(owner.data.items.length, 4);
    assert.equal(owner.data.items[0].todos, undefined);
    store.setCoordinationMembership(lead.id, w.id, { read_all_work: true });
    const broader = await call({ workspaceId: w.id, includeClosed: true, limit: 2 });
    store.setCoordinationMembership(lead.id, w.id, { read_all_work: false });
    const narrowed = await client.callTool({
      name: 'get_current_work',
      arguments: {
        workspaceId: w.id,
        includeClosed: true,
        limit: 2,
        cursor: broader.data.nextCursor,
      },
    });
    assert.equal(narrowed.isError, true);
    assert.equal((narrowed.structuredContent as any).code, 'STALE_WORK_CURSOR');
    const beforeDelete = await call({ includeClosed: true, limit: 2 });
    // Isolated-fixture deletion: the app has no general project-deletion command.
    raw.db.prepare('DELETE FROM buddy_todos WHERE buddy_project_id=?').run(id);
    raw.db.prepare('DELETE FROM owned_projects WHERE id=?').run(id);
    const deletedCursor = await client.callTool({
      name: 'get_current_work',
      arguments: { includeClosed: true, limit: 2, cursor: beforeDelete.data.nextCursor },
    });
    assert.equal(deletedCursor.isError, true);
    assert.equal((deletedCursor.structuredContent as any).code, 'STALE_WORK_CURSOR');
  } finally {
    await Promise.all([client.close(), server.close()]);
    raw.close();
  }
});

test('native inbox and team filters run before pagination; summary reports real timing and unknown usage', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const w = raw.createWorkspace({ name: 'Attention', rootPath: '/tmp/buddy-read-attention' });
  const lead = raw.createBuddy({ project: w.id, name: 'Lead', role: 'Read' });
  const worker = raw.createBuddy({ project: w.id, name: 'Worker', role: 'Work' });
  store.setCoordinationMembership(worker.id, w.id, { background_enabled: true });
  const server = createBuddyMcpServer(store, {
    buddyId: lead.id,
    workspaceId: w.id,
    conversationId: 'owner',
  });
  const client = new Client({ name: 'attention-contract', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return (result.structuredContent as any).data;
  };
  try {
    const messages = [0, 1, 2].map((i) =>
      store.sendCoordinatedMessage(
        {
          fromBuddy: lead.id,
          to: worker.id,
          workspace: w.id,
          key: `m-${i}`,
          purpose: 'Read',
          body: 'long '.repeat(100),
        },
        { policy: { allowed_operations: [] } }
      )
    );
    for (let i = 0; i < messages.length; i++)
      raw.db
        .prepare('UPDATE buddy_messages SET created_at=?,updated_at=? WHERE id=?')
        .run(`2026-09-01T00:00:0${i}.000Z`, `2026-09-01T00:00:0${i}.000Z`, messages[i].id);
    assert.equal((await call('get_inbox', { limit: 1 })).messages[0].id, messages[0].id);
    const recent = await call('get_inbox', { order: 'recent', filter: 'outstanding', limit: 1 });
    assert.equal(recent.messages[0].id, messages[2].id);
    assert.equal(recent.messages[0].bodyTruncated, true);
    const firstRun = store.listBuddyRuns({ buddyId: worker.id })[0];
    store.claimBuddyRun(firstRun.id, { claimToken: 'one', conversationId: 'worker' });
    store.startBuddyRun(firstRun.id, 'one');
    store.finishBuddyRun(firstRun.id, {
      claimToken: 'one',
      status: 'complete',
      outcome: 'Inspected',
    });
    const summary = await call('get_team_state', {
      view: 'summary',
      states: ['complete'],
      limit: 1,
    });
    assert.equal(summary.items[0].runId, firstRun.id);
    assert.equal(summary.items[0].state, 'complete');
    assert.equal(summary.items[0].detailsOmitted, true);
    assert.deepEqual(summary.items[0].checkpoints, []);
    assert.ok(summary.items[0].timing.claimedMs >= 0);
    assert.equal(summary.usageCoverage.tokens, null);
    assert.equal(summary.usageCoverage.cost, null);
    const full = await call('get_team_state', { runId: firstRun.id });
    assert.deepEqual(
      full.items[0].timing,
      summary.items[0].timing,
      'terminal elapsed times stop increasing'
    );
  } finally {
    await Promise.all([client.close(), server.close()]);
    raw.close();
  }
});
