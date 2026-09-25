import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation } from '@unleashd/shared';
import { createStore } from 'jotai';
import { buddySidebarOverviewAtom, buddySidebarProjectsAtom } from '../src/atoms/buddy-sidebar';
import {
  allConversationIdsAtom,
  chatConversationIdsAtom,
  conversationAtomFamily,
  conversationsAtom,
} from '../src/atoms/conversations';

test('background placement hides rows but preserves direct transcript access and visible owner chats', () => {
  const store = createStore();
  store.set(buddySidebarOverviewAtom, {
    employees: [
      { buddy: { id: 'lead', name: 'Lead' }, workspaces: [{ id: 'work', name: 'Work' }] },
    ],
    recentRuns: [],
  });
  const make = (id: string, placement: 'default' | 'background') =>
    ({
      id,
      placement,
      kind: { kind: 'buddy' as const, buddyId: 'lead', workspaceId: 'work' },
      createdAt: new Date(),
      messages: [] as Conversation['messages'],
      workingDirectory: '/project',
    }) as Conversation;
  const owner = make('owner-thread', 'default');
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
  // A schedule returning in the owner's chat updates execution, not placement.
  store.set(
    conversationsAtom,
    new Map([
      [owner.id, { ...owner, isRunning: true }],
      [worker.id, worker],
    ])
  );
  assert.deepEqual(store.get(chatConversationIdsAtom), [owner.id]);
});
