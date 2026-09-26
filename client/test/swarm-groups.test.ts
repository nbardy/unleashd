import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationRow, OompaRuntimeSnapshot } from '@unleashd/shared';
import {
  buildProjectCards,
  groupExecWorkers,
  runningFromSnapshot,
} from '../src/swarm/swarm-groups';

/**
 * The one swarm regroup (T20). Six views each carried a copy until 2026-09-26,
 * and the copies drifted: the mobile detail ignored the selected run and the
 * mobile dashboard ignored runtime snapshots. The fixture is shaped like a real
 * oompa project: two runs, exec workers w0/w1 with reviews and a fix, each row
 * as the list index delivers it.
 */
const ROOT = '/Users/nick/git/room-runners-arena-lib';
const T = Date.parse('2026-09-20T10:00:00Z');
const MIN = 60_000;

function worker(
  id: string,
  swarmId: string,
  workerId: string,
  role: 'work' | 'review' | 'fix',
  createdAt: number,
  activityAt: number
): ConversationRow {
  return {
    id,
    kind: { t: 'worker', swarmId, workerId, role },
    parent: null,
    resumedFrom: null,
    provider: 'claude',
    cwd: `${ROOT}/.ws${swarmId}-${workerId}-i1`,
    label: `[oompa] ${workerId} ${role}`,
    createdAt,
    activityAt,
    messageCount: 12,
    run: 'idle',
    done: false,
  };
}

const ROWS: ConversationRow[] = [
  worker('exec-w0', 'run-a', 'w0', 'work', T, T + 10 * MIN),
  worker('exec-w1', 'run-a', 'w1', 'work', T, T + 30 * MIN),
  worker('review-w0', 'run-a', 'w0-review', 'review', T + 11 * MIN, T + 12 * MIN),
  worker('fix-w1', 'run-a', 'w1-fix', 'fix', T + 31 * MIN, T + 33 * MIN),
  // Run B: created one minute after w0's last activity, closer than anything,
  // but it belongs to another run and must never pair with a run-A exec.
  worker('exec-b', 'run-b', 'w0', 'work', T + 60 * MIN, T + 90 * MIN),
  worker('review-b-orphan', 'run-b-stale', 'r', 'review', T + 10 * MIN + 1, T + 11 * MIN),
];

const snapshot = (workers: OompaRuntimeSnapshot['run']): OompaRuntimeSnapshot => ({
  available: true,
  run: workers,
  reason: null,
});

test('reviews pair with the nearest exec of their own run; strays are dropped', () => {
  const all = groupExecWorkers(ROWS, runningFromSnapshot(null), null);
  const pairs = Object.fromEntries(all.groups.map((g) => [g.exec.id, g.reviews.map((r) => r.id)]));
  assert.deepEqual(pairs, {
    'exec-b': [],
    'exec-w1': ['fix-w1'],
    'exec-w0': ['review-w0'],
  });
  assert.deepEqual([all.workCount, all.reviewCount, all.fixCount], [3, 2, 1]);

  const runA = groupExecWorkers(ROWS, runningFromSnapshot(null), 'run-a');
  assert.deepEqual(runA.all.map((w) => w.id).sort(), ['exec-w0', 'exec-w1', 'fix-w1', 'review-w0']);
});

test('the runtime snapshot decides who is running, and running execs sort first', () => {
  // The rows all say idle; oompa says w0 is running. Without the snapshot w1
  // (newer activity) would lead.
  const live = runningFromSnapshot(
    snapshot({
      runId: 'run-a',
      swarmId: 'run-a',
      isRunning: true,
      totalWorkers: 2,
      activeWorkers: 1,
      doneWorkers: 0,
      configPath: null,
      logFile: null,
      workers: [
        { id: 'w0', status: 'running', lastEvent: '' },
        { id: 'w1', status: 'idle', lastEvent: '' },
      ],
      runCount: 2,
    })
  );
  const order = groupExecWorkers(ROWS, live, 'run-a').groups.map((g) => g.exec.id);
  assert.deepEqual(order, ['exec-w0', 'exec-w1']);
});

test('dashboard cards: runtime counts win, disk-only projects appear, running first', () => {
  const byProject = new Map([[ROOT, ROWS]]);
  const cards = buildProjectCards(byProject, {}, [
    {
      projectRoot: '/Users/nick/git/gemini-swarm',
      projectName: 'gemini-swarm',
      runtime: snapshot({
        runId: 'g1',
        swarmId: 'g1',
        isRunning: true,
        totalWorkers: 4,
        activeWorkers: 3,
        doneWorkers: 0,
        configPath: null,
        logFile: null,
        workers: [],
        runCount: 1,
      }),
    },
    // Also listed on disk: the row-backed card must not be replaced.
    { projectRoot: ROOT, projectName: 'dup', runtime: snapshot(null) },
  ]);
  assert.deepEqual(
    cards.map((c) => [c.projectName, c.runningCount, c.idleCount, c.sessionCount, c.runCount]),
    [
      ['gemini-swarm', 3, 1, 0, 1],
      // Distinct worker ids across both runs; three swarm ids seen in the rows.
      ['room-runners-arena-lib', 0, 5, 6, 3],
    ]
  );
  assert.equal(cards[1].latestActivity, T + 90 * MIN);
});
