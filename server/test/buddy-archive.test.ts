import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import express from 'express';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { registerSearchRoutes } from '../src/http/search-routes';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { BuddyScheduler, nextAutomationRunAt } from '../src/buddies/scheduler';

test('Delete archives durably, drains automation claims and removes public Buddy projections', async () => {
  const root = mkdtempSync(join(tmpdir(), 'buddy-archive-'));
  const database = join(root, 'buddies.sqlite');
  let store = new BuddiesStore(database);
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: root });
  const manager = store.createBuddy({ project: workspace.id, name: 'Manager', role: 'Manage' });
  store.updateBuddy(manager.id, { hireQuota: 1 });
  const { buddy } = store.hireDirectReport({
    managerBuddy: manager.id,
    workspace: workspace.id,
    name: 'Report',
    role: 'Research',
    soul: 'Preserve this soul.',
  });
  store.rememberNote(buddy.id, { topic: 'Archive proof', body: 'Preserve this memory.' });
  store.linkConversation({
    buddy: buddy.id,
    workspace: workspace.id,
    provider: 'codex',
    unleashdConversationId: 'archived-thread',
  });
  const definition = store.createAutomation({
    buddy: buddy.id,
    workspace: workspace.id,
    name: 'Scheduled research',
    scheduleKind: 'interval',
    scheduleExpression: '60',
    jobKind: 'prompt',
    jobPayload: { prompt: 'Research.' },
    nextRunAt: new Date().toISOString(),
  });
  const run = store.claimAutomationRun(definition.id, {
    scheduledFor: new Date().toISOString(),
    claimToken: 'test-claim',
    leaseSeconds: 120,
  });
  const scheduler = new BuddyScheduler({
    store: store as unknown as BuddiesStorePort,
    createConversation: async () => {
      throw new Error('Archived Buddy must not run');
    },
  });
  const archived: string[] = [];
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => store as unknown as BuddiesStorePort,
    getScheduler: () => scheduler,
    onBuddyArchived: async (id) => {
      assert.equal(store.getBuddy(id)?.status, 'archived');
      archived.push(id);
    },
    sendError: (res, error, status) => res.status(status).json({ error: String(error) }),
    getNextAutomationRunAt: nextAutomationRunAt,
    createId: () => 'test-id',
    isConversationDeleted: async () => false,
  });
  registerSearchRoutes(
    app,
    () =>
      ['archived-thread', 'general-thread'].map((id) => ({
        id,
        workingDirectory: root,
        messages: [{ role: 'user' as const, content: 'Searchable history', timestamp: new Date() }],
      })),
    async () => (id) => id !== 'archived-thread' || store.getBuddy(buddy.id)?.status !== 'archived'
  );
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/buddies`;
    const availability = await fetch(`${url}/capabilities/archive`);
    assert.equal(availability.status, 200);
    assert.deepEqual(await availability.json(), { available: true });
    const response = await fetch(`${url}/${buddy.id}`, { method: 'DELETE' });
    assert.equal(response.status, 200, await response.text());
    assert.deepEqual(archived, [buddy.id]);
    assert.equal(store.getAutomationRun(run.id)?.status, 'cancelled');
    assert.equal(Boolean(store.getAutomation(definition.id)?.enabled), false);
    await assert.rejects(() => scheduler.runNow(definition.id), /disabled/);
    assert.equal(store.listConversationLinks(buddy.id).length, 1);
    const search = await fetch(url.replace('/api/buddies', '/api/search?q=Searchable'));
    assert.equal(search.status, 200);
    const hits = (await search.json()) as { results: Array<{ conversationId: string }> };
    assert.deepEqual(
      hits.results.map((hit) => hit.conversationId),
      ['general-thread']
    );
    assert.ok(
      JSON.stringify(store.recall(buddy.id, { pattern: 'Preserve' })).includes(
        'Preserve this memory'
      )
    );
    assert.equal((await fetch(`${url}/${buddy.id}`)).status, 404);
    assert.equal((await fetch(`${url}/${buddy.id}/context`)).status, 404);
    for (const path of ['', '/overview', `/${manager.id}`]) {
      const result = await fetch(`${url}${path}`);
      assert.equal(result.status, 200);
      assert.equal((await result.text()).includes(buddy.id), false, path);
    }
    assert.equal((await fetch(`${url}/${buddy.id}`, { method: 'DELETE' })).status, 200);
    store.close();
    store = new BuddiesStore(database);
    assert.equal(store.getBuddy(buddy.id)?.status, 'archived');
    assert.equal((await fetch(`${url}/${buddy.id}`)).status, 404);
    assert.equal((await (await fetch(`${url}/overview`)).text()).includes(buddy.id), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
