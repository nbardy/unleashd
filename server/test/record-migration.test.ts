import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PersistedConversationConfigRecordSchema,
  createDefaultConversationConfig,
} from '@unleashd/shared';
import { migrateConversationRecords } from '../src/conversations/record-migration';

// The one-time v1 → v2 record rewrite (T09). v1 re-derived kind at every
// hydration from creation.buddyContext / purpose / placement and a transcript
// marker; a Builder record carried only `purpose` (30 such records seen on
// 2026-09-07 — if the purpose path is lost, every Builder thread renders as a
// plain chat). Runs on a fixture shaped like the live records.

const config = createDefaultConversationConfig('codex');
const BUDDY = { buddyId: 'buddy_1', workspaceId: 'project_1' };

function v1(conversationId: string, creation: Record<string, unknown> | undefined, extra = {}) {
  return {
    version: 1,
    conversationId,
    sessionBindings: [{ provider: 'codex', sessionId: `session-${conversationId}` }],
    currentSession: { provider: 'codex', sessionId: `session-${conversationId}` },
    status: 'active',
    done: conversationId === 'chat',
    workingDirectory: '/work',
    ...(creation ? { creation } : {}),
    config,
    recordRevision: 3,
    configRevision: 1,
    provenance: creation ? 'user' : 'external_discovered',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    ...extra,
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'record-migration-'));
  const byConversation = path.join(root, 'conversation-config', 'v1', 'by-conversation');
  await mkdir(byConversation, { recursive: true });
  // What records-tool import reads: each migrated file, parsed as record v2.
  const store = {
    getByConversationId: async (id: string) =>
      PersistedConversationConfigRecordSchema.parse(
        JSON.parse(
          await readFile(
            path.join(byConversation, `${Buffer.from(id).toString('base64url')}.json`),
            'utf8'
          )
        )
      ),
  };
  const records = {
    builder: v1('builder', { commandId: 'c1', purpose: 'buddy_builder' }),
    owner: v1('owner', { commandId: 'c2', buddyContext: BUDDY }),
    background: v1('background', {
      commandId: 'c3',
      buddyContext: BUDDY,
      placement: 'background',
      initialMessage: 'Do the thing',
    }),
    delegated: v1('delegated', {
      commandId: 'c4',
      buddyContext: { ...BUDDY, delegatedByBuddyId: 'lead' },
    }),
    marker: v1('marker', undefined),
    chat: v1('chat', undefined),
  };
  // Real v1 records often lack keys the schema defaults (status, done,
  // recordRevision). A first cut wrote the PARSED record, so its verification
  // saw the defaults as changed fields and refused 7,142 of 8,017 records on
  // the 2026-09-25 copy. The stored file must stay what it was, plus `kind`.
  const sparse = records.marker as Record<string, unknown>;
  for (const key of ['status', 'done', 'recordRevision']) delete sparse[key];
  for (const record of Object.values(records)) {
    // The store's own file naming: base64url of the id.
    const name = `${Buffer.from(record.conversationId).toString('base64url')}.json`;
    await writeFile(path.join(byConversation, name), JSON.stringify(record, null, 2));
  }
  // A session-cache entry whose first user message carries the Buddy marker.
  const cache = path.join(root, 'session-cache-v1');
  await mkdir(cache);
  const payload = Buffer.from(JSON.stringify(BUDDY)).toString('base64url');
  await writeFile(
    path.join(cache, 'marker.json'),
    JSON.stringify({
      version: 7,
      session: {
        sessionId: 'session-marker',
        provider: 'codex',
        messages: [
          {
            role: 'user',
            content: `<!-- unleashd:buddy-context-v2 ${payload} 5 -->\nbrief\n<!-- /unleashd:buddy-context-v2 -->\n\nhi`,
          },
        ],
      },
    })
  );
  return { root, store };
}

test('v1 records become v2 with one stored kind; everything else is preserved', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  // Before migration a record is v1, which the importer refuses.
  await assert.rejects(store.getByConversationId('chat'));

  const result = await migrateConversationRecords({
    appDataRoot: root,
    logger: { log: () => undefined, warn: () => undefined },
  });
  assert.equal(result.t, 'migrated');
  if (result.t !== 'migrated') return;
  assert.deepEqual(result.report.failures, []);
  assert.equal(result.report.verified, 6);
  assert.deepEqual(result.report.byKind, { chat: 1, buddy: 4, builder: 1, worker: 0 });
  assert.deepEqual(result.report.markerDerived, [{ conversationId: 'marker', kind: 'buddy' }]);

  const kind = async (id: string) => (await store.getByConversationId(id))?.kind;
  assert.deepEqual(await kind('builder'), { t: 'builder' });
  assert.deepEqual(await kind('chat'), { t: 'chat' });
  const visibility = async (id: string) => {
    const k = await kind(id);
    return k?.t === 'buddy' ? k.visibility : null;
  };
  assert.equal(await visibility('owner'), 'foreground');
  assert.equal(await visibility('background'), 'background');
  assert.equal(await visibility('delegated'), 'background');
  assert.equal(await visibility('marker'), 'foreground');

  const background = await store.getByConversationId('background');
  assert.equal(background?.creation?.initialMessage, 'Do the thing');
  assert.equal(background?.recordRevision, 3);
  assert.equal((await store.getByConversationId('chat'))?.done, true);

  // The originals are kept, and a second boot does nothing.
  const root1 = path.join(root, 'conversation-config', 'v1');
  assert.ok((await readdir(root1)).some((name) => name.startsWith('backup-v1-')));
  assert.deepEqual(await migrateConversationRecords({ appDataRoot: root }), {
    t: 'already_migrated',
  });
  const report = JSON.parse(await readFile(path.join(root1, 'migration-v2-report.json'), 'utf8'));
  assert.equal(report.migrated, 6);
});
