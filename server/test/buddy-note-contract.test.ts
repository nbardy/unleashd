import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore, MEMORY_NOTE_MAX_BYTES } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { executeOwnerResource } from '../src/buddies/owner-resources';
import { scopedNote } from '../src/buddies/knowledge';

test('native and owner note resources enforce the same UTF-8 body bound as remember_note', async () => {
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  const workspace = raw.createWorkspace({ name: 'Notes', rootPath: '/tmp' });
  const buddy = raw.createBuddy({ project: workspace.id, name: 'Writer', role: 'Record evidence' });
  const context = { buddyId: buddy.id, workspaceId: workspace.id, conversationId: 'owner-thread' };
  const scope = { kind: 'owner_thread' as const, conversationId: context.conversationId };
  const server = createBuddyMcpServer(store, context);
  const client = new Client({ name: 'note-contract', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const ref = { targetBuddyId: buddy.id, scope, kind: 'note', name: 'bounded-note' };
  const owner = {
    ownerInputId: 'owner-input',
    conversationId: context.conversationId,
    workspaceIds: [workspace.id],
  };
  try {
    await Promise.all([client.connect(a), server.connect(b)]);
    const read = async () => {
      const result = await client.callTool({ name: 'get_document', arguments: { ref } });
      assert.ok(!result.isError, JSON.stringify(result));
      return (result.structuredContent as { data: { content: string; revision: string } }).data;
    };
    const before = await read();
    const oversized = '界'.repeat(6000);
    const update = {
      ref,
      revision: before.revision,
      key: 'note-create',
      content: oversized,
      reason: 'Synthetic note',
      preview: false,
    };
    const remembered = await client.callTool({
      name: 'remember_note',
      arguments: { body: oversized },
    });
    assert.equal(remembered.isError, true);
    for (const preview of [true, false]) {
      const rejected = await client.callTool({
        name: 'update_document',
        arguments: { ...update, preview },
      });
      assert.equal(rejected.isError, true);
      assert.match(JSON.stringify(rejected), /16000 UTF-8 bytes/);
      assert.throws(
        () =>
          executeOwnerResource(
            store,
            'update_document',
            { ...update, preview, workspaceId: workspace.id },
            owner
          ),
        /16000 UTF-8 bytes/
      );
    }
    assert.throws(
      () =>
        scopedNote(
          store,
          {
            actor: buddy.id,
            workspaceId: workspace.id,
            conversationId: context.conversationId,
            scope,
          },
          { body: oversized }
        ),
      /16000 UTF-8 bytes/,
      'Reviewer/internal scoped notes use the same resource validation'
    );
    assert.deepEqual(await read(), before, 'Rejected writes do not create a document or revision');
    const body = '界'.repeat(5333) + 'x';
    assert.equal(Buffer.byteLength(body), MEMORY_NOTE_MAX_BYTES);
    const valid = await client.callTool({
      name: 'update_document',
      arguments: { ...update, content: body },
    });
    assert.ok(!valid.isError, JSON.stringify(valid));
    const head = await read();
    assert.equal(head.content, body);
    const atLimit = await client.callTool({
      name: 'remember_note',
      arguments: { body, topic: 'Exact body cap', evidence: ['Separate metadata'] },
    });
    assert.ok(!atLimit.isError, JSON.stringify(atLimit));
    const replacement = await client.callTool({
      name: 'update_document',
      arguments: { ...update, key: 'note-replace', revision: head.revision, content: 'changed' },
    });
    assert.equal(replacement.isError, true);
    assert.match(JSON.stringify(replacement), /append-only/);
    assert.deepEqual(await read(), head);
  } finally {
    await client.close();
    await server.close();
    raw.close();
  }
});

test('native recall advertises literal matching and treats regex metacharacters literally', async () => {
  const raw = new BuddiesStore(':memory:');
  const workspace = raw.createWorkspace({ name: 'Recall', rootPath: '/tmp' });
  const buddy = raw.createBuddy({ project: workspace.id, name: 'Reader', role: 'Recall evidence' });
  const server = createBuddyMcpServer(raw as unknown as BuddiesStorePort, {
    buddyId: buddy.id,
    workspaceId: workspace.id,
    conversationId: 'owner-thread',
  });
  const client = new Client({ name: 'recall-contract', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(a), server.connect(b)]);
    const tools = await client.listTools();
    const recall = tools.tools.find((tool) => tool.name === 'recall')!;
    assert.equal(recall.inputSchema.properties?.regex, undefined);
    assert.match(recall.description!, /literal/);
    assert.doesNotMatch(recall.description!, /regex must be explicitly enabled/);
    for (const body of ['literal a.*b canary', 'pattern axxxb decoy']) {
      const result = await client.callTool({ name: 'remember_note', arguments: { body } });
      assert.ok(!result.isError, JSON.stringify(result));
    }
    const result = await client.callTool({ name: 'recall', arguments: { pattern: 'a.*b' } });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.match(JSON.stringify(result), /literal a\.\*b canary/);
    assert.doesNotMatch(JSON.stringify(result), /axxxb decoy/);
    const unsupported = await client.callTool({
      name: 'recall',
      arguments: { pattern: 'a.*b', regex: true },
    });
    assert.equal(unsupported.isError, true);
    assert.match(JSON.stringify(unsupported), /regex/);
  } finally {
    await client.close();
    await server.close();
    raw.close();
  }
});
