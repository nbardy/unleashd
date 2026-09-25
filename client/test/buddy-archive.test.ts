import assert from 'node:assert/strict';
import test from 'node:test';
import { type ServerMessage, encodeRows } from '@unleashd/shared';
import { handleMessage } from '../src/atoms/actions';
import { buddySidebarAtom, buddySidebarOverviewAtom } from '../src/atoms/buddy-sidebar';
import { listIndexAtom, rowFamily } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { syntheticConversation } from './fixtures/synthetic-conversations';

// An archived Buddy's rows never enter the store (filtered at ingestion in
// actions.ts, T19), so no reader re-checks the archived set. A stale overview
// and a late `rows` update for its thread must not bring it back.
test('archived Buddy threads stay hidden despite stale overview and later row updates', () => {
  const thread = syntheticConversation(1, {
    id: 'thread',
    kind: { t: 'buddy', buddyId: 'retired', workspaceId: 'work', visibility: 'foreground' },
  });
  handleMessage({
    type: 'hello',
    protocol: { version: 3 },
    defaultCwd: '/',
    loading: false,
    archivedBuddyIds: [],
    ...encodeRows([thread]),
  } as unknown as ServerMessage);
  jotaiStore.set(buddySidebarOverviewAtom, [
    {
      id: 'work',
      name: 'Work',
      rootPath: '/work',
      buddies: [{ id: 'retired', name: 'Retired', status: 'active' }],
    },
  ]);
  assert.equal(jotaiStore.get(rowFamily(thread.id))?.id, thread.id);

  handleMessage({ type: 'buddy_archived', buddyId: 'retired' });
  handleMessage({
    type: 'rows',
    ...encodeRows([{ ...thread, label: 'Late update' }]),
  } as unknown as ServerMessage);

  assert.deepEqual(jotaiStore.get(listIndexAtom).order, []);
  assert.equal(jotaiStore.get(rowFamily(thread.id)), null);
  assert.deepEqual(jotaiStore.get(buddySidebarAtom).projects, []);
});
