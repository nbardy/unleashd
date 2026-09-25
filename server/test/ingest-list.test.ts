/**
 * Boot → conversation list, through the REAL ingest crate over a fixture HOME and a real records
 * store (T13b S1). Catches: a list row that stops coming from the store's join (label, cwd,
 * createdAt, count), the Muse approval-review children (no cwd anywhere) leaking back into the
 * list under a guessed directory, live runtime ids being listed twice, and an appended transcript
 * no longer reaching clients as an `activity` patch.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ConversationBroadcast } from '../src/conversations/runtime';
import { bootIngest } from '../src/ingest/boot';
import { recordStore } from './fixtures/records';

const CHAT = '11111111-1111-4111-8111-111111111111';
const LIVE = '22222222-2222-4222-8222-222222222222';
const APPROVAL = '33333333-3333-4333-8333-333333333333';
const CLAUDE_SESSION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const LIVE_SESSION = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const MUSE_SESSION = 'muse-approval-review-child';
const CONFIG = { provider: 'claude', model: { mode: 'default' }, reasoning: { mode: 'default' } };
const T0 = Date.parse('2026-09-20T12:00:00Z');

function claudeLine(role: 'user' | 'assistant', text: string, at: number, cwd: string): string {
  return `${JSON.stringify({
    type: role,
    sessionId: CLAUDE_SESSION,
    cwd,
    timestamp: new Date(at).toISOString(),
    uuid: `${role}-${at}`,
    message:
      role === 'user'
        ? { role, content: text }
        : { role, id: `msg-${at}`, model: 'claude-opus-5-5', content: [{ type: 'text', text }] },
  })}\n`;
}

async function until<T>(read: () => T | undefined, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('boot lists record-joined rows from the ingest store and patches appended activity', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-ingest-list-'));
  const appData = path.join(home, '.agent-viewer');
  const project = path.join(home, 'git', 'demo');
  fs.mkdirSync(project, { recursive: true });
  const claudeDir = path.join(home, '.claude', 'projects', project.replaceAll('/', '-'));
  fs.mkdirSync(claudeDir, { recursive: true });
  const transcript = path.join(claudeDir, `${CLAUDE_SESSION}.jsonl`);
  fs.writeFileSync(
    transcript,
    claudeLine('user', 'Fix the flaky test\nmore detail', T0, project) +
      claudeLine('assistant', 'Done.', T0 + 1_000, project)
  );
  fs.writeFileSync(
    path.join(claudeDir, `${LIVE_SESSION}.jsonl`),
    claudeLine('user', 'live one', T0, project)
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
  const bind = (provider: string, sessionId: string) => ({ provider, sessionId }) as never;
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
  const warnings: string[] = [];
  const { ingest, list } = await bootIngest(
    { home, appDataDir: appData },
    {
      records,
      isLive: (id) => id === LIVE,
      broadcast: (data) => sent.push(data),
      logger: {
        log: () => undefined,
        warn: (m: string) => warnings.push(m),
        error: () => undefined,
      },
    }
  );
  try {
    assert.deepEqual(list.rows(), [
      {
        id: CHAT,
        kind: { t: 'chat' },
        parent: null,
        resumedFrom: null,
        provider: 'claude',
        cwd: project,
        // The crate's label folds the first prompt onto one line (the runtime keeps line 1 only).
        label: 'Fix the flaky test more detail',
        // Discovered record: the transcript's own birth, not the import stamp.
        createdAt: T0,
        activityAt: T0 + 1_000,
        messageCount: 2,
        run: 'idle',
        done: false,
      },
    ]);
    assert.ok(list.ids().includes(LIVE), 'a live id is listed for `ready`, not sent as a row');
    assert.ok(!list.ids().includes(APPROVAL));
    assert.equal(warnings.filter((m) => m.includes('no working directory')).length, 1);

    fs.appendFileSync(transcript, claudeLine('user', 'and again', T0 + 60_000, project));
    const patch = await until(() =>
      sent.find((data) => data.type === 'patch' && data.id === CHAT && data.patch.t === 'activity')
    );
    assert.deepEqual(patch, {
      type: 'patch',
      id: CHAT,
      patch: { t: 'activity', activityAt: T0 + 60_000, messageCount: 3 },
    });
  } finally {
    await ingest.stop();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
