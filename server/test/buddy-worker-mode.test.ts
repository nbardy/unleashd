import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { coordinationStore } from '../src/buddies/coordination-store';
import { createBuddyDispatchService } from '../src/buddies/dispatch-service';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';

test('current MCP creates a Worker and dispatches two projects through the existing continuation boundary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-mcp-'));
  const raw = new BuddiesStore(join(root, 'state.sqlite'));
  const store = coordinationStore(raw as unknown as BuddiesStorePort);
  const workspace = raw.createWorkspace({ name: 'Team', rootPath: root });
  const parent = raw.createBuddy({ project: workspace.id, name: 'Parent', role: 'Coordinate' });
  raw.setBuddyAccess({
    granteeId: parent.id,
    workspaceId: workspace.id,
    capabilities: ['staff.create'],
    createdBuddyIncoming: true,
    baseRevision: 0,
    key: 'grant',
    reason: 'Owner staffing grant',
  });
  const context = { buddyId: parent.id, workspaceId: workspace.id, conversationId: 'owner-thread' };
  const dispatch = createBuddyDispatchService({
    getStore: async () => store,
    createConversation: async () => {
      throw new Error('Admission must remain inert');
    },
    dispatchInitialMessage: async () => {},
    abandonConversation: () => {},
  });
  const server = createBuddyMcpServer(raw as unknown as BuddiesStorePort, context, {
    dispatchMessage: (input) => dispatch.send(context, input),
  });
  const client = new Client({ name: 'worker-flow', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const call = async (name: string, input: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: input });
    assert.ok(!result.isError, JSON.stringify(result));
    return (result.structuredContent as { data: any }).data;
  };
  try {
    await Promise.all([client.connect(a), server.connect(b)]);
    const input = {
      key: 'designer',
      name: 'Designer',
      role: 'Deliver related designs',
      soul: 'Keep saved evidence',
      employmentMode: 'worker',
      backgroundEnabled: true,
    };
    const created = await call('create_buddy', input);
    assert.equal(created.buddy.employment_mode, 'worker');
    assert.equal((await call('create_buddy', input)).buddy.id, created.buddy.id);
    assert.equal(raw.getBuddyTeamState(created.buddy.id).manager?.id, parent.id);
    const project = async (key: string) =>
      call('new_project', {
        key,
        ownerId: created.buddy.id,
        title: key,
        definitionOfDone: 'Saved reviewed artifact',
      });
    const first = await project('first'),
      second = await project('second');
    const send = (id: string, key: string, continueFrom?: string) =>
      call('send', {
        key,
        to: created.buddy.id,
        purpose: 'work',
        body: 'Deliver criteria',
        delivery: {
          kind: 'work',
          projectId: id,
          maxRuns: 2,
          maxDurationSeconds: 120,
          ...(continueFrom ? { continueFrom } : {}),
        },
      });
    const firstReceipt = await send(first.id, 'start');
    const message = firstReceipt.message;
    const run = raw
      .listBuddyRuns({ buddyId: created.buddy.id })
      .find((r) => r.input_id === message.id)!;
    raw.claimBuddyRun(run.id, { claimToken: run.id, conversationId: 'worker-background' });
    raw.startBuddyRun(run.id, run.id);
    raw.updateCoordinatedProject(
      first.id,
      { baseRevision: first.revision, status: 'done', evidence: ['file:design.md@v1'] },
      { actor: created.buddy.id, key: 'finish' }
    );
    raw.finishBuddyRun(run.id, { claimToken: run.id, status: 'complete' });
    const next = await send(second.id, 'continue', message.id);
    assert.equal(next.message.child_conversation_id, 'worker-background');
    assert.equal(next.message.buddy_project_id, second.id);
    assert.equal(raw.listBuddies().length, 2);
  } finally {
    await client.close();
    await server.close();
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
