import assert from 'node:assert/strict';
import test from 'node:test';
import { RECENT_TILES, workspaceHomeSections } from '../src/components/buddies/workspace-home';

const run = (workspaceId: string, buddyId: string, lastActiveAt: string) => ({
  conversationId: `${workspaceId}-${buddyId}-${lastActiveAt}`,
  buddyId,
  buddyName: buddyId.toUpperCase(),
  workspaceId,
  workspaceName: workspaceId,
  status: 'idle',
  lastActiveAt,
});

// Every workspace must appear exactly once: a tiled workspace repeated in the
// list, or a quiet one dropped from both, is the easy way to get this wrong.
test('workspace home tiles the most recent and lists every other workspace once', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'quiet'];
  const workspaces = ids.map((id) => ({ id, slug: id, name: id, root_path: `/tmp/${id}` }));
  const runs = ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
    run(id, 'lead', `2026-09-25T1${index}:00:00.000Z`)
  );
  const { recent, rest } = workspaceHomeSections(workspaces, new Map(), runs);

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
    [{ id: 'w', slug: 'w', name: 'w', root_path: '/tmp/w' }],
    new Map([['w', { repliesToYou: 2, unreadChannels: 1 }]]),
    [
      run('w', 'old', '2026-09-25T09:00:00.000Z'),
      run('w', 'lead', '2026-09-25T10:00:00.000Z'),
      run('w', 'lead', '2026-09-25T12:00:00.000Z'),
      run('w', 'dev', '2026-09-25T11:00:00.000Z'),
      run('other', 'x', '2026-09-25T13:00:00.000Z'),
    ]
  );
  const [row] = recent;
  assert.equal(row.repliesToYou, 2);
  assert.deepEqual(row.activity, {
    kind: 'active',
    lastActiveAt: '2026-09-25T12:00:00.000Z',
    buddies: [
      { id: 'lead', name: 'LEAD' },
      { id: 'dev', name: 'DEV' },
      { id: 'old', name: 'OLD' },
    ],
  });
});
