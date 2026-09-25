import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from 'jotai';
import { buddySidebarAtom, buddySidebarOverviewAtom } from '../src/atoms/buddy-sidebar';
import { listIndexAtom, rowFamily, rowsAtom } from '../src/atoms/conversations';
import { syntheticConversation } from './fixtures/synthetic-conversations';

test('background placement hides rows but preserves direct transcript access and visible owner chats', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, [
    {
      id: 'work',
      name: 'Work',
      rootPath: '/project',
      buddies: [{ id: 'lead', name: 'Lead', status: 'active' }],
    },
  ]);
  const make = (id: string, placement: 'default' | 'background') =>
    syntheticConversation(1, {
      id,
      kind: {
        t: 'buddy',
        buddyId: 'lead',
        workspaceId: 'work',
        visibility: placement === 'background' ? 'background' : 'foreground',
      },
      cwd: '/project',
    });
  const owner = make('owner-thread', 'default');
  const worker = make('background-thread', 'background');
  store.set(
    rowsAtom,
    new Map([
      [owner.id, owner],
      [worker.id, worker],
    ])
  );
  assert.ok(store.get(listIndexAtom).order.includes(worker.id));
  assert.equal(store.get(rowFamily(worker.id))?.id, worker.id);
  assert.deepEqual(store.get(listIndexAtom).inbox.ids, [owner.id]);
  assert.deepEqual(
    store
      .get(buddySidebarAtom)
      .projects.flatMap((p) => p.items.flatMap((i) => i.conversations.map((c) => c.id))),
    [owner.id]
  );
  // A schedule returning in the owner's chat updates execution, not placement.
  store.set(
    rowsAtom,
    new Map([
      [owner.id, { ...owner, run: 'running' }],
      [worker.id, worker],
    ])
  );
  assert.deepEqual(store.get(listIndexAtom).inbox.ids, [owner.id]);
});
