import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertPortsFree, claimDevRuntime } from './dev-supervisor.mjs';

function lockFile(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'dev-supervisor-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'dev-supervisor.lock.json');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function idleProcess(t, options = {}) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
    ...options,
  });
  t.after(() => {
    try {
      process.kill(child.pid, 'SIGKILL');
    } catch {}
  });
  return child;
}

test('a live dev runtime is refused, a dead one is reclaimed', async (t) => {
  const file = lockFile(t);
  const live = idleProcess(t);
  writeFileSync(file, JSON.stringify({ pid: live.pid, childPgid: null }));
  await assert.rejects(claimDevRuntime({ file }), new RegExp(`PID ${live.pid}`));

  live.kill('SIGKILL');
  await new Promise((resolve) => live.once('exit', resolve));
  const runtime = await claimDevRuntime({ file });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid);
  runtime.release();
  assert.equal(existsSync(file), false);
});

test('replacing a runtime also kills the child group it recorded', async (t) => {
  // An owner that dies without forwarding the signal must not leave its
  // children running: an orphaned backend keeps the port and serves stale code
  // (2026-09-23).
  const file = lockFile(t);
  const owner = idleProcess(t);
  const orphanCandidate = idleProcess(t, { detached: true });
  writeFileSync(file, JSON.stringify({ pid: owner.pid, childPgid: orphanCandidate.pid }));

  const runtime = await claimDevRuntime({ file, replace: true });
  t.after(runtime.release);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(isAlive(owner.pid), false);
  assert.equal(isAlive(orphanCandidate.pid), false);
});

test('a dev port held outside the runtime is refused with its PID', async (t) => {
  const holder = net.createServer();
  await new Promise((resolve) => holder.listen(0, '127.0.0.1', resolve));
  t.after(() => holder.close());
  const { port } = holder.address();
  await assert.rejects(
    assertPortsFree([port]),
    new RegExp(`port ${port} \\(PID ${process.pid}\\)`)
  );
});
