/**
 * Boot → conversation list, through the REAL ingest crate over a fixture HOME and a real records
 * store (T13b). Catches: a list row that stops coming from the store's join (label, cwd,
 * createdAt, count), the Muse approval-review children (no cwd anywhere) leaking back into the
 * list under a guessed directory, live runtime ids being listed twice, an appended transcript no
 * longer reaching clients as an `activity` patch, a record created after boot never joining the
 * list (S1 gap), overlapping sessions counted twice (S1 gap), and the two label rules drifting
 * apart so a row changes label when its transcript lands (S1 gap).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { type ConversationBroadcast, conversationLabel } from '../src/conversations/runtime';
import { bootIngest } from '../src/ingest/boot';
import type { ListedRuntime } from '../src/ingest/conversation-list';
import { claudeLine, ingestHome, until } from './fixtures/ingest-home';
import { recordStore } from './fixtures/records';

const CHAT = '11111111-1111-4111-8111-111111111111';
const LIVE = '22222222-2222-4222-8222-222222222222';
const APPROVAL = '33333333-3333-4333-8333-333333333333';
const LATER = '44444444-4444-4444-8444-444444444444';
const CLAUDE_SESSION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const LIVE_SESSION = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const FIRST_SESSION = 'cccccccc-3333-4333-8333-cccccccccccc';
const FORKED_SESSION = 'dddddddd-4444-4444-8444-dddddddddddd';
const MUSE_SESSION = 'muse-approval-review-child';
const CONFIG = { provider: 'claude', model: { mode: 'default' }, reasoning: { mode: 'default' } };
const T0 = Date.parse('2026-09-20T12:00:00Z');
const bind = (provider: string, sessionId: string) => ({ provider, sessionId }) as never;

function listDependencies(
  records: ReturnType<typeof recordStore>,
  sent: ConversationBroadcast[],
  runtimes: Map<string, ListedRuntime> = new Map()
) {
  const external = new Map<string, number>();
  return {
    records,
    runtime: (id: string) => runtimes.get(id),
    discover: async () => null,
    externalActivity: {
      has: (id: string) => external.has(id),
      set: (id: string, at: number) => void external.set(id, at),
      delete: (id: string) => void external.delete(id),
      entries: () => external.entries(),
    },
    completionSuppression: { isSuppressed: () => false },
    externalGraceMs: 30_000,
    broadcast: (data: ConversationBroadcast) => sent.push(data),
    logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
  };
}

test('boot lists record-joined rows from the ingest store and patches appended activity', async () => {
  const fixture = ingestHome('unleashd-ingest-list-');
  const { home, appData, project } = fixture;
  const transcript = fixture.transcript(CLAUDE_SESSION);
  fs.writeFileSync(
    transcript,
    claudeLine(CLAUDE_SESSION, 'user', 'Fix the flaky test\nmore detail', T0, project) +
      claudeLine(CLAUDE_SESSION, 'assistant', 'Done.', T0 + 1_000, project)
  );
  fs.writeFileSync(
    fixture.transcript(LIVE_SESSION),
    claudeLine(LIVE_SESSION, 'user', 'live one', T0, project)
  );
  // A Muse session log with no cwd anywhere, like the approval-review children.
  const museDir = path.join(home, '.local', 'share', 'muse', 'sessions', '2026', '09', '20');
  fs.mkdirSync(path.join(museDir, MUSE_SESSION), { recursive: true });
  fs.writeFileSync(
    path.join(museDir, MUSE_SESSION, 'session.jsonl'),
    `${JSON.stringify({
      stream: { kind: 'session', id: MUSE_SESSION },
      recorded_at: T0 * 1000,
      payload_type: 'runtime.session',
      payload: { kind: 'run', event: { kind: 'started', prompt: 'approve?' } },
    })}\n`
  );

  const records = recordStore(appData);
  await records.create({
    conversationId: CHAT,
    kind: { t: 'chat' },
    sessionBindings: [bind('claude', CLAUDE_SESSION)],
    currentSession: bind('claude', CLAUDE_SESSION),
    config: CONFIG as never,
    provenance: 'external_discovered',
  });
  await records.create({
    conversationId: LIVE,
    kind: { t: 'chat' },
    currentSession: bind('claude', LIVE_SESSION),
    config: CONFIG as never,
    provenance: 'user',
  });
  await records.create({
    conversationId: APPROVAL,
    kind: { t: 'chat' },
    currentSession: bind('muse', MUSE_SESSION),
    config: { ...CONFIG, provider: 'muse' } as never,
    provenance: 'external_discovered',
  });

  const sent: ConversationBroadcast[] = [];
  const live: ListedRuntime = { id: LIVE, messages: [], hasActiveProcess: () => false };
  const { ingest, list } = await bootIngest(
    { home, appDataDir: appData },
    listDependencies(records, sent, new Map([[LIVE, live]]))
  );
  try {
    const listed = {
      id: CHAT,
      kind: { t: 'chat' },
      parent: null,
      resumedFrom: null,
      provider: 'claude',
      cwd: project,
      label: 'Fix the flaky test more detail',
      // Discovered record: the transcript's own birth, not the import stamp.
      createdAt: T0,
      activityAt: T0 + 1_000,
      messageCount: 2,
      run: 'idle',
      done: false,
    };
    assert.deepEqual(list.rows(), [listed]);
    assert.ok(list.ids().includes(LIVE), 'a live id is listed for `ready`, not sent as a row');
    assert.ok(!list.ids().includes(APPROVAL));

    // One label rule: the runtime's (a conversation whose transcript is not read yet) folds a
    // multi-line prompt exactly as the crate does, so the label does not jump when it lands.
    assert.equal(
      conversationLabel(undefined, [
        { role: 'user', content: 'Fix the flaky test\nmore detail', timestamp: new Date(T0) },
      ]),
      listed.label
    );
    const runtimeFields = list.historyFields({
      id: CHAT,
      messages: [],
      createdAt: new Date(T0),
      hasActiveProcess: () => false,
    });
    assert.equal(runtimeFields.label, listed.label);
    assert.equal(runtimeFields.messageCount, listed.messageCount);

    fs.appendFileSync(
      transcript,
      claudeLine(CLAUDE_SESSION, 'user', 'and again', T0 + 60_000, project)
    );
    const patch = await until(() =>
      sent.find((data) => data.type === 'patch' && data.id === CHAT && data.patch.t === 'activity')
    );
    assert.deepEqual(patch, {
      type: 'patch',
      id: CHAT,
      patch: { t: 'activity', activityAt: T0 + 60_000, messageCount: 3 },
    });
    // Nothing this server runs wrote it: the row shows as running elsewhere.
    assert.ok(
      sent.some(
        (data) =>
          data.type === 'patch' &&
          data.id === CHAT &&
          data.patch.t === 'run' &&
          data.patch.run === 'running'
      )
    );
  } finally {
    list.stop();
    await ingest.stop();
    fixture.cleanup();
  }
});

test('a record created after boot joins the list and its overlapping sessions count once', async () => {
  const fixture = ingestHome('unleashd-ingest-later-');
  const { home, appData, project } = fixture;
  const records = recordStore(appData);
  const sent: ConversationBroadcast[] = [];
  const { ingest, list } = await bootIngest(
    { home, appDataDir: appData },
    listDependencies(records, sent)
  );
  try {
    assert.deepEqual(list.rows(), []);
    // Created after boot (S1 left these out until a restart), then a fork whose new transcript
    // repeats the first one's lines before continuing.
    await records.create({
      conversationId: LATER,
      kind: { t: 'chat' },
      sessionBindings: [bind('claude', FIRST_SESSION)],
      currentSession: bind('claude', FORKED_SESSION),
      config: CONFIG as never,
      provenance: 'user',
    });
    const prefix =
      claudeLine(FIRST_SESSION, 'user', 'Plan the release', T0, project) +
      claudeLine(FIRST_SESSION, 'assistant', 'Here is a plan.', T0 + 1_000, project);
    fs.writeFileSync(fixture.transcript(FIRST_SESSION), prefix);
    fs.writeFileSync(
      fixture.transcript(FORKED_SESSION),
      prefix.replaceAll(FIRST_SESSION, FORKED_SESSION) +
        claudeLine(FORKED_SESSION, 'user', 'Ship it', T0 + 60_000, project) +
        claudeLine(FORKED_SESSION, 'assistant', 'Shipped.', T0 + 61_000, project)
    );
    await until(() =>
      list.rows().find((row) => row.id === LATER)?.messageCount === 4 ? true : undefined
    );
    const row = list.rows().find((candidate) => candidate.id === LATER);
    assert.equal(row?.messageCount, 4, 'the inherited prefix is counted once, not 2 + 4');
    assert.equal(row?.label, 'Plan the release');
    const page = await list.page(LATER, { afterSeq: -1, limit: 100 });
    assert.deepEqual(
      page?.messages.map((message) => message.content),
      ['Plan the release', 'Here is a plan.', 'Ship it', 'Shipped.']
    );
  } finally {
    list.stop();
    await ingest.stop();
    fixture.cleanup();
  }
});
