import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import { BuddyTaskCommentSchema, BuddyTaskCommentsPageSchema } from '@unleashd/shared';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createBuddyMcpServer } from '../src/buddies/mcp-server';
import { BuddyOperationsService } from '../src/buddies/operations';
import { registerBuddyRoutes } from '../src/buddies/routes';

test('Task comments share one durable contract across native tools and owner HTTP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-task-comments-'));
  const raw = new BuddiesStore(':memory:');
  const store = raw as unknown as BuddiesStorePort;
  const workspace = raw.createWorkspace({ name: 'Comments', rootPath: root });
  const buddy = raw.createBuddy({ project: workspace.id, name: 'Writer', role: 'Build' });
  const outsider = raw.createBuddy({ project: workspace.id, name: 'Other', role: 'Other work' });
  const project = raw.newProject({
    buddy: buddy.id,
    workspace: workspace.id,
    title: 'Deliver artifact',
    definitionOfDone: 'Reviewed evidence',
    status: 'in_progress',
  });
  const other = raw.newProject({
    buddy: buddy.id,
    workspace: workspace.id,
    title: 'Unrelated work',
    definitionOfDone: 'Other evidence',
  });
  const before = raw.getBuddyProject(project.id);
  const mcp = createBuddyMcpServer(store, {
    buddyId: buddy.id,
    workspaceId: workspace.id,
    conversationId: 'owner-comments',
  });
  const client = new Client({ name: 'comments-boundary', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([mcp.connect(a), client.connect(b)]);
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('Comments cannot launch work');
    },
    sendError: (response, error, status) => {
      response
        .status(status)
        .json({ error: error instanceof Error ? error.message : String(error) });
    },
    getNextAutomationRunAt: () => '2026-09-15T00:00:00.000Z',
    createId: () => 'unused-comment-id',
    isConversationDeleted: async () => false,
  });
  const http = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('listening', resolve);
      http.once('error', reject);
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return JSON.parse((result.content as Array<{ text: string }>)[0].text).data;
    };
    const input = {
      projectId: project.id,
      key: 'saved-work',
      body: 'Parser saved; review needed.',
      evidence: ['agent_notes/parser.md', 'commit:abc123'],
    };
    const comment = BuddyTaskCommentSchema.parse(await call('append_task_comment', input));
    assert.equal(comment.author, buddy.id);
    assert.deepEqual(await call('append_task_comment', input), comment);
    const conflict = await client.callTool({
      name: 'append_task_comment',
      arguments: { ...input, body: 'Changed under the same key' },
    });
    assert.equal(conflict.isError, true);
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/buddies/projects`;
    const posted = await fetch(`${base}/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'owner-review', body: 'Please also cover empty files.' }),
    });
    assert.equal(posted.status, 201);
    const ownerComment = BuddyTaskCommentSchema.parse(await posted.json());
    assert.equal(ownerComment.author, 'owner');
    const first = BuddyTaskCommentsPageSchema.parse(
      await (await fetch(`${base}/${project.id}/comments?limit=1`)).json()
    );
    assert.equal(first.items[0].id, ownerComment.id);
    assert.ok(first.nextCursor);
    const older = BuddyTaskCommentsPageSchema.parse(
      await call('list_task_comments', {
        projectId: project.id,
        limit: 1,
        cursor: first.nextCursor,
      })
    );
    assert.deepEqual(older.items, [comment]);
    assert.equal(older.nextCursor, null);
    assert.deepEqual(
      raw.getBuddyProject(project.id),
      before,
      'comments never change Task status/revision'
    );
    assert.equal(raw.listBuddyRuns({}).length, 0, 'comments do not enqueue work');
    const stranger = new BuddyOperationsService(store, {
      buddyId: outsider.id,
      workspaceId: workspace.id,
      conversationId: 'other-owner',
    });
    assert.throws(
      () => stranger.execute('buddy.list_task_comments', { projectId: project.id }),
      /access|read|scope|permission/i
    );
    const scoped = new BuddyOperationsService(store, {
      buddyId: buddy.id,
      workspaceId: workspace.id,
      buddyProjectId: project.id,
      conversationId: 'project-work',
      delegatedByBuddyId: outsider.id,
      knowledgeScope: { kind: 'project', projectId: project.id },
    });
    assert.throws(
      () =>
        scoped.execute('buddy.append_task_comment', {
          projectId: other.id,
          key: 'wrong-audience',
          body: 'Private context',
        }),
      /audience/
    );
    const malformed = await fetch(`${base}/${project.id}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'spoof-author', body: 'No', author: buddy.id }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await fetch(`${base}/missing/comments`)).status, 404);
    assert.equal((await fetch(`${base}/${project.id}/comments?limit=0`)).status, 400);
    const tools = await client.listTools();
    assert.ok(!tools.tools.some((tool) => tool.name === 'checkpoint'));
    assert.throws(
      () =>
        new BuddyOperationsService(store, {
          buddyId: buddy.id,
          workspaceId: workspace.id,
        }).execute('buddy.checkpoint', {}),
      /retired/
    );
  } finally {
    await client.close();
    await mcp.close();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve()))
    );
    raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});
