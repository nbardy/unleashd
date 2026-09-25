// The TS boundary for conversation records: the built addon round-trips a record in the exact
// PersistedConversationConfigRecord shape (nullish null vs absent included), resolves concurrent
// set_config calls from JS to one winner, and returns typed outcomes. Run `pnpm run build` first.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { ConversationRecords } = createRequire(import.meta.url)('../index.js');
const T0 = 1_790_000_000_000;

const config = (modelId) => ({
  provider: 'codex',
  model: { mode: 'explicit', modelId },
  reasoning: { mode: 'default' },
});

test('records round-trip through the addon and set_config is compare-and-set', async () => {
  const db = join(mkdtempSync(join(tmpdir(), 'unleashd-records-')), 'records.sqlite');
  const records = await ConversationRecords.open(db);
  const creation = { commandId: 'cmd-1' };
  const kind = {
    t: 'buddy',
    context: {
      buddyId: 'b1',
      workspaceId: 'w1',
      buddyProjectId: null,
      allowedBuddyOperations: ['buddy.post'],
    },
    visibility: 'foreground',
  };
  const created = await records.create(
    {
      conversationId: 'c1',
      kind,
      sessionBindings: [],
      currentSession: { provider: 'codex', sessionId: 's1' },
      workingDirectory: '/work',
      creation,
      config: config('gpt-a'),
      lastResolvedConfig: { provider: 'codex', modelId: 'gpt-a' },
      provenance: 'user',
    },
    T0
  );
  assert.equal(created.t, 'created');
  assert.deepEqual(created.record, {
    conversationId: 'c1',
    kind,
    sessionBindings: [],
    currentSession: { provider: 'codex', sessionId: 's1' },
    status: 'active',
    done: false,
    workingDirectory: '/work',
    creation,
    config: config('gpt-a'),
    recordRevision: 0,
    configRevision: 0,
    lastResolvedConfig: { provider: 'codex', modelId: 'gpt-a' },
    provenance: 'user',
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
  });
  // null and absent stay distinct across the boundary (JSON.stringify keeps one, drops the other).
  const read = await records.get('c1');
  assert.equal(JSON.stringify(read), JSON.stringify(created.record));
  assert.equal((await records.findBySession('codex', 's1')).conversationId, 'c1');
  assert.equal(await records.findBySession('codex', 'nope'), null);

  // Five set_config calls in flight at once, all expecting revision 0: exactly one commits.
  const outcomes = await Promise.all(
    ['x', 'y', 'z', 'u', 'v'].map((m) =>
      records.setConfig(
        {
          conversationId: 'c1',
          expectedConfigRevision: 0,
          config: config(`gpt-${m}`),
          lastResolvedConfig: { provider: 'codex', modelId: `gpt-${m}` },
        },
        T0 + 1
      )
    )
  );
  assert.deepEqual(outcomes.map((o) => o.t).sort(), [
    'committed',
    'revision_conflict',
    'revision_conflict',
    'revision_conflict',
    'revision_conflict',
  ]);
  const winner = outcomes.find((o) => o.t === 'committed').record;
  assert.equal(winner.configRevision, 1);
  for (const o of outcomes.filter((o) => o.t === 'revision_conflict'))
    assert.deepEqual(o.current, winner);

  assert.equal((await records.setDone('c1', true, T0 + 2)).done, true);
  assert.equal(await records.markDeleted('c1', T0 + 3), true);
  const [summary] = await records.listSummaries();
  assert.deepEqual(summary.kind, kind);
  assert.equal(summary.status, 'deleted');
  assert.deepEqual(summary.sessions, [{ provider: 'codex', sessionId: 's1' }]);

  // A record the Zod schema would refuse is refused with a typed code, not stored.
  await assert.rejects(
    records.create(
      {
        conversationId: 'c2',
        kind: { t: 'chat' },
        sessionBindings: [{ provider: 'codex', sessionId: '' }],
        config: config('m'),
        provenance: 'user',
      },
      T0
    ),
    /^Error: \[invalid\]/
  );
  assert.equal(await records.get('c2'), null);

  // Worker ids are `.nullable()` in the Zod schema: null must cross as null, never as absent.
  const worker = { t: 'worker', swarmId: 'sw', workerId: null, role: null };
  const w = await records.create(
    {
      conversationId: 'w1',
      kind: worker,
      sessionBindings: [],
      config: config('m'),
      provenance: 'external_discovered',
    },
    T0
  );
  assert.deepEqual((await records.get(w.record.conversationId)).kind, worker);
});
