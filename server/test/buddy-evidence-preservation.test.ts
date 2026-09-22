import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';

test('Buddy MCP preserves omitted completion evidence while criteria changes reopen work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-evidence-mcp-'));
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({ name: 'Evidence fixture', rootPath: root });
  const lead = store.createBuddy({
    project: workspace.id,
    name: 'Lead',
    role: 'Coordinate',
  });
  const worker = store.createBuddy({
    project: workspace.id,
    name: 'Worker',
    role: 'Deliver',
  });
  store.setBuddyRelationship({
    fromBuddy: lead.id,
    toBuddy: worker.id,
    kind: 'manager',
  });
  const server = createBuddyMcpServer(store as unknown as BuddiesStorePort, {
    buddyId: lead.id,
    workspaceId: workspace.id,
    conversationId: 'evidence-fixture-owner',
  });
  const client = new Client({ name: 'buddy-evidence-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    return (result.structuredContent as { data: any }).data;
  }

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    for (const [label, ownerId] of [
      ['self', lead.id],
      ['supervised', worker.id],
    ]) {
      const created = await call('new_project', {
        key: `create-${label}`,
        ownerId,
        title: `${label} project`,
        definitionOfDone: 'Original criteria',
        todos: [{ title: 'Step', definitionOfDone: 'Original step criteria' }],
      });
      const seeded = await call('update_project', {
        projectId: created.id,
        baseRevision: created.revision,
        key: `seed-${label}`,
        status: 'done',
        evidence: ['project:old'],
        todoOperations: [
          {
            operation: 'update',
            todoId: created.todos[0].id,
            status: 'done',
            evidence: ['todo:old'],
          },
        ],
      });
      const criteriaPatch = {
        projectId: created.id,
        baseRevision: seeded.revision,
        key: `criteria-${label}`,
        definitionOfDone: 'Clarified criteria',
        todoOperations: [
          {
            operation: 'update',
            todoId: created.todos[0].id,
            definitionOfDone: 'Clarified step criteria',
          },
        ],
      };
      const reassessedWrite = await call('update_project', criteriaPatch);
      const reassessed = (
        await call('get_current_work', {
          projectId: created.id,
          includeClosed: true,
          view: 'full',
        })
      ).items[0];
      assert.equal(reassessed.status, 'in_progress');
      assert.equal(reassessed.completed_at, null);
      assert.deepEqual(JSON.parse(reassessed.completion_evidence), ['project:old']);
      assert.equal(reassessed.todos[0].status, 'open');
      assert.equal(reassessed.todos[0].completed_at, null);
      assert.deepEqual(reassessed.todos[0].completion_evidence, ['todo:old']);
      assert.deepEqual(await call('update_project', criteriaPatch), reassessedWrite);

      const replacementPatch = {
        projectId: created.id,
        baseRevision: reassessed.revision,
        key: `replace-${label}`,
        status: 'done',
        evidence: ['project:new'],
        todoOperations: [
          {
            operation: 'update',
            todoId: created.todos[0].id,
            status: 'done',
            evidence: ['todo:new'],
          },
        ],
      };
      const replacedWrite = await call('update_project', replacementPatch);
      const replaced = (
        await call('get_current_work', {
          projectId: created.id,
          includeClosed: true,
          view: 'full',
        })
      ).items[0];
      assert.equal(replaced.status, 'done');
      assert.deepEqual(JSON.parse(replaced.completion_evidence), ['project:new']);
      assert.equal(replaced.todos[0].status, 'done');
      assert.deepEqual(replaced.todos[0].completion_evidence, ['todo:new']);
      assert.deepEqual(await call('update_project', replacementPatch), replacedWrite);
    }
  } finally {
    await client.close();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Buddy MCP treats explicit empty evidence as omitted, preserving prior evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-empty-evidence-mcp-'));
  const store = new BuddiesStore(':memory:');
  const workspace = store.createWorkspace({ name: 'Empty-evidence fixture', rootPath: root });
  const lead = store.createBuddy({
    project: workspace.id,
    name: 'Lead',
    role: 'Coordinate',
  });
  const worker = store.createBuddy({
    project: workspace.id,
    name: 'Worker',
    role: 'Deliver',
  });
  store.setBuddyRelationship({
    fromBuddy: lead.id,
    toBuddy: worker.id,
    kind: 'manager',
  });
  const server = createBuddyMcpServer(store as unknown as BuddiesStorePort, {
    buddyId: lead.id,
    workspaceId: workspace.id,
    conversationId: 'empty-evidence-fixture-owner',
  });
  const client = new Client({ name: 'buddy-empty-evidence-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined, JSON.stringify(result.content));
    return (result.structuredContent as { data: any }).data;
  }

  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    for (const [label, ownerId] of [
      ['self', lead.id],
      ['supervised', worker.id],
    ]) {
      const created = await call('new_project', {
        key: `create-${label}`,
        ownerId,
        title: `${label} project`,
        definitionOfDone: 'Original criteria',
        todos: [{ title: 'Step', definitionOfDone: 'Original step criteria' }],
      });
      const seeded = await call('update_project', {
        projectId: created.id,
        baseRevision: created.revision,
        key: `seed-${label}`,
        status: 'done',
        evidence: ['e1', 'e2', 'e3', 'e4', 'e5'],
        todoOperations: [
          {
            operation: 'update',
            todoId: created.todos[0].id,
            status: 'done',
            evidence: ['todo:old'],
          },
        ],
      });
      // Explicit [] carries no new proof: it must preserve like an omitted field,
      // never wipe the five seeded project entries or the todo entry.
      await call('update_project', {
        projectId: created.id,
        baseRevision: seeded.revision,
        key: `empty-${label}`,
        nextAction: 'follow up',
        evidence: [],
        todoOperations: [
          {
            operation: 'update',
            todoId: created.todos[0].id,
            nextAction: 'keep going',
            evidence: [],
          },
        ],
      });
      const kept = (
        await call('get_current_work', {
          projectId: created.id,
          includeClosed: true,
          view: 'full',
        })
      ).items[0];
      assert.deepEqual(JSON.parse(kept.completion_evidence), ['e1', 'e2', 'e3', 'e4', 'e5']);
      assert.deepEqual(kept.todos[0].completion_evidence, ['todo:old']);
    }
  } finally {
    await client.close();
    await server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
