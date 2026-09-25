// The TS boundary: load the built addon, pass sum types in, get sum types and typed errors out.
// Run `pnpm run build` first.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const { BuddiesCore } = createRequire(import.meta.url)('../index.js');

test('a request, its run and its answer cross the napi boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'buddies-core-'));
  const path = join(dir, 'core.sqlite');
  const core = await BuddiesCore.open(path);

  // Identity rows have no core writer yet (team admin lands with the server rewrite), so seed them.
  const db = new DatabaseSync(path);
  db.exec(`INSERT INTO workspace VALUES ('ws', 'ws', '${dir}', '2026-01-01T00:00:00.000Z', NULL);
    INSERT INTO buddy (id, workspace_id, slug, name, role, status, created_at)
    VALUES ('a', 'ws', 'a', 'A', 'r', 'active', '2026-01-01T00:00:00.000Z'),
           ('b', 'ws', 'b', 'B', 'r', 'active', '2026-01-01T00:00:00.000Z');`);
  db.close();

  const a = { kind: 'buddy', id: 'a' };
  const b = { kind: 'buddy', id: 'b' };
  assert.deepEqual(await core.authorize(a, 'write_doc', { kind: 'buddy', id: 'b' }), {
    kind: 'denied',
    reason: 'a is neither b nor one of its managers',
  });

  const post = await core.post(
    a,
    { kind: 'direct', members: [a, b] },
    { kind: 'request', body: 'review this', evidence: [], key: 'k1' }
  );
  assert.deepEqual(post.request, { state: 'awaiting' });
  const channel = await core.openChannel(b, { kind: 'direct', members: [b, a] });
  assert.equal(channel.id, post.channelId);
  assert.deepEqual(channel.kind, { type: 'direct', members: [a, b] });

  const claim = await core.claimRun(60_000);
  assert.deepEqual(claim.run.input, { kind: 'post', postId: post.id });
  const answer = await core.answer(b, {
    requestId: post.id,
    body: 'lgtm',
    evidence: ['ci'],
    key: 'k2',
  });
  assert.equal(answer.replyToId, post.id);
  assert.deepEqual(answer.evidence, ['ci']);
  assert.deepEqual((await core.getPost(a, post.id)).request, {
    state: 'answered',
    answerId: answer.id,
  });
  const settled = await core.settleRun(claim.run.id, claim.leaseToken, {
    kind: 'complete',
    text: 'ok',
  });
  assert.equal(settled.status, 'complete');

  await assert.rejects(core.getBuddy('nobody'), /^Error: \[not_found\]/);
  await assert.rejects(
    core.writeDoc(a, {
      doc: { buddyId: 'b', scope: { kind: 'buddy' }, kind: 'working', name: '' },
      content: 'x',
      baseRevision: 0,
      reason: 'r',
      key: 'k3',
    }),
    /^Error: \[denied\]/
  );
});

test('open refuses a file that is not a buddies-core database', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'buddies-core-')), 'other.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE buddies (id TEXT)');
  db.close();
  await assert.rejects(BuddiesCore.open(path), /\[wrong_database\]/);
});
