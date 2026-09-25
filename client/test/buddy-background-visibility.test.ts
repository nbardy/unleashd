import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from 'jotai';
import { buddySidebarOverviewAtom, buddySidebarProjectsAtom } from '../src/atoms/buddy-sidebar';
import {
  allConversationIdsAtom,
  chatConversationIdsAtom,
  conversationAtomFamily,
  conversationsAtom,
} from '../src/atoms/conversations';
import { syntheticConversation } from './fixtures/synthetic-conversations';

test('background visibility hides rows but preserves direct transcript access and visible owner chats', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, {
    employees: [
      { buddy: { id: 'lead', name: 'Lead' }, workspaces: [{ id: 'work', name: 'Work' }] },
    ],
    recentRuns: [],
  });
  const make = (id: string, visibility: 'foreground' | 'background') =>
    syntheticConversation(1, {
      id,
      kind: { t: 'buddy', buddyId: 'lead', workspaceId: 'work', visibility },
      cwd: '/project',
    });
  const owner = make('owner-thread', 'foreground');
  const worker = make('background-thread', 'background');
  store.set(
    conversationsAtom,
    new Map([
      [owner.id, owner],
      [worker.id, worker],
    ])
  );
  assert.ok(store.get(allConversationIdsAtom).includes(worker.id));
  assert.equal(store.get(conversationAtomFamily(worker.id))?.id, worker.id);
  assert.deepEqual(store.get(chatConversationIdsAtom), [owner.id]);
  assert.deepEqual(
    store
      .get(buddySidebarProjectsAtom)
      .flatMap((p) => p.items.flatMap((i) => i.conversations.map((c) => c.id))),
    [owner.id]
  );
  // A schedule returning in the owner's chat updates execution, not visibility.
  store.set(
    conversationsAtom,
    new Map([
      [owner.id, { ...owner, run: 'running' }],
      [worker.id, worker],
    ])
  );
  assert.deepEqual(store.get(chatConversationIdsAtom), [owner.id]);
});
