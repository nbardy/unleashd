/**
 * The swarm observer against real `runs/` directories on disk.
 *
 * What would re-break: a per-conversation poller (N running turns in one repo
 * = N scans per tick), synchronous fs on the observer path (it runs every 2 s
 * on the event loop), or losing the "swarm launched during this turn" sub-agent
 * row the chat UI shows.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { OompaRuntimeSnapshot, ServerMessage, SubAgent } from '@unleashd/shared';
import { SwarmObservers, watchSwarmRuns } from '../src/swarm/observer';
import { readLatestSwarmRuntime } from '../src/swarm/runtime';

async function writeRun(projectRoot: string, runId: string, workerStatus: 'running' | 'stopped') {
  const runDirectory = path.join(projectRoot, 'runs', runId);
  await mkdir(path.join(runDirectory, 'workers'), { recursive: true });
  await writeFile(
    path.join(runDirectory, 'started.json'),
    JSON.stringify({
      'swarm-id': `swarm-${runId}`,
      'started-at': new Date().toISOString(),
      pid: process.pid,
      workers: [{ id: 'w0' }],
    })
  );
  await writeFile(
    path.join(runDirectory, 'workers', 'w0.json'),
    JSON.stringify(
      workerStatus === 'running'
        ? { status: 'running', cycle: 1 }
        : { status: 'stopped', reason: 'done' }
    )
  );
}

async function until(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail(`timed out waiting for ${label}`);
}

test('turns in one folder share one swarm poller', async (context) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-observer-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  const reads: string[] = [];
  const observers = new SwarmObservers(
    async (folder) => {
      reads.push(folder);
      return readLatestSwarmRuntime(folder);
    },
    { intervalMs: 50, throttleMs: 40 }
  );
  const seen: OompaRuntimeSnapshot[][] = [[], [], []];
  const stops = seen.map((snapshots) =>
    observers.watch(projectRoot, (snapshot) => snapshots.push(snapshot))
  );
  await delay(260);
  for (const stop of stops) stop();
  const readsWhileWatched = reads.length;
  await delay(120);

  // ~5 interval ticks plus one baseline read per watcher that can coalesce.
  // Three per-conversation pollers would read at least 15 times.
  assert.ok(readsWhileWatched >= 2 && readsWhileWatched <= 9, `reads: ${readsWhileWatched}`);
  assert.equal(reads.length, readsWhileWatched, 'the poller stops with its last watcher');
  for (const snapshots of seen) assert.ok(snapshots.length >= 2);
});

test('a swarm launched during a turn becomes a sub-agent row that completes when it stops', async (context) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-launch-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeRun(projectRoot, 'run-before', 'stopped');
  const agents: SubAgent[] = [];
  const broadcasts: ServerMessage[] = [];
  const observers = new SwarmObservers((folder) => readLatestSwarmRuntime(folder), {
    intervalMs: 30,
    throttleMs: 20,
  });
  const stop = watchSwarmRuns(observers, projectRoot, {
    conversationId: 'conversation',
    agents,
    broadcast: (message) => broadcasts.push(message),
    newId: () => 'unused',
  });
  context.after(stop);
  await delay(60);
  assert.equal(agents.length, 0, 'a run that predates the turn is its baseline, not a launch');

  // Newer mtime than run-before, so it is the latest run.
  await delay(20);
  await writeRun(projectRoot, 'run-launched', 'running');
  await until(() => agents.length === 1, 'swarm row');
  assert.equal(agents[0].id, 'swarm-run-launched');
  assert.equal(agents[0].status, 'running');
  assert.equal(agents[0].description, 'Swarm Run: swarm-run-launched (1 workers)');

  await writeFile(
    path.join(projectRoot, 'runs', 'run-launched', 'stopped.json'),
    JSON.stringify({ reason: 'done' })
  );
  await until(() => agents[0].status === 'completed', 'swarm row completion');
  assert.deepEqual(
    broadcasts.map((message) => message.type),
    ['subagent_start', 'subagent_complete']
  );
});

test('a swarm runtime read never touches synchronous fs', async (context) => {
  // The observer runs this on the event loop every 2 s while a turn runs.
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-async-'));
  context.after(() => rm(projectRoot, { recursive: true, force: true }));
  await writeRun(projectRoot, 'run-1', 'running');
  const syncCalls = ['readFileSync', 'readdirSync', 'statSync', 'existsSync'] as const;
  for (const name of syncCalls) {
    context.mock.method(fs, name, () => {
      throw new Error(`fs.${name} on the swarm observer path`);
    });
  }
  const snapshot = await readLatestSwarmRuntime(projectRoot);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.run?.runId, 'run-1');
  assert.equal(snapshot.run?.isRunning, true);
});
