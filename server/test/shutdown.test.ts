import assert from 'node:assert/strict';
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
  assert.equal(controller.state, 'reloading');
  assert.equal(controller.beginMutation(), null);
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
 * Incident 2026-08-20. `reloading` is an absorbing state — nothing returns the
 * controller to `idle` — so if the drain never completes the server stays up
 * refusing every mutation with "Backend reload is draining active turns" until
 * the process is killed by hand. A provider turn that outlives the grace is the
 * normal case here (agents editing server/src while their own turn is running),
 * so the grace is a liveness requirement. Every other test in this file lets the
 * work go away; this one never does.
 */
test('a reload whose work never drains still exits after the grace', async () => {
  const fixture = createFixture(true);
  const controller = createShutdownController({ ...INERT, reloadDrainGraceMs: 300 }, fixture.ports);
  assert.equal(controller.completeStartup(), true);

  controller.handleReload();
  assert.equal(controller.state, 'reloading');
  assert.equal(controller.beginMutation(), null);

  await sleep(150);
  assert.equal(fixture.counts().processStops, 0, 'turn is left alone before the grace');
  assert.equal(fixture.counts().flushes, 0);

  await sleep(350);
  assert.equal(fixture.counts().processStops, 1, 'live turn interrupted at the grace');
  assert.equal(fixture.counts().flushes, 1, 'exit started despite the turn never ending');
  fixture.pendingFlush.resolve();
  await fixture.pendingFlush.promise;
  await Promise.resolve();
  assert.equal(fixture.counts().exits, 1);
  controller.dispose();
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
