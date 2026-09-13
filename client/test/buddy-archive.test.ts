import assert from 'node:assert/strict';
import test from 'node:test';
import type { Conversation } from '@unleashd/shared';
import { createStore } from 'jotai';
import { archivedBuddyIdsAtom } from '../src/atoms/buddy-visibility';
import { buddySidebarOverviewAtom, buddySidebarProjectsAtom } from '../src/atoms/buddy-sidebar';
import {
  allConversationsAtom,
  conversationAtomFamily,
  conversationsAtom,
} from '../src/atoms/conversations';
import { buddyTabPath, parseEmployeeTab } from '../src/components/buddies/buddy-tabs';

test('archived Buddy threads stay hidden despite stale overview and later conversation snapshots', () => {
  const store = createStore();
  const thread = {
    id: 'thread',
    kind: { kind: 'buddy', buddyId: 'retired', workspaceId: 'work' },
    createdAt: new Date(),
    messages: [],
  } as unknown as Conversation;
  store.set(conversationsAtom, new Map([[thread.id, thread]]));
  store.set(buddySidebarOverviewAtom, {
    employees: [{ buddy: { id: 'retired', name: 'Retired' }, workspaces: [] }],
    recentRuns: [],
  });
  store.set(archivedBuddyIdsAtom, new Set(['retired']));
  store.set(conversationsAtom, new Map([[thread.id, { ...thread, title: 'Late update' }]]));
  assert.deepEqual(store.get(allConversationsAtom), []);
  assert.equal(store.get(conversationAtomFamily(thread.id)), null);
  assert.deepEqual(store.get(buddySidebarProjectsAtom), []);
});

test('Settings is a real Buddy route', () => {
  assert.equal(parseEmployeeTab('settings'), 'settings');
  assert.equal(buddyTabPath('lead', 'settings'), '/buddies/lead/settings');
});
