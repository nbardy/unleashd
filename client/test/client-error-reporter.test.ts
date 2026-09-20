import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientErrorReporter } from '../src/observability/client-error-reporter';

test('client error reporter suppresses duplicate delivery paths and caps each window', () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let timestamp = 1_000;
  const report = createClientErrorReporter({
    fetcher: ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Promise.resolve(new Response(null, { status: 202 }));
    }) as typeof fetch,
    now: () => timestamp,
    route: () => '/chat/example',
    maxReports: 2,
    windowMs: 60_000,
    duplicateWindowMs: 1_000,
  });
  const error = new Error('Render failed');

  assert.equal(report({ source: 'react-uncaught', error }), true);
  assert.equal(report({ source: 'browser-error', error }), false);
  timestamp += 1_001;
  assert.equal(report({ source: 'browser-error', error }), true);
  assert.equal(report({ source: 'unhandled-rejection', error: 'third failure' }), false);

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, '/api/diagnostics/errors/client');
  const payload = JSON.parse(String(requests[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(payload.source, 'react-uncaught');
  assert.equal(payload.message, 'Render failed');
  assert.equal(payload.route, '/chat/example');
  assert.match(String(payload.stack), /Error: Render failed/);
});

test('client error reporter never exposes a rejected reporting request', async () => {
  const report = createClientErrorReporter({
    fetcher: (() => Promise.reject(new Error('server offline'))) as typeof fetch,
    route: () => '/',
  });

  assert.equal(report({ source: 'unhandled-rejection', error: 'original failure' }), true);
  await new Promise((resolve) => setImmediate(resolve));
});

test('client error reporter contains synchronous reporting failures', () => {
  const report = createClientErrorReporter({
    fetcher: (() => {
      throw new Error('invalid request setup');
    }) as typeof fetch,
    route: () => '/',
  });

  assert.doesNotThrow(() => report({ source: 'browser-error', error: 'original failure' }));
});

test('client error reporter does not serialize arbitrary rejection objects', () => {
  const requests: RequestInit[] = [];
  const report = createClientErrorReporter({
    fetcher: ((_url: string | URL | Request, init?: RequestInit) => {
      if (init) requests.push(init);
      return Promise.resolve(new Response(null, { status: 202 }));
    }) as typeof fetch,
    route: () => '/',
  });

  report({
    source: 'unhandled-rejection',
    error: { token: 'must-not-be-serialized', nested: { private: true } },
  });

  const payload = JSON.parse(String(requests[0]?.body)) as Record<string, unknown>;
  assert.equal(payload.message, 'Non-Error object thrown by the client');
  assert.doesNotMatch(String(requests[0]?.body), /must-not-be-serialized|private/);
});
