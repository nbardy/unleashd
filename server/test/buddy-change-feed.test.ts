import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BuddiesStore } from '@nbardy/buddies';
import express from 'express';
import { onBuddiesChanged, registerBuddyMutationFeed } from '../src/buddies/change-feed';
import { BuddyOperationsService } from '../src/buddies/operations';

// The client refreshes every cached Buddy view from ONE signal. These guard the
// two properties that signal must have: a write announces itself no matter
// which door it came through, and a read never does (a Buddy polling its inbox
// must not make every open panel refetch).

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'buddy-change-feed-'));
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'BUDDY_SOUL.md'), 'Act on evidence.');
  const store = new BuddiesStore(join(root, 'state.sqlite'));
  const workspace = store.createWorkspace({ name: 'Workspace', rootPath: workspaceRoot });
  const buddy = store.createBuddy({
    project: workspace.id,
    name: 'Lead',
    role: 'Delivery',
    memoryPath: 'memory',
    soulPath: 'BUDDY_SOUL.md',
  });
  return {
    store,
    buddy,
    workspace,
    close() {
      store.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('a Buddy operation that writes announces once; a read stays silent', () => {
  const f = fixture();
  let announcements = 0;
  const unsubscribe = onBuddiesChanged(() => {
    announcements += 1;
  });
  try {
    const operations = new BuddyOperationsService(f.store, {
      buddyId: f.buddy.id,
      workspaceId: f.workspace.id,
    });

    operations.execute('buddy.get_current_work');
    assert.equal(announcements, 0, 'reads must not fan out to every Buddy panel');

    operations.execute('buddy.new_project', {
      title: 'Ship the change feed',
      definitionOfDone: 'Every Buddy view refreshes from one WS event.',
    });
    assert.equal(announcements, 1, 'one write, one signal');
  } finally {
    unsubscribe();
    f.close();
  }
});

test('a successful non-GET under /api/buddies announces; GETs and failures do not', async () => {
  const app = express();
  registerBuddyMutationFeed(app);
  app.get('/api/buddies/overview', (_request, response) => response.json({}));
  app.post('/api/buddies/x/messages', (_request, response) => response.status(201).json({}));
  app.post('/api/buddies/x/broken', (_request, response) => response.status(400).json({}));

  let announcements = 0;
  const unsubscribe = onBuddiesChanged(() => {
    announcements += 1;
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await fetch(`${base}/api/buddies/overview`);
    await fetch(`${base}/api/buddies/x/broken`, { method: 'POST' });
    assert.equal(announcements, 0);

    await fetch(`${base}/api/buddies/x/messages`, { method: 'POST' });
    assert.equal(announcements, 1);
  } finally {
    unsubscribe();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
