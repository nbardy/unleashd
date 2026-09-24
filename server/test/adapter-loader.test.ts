import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { DiskAdapter, ParsedSession } from '../src/adapters/disk-adapter';
import { loadAllConversations } from '../src/adapters/loader';
import { NormalizedSessionCache } from '../src/adapters/session-cache';

function parsedSession(filePath: string): ParsedSession {
  const now = new Date();
  return {
    sessionId: path.basename(filePath),
    filePath,
    workingDirectory: '/tmp/project',
    provider: 'claude',
    model: 'unknown',
    createdAt: now,
    modifiedAt: now,
    messages: [{ role: 'user', content: 'hello', timestamp: now }],
  };
}

test('startup limit hydrates only the requested files but baselines every discovered source', async (t) => {
  const fixtureDir = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-loader-'));
  t.after(() => fs.rm(fixtureDir, { recursive: true, force: true }));
  const files = await Promise.all(
    ['one.jsonl', 'two.jsonl', 'three.jsonl'].map(async (name, index) => {
      const filePath = path.join(fixtureDir, name);
      await fs.writeFile(filePath, 'x'.repeat(index + 1));
      return filePath;
    })
  );
  let parseCalls = 0;
  const adapter: DiskAdapter = {
    provider: 'claude',
    sessionFileKeys: (filePath) => [path.basename(filePath, '.jsonl')],
    discoverFiles: async () => files,
    parseFile: async (filePath) => {
      parseCalls += 1;
      return parsedSession(filePath);
    },
  };

  const result = await loadAllConversations({ adapters: [adapter], limit: 1 });

  assert.equal(parseCalls, 1);
  assert.equal(result.conversations.size, 1);
  assert.equal(result.mtimes.size, 3);
  for (const filePath of files) assert.equal(result.mtimes.has(filePath), true);
});

test('startup parser respects the aggregate in-flight source byte budget', async (t) => {
  const fixtureDir = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-loader-budget-'));
  t.after(() => fs.rm(fixtureDir, { recursive: true, force: true }));
  const files = await Promise.all(
    ['one.jsonl', 'two.jsonl', 'three.jsonl'].map(async (name) => {
      const filePath = path.join(fixtureDir, name);
      await fs.writeFile(filePath, '1234');
      return filePath;
    })
  );
  let activeParsers = 0;
  let maxActiveParsers = 0;
  const adapter: DiskAdapter = {
    provider: 'claude',
    sessionFileKeys: (filePath) => [path.basename(filePath, '.jsonl')],
    discoverFiles: async () => files,
    parseFile: async (filePath) => {
      activeParsers += 1;
      maxActiveParsers = Math.max(maxActiveParsers, activeParsers);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeParsers -= 1;
      return parsedSession(filePath);
    },
  };

  await loadAllConversations({
    adapters: [adapter],
    concurrency: 3,
    maxInFlightParseBytes: 5,
  });

  assert.equal(maxActiveParsers, 1);
});

test('startup reuses normalized sessions while source identity is unchanged', async (t) => {
  const fixtureDir = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-loader-cache-'));
  t.after(() => fs.rm(fixtureDir, { recursive: true, force: true }));
  const sourcePath = path.join(fixtureDir, 'session.jsonl');
  await fs.writeFile(sourcePath, 'provider-native-events');
  const cache = new NormalizedSessionCache(path.join(fixtureDir, 'cache'));
  let parseCalls = 0;
  const adapter: DiskAdapter = {
    provider: 'claude',
    sessionFileKeys: (filePath) => [path.basename(filePath, '.jsonl')],
    discoverFiles: async () => [sourcePath],
    parseFile: async (filePath) => {
      parseCalls += 1;
      return parsedSession(filePath);
    },
  };

  const first = await loadAllConversations({ adapters: [adapter], cache });
  const second = await loadAllConversations({ adapters: [adapter], cache });

  assert.equal(parseCalls, 1);
  assert.equal(first.conversations.size, 1);
  assert.equal(second.conversations.size, 1);
  assert.ok(second.conversations.get(path.basename(sourcePath))?.createdAt instanceof Date);

  await fs.appendFile(sourcePath, '-changed');
  await loadAllConversations({ adapters: [adapter], cache });
  assert.equal(parseCalls, 2);
});

test('startup drops cache records of deleted sources, but never after a failed discovery', async (t) => {
  // Records for deleted sources were never removed: 13,361 records (787MB) for
  // ~7,700 sources on 2026-09-25. The failed-discovery half guards the obvious
  // regression: one transient readdir error must not wipe a provider's cache.
  const fixtureDir = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-loader-prune-'));
  t.after(() => fs.rm(fixtureDir, { recursive: true, force: true }));
  const kept = path.join(fixtureDir, 'kept.jsonl');
  const deleted = path.join(fixtureDir, 'deleted.jsonl');
  await fs.writeFile(kept, 'a');
  await fs.writeFile(deleted, 'b');
  const cacheDir = path.join(fixtureDir, 'cache');
  const cache = new NormalizedSessionCache(cacheDir);
  let sources = [kept, deleted];
  let codexFails = false;
  const claude: DiskAdapter = {
    provider: 'claude',
    sessionFileKeys: (filePath) => [path.basename(filePath, '.jsonl')],
    discoverFiles: async () => sources,
    parseFile: async (filePath) => parsedSession(filePath),
  };
  const codex: DiskAdapter = {
    provider: 'codex',
    sessionFileKeys: () => [],
    discoverFiles: async () => {
      if (codexFails) throw new Error('transient');
      return [];
    },
    parseFile: async () => null,
  };
  const records = async () => (await fs.readdir(cacheDir)).filter((n) => n.endsWith('.json'));

  await loadAllConversations({ adapters: [claude, codex], cache });
  assert.equal((await records()).length, 2);

  await fs.rm(deleted);
  sources = [kept];
  codexFails = true;
  await loadAllConversations({ adapters: [claude, codex], cache });
  assert.equal((await records()).length, 2, 'a failed discovery must not prune');

  codexFails = false;
  await loadAllConversations({ adapters: [claude, codex], cache });
  assert.equal((await records()).length, 1);
  assert.equal(
    (
      await cache.read({
        provider: 'claude',
        filePath: kept,
        mtimeMs: (await fs.stat(kept)).mtimeMs,
        sizeBytes: 1,
      })
    ).hit,
    true
  );
});

test('startup emits a small first batch before returning to the steady batch size', async (t) => {
  const fixtureDir = await fs.mkdtemp(path.join(tmpdir(), 'unleashd-loader-batches-'));
  t.after(() => fs.rm(fixtureDir, { recursive: true, force: true }));
  const files = await Promise.all(
    Array.from({ length: 18 }, async (_, index) => {
      const filePath = path.join(fixtureDir, `${index}.jsonl`);
      await fs.writeFile(filePath, String(index));
      return filePath;
    })
  );
  const adapter: DiskAdapter = {
    provider: 'claude',
    sessionFileKeys: (filePath) => [path.basename(filePath, '.jsonl')],
    discoverFiles: async () => files,
    parseFile: async (filePath) => parsedSession(filePath),
  };
  const batchSizes: number[] = [];

  await loadAllConversations({
    adapters: [adapter],
    concurrency: 1,
    initialBatchSize: 3,
    batchSize: 10,
    onProgress: (batch) => {
      batchSizes.push(batch.length);
    },
  });

  assert.deepEqual(batchSizes, [3, 10, 5]);
});
