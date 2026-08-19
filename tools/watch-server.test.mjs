import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createWatchServer, snapshotsMatch } from './watch-server.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.stderr = new EventEmitter();
    this.killedSignal = null;
    this.sent = [];
  }
  kill(signal) {
    this.killedSignal = signal;
  }
  send(msg, cb) {
    this.sent.push(msg);
    if (cb) cb(null);
  }
}

function createClock(initial = 1000) {
  let now = initial;
  let id = 1;
  const timeouts = new Map();
  const intervals = new Map();
  function setTimeoutFn(cb, delay) {
    const tid = id++;
    timeouts.set(tid, { cb, due: now + delay, delay });
    return tid;
  }
  function clearTimeoutFn(tid) {
    timeouts.delete(tid);
  }
  function setIntervalFn(cb, delay) {
    const iid = id++;
    intervals.set(iid, { cb, delay, next: now + delay });
    return iid;
  }
  function clearIntervalFn(tid) {
    timeouts.delete(tid);
    intervals.delete(tid);
  }
  async function tick(ms) {
    now += ms;
    const dueTimeouts = [...timeouts.entries()].filter(([, v]) => v.due <= now);
    dueTimeouts.sort((a, b) => a[1].due - b[1].due);
    for (const [tid, entry] of dueTimeouts) {
      timeouts.delete(tid);
      await entry.cb();
    }
    for (const [iid, entry] of intervals) {
      while (entry.next <= now) {
        await entry.cb();
        entry.next += entry.delay;
      }
    }
    await new Promise((r) => setImmediate(r));
    // flush any void async tasks that were spawned inside callbacks (e.g. startServer)
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    set: (v) => { now = v; },
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    setInterval: setIntervalFn,
    clearInterval: clearIntervalFn,
    tick,
    getTimeouts: () => timeouts,
    getIntervals: () => intervals,
  };
}

function createFakeProcess() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    exitCode: undefined,
    env: {},
    execPath: process.execPath,
    stderr: { write: () => {} },
  });
}

function collectLogs() {
  const logs = [];
  const errors = [];
  return {
    logs,
    errors,
    log: (...args) => logs.push(args.join(' ')),
    error: (...args) => errors.push(args.join(' ')),
  };
}

const okPreflight = async () => ({ ok: true, errors: [] });

// ---------------------------------------------------------------------------
// 1) Transform failed typo stays up and recovers on fix
// ---------------------------------------------------------------------------

test('Transform failed typo stays up and recovers on fix', async (t) => {
  const clock = createClock(0);
  const logger = collectLogs();
  const fakeProc = createFakeProcess();
  let spawnCount = 0;
  const children = [];
  const spawn = () => {
    const c = new FakeChild();
    spawnCount += 1;
    children.push(c);
    return c;
  };
  let snapshotVersion = 0;
  const snapshotDirectory = async (root, snapshot) => {
    snapshot.set(`/fake/server/src/file-${snapshotVersion}.ts`, { digest: `v${snapshotVersion}`, metadataKey: `${snapshotVersion}` });
  };
  const missingRuntimeArtifacts = async () => [];

  const server = createWatchServer({
    spawn,
    snapshotDirectory,
    missingRuntimeArtifacts,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    backendDownRetryDelayMs: 10,
    backendDownReminderIntervalMs: 30,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server.destroy());

  await server.startServer();
  assert.equal(spawnCount, 1);
  const child1 = children[0];
  assert.equal(server.getState().stopping, false);

  child1.stderr.emit('data', Buffer.from('Transform failed: jsonl.ts:13:42 Expected ";" but found "is"\n'));
  clock.advance(100);
  child1.exitCode = 1;
  child1.emit('close', 1, null);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const s1 = server.getState();
  assert.equal(s1.stopping, false, 'Transform failure should not set stopping');
  assert.equal(fakeProc.exitCode, undefined);
  assert.equal(s1.child, null);
  assert.notEqual(s1.backendDownRetryTimer, null, 'should schedule retry');
  assert.notEqual(s1.backendDownReminderTimer, null, 'should schedule reminder');
  assert.equal(s1.backendDownRetryCount, 1);
  assert.match(logger.errors.join('\n'), /Backend failed to start.*Transform failure/);

  snapshotVersion = 1;
  await clock.tick(10);
  // need extra flush for void startServer
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(spawnCount, 2, 'retry should have spawned again');
  const s2 = server.getState();
  assert.equal(s2.backendDownRetryCount, 0, 'successful spawn resets retry count');
  assert.equal(s2.backendDownReminderTimer, null);
  assert.equal(s2.backendDownRetryTimer, null);
  assert.equal(s2.failWatcherConsecutive, 0);

  const child2 = children[1];
  child2.exitCode = 0;
  assert.equal(server.getState().stopping, false);
  assert.equal(fakeProc.exitCode, undefined);
});

// ---------------------------------------------------------------------------
// 2) EADDRINUSE quick crash retries 3x then fatal with DOWN reminder
// ---------------------------------------------------------------------------

test('EADDRINUSE quick crash retries 3x then fatal with DOWN reminder', async (t) => {
  const clock = createClock(0);
  const logger = collectLogs();
  const fakeProc = createFakeProcess();
  const children = [];
  const spawn = () => {
    const c = new FakeChild();
    children.push(c);
    return c;
  };
  const snapshotDirectory = async () => {};
  const missingRuntimeArtifacts = async () => [];

  const server = createWatchServer({
    spawn,
    snapshotDirectory,
    missingRuntimeArtifacts,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    backendDownRetryDelayMs: 10,
    backendDownReminderIntervalMs: 30,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server.destroy());

  async function quickCrash(child, code = 1) {
    child.stderr.emit('data', Buffer.from(`Error: listen EADDRINUSE: address already in use 0.0.0.0:7499\n`));
    clock.advance(50);
    child.exitCode = code;
    child.emit('close', code, null);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }

  await server.startServer();
  assert.equal(children.length, 1);
  await quickCrash(children[0]);
  let s = server.getState();
  assert.equal(s.stopping, false, 'first quick crash should not be fatal');
  assert.equal(s.backendDownRetryCount, 1);
  assert.notEqual(s.backendDownRetryTimer, null);
  assert.notEqual(s.backendDownReminderTimer, null);
  assert.match(logger.errors.join('\n'), /quick exit after/);

  await clock.tick(10);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(children.length, 2, 'first retry should spawn');
  s = server.getState();
  await quickCrash(children[1]);
  s = server.getState();
  assert.equal(s.backendDownRetryCount, 2);
  assert.equal(s.stopping, false);

  console.log('DEBUG second before tick', { now: clock.now(), children: children.length, state: s });
  await clock.tick(10);
  console.log('DEBUG second after tick', { now: clock.now(), children: children.length, state: server.getState() });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  console.log('DEBUG second after flush', { children: children.length });
  assert.equal(children.length, 3, 'second retry should spawn');
  await quickCrash(children[2]);
  s = server.getState();
  assert.equal(s.backendDownRetryCount, 3);
  assert.equal(s.stopping, false);

  console.log('DEBUG third before tick', { now: clock.now(), children: children.length });
  await clock.tick(10);
  console.log('DEBUG third after tick', { now: clock.now(), children: children.length, state: server.getState() });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  console.log('DEBUG third after flush', { children: children.length });
  assert.equal(children.length, 4, 'third retry should spawn');
  await quickCrash(children[3]);
  s = server.getState();
  assert.equal(s.stopping, true, 'fourth quick crash should escalate to fatal');
  assert.equal(fakeProc.exitCode, 1);
  assert.equal(s.backendDownRetryTimer, null);
  assert.equal(s.backendDownReminderTimer, null);
  assert.match(logger.errors.join('\n'), /escalating to fatal/);

  // reminder fires
  const logger2 = collectLogs();
  const fakeProc2 = createFakeProcess();
  const children2 = [];
  const clock2 = createClock(0);
  const server2 = createWatchServer({
    spawn: () => { const c = new FakeChild(); children2.push(c); return c; },
    snapshotDirectory,
    missingRuntimeArtifacts,
    now: clock2.now,
    setTimeout: clock2.setTimeout,
    clearTimeout: clock2.clearTimeout,
    setInterval: clock2.setInterval,
    clearInterval: clock2.clearInterval,
    process: fakeProc2,
    consoleLog: logger2.log,
    consoleError: logger2.error,
    backendDownRetryDelayMs: 10,
    backendDownReminderIntervalMs: 30,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server2.destroy());
  await server2.startServer();
  children2[0].stderr.emit('data', Buffer.from('EADDRINUSE\n'));
  clock2.advance(50);
  children2[0].exitCode = 1;
  children2[0].emit('close', 1, null);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  await clock2.tick(30);
  assert.match(logger2.errors.join('\n'), /Backend is DOWN/);
});

// ---------------------------------------------------------------------------
// 3) close vs exit race (stderr buffer complete)
// ---------------------------------------------------------------------------

test('close vs exit race: uses close event and stderr buffer is complete', async (t) => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./watch-server.mjs', import.meta.url), 'utf8');
  assert.match(src, /child\.once\('close'/, 'should use close event');
  assert.doesNotMatch(src, /child\.once\('exit'/, 'should not use exit event for decision');

  const clock = createClock(0);
  const logger = collectLogs();
  const fakeProc = createFakeProcess();
  const children = [];
  const server = createWatchServer({
    spawn: () => { const c = new FakeChild(); children.push(c); return c; },
    snapshotDirectory: async () => {},
    missingRuntimeArtifacts: async () => [],
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    backendDownRetryDelayMs: 10,
    backendDownReminderIntervalMs: 30,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server.destroy());
  await server.startServer();
  const child = children[0];
  child.stderr.emit('data', Buffer.from('Transform failed'));
  clock.advance(10);
  child.exitCode = 1;
  child.emit('close', 1, null);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const s = server.getState();
  assert.equal(s.stopping, false);
  assert.equal(s.lastStderr, 'Transform failed');

  // large ring truncation still detects Transform
  const children2 = [];
  const server2 = createWatchServer({
    spawn: () => { const c = new FakeChild(); children2.push(c); return c; },
    snapshotDirectory: async () => {},
    missingRuntimeArtifacts: async () => [],
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server2.destroy());
  await server2.startServer();
  const child2 = children2[0];
  const bigChunk = 'a'.repeat(40000) + 'Transform failed';
  child2.stderr.emit('data', Buffer.from(bigChunk));
  clock.advance(10);
  child2.exitCode = 1;
  child2.emit('close', 1, null);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const s2 = server2.getState();
  assert.equal(s2.lastStderr.length, 32768);
  assert.match(s2.lastStderr, /Transform failed/);
});

// ---------------------------------------------------------------------------
// 4) poll respects failWatcher backoff
// ---------------------------------------------------------------------------

test('poll respects failWatcher backoff', async (t) => {
  const clock = createClock(0);
  const logger = collectLogs();
  const fakeProc = createFakeProcess();
  let snapshotCalls = 0;
  const snapshotDirectory = async () => { snapshotCalls += 1; };
  const missingRuntimeArtifacts = async () => [];
  const server = createWatchServer({
    spawn: () => new FakeChild(),
    snapshotDirectory,
    missingRuntimeArtifacts,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server.destroy());

  server.failWatcher(new Error('EACCES'));
  let s = server.getState();
  assert.equal(s.failWatcherConsecutive, 1);
  assert.notEqual(s.reloadTimer, null);
  assert.match(logger.errors.join('\n'), /Transient watcher error.*attempt 1\/20.*retry in 300ms/);

  snapshotCalls = 0;
  await server.poll();
  assert.equal(snapshotCalls, 0, 'poll should respect backoff and not call snapshot');

  server.failWatcher(new Error('EACCES again'));
  s = server.getState();
  assert.equal(s.failWatcherConsecutive, 2);
  assert.match(logger.errors.join('\n'), /attempt 2\/20.*retry in 600ms/);

  // successful poll resets after backoff elapses
  let callCount = 0;
  const snapshotDirectory2 = async (root, snap) => {
    callCount += 1;
    snap.set('/fake/a.js', { digest: 'same', metadataKey: '1' });
  };
  const server2 = createWatchServer({
    spawn: () => new FakeChild(),
    snapshotDirectory: snapshotDirectory2,
    missingRuntimeArtifacts,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server2.destroy());
  server2.setSnapshot(new Map([['/fake/a.js', { digest: 'same', metadataKey: '1' }]]));
  server2.failWatcher(new Error('transient'));
  assert.equal(server2.getState().failWatcherConsecutive, 1);
  callCount = 0;
  await server2.poll();
  assert.equal(callCount, 0, 'poll with pending backoff should not call snapshot');
  // advance past backoff (300ms) to clear reloadTimer via tick (queueReload sets reloadTimer=null)
  await clock.tick(300);
  // queueReload will have run, but it may have scheduled another reload if missing artifacts etc; ensure reloadTimer cleared or not pending with consecutive>0
  // Now poll should run and reset
  // For deterministic, create a fresh server without backoff pending
  const server3 = createWatchServer({
    spawn: () => new FakeChild(),
    snapshotDirectory: snapshotDirectory2,
    missingRuntimeArtifacts,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server3.destroy());
  server3.setSnapshot(new Map([['/fake/a.js', { digest: 'same', metadataKey: '1' }]]));
  server3.failWatcher(new Error('x'));
  server3.failWatcher(new Error('x'));
  assert.equal(server3.getState().failWatcherConsecutive, 2);
  // let backoff timers fire
  await clock.tick(700);
  // after ticks, reloadTimer should be null (queueReload cleared it), so poll can proceed
  // force reloadTimer null if still pending due to queueReload scheduling another timer
  const st = server3.getState();
  if (st.reloadTimer) {
    clock.clearTimeout(st.reloadTimer);
    // need to also clear server's internal variable: we can't directly, so destroy and recreate is easier
    // Instead just test that a matching snapshot poll resets consecutive when no backoff pending
    // So create server with no pending timer and matching snapshot
  }
  const server4 = createWatchServer({
    spawn: () => new FakeChild(),
    snapshotDirectory: snapshotDirectory2,
    missingRuntimeArtifacts,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server4.destroy());
  server4.setSnapshot(new Map([['/fake/a.js', { digest: 'same', metadataKey: '1' }]]));
  // set consecutive manually via failWatcher then clear timer by ticking
  server4.failWatcher(new Error('x'));
  assert.equal(server4.getState().failWatcherConsecutive, 1);
  await clock.tick(400);
  // now poll with matching snapshot should reset
  await server4.poll();
  assert.equal(server4.getState().failWatcherConsecutive, 0, 'successful poll resets backoff');

  // Escalation after 20
  const logger3 = collectLogs();
  const clock3 = createClock(0);
  const fakeProc3 = createFakeProcess();
  const server5 = createWatchServer({
    spawn: () => { const c = new FakeChild(); c.exitCode = null; return c; },
    snapshotDirectory: async () => {},
    missingRuntimeArtifacts: async () => [],
    now: clock3.now,
    setTimeout: clock3.setTimeout,
    clearTimeout: clock3.clearTimeout,
    setInterval: clock3.setInterval,
    clearInterval: clock3.clearInterval,
    process: fakeProc3,
    consoleLog: logger3.log,
    consoleError: logger3.error,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server5.destroy());
  await server5.start();
  const pollTimerBefore = server5.getState().pollTimer;
  assert.notEqual(pollTimerBefore, null);
  for (let i = 0; i < 19; i++) server5.failWatcher(new Error(`err ${i}`));
  assert.equal(server5.getState().failWatcherConsecutive, 19);
  assert.equal(server5.getState().stopping, false);
  server5.failWatcher(new Error('20th'));
  assert.equal(server5.getState().stopping, true);
  assert.equal(server5.getState().fatalError, true);
  assert.equal(server5.getState().pollTimer, null);
});

// ---------------------------------------------------------------------------
// 5) kill -9 and Ctrl-C paths
// ---------------------------------------------------------------------------

test('kill -9 and Ctrl-C paths', async (t) => {
  const clock = createClock(0);
  const logger = collectLogs();

  // kill -9
  {
    const fakeProc = createFakeProcess();
    const children = [];
    const server = createWatchServer({
      spawn: () => { const c = new FakeChild(); children.push(c); return c; },
      snapshotDirectory: async () => {},
      missingRuntimeArtifacts: async () => [],
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      process: fakeProc,
      consoleLog: logger.log,
      consoleError: logger.error,
      preflightTransformCheck: okPreflight,
    });
    t.after(() => server.destroy());
    await server.startServer();
    const child = children[0];
    child.stderr.emit('data', Buffer.from('something'));
    clock.advance(100);
    child.exitCode = null;
    child.emit('close', null, 'SIGKILL');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const s = server.getState();
    // Revised 2026-08-20 (was: 'SIGKILL should be fatal'). A targeted kill of the
    // backend must NOT take down the dev runtime — the watcher's job is to keep a
    // backend running, and `stopping = true` here propagates exitCode 1 into
    // `concurrently --kill-others-on-fail`, which SIGTERMs shared/cli/client too.
    assert.equal(s.stopping, false, 'an external kill must not stop the dev runtime');
    assert.equal(fakeProc.exitCode, undefined, 'no fatal exit code for an external kill');
    assert.equal(children.length, 2, 'backend should be restarted after an external kill');
    assert.match(logger.errors.join('\n'), /Backend exited \(signal SIGKILL\).*restarting/);
  }

  // Ctrl-C while child running
  {
    const fakeProc = createFakeProcess();
    const logger2 = collectLogs();
    const children = [];
    const server = createWatchServer({
      spawn: () => { const c = new FakeChild(); children.push(c); return c; },
      snapshotDirectory: async () => {},
      missingRuntimeArtifacts: async () => [],
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      process: fakeProc,
      consoleLog: logger2.log,
      consoleError: logger2.error,
      backendDownRetryDelayMs: 10,
      backendDownReminderIntervalMs: 30,
      preflightTransformCheck: okPreflight,
    });
    t.after(() => server.destroy());
    await server.startServer();
    const child = children[0];
    assert.equal(child.killedSignal, null);
    server.stop('SIGINT');
    assert.equal(server.getState().stopping, true);
    assert.equal(child.killedSignal, 'SIGINT');
    child.exitCode = null;
    child.emit('close', null, 'SIGINT');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.equal(fakeProc.exitCode, 1);
  }

  // Ctrl-C while DOWN
  {
    const fakeProc = createFakeProcess();
    const clock2 = createClock(0);
    const logger3 = collectLogs();
    const children = [];
    const server = createWatchServer({
      spawn: () => { const c = new FakeChild(); children.push(c); return c; },
      snapshotDirectory: async () => {},
      missingRuntimeArtifacts: async () => [],
      now: clock2.now,
      setTimeout: clock2.setTimeout,
      clearTimeout: clock2.clearTimeout,
      setInterval: clock2.setInterval,
      clearInterval: clock2.clearInterval,
      process: fakeProc,
      consoleLog: logger3.log,
      consoleError: logger3.error,
      backendDownRetryDelayMs: 100,
      backendDownReminderIntervalMs: 100,
      preflightTransformCheck: okPreflight,
    });
    t.after(() => server.destroy());
    await server.start();
    const firstChild = children[0];
    firstChild.stderr.emit('data', Buffer.from('Transform failed'));
    clock2.advance(50);
    firstChild.exitCode = 1;
    firstChild.emit('close', 1, null);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const sDown = server.getState();
    assert.equal(sDown.child, null);
    assert.notEqual(sDown.backendDownRetryTimer, null);
    assert.notEqual(sDown.backendDownReminderTimer, null);
    assert.notEqual(sDown.pollTimer, null);
    fakeProc.exitCode = undefined;
    server.stop('SIGINT');
    const sAfter = server.getState();
    assert.equal(sAfter.stopping, true);
    assert.equal(sAfter.backendDownRetryTimer, null);
    assert.equal(sAfter.backendDownReminderTimer, null);
    assert.equal(sAfter.pollTimer, null);
    assert.equal(fakeProc.exitCode, 0);
  }

  // stop idempotence
  {
    const fakeProc = createFakeProcess();
    const server = createWatchServer({
      spawn: () => new FakeChild(),
      snapshotDirectory: async () => {},
      missingRuntimeArtifacts: async () => [],
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      process: fakeProc,
      consoleLog: logger.log,
      consoleError: logger.error,
      preflightTransformCheck: okPreflight,
    });
    t.after(() => server.destroy());
    server.stop('SIGINT');
    assert.equal(server.getState().stopping, true);
    server.stop('SIGINT');
    assert.equal(server.getState().stopping, true);
  }
});

test('snapshotsMatch helper', () => {
  const a = new Map([['/x', { digest: '1', metadataKey: '1' }]]);
  const b = new Map([['/x', { digest: '1', metadataKey: '1' }]]);
  const c = new Map([['/x', { digest: '2', metadataKey: '2' }]]);
  assert.equal(snapshotsMatch(a, b), true);
  assert.equal(snapshotsMatch(a, c), false);
  assert.equal(snapshotsMatch(a, new Map()), false);
});

// ---------------------------------------------------------------------------
// 7) Regression: incident 2026-08-20 — a manual `kill` killed the dev runtime
//
// The backend wedged in its reload drain, the developer ran `kill <backend-pid>`
// to recover, the backend shut down gracefully (exit 0, no signal), and this
// watcher logged "Backend exited unexpectedly with code 0; stopping dev runtime"
// and set exitCode 1. `concurrently --kill-others-on-fail` then SIGTERMed
// shared-esm, shared-cjs, cli and client, so recovering the backend cost the
// whole dev runtime and required `pnpm dev:replace`.
// ---------------------------------------------------------------------------

test('a healthy backend exiting 0 without a reload request is restarted, not fatal', async (t) => {
  const clock = createClock(0);
  const logger = collectLogs();
  const fakeProc = createFakeProcess();
  const children = [];
  const server = createWatchServer({
    spawn: () => { const c = new FakeChild(); children.push(c); return c; },
    snapshotDirectory: async () => {},
    missingRuntimeArtifacts: async () => [],
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server.destroy());

  await server.startServer();
  assert.equal(children.length, 1);

  // Backend served for two minutes, then a targeted SIGTERM made it drain and
  // exit(0) cleanly. reloadPending is false: the watcher never asked for this.
  clock.advance(120_000);
  children[0].exitCode = 0;
  children[0].emit('close', 0, null);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const state = server.getState();
  assert.equal(state.stopping, false, 'a clean exit must not stop the dev runtime');
  assert.equal(fakeProc.exitCode, undefined, 'must not set a fatal exit code');
  assert.equal(children.length, 2, 'replacement backend should have been spawned');
  assert.equal(state.unexpectedExitStreak, 1);
});

test('a backend that never stays up escalates instead of restarting forever', async (t) => {
  const clock = createClock(0);
  const logger = collectLogs();
  const fakeProc = createFakeProcess();
  const children = [];
  const server = createWatchServer({
    spawn: () => { const c = new FakeChild(); children.push(c); return c; },
    snapshotDirectory: async () => {},
    missingRuntimeArtifacts: async () => [],
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    process: fakeProc,
    consoleLog: logger.log,
    consoleError: logger.error,
    healthyUptimeMs: 30_000,
    preflightTransformCheck: okPreflight,
  });
  t.after(() => server.destroy());

  await server.startServer();
  // Each life is longer than QUICK_EXIT_MS (so it is not a build failure) but
  // shorter than healthyUptimeMs (so it never earns a fresh budget).
  for (let attempt = 0; attempt < 4; attempt += 1) {
    clock.advance(5_000);
    const child = children[children.length - 1];
    child.exitCode = 0;
    child.emit('close', 0, null);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  }

  assert.equal(server.getState().stopping, true, 'restart loop must be bounded');
  assert.equal(fakeProc.exitCode, 1);
  assert.match(logger.errors.join('\n'), /escalating to fatal/);
});
