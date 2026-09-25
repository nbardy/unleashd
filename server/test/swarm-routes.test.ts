import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { registerSwarmRoutes } from '../src/swarm';

// Regression guard (T10, 2026-09-26): `oompa-config`, `swarm-reviews`,
// `swarm-projects`, `swarm-signal` and `oompa-swarm-context` read the project
// with existsSync/readdirSync/readFileSync/writeFileSync on the event loop.
// Every sync fs call throws here, so re-adding one fails the route (500) or the
// assertion on its body. The routes are reached through the one swarm entry.
test('swarm routes never touch synchronous fs', async (context) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'unleashd-swarm-routes-'));
  context.after(() => rm(sandbox, { recursive: true, force: true }));
  const projectRoot = path.join(sandbox, 'project');
  const runDirectory = path.join(projectRoot, 'runs', 'run-1');
  const binDirectory = path.join(sandbox, 'bin');
  await mkdir(path.join(runDirectory, 'reviews'), { recursive: true });
  await mkdir(path.join(projectRoot, 'docs'));
  await mkdir(binDirectory);
  await writeFile(path.join(binDirectory, 'oompa'), '#!/bin/sh\necho "oompa $1"\n', {
    mode: 0o755,
  });
  await writeFile(path.join(projectRoot, 'oompa.json'), JSON.stringify({ workers: [{}] }));
  await writeFile(path.join(projectRoot, 'docs', 'SWARM_GUIDE.md'), '# guide');
  // A pid no live process has, so the signal route takes the stale-PID write path.
  await writeFile(
    path.join(runDirectory, 'started.json'),
    JSON.stringify({ 'swarm-id': 'swarm-1', pid: 2 ** 22 + 1, workers: [] })
  );
  await writeFile(
    path.join(runDirectory, 'reviews', 'w0.json'),
    JSON.stringify({ verdict: 'approved' })
  );
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDirectory}${path.delimiter}${originalPath}`;
  context.after(() => {
    process.env.PATH = originalPath;
  });

  const app = express();
  app.use(express.json());
  registerSwarmRoutes(app, {
    isUnderKnownProject: (candidate) => candidate.startsWith(projectRoot),
    listProjectRoots: () => [projectRoot],
    resolveWorkingDirectory: path.resolve,
    commandTimeoutMs: 5_000,
  });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const dir = encodeURIComponent(projectRoot);

  // body-parser lazy-loads its charset tables with readFileSync on the first
  // JSON body; load them before the trap is set.
  await fetch(`${base}/api/swarm-signal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  for (const name of ['readFileSync', 'readdirSync', 'statSync', 'existsSync', 'writeFileSync']) {
    context.mock.method(fs, name as 'readFileSync', () => {
      throw new Error(`fs.${name} on a swarm route`);
    });
  }

  const json = async <T = unknown>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${base}${url}`, init);
    assert.equal(response.status, 200, url);
    return (await response.json()) as T;
  };
  assert.deepEqual(await json(`/api/oompa-config?dir=${dir}`), { workers: [{}] });
  assert.deepEqual(await json(`/api/swarm-reviews?dir=${dir}&swarmId=run-1`), {
    reviews: [{ verdict: 'approved' }],
  });
  const { projects } = await json<{ projects: unknown[] }>('/api/swarm-projects');
  assert.equal(projects.length, 1);
  const { prefix } = await json<{ prefix: string }>(`/api/oompa-swarm-context?dir=${dir}`);
  assert.match(prefix, /workers=1/);
  assert.match(prefix, /# guide/);
  const signal = await json<{ ok: boolean }>('/api/swarm-signal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dir: projectRoot, signal: 'stop', swarmId: 'run-1' }),
  });
  assert.equal(signal.ok, true);
  context.mock.restoreAll();
  const stopped = JSON.parse(await readFile(path.join(runDirectory, 'stopped.json'), 'utf8'));
  assert.equal(stopped['swarm-id'], 'swarm-1');
});
