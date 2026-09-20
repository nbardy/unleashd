import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BuddiesStore } from '@nbardy/buddies';
import { BuddySoulConflictSchema, BuddySoulSchema } from '@unleashd/shared';
import express from 'express';
import { mergeSoulDraft, resolveSoulMerge } from '../../client/src/components/buddies/soul-merge';
import type { BuddiesStorePort } from '../src/buddies/contract';
import { createLegacyBuddyMcpServer as createBuddyMcpServer } from '../src/buddies/mcp-server';
import { registerBuddyRoutes } from '../src/buddies/routes';
import { updateBuddySoul } from '../src/buddies/soul';

test(
  'two independent SQLite connections racing the same soul revision have exactly one winner',
  { timeout: 15_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'soul-atomic-'));
    const db = join(root, 'buddies.sqlite');
    const store = new BuddiesStore(db);
    const workspace = store.createWorkspace({ name: 'QA', rootPath: root });
    const buddy = store.createBuddy({
      project: workspace.id,
      name: 'QA Lead',
      role: 'Test atomic saves',
    });
    const base = updateBuddySoul(
      store as unknown as BuddiesStorePort,
      buddy.id,
      {
        content: 'Original soul',
        baseVersion: store.readBuddySoul(buddy.id).revision,
        reasoning: 'Seed',
      },
      'owner:test',
      {}
    );
    const workers = ['First edit', 'Second edit'].map(
      (content) =>
        new Worker(
          `
    const { parentPort, workerData } = require('node:worker_threads');
    const { BuddiesStore } = require(workerData.modulePath);
    const store = new BuddiesStore(workerData.db);
    parentPort.once('message', () => {
      try {
        const result = store.updateSoul(workerData.buddyId, {
          content: workerData.content, baseVersion: workerData.baseVersion,
          reasoning: 'Concurrent edit', requestedBy: 'owner:test',
        });
        parentPort.postMessage({ status: 'saved', body: result.body, revision: result.revision });
      } catch (error) {
        parentPort.postMessage({ status: error.code, message: error.message });
      } finally {
        store.close();
        parentPort.close();
      }
    });
    parentPort.postMessage('ready');
  `,
          {
            eval: true,
            workerData: {
              modulePath: require.resolve('@nbardy/buddies'),
              db,
              buddyId: buddy.id,
              baseVersion: base.revision,
              content,
            },
          }
        )
    );
    try {
      await Promise.all(
        workers.map(async (worker) => assert.deepEqual(await once(worker, 'message'), ['ready']))
      );
      const results = workers.map((worker) => once(worker, 'message'));
      for (const worker of workers) worker.postMessage('save');
      const outcomes = (await Promise.all(results)).map(([result]) => result);
      assert.deepEqual(outcomes.map((result) => result.status).sort(), [
        'STALE_MEMORY_WRITE',
        'saved',
      ]);
      const winner = outcomes.find((result) => result.status === 'saved');
      const head = store.readBuddySoul(buddy.id);
      assert.equal(head.body, winner.body);
      assert.equal(head.revision, base.revision + 1);
      const projected = readFileSync(store.getBuddy(buddy.id)!.soul_path!, 'utf8');
      assert.ok(projected.includes(winner.body));
      assert.ok(!projected.includes(winner.body === 'First edit' ? 'Second edit' : 'First edit'));
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('competing HTTP/MCP soul edits preserve all changes through repeated revision conflicts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'soul-conflicts-'));
  const db = join(root, 'buddies.sqlite');
  const store = new BuddiesStore(db);
  const port = store as unknown as BuddiesStorePort;
  const workspace = store.createWorkspace({ name: 'QA', rootPath: root });
  const buddy = store.createBuddy({ project: workspace.id, name: 'QA Lead', role: 'Test edits' });
  const original = '# Identity\nQA Lead\n\n# Style\nBrief\n\n# Work\nPlan';
  const base = BuddySoulSchema.parse(
    updateBuddySoul(
      port,
      buddy.id,
      {
        content: original,
        baseVersion: store.readBuddySoul(buddy.id).revision,
        reasoning: 'Initialize fixture',
      },
      'owner:test',
      {}
    )
  );
  const soulPath = store.getBuddy(buddy.id)!.soul_path!;
  const app = express();
  app.use(express.json());
  registerBuddyRoutes(app, {
    getStore: async () => port,
    getScheduler: () => null,
    createConversation: async () => {
      throw new Error('unused');
    },
    sendError: (res, error, status) => res.status(status).json({ error: String(error) }),
    getNextAutomationRunAt: () => null,
    createId: () => 'test-id',
    isConversationDeleted: async () => false,
  });
  const http = app.listen(0, '127.0.0.1');
  const mcp = createBuddyMcpServer(port, {
    buddyId: buddy.id,
    workspaceId: workspace.id,
    conversationId: 'owner-test',
  });
  const client = new Client({ name: 'conflict-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([once(http, 'listening'), client.connect(a), mcp.connect(b)]);
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/api/buddies/${buddy.id}/soul`;
    const put = (content: string, baseVersion: number) =>
      fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content, baseVersion, reasoning: 'Owner requested this edit' }),
      });
    const drafts = [
      original.replace('QA Lead', 'Animal Fights Lead'),
      original.replace('Brief', 'Detailed'),
    ];
    const responses = await Promise.all(drafts.map((draft) => put(draft, base.revision)));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const winner = responses.findIndex((response) => response.status === 200);
    const head = BuddySoulSchema.parse(await responses[winner].json());
    const stale = BuddySoulConflictSchema.parse(await responses[1 - winner].json());
    assert.equal(head.revision, base.revision + 1);
    assert.equal(stale.details.current_content, head.body);
    assert.equal(stale.details.supplied_base, base.revision);
    assert.equal(store.readBuddySoul(buddy.id).body, head.body);
    const fileAfterWinner = readFileSync(soulPath, 'utf8');

    const staleMcp = await client.callTool({
      name: 'update_soul',
      arguments: {
        content: 'Do not overwrite',
        baseVersion: base.revision,
        reasoning: 'Stale caller',
      },
    });
    assert.equal(staleMcp.isError, true);
    assert.equal(staleMcp.structuredContent?.code, 'MEMORY_STALE');
    assert.equal(readFileSync(soulPath, 'utf8'), fileAfterWinner);

    const merged = resolveSoulMerge(mergeSoulDraft(original, drafts[1 - winner], head.body), {});
    assert.equal(
      merged,
      original.replace('QA Lead', 'Animal Fights Lead').replace('Brief', 'Detailed')
    );
    // A third writer arrives while the first conflict is being reviewed.
    const intervening = await client.callTool({
      name: 'update_soul',
      arguments: {
        content: head.body.replace('Plan', 'Deliver'),
        baseVersion: head.revision,
        reasoning: 'Another owner chat updated work preferences',
      },
    });
    assert.equal(intervening.isError, undefined);
    const fileAfterIntervening = readFileSync(soulPath, 'utf8');
    const retry = await put(merged!, head.revision);
    assert.equal(retry.status, 409);
    const secondConflict = BuddySoulConflictSchema.parse(await retry.json());
    assert.equal(readFileSync(soulPath, 'utf8'), fileAfterIntervening);
    assert.equal(secondConflict.details.current_version, head.revision + 1);
    const reconciled = resolveSoulMerge(
      mergeSoulDraft(head.body, merged!, secondConflict.details.current_content),
      {}
    );
    const expected = merged!.replace('Plan', 'Deliver');
    assert.equal(reconciled, expected);
    const saved = await put(reconciled!, secondConflict.details.current_version);
    assert.equal(saved.status, 200);
    const final = BuddySoulSchema.parse(await saved.json());
    assert.equal(final.body, expected);
    assert.equal(final.revision, base.revision + 3);
    assert.match(readFileSync(soulPath, 'utf8'), /Animal Fights Lead/);
    assert.match(readFileSync(soulPath, 'utf8'), /Detailed/);
    assert.match(readFileSync(soulPath, 'utf8'), /Deliver/);
    const oversized = await put('x'.repeat(10_001), final.revision);
    assert.equal(oversized.status, 413);
    assert.equal(store.readBuddySoul(buddy.id).revision, final.revision);
    assert.deepEqual(BuddySoulSchema.parse(await (await fetch(url)).json()), final);
  } finally {
    await client.close();
    await mcp.close();
    await new Promise<void>((resolve, reject) =>
      http.close((error) => (error ? reject(error) : resolve()))
    );
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
