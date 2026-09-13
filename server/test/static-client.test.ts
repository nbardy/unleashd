import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { registerStaticClient } from '../src/lifecycle/static-client';

test('missing API routes return JSON while Buddy navigation receives the SPA', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'unleashd-static-'));
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Unleashd</title>');
  const app = express();
  app.get('/api/available', (_req, res) => res.json({ ok: true }));
  registerStaticClient(app, directory);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const missing = await fetch(`${base}/api/buddies/example/coordination`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await missing.json(), { error: 'API endpoint unavailable on this server.' });
    assert.deepEqual(await (await fetch(`${base}/api/available`)).json(), { ok: true });
    const page = await fetch(`${base}/buddies/example/identity`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<!doctype html>/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await rm(directory, { recursive: true, force: true });
  }
});
