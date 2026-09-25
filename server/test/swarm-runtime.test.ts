import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readLatestSwarmRuntime } from '../src/swarm/runtime';

test('runtime derives live worker state through injected process liveness', async (context) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-runtime-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const runDirectory = path.join(projectRoot, 'runs', 'run-1');
  await mkdir(path.join(runDirectory, 'cycles'), { recursive: true });
  await writeFile(
    path.join(runDirectory, 'started.json'),
    JSON.stringify({
      'swarm-id': 'swarm-1',
      'started-at': '2026-01-01T00:00:00.000Z',
      'config-file': '/tmp/oompa.json',
      pid: 123,
      workers: [
        { id: 'worker-a', harness: 'codex', model: 'gpt-5.6-sol', iterations: 2 },
        { id: 'worker-b', harness: 'claude', model: 'opus', iterations: 2 },
      ],
    })
  );
  await writeFile(
    path.join(runDirectory, 'cycles', 'worker-a-1.json'),
    JSON.stringify({
      'worker-id': 'worker-a',
      cycle: 1,
      outcome: 'merged',
      timestamp: '2026-01-01T00:01:00.000Z',
    })
  );

  const snapshot = await readLatestSwarmRuntime(projectRoot, {
    isProcessAlive: (pid) => pid === 123,
    now: () => Date.parse('2026-01-01T00:02:00.000Z'),
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.run?.swarmId, 'swarm-1');
  assert.equal(snapshot.run?.isRunning, true);
  assert.equal(snapshot.run?.activeWorkers, 2);
  assert.deepEqual(
    snapshot.run?.workers.map((worker) => [worker.id, worker.status]),
    [
      ['worker-a', 'running'],
      ['worker-b', 'running'],
    ]
  );
});

test('stopped event is authoritative over a still-live pid', async (context) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-stopped-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const runDirectory = path.join(projectRoot, 'runs', 'run-2');
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    path.join(runDirectory, 'started.json'),
    JSON.stringify({
      'swarm-id': 'swarm-2',
      'started-at': '2026-01-01T00:00:00.000Z',
      pid: 456,
      workers: [{ id: 'worker-a', harness: 'codex', model: 'gpt-5.6-sol', iterations: 1 }],
    })
  );
  await writeFile(
    path.join(runDirectory, 'stopped.json'),
    JSON.stringify({
      'swarm-id': 'swarm-2',
      'stopped-at': '2026-01-01T00:03:00.000Z',
      reason: 'completed',
    })
  );

  const snapshot = await readLatestSwarmRuntime(projectRoot, {
    isProcessAlive: () => true,
    now: () => Date.parse('2026-01-01T00:04:00.000Z'),
  });

  assert.equal(snapshot.run?.isRunning, false);
  assert.equal(snapshot.run?.doneWorkers, 1);
  assert.equal(snapshot.run?.workers[0]?.status, 'done');
});

// Regression: run a98d3b2e (2026-08-07) — all three workers rendered dead/red and
// the card said "All idle" while every worker was alive and mid-cycle-2. Cause:
// status was derived from the latest cycle FILE (written only at cycle end), so a
// worker whose cycle 1 errored looked terminal for its entire cycle 2. The
// workers/<id>.json state file (written by oompa at cycle start / terminal exit)
// is the liveness authority; a live-run 'stopped' state must still win over it.
test('a finished error cycle does not mark a live mid-cycle worker dead', async (context) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-livecycle-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const runDirectory = path.join(projectRoot, 'runs', 'run-3');
  await mkdir(path.join(runDirectory, 'cycles'), { recursive: true });
  await mkdir(path.join(runDirectory, 'workers'), { recursive: true });
  await writeFile(
    path.join(runDirectory, 'started.json'),
    JSON.stringify({
      'swarm-id': 'swarm-3',
      'started-at': '2026-01-01T00:00:00.000Z',
      pid: 123,
      workers: [
        { id: 'worker-a', harness: 'muse', model: 'muse-spark' },
        { id: 'worker-b', harness: 'muse', model: 'muse-spark' },
      ],
    })
  );
  // Both workers' cycle 1 ended in error...
  for (const id of ['worker-a', 'worker-b']) {
    await writeFile(
      path.join(runDirectory, 'cycles', `${id}-c1.json`),
      JSON.stringify({ 'worker-id': id, cycle: 1, outcome: 'error' })
    );
  }
  // ...but worker-a is alive in cycle 2, while worker-b exhausted its retries.
  await writeFile(
    path.join(runDirectory, 'workers', 'worker-a.json'),
    JSON.stringify({ 'worker-id': 'worker-a', status: 'running', cycle: 2, attempt: 1 })
  );
  await writeFile(
    path.join(runDirectory, 'workers', 'worker-b.json'),
    JSON.stringify({ 'worker-id': 'worker-b', status: 'stopped', reason: 'error', cycle: 1 })
  );

  const snapshot = await readLatestSwarmRuntime(projectRoot, {
    isProcessAlive: (pid) => pid === 123,
    now: () => Date.parse('2026-01-01T00:10:00.000Z'),
  });

  assert.deepEqual(
    snapshot.run?.workers.map((worker) => [worker.id, worker.status]),
    [
      ['worker-a', 'running'],
      ['worker-b', 'error'],
    ]
  );
  assert.equal(snapshot.run?.isRunning, true);
  assert.equal(snapshot.run?.activeWorkers, 1);
});

test('legacy run without worker state files: live run renders finished-cycle workers as running', async (context) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-legacy-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const runDirectory = path.join(projectRoot, 'runs', 'run-4');
  await mkdir(path.join(runDirectory, 'cycles'), { recursive: true });
  await writeFile(
    path.join(runDirectory, 'started.json'),
    JSON.stringify({
      'swarm-id': 'swarm-4',
      'started-at': '2026-01-01T00:00:00.000Z',
      pid: 123,
      workers: [{ id: 'worker-a', harness: 'muse', model: 'muse-spark' }],
    })
  );
  await writeFile(
    path.join(runDirectory, 'cycles', 'worker-a-c1.json'),
    JSON.stringify({ 'worker-id': 'worker-a', cycle: 1, outcome: 'error' })
  );

  const live = await readLatestSwarmRuntime(projectRoot, {
    isProcessAlive: (pid) => pid === 123,
    now: () => Date.parse('2026-01-01T00:10:00.000Z'),
  });
  assert.deepEqual(
    live.run?.workers.map((worker) => [worker.id, worker.status]),
    [['worker-a', 'running']]
  );

  // Once the swarm process is gone, the terminal outcome is honest again.
  const dead = await readLatestSwarmRuntime(projectRoot, {
    isProcessAlive: () => false,
    now: () => Date.parse('2026-01-01T00:10:00.000Z'),
  });
  assert.deepEqual(
    dead.run?.workers.map((worker) => [worker.id, worker.status]),
    [['worker-a', 'error']]
  );
});
