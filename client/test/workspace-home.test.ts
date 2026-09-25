import assert from 'node:assert/strict';
import test from 'node:test';
import type { BuddyOverview } from '../src/components/buddies/types';
import { RECENT_TILES, workspaceHomeSections } from '../src/components/buddies/workspace-home';

// Port of 6d04860's tests onto the T19 list index: activity now comes from the
// Buddy conversations in `listField('buddyEntries')`, names from the overview.

const workspace = (id: string, buddies: string[] = []) =>
  ({
    id,
    name: id,
    rootPath: `/tmp/${id}`,
    createdAt: '2026-09-25T00:00:00.000Z',
    buddies: buddies.map((buddyId) => ({ id: buddyId, name: buddyId.toUpperCase() })),
    taskCounts: [],
  }) as unknown as BuddyOverview[number];

const entry = (workspaceId: string, buddyId: string, activityMs: number) => ({
  buddyId,
  buddyWorkspaceId: workspaceId,
  activityMs,
});

// Every workspace must appear exactly once: a tiled workspace repeated in the
// list, or a quiet one dropped from both, is the easy way to get this wrong.
test('workspace home tiles the most recent and lists every other workspace once', () => {
  const active = ['a', 'b', 'c', 'd', 'e'];
  const overview = [...active, 'quiet'].map((id) => workspace(id, ['lead']));
  const entries = active.map((id, index) => entry(id, 'lead', 1_000 + index));
  const { recent, rest } = workspaceHomeSections(overview, new Map(), entries);

  assert.deepEqual(
    recent.map((row) => row.id),
    ['e', 'd', 'c', 'b'].slice(0, RECENT_TILES)
  );
  assert.deepEqual(
    rest.map((row) => row.id),
    ['a', 'quiet']
  );
});

test('workspace faces are distinct Buddies, most recently active first', () => {
  const { recent } = workspaceHomeSections(
    [workspace('w', ['old', 'lead', 'dev', 'x'])],
    new Map([['w', { requests: 2, unreadChannels: 1 }]]),
    [
      entry('w', 'old', 9),
      entry('w', 'lead', 10),
      entry('w', 'lead', 12),
      entry('w', 'dev', 11),
      entry('other', 'x', 13),
    ]
  );
  const [row] = recent;
  assert.equal(row.total.requests, 2);
  assert.deepEqual(row.activity, {
    kind: 'active',
    lastActiveMs: 12,
    buddies: [
      { id: 'lead', name: 'LEAD' },
      { id: 'dev', name: 'DEV' },
      { id: 'old', name: 'OLD' },
    ],
  });
});
