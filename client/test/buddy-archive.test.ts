import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore } from 'jotai';
import { buddySidebarOverviewAtom, buddySidebarProjectsAtom } from '../src/atoms/buddy-sidebar';
import { archivedBuddyIdsAtom } from '../src/atoms/buddy-visibility';
import {
  allConversationIdsAtom,
  conversationAtomFamily,
  conversationsAtom,
} from '../src/atoms/conversations';
import { syntheticConversation } from './fixtures/synthetic-conversations';

test('archived Buddy threads stay hidden despite stale overview and later conversation snapshots', () => {
  const store = createStore();
  const thread = syntheticConversation(1, {
    id: 'thread',
    kind: { t: 'buddy', buddyId: 'retired', workspaceId: 'work', visibility: 'foreground' },
  });
  store.set(conversationsAtom, new Map([[thread.id, thread]]));
  store.set(buddySidebarOverviewAtom, [
    {
      id: 'work',
      name: 'Work',
      rootPath: '/work',
      buddies: [{ id: 'retired', name: 'Retired', status: 'active' }],
    },
  ]);
  store.set(archivedBuddyIdsAtom, new Set(['retired']));
  store.set(conversationsAtom, new Map([[thread.id, { ...thread, label: 'Late update' }]]));
  assert.deepEqual(store.get(allConversationIdsAtom), []);
  assert.equal(store.get(conversationAtomFamily(thread.id)), null);
  assert.deepEqual(store.get(buddySidebarProjectsAtom), []);
});
