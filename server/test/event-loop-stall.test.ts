/**
 * The stall monitor against a REAL error journal on disk: a genuine synchronous
 * block of the event loop must land as one grouped `event-loop` occurrence that
 * names the activity noted before it, and an idle loop must record nothing.
 *
 * What would re-break: computing drift from the wrong baseline (every tick then
 * reads as a stall, or none does), losing the activity label, or journaling
 * every repeat of the same stall instead of summarizing within the window.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ErrorJournal } from '../src/observability/error-journal';
import { noteActivity, startEventLoopStallMonitor } from '../src/observability/event-loop-stall';

function blockEventLoop(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* a synchronous stall, like a readFileSync of a large transcript */
  }
}

test('a blocked event loop is journaled once per activity; an idle loop is not', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-stall-'));
  const journal = new ErrorJournal({ directory });
  await journal.initialize();
  const stop = startEventLoopStallMonitor(journal);
  try {
    await delay(300);
    await journal.flush();
    assert.deepEqual(await journal.queryGroups({ status: 'all' }), [], 'idle loop reported');

    noteActivity('GET /api/usage');
    blockEventLoop(250);
    await delay(120);
    noteActivity('GET /api/usage');
    blockEventLoop(180);
    await delay(120);
    await journal.flush();

    const groups = await journal.queryGroups({ status: 'all' });
    assert.equal(groups.length, 1);
    const [group] = groups;
    assert.equal(group.component, 'event-loop');
    assert.equal(group.count, 1, 'the second stall in the window must be summarized, not written');
    assert.equal(group.context?.route, 'GET /api/usage');
    const stalledMs = Number(/stalled (\d+)ms/.exec(group.message)?.[1]);
    assert.ok(stalledMs >= 150 && stalledMs < 1_000, `stall measured as ${stalledMs}ms`);
  } finally {
    stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
