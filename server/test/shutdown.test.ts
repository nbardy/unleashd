import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Message } from '@unleashd/shared';
import {
  type ShutdownConversation,
  type ShutdownOptions,
  type ShutdownPorts,
  createShutdownController,
} from '../src/lifecycle/shutdown';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

// Graces long enough that only the one under test can fire.
const INERT: ShutdownOptions = {
  forceExitGraceMs: 60_000,
  reloadDrainGraceMs: 60_000,
  flushGraceMs: 60_000,
};

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createFixture(activeInitially: boolean) {
  let active = activeInitially;
  let activeSchedulerRuns = 0;
  let schedulerPauses = 0;
  let schedulerStops = 0;
  let flushes = 0;
  let exits = 0;
  let processStops = 0;
  const pendingFlush = deferred();
  const messages: Message[] = [];
  const conversation: ShutdownConversation = {
    id: 'conversation-1',
    messages,
    process: null,
    hasActiveProcess: () => active,
    stop: () => {
      processStops += 1;
      active = false;
    },
  };
  const ports: ShutdownPorts = {
    conversations: () => [conversation],
    activeSchedulerRuns: () => activeSchedulerRuns,
    pauseScheduler: () => {
      schedulerPauses += 1;
    },
    stopScheduler: () => {
      schedulerStops += 1;
    },
    flushState: () => {
      flushes += 1;
      return pendingFlush.promise;
    },
    broadcastMessage: () => undefined,
    exit: () => {
      exits += 1;
    },
  };
  return {
    conversation,
    pendingFlush,
    ports,
    setActive: (value: boolean) => {
      active = value;
    },
    setActiveSchedulerRuns: (value: number) => {
      activeSchedulerRuns = value;
    },
    counts: () => ({ schedulerPauses, schedulerStops, flushes, exits, processStops }),
  };
}

test('SIGTERM claims shutdown before its single flush can be re-entered', async () => {
  const fixture = createFixture(false);
  const controller = createShutdownController(INERT, fixture.ports);

  controller.handleSigterm();
  controller.handleSigterm();

  assert.equal(controller.state, 'exiting');
  assert.deepEqual(fixture.counts(), {
    schedulerPauses: 0,
    schedulerStops: 1,
    flushes: 1,
    exits: 0,
    processStops: 0,
  });

  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  await Promise.resolve();
  assert.equal(fixture.counts().exits, 1);
  controller.dispose();
});

test('reload waits for active turns and coalesces repeated requests', async () => {
  const fixture = createFixture(true);
  const controller = createShutdownController(INERT, fixture.ports);
  assert.equal(controller.beginMutation(), null);
  const startupCreation = controller.beginMutation({ allowDuringStartup: true });
  assert.ok(startupCreation);
  startupCreation();
  assert.equal(controller.completeStartup(), true);
  const admissionProbe = controller.beginMutation();
  assert.ok(admissionProbe);
  admissionProbe();

  controller.handleReload();
  assert.equal(controller.state, 'idle');
  const workDuringDeferral = controller.beginMutation();
  assert.ok(workDuringDeferral);
  workDuringDeferral();
  controller.handleReload();

  assert.deepEqual(fixture.counts(), {
    schedulerPauses: 1,
    schedulerStops: 0,
    flushes: 0,
    exits: 0,
    processStops: 0,
  });
  assert.equal(fixture.conversation.messages.length, 0);

  fixture.setActive(false);
  await sleep(550);
  assert.equal(fixture.counts().flushes, 1);
  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  await Promise.resolve();
  assert.equal(fixture.counts().exits, 1);
  controller.dispose();
});

test('reload drains an admitted mutation before exit', async () => {
  const fixture = createFixture(false);
  const controller = createShutdownController(INERT, fixture.ports);
  assert.equal(controller.completeStartup(), true);
  const release = controller.beginMutation();
  assert.ok(release);

  controller.handleReload();
  await sleep(550);
  assert.equal(fixture.counts().flushes, 0);

  release();
  await sleep(550);
  assert.equal(fixture.counts().flushes, 1);
  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  controller.dispose();
});

test('reload drains the automation run beyond its individual provider turn', async () => {
  const fixture = createFixture(false);
  fixture.setActiveSchedulerRuns(1);
  const controller = createShutdownController(INERT, fixture.ports);
  assert.equal(controller.completeStartup(), true);

  controller.handleReload();
  await sleep(550);
  assert.equal(fixture.counts().flushes, 0);

  fixture.setActiveSchedulerRuns(0);
  await sleep(550);
  assert.equal(fixture.counts().flushes, 1);
  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  controller.dispose();
});

/**
 * Incident 2026-08-22. The old reload grace force-killed ordinary provider turns
 * because they routinely outlive eight seconds. The grace now bounds only how
 * long the old backend remains fully available: afterward it quiesces admission
 * but retains process ownership until the turn completes naturally.
 */
test('a reload quiesces after the grace without interrupting its live turn', async () => {
  const fixture = createFixture(true);
  const controller = createShutdownController({ ...INERT, reloadDrainGraceMs: 300 }, fixture.ports);
  assert.equal(controller.completeStartup(), true);

  controller.handleReload();
  assert.equal(controller.state, 'idle');
  const admittedDuringDeferral = controller.beginMutation();
  assert.ok(admittedDuringDeferral);
  admittedDuringDeferral();

  await sleep(150);
  assert.equal(fixture.counts().processStops, 0, 'turn is left alone before the grace');
  assert.equal(fixture.counts().flushes, 0);

  await sleep(250);
  assert.equal(controller.state, 'reloading');
  assert.equal(controller.beginMutation(), null, 'new work is refused after the grace');
  assert.equal(fixture.counts().processStops, 0, 'live turn survives the grace');
  assert.equal(fixture.counts().flushes, 0, 'reload still waits for its owned turn');

  fixture.setActive(false);
  await sleep(550);
  assert.equal(fixture.counts().flushes, 1);
  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  await Promise.resolve();
  assert.equal(fixture.counts().exits, 1);
  controller.dispose();
});

test('quiesced reload waits for admitted mutations and active automation wrappers', async () => {
  const fixture = createFixture(false);
  fixture.setActiveSchedulerRuns(1);
  const controller = createShutdownController({ ...INERT, reloadDrainGraceMs: 100 }, fixture.ports);
  assert.equal(controller.completeStartup(), true);
  const releaseMutation = controller.beginMutation();
  assert.ok(releaseMutation);

  controller.handleReload();
  await sleep(150);

  assert.equal(controller.state, 'reloading');
  assert.equal(fixture.counts().schedulerStops, 0, 'reload never cancels an active automation');
  assert.equal(fixture.counts().flushes, 0);

  fixture.setActiveSchedulerRuns(0);
  await sleep(550);
  assert.equal(fixture.counts().flushes, 0, 'admitted mutation still owns the process');

  releaseMutation();
  await sleep(550);
  assert.equal(fixture.counts().flushes, 1);
  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  controller.dispose();
});

test('hot reload preserves a real detached provider process beyond its grace', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'unleashd-reload-provider-'));
  const marker = join(directory, 'completed');
  const child = spawn(
    process.execPath,
    [
      '-e',
      "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'ok'), 650)",
      marker,
    ],
    { detached: true, stdio: 'ignore' }
  );
  let stopped = 0;
  let flushed = 0;
  let exited = 0;
  const conversation: ShutdownConversation = {
    id: 'real-provider-turn',
    messages: [],
    process: child,
    hasActiveProcess: () => child.exitCode === null,
    stop: () => {
      stopped += 1;
      if (child.pid != null) process.kill(-child.pid, 'SIGTERM');
    },
  };
  const controller = createShutdownController(
    { ...INERT, reloadDrainGraceMs: 100 },
    {
      conversations: () => [conversation],
      activeSchedulerRuns: () => 0,
      pauseScheduler: () => undefined,
      stopScheduler: () => undefined,
      flushState: () => {
        flushed += 1;
      },
      broadcastMessage: () => undefined,
      exit: () => {
        exited += 1;
      },
    }
  );
  t.after(() => {
    controller.dispose();
    if (child.exitCode === null && child.pid != null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(controller.completeStartup(), true);

  controller.handleReload();
  await sleep(250);

  assert.equal(controller.state, 'reloading');
  assert.equal(stopped, 0);
  assert.equal(flushed, 0);

  await new Promise<void>((resolve) => child.once('close', () => resolve()));
  await sleep(550);

  assert.equal(existsSync(marker), true, 'provider completed its work after reload quiesced');
  assert.equal(stopped, 0, 'reload never signalled the provider process group');
  assert.equal(flushed, 1);
  assert.equal(exited, 1);
});

/**
 * Incident 2026-08-20. exitOnce() clears every drain timer before awaiting
 * flushState(), so a flush that never settles left the process alive in
 * `exiting` with nothing armed to rescue it — same user-visible symptom, but
 * permanent. flushState() awaits turnAttemptJournal.flush(), which queues behind
 * every in-flight journal write, so "never settles" is reachable in production.
 */
test('a state flush that never settles still exits the process', async () => {
  const fixture = createFixture(false);
  const controller = createShutdownController({ ...INERT, flushGraceMs: 200 }, fixture.ports);
  assert.equal(controller.completeStartup(), true);

  controller.handleSigterm();
  assert.equal(controller.state, 'exiting');
  assert.equal(fixture.counts().flushes, 1);
  assert.equal(fixture.counts().exits, 0, 'exit is still waiting on the flush');

  await sleep(350);
  assert.equal(fixture.counts().exits, 1, 'watchdog exits despite the hung flush');
  controller.dispose();
});

/**
 * handleShutdown used to call waitForDrain (which arms the force-exit timer) and
 * then immediately overwrite the handle with its own timer, leaking one that
 * clearTimers()/dispose() could never reach. The shutdown path must force-exit on
 * forceExitGraceMs, never on the much longer reload grace.
 */
test('shutdown force-exits on the shutdown grace, not the reload grace', async () => {
  const fixture = createFixture(false);
  // A scheduler run is work that interrupt() cannot clear, so the drain is still
  // open when the grace expires.
  fixture.setActiveSchedulerRuns(1);
  const controller = createShutdownController({ ...INERT, forceExitGraceMs: 300 }, fixture.ports);
  assert.equal(controller.completeStartup(), true);

  controller.handleSigterm();
  assert.equal(controller.state, 'shutting_down');
  assert.equal(fixture.counts().flushes, 0, 'still draining the scheduler run');

  await sleep(450);
  assert.equal(fixture.counts().flushes, 1, 'forced at forceExitGraceMs');
  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  await Promise.resolve();
  assert.equal(fixture.counts().exits, 1);
  controller.dispose();
});
