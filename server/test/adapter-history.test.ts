import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ConversationSessionBinding, Provider } from '@unleashd/shared';
import type {
  DiskAdapter,
  ParsedSession,
  SessionHistorySource,
} from '../src/adapters/disk-adapter';
import { loadAllConversations } from '../src/adapters/loader';
import { getDiskAdapter } from '../src/adapters/registry';
import { NormalizedSessionCache } from '../src/adapters/session-cache';

const timestamp = '2026-09-01T00:00:00.000Z';

function codexTranscript(sessionId: string, content: string): string {
  return [
    { timestamp, type: 'session_meta', payload: { id: sessionId, cwd: '/tmp/project' } },
    { timestamp, type: 'event_msg', payload: { type: 'user_message', message: content } },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n');
}

test('capped startup restores bound native siblings through registered adapters and cache', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-adapter-history-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const currentId = '11111111-1111-4111-8111-111111111111';
  const oldId = '22222222-2222-4222-8222-222222222222';
  const unrelatedId = '33333333-3333-4333-8333-333333333333';
  const hiddenId = '44444444-4444-4444-8444-444444444444';
  const geminiId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const collisionId = 'aaaaaaaa-2222-4222-8222-222222222222';
  const museId = '55555555-5555-4555-8555-555555555555';
  const files = new Map<Provider, string[]>();

  async function write(provider: Provider, name: string, body: string, mtime: number) {
    const filePath = path.join(root, provider, name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.utimes(filePath, mtime, mtime);
    files.set(provider, [...(files.get(provider) ?? []), filePath]);
    return filePath;
  }

  await write('codex', `rollout-${currentId}.jsonl`, codexTranscript(currentId, 'current'), 700);
  await write(
    'codex',
    `rollout-${unrelatedId}.jsonl`,
    codexTranscript(unrelatedId, 'unrelated'),
    600
  );
  await write('codex', `rollout-${oldId}.jsonl`, codexTranscript(oldId, 'original'), 200);
  await write(
    'codex',
    `rollout-${hiddenId}.jsonl`,
    codexTranscript(hiddenId, '[_HIDE_TEST_] hidden'),
    100
  );
  for (const [id, suffix, mtime] of [
    [collisionId, '02', 500],
    [geminiId, '01', 400],
  ] as const) {
    await write(
      'gemini',
      `session-2026-09-${suffix}T00-00-aaaaaaaa.json`,
      JSON.stringify({
        sessionId: id,
        startTime: timestamp,
        lastUpdated: timestamp,
        messages: [
          {
            type: 'user',
            content: [{ text: id === geminiId ? 'gemini history' : 'collision' }],
            timestamp,
          },
        ],
      }),
      mtime
    );
  }
  await write(
    'muse',
    `${museId}/session.jsonl`,
    JSON.stringify({
      stream: { id: museId, kind: 'session' },
      recorded_at: timestamp,
      payload_type: 'runtime.session',
      payload: { kind: 'run', event: { kind: 'started', prompt: 'muse history' } },
    }),
    300
  );

  let discovers = 0;
  let parses = 0;
  const adapters = [...files].map(([provider, sources]): DiskAdapter => {
    const adapter = getDiskAdapter(provider);
    return {
      ...adapter,
      discoverFiles: async () => {
        discovers += 1;
        return sources;
      },
      parseFile: async (filePath) => {
        parses += 1;
        return adapter.parseFile(filePath);
      },
    };
  });
  const bindings: ConversationSessionBinding[] = [
    { provider: 'codex', sessionId: oldId },
    { provider: 'gemini', sessionId: geminiId },
    { provider: 'muse', sessionId: museId },
    { provider: 'codex', sessionId: hiddenId },
    { provider: 'codex', sessionId: '66666666-6666-4666-8666-666666666666' },
  ];
  const options = {
    adapters,
    limit: 1,
    concurrency: 3,
    cache: new NormalizedSessionCache(path.join(root, 'cache')),
    resolveSessionBindings: async () => bindings,
  };
  const first = await loadAllConversations(options);
  const observed: SessionHistorySource[] = [...first.conversations.values()];
  const firstParseCount = parses;
  await loadAllConversations({
    ...options,
    onProgress: (batch) => {
      observed.push(...batch);
    },
  });

  assert.equal(first.conversations.size, 1, 'unrelated sources remain outside the startup cap');
  assert.equal(first.mtimes.size, 7, 'every source remains in the discovery baseline');
  assert.equal(discovers, 6, 'each adapter discovers once per startup, not once per binding');
  assert.equal(firstParseCount, 6, 'only current, related, and the short-id collision are parsed');
  assert.equal(
    parses,
    firstParseCount,
    'all selected and related sources use the normalized cache'
  );
  for (const source of observed) {
    assert.equal(source.sessionId, currentId);
    assert.deepEqual(
      source.boundSessionSources?.map((entry) => entry.sessionId),
      [oldId, geminiId, museId]
    );
    assert.deepEqual(
      source.boundSessionSources?.map((entry) => entry.messages[0].content),
      ['original', 'gemini history', 'muse history']
    );
  }
});

test('selected and related parses share the aggregate source byte budget', async (t) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-history-budget-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sources = await Promise.all(
    ['current-a', 'current-b', 'old-a', 'old-b'].map(async (id, index) => {
      const filePath = path.join(root, `${id}.jsonl`);
      await fs.writeFile(filePath, '1234');
      await fs.utimes(filePath, 100 - index, 100 - index);
      return filePath;
    })
  );
  let active = 0;
  let maximum = 0;
  let parses = 0;
  const adapter: DiskAdapter = {
    provider: 'claude',
    discoverFiles: async () => sources,
    parseFile: async (filePath): Promise<ParsedSession> => {
      active += 1;
      maximum = Math.max(maximum, active);
      parses += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        sessionId: path.basename(filePath, '.jsonl'),
        filePath,
        workingDirectory: '/tmp/project',
        provider: 'claude',
        model: 'unknown',
        createdAt: new Date(timestamp),
        modifiedAt: new Date(timestamp),
        messages: [{ role: 'user', content: filePath, timestamp: new Date(timestamp) }],
      };
    },
  };
  const result = await loadAllConversations({
    adapters: [adapter],
    limit: 2,
    concurrency: 2,
    maxInFlightParseBytes: 5,
    resolveSessionBindings: async (source) => [
      { provider: 'claude', sessionId: source.sessionId.replace('current', 'old') },
    ],
  });
  assert.equal(maximum, 1, 'history parsing must not bypass the selected-source byte budget');
  assert.equal(parses, 4);
  assert.equal(result.conversations.size, 2);
  for (const source of result.conversations.values() as Iterable<SessionHistorySource>) {
    assert.equal(source.boundSessionSources?.length, 1);
  }
});
