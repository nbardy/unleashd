import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { WebSocket } from 'ws';
import { resolveAuthPolicy } from '../src/auth/policy';

/**
 * Boots the real server process with a shared secret configured and probes it
 * over real sockets. The point is the wiring, not the helpers: a unit test of
 * `decideAuth` would still pass if someone mounted the gate after the routes,
 * or restored `new WebSocketServer({ server })` and made every upgrade public
 * again.
 */

const PORT = 7527;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'f4c1a9e2b7d60358f4c1a9e2b7d60358';

let serverProcess: ChildProcess | null = null;
let dataDirectory = '';

function startServer(): Promise<void> {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-auth-'));
  // The conventional token path is the documented default — exercise it rather
  // than the env var, which is the discouraged option.
  fs.writeFileSync(path.join(dataDirectory, 'auth-token'), `${TOKEN}\n`, 'utf8');
  const shimDirectory = path.join(dataDirectory, 'bin');
  fs.mkdirSync(shimDirectory, { recursive: true });
  const shim = path.join(shimDirectory, 'claude');
  fs.writeFileSync(shim, '#!/bin/sh\nexit 0\n', 'utf8');
  fs.chmodSync(shim, 0o755);

  return new Promise((resolve, reject) => {
    serverProcess = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        HOME: dataDirectory,
        PATH: `${shimDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        PORT: String(PORT),
        UNLEASHD_DATA_DIR: dataDirectory,
        UNLEASHD_AUTH_TOKEN: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => reject(new Error('server did not start in 30s')), 30_000);
    serverProcess.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Server running')) {
        clearTimeout(timer);
        setTimeout(resolve, 300);
      }
    });
    serverProcess.stderr?.on('data', (chunk: Buffer) => {
      console.error('[server]', chunk.toString().trim());
    });
    serverProcess.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function stopServer(): Promise<void> {
  const child = serverProcess;
  serverProcess = null;
  if (child) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
  if (dataDirectory) fs.rmSync(dataDirectory, { recursive: true, force: true });
}

function connectWebSocket(headers: Record<string, string>): Promise<'open' | 'rejected'> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
    const timer = setTimeout(() => {
      socket.terminate();
      resolve('rejected');
    }, 5_000);
    socket.on('open', () => {
      clearTimeout(timer);
      socket.close();
      resolve('open');
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve('rejected');
    });
  });
}

describe('shared-secret auth (real server)', () => {
  before(startServer);
  after(stopServer);

  test('API data is not served without a credential', async () => {
    const response = await fetch(`${BASE}/api/provider-catalog`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'unauthorized',
      message: 'Missing or invalid access key',
    });
  });

  test('bearer token unlocks the API', async () => {
    const response = await fetch(`${BASE}/api/provider-catalog`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.status, 200);
  });

  test('a wrong key of a different length is rejected, not a crash', async () => {
    // timingSafeEqual throws on unequal buffer lengths; comparing SHA-256
    // digests is what keeps this a 401 instead of a 500.
    for (const wrong of ['x', `${TOKEN}extra`, TOKEN.replace('f', 'a')]) {
      const response = await fetch(`${BASE}/api/provider-catalog`, {
        headers: { authorization: `Bearer ${wrong}` },
      });
      assert.equal(response.status, 401, `expected 401 for ${wrong.slice(0, 8)}…`);
    }
  });

  test('the app shell itself is gated and answers with a login form', async () => {
    const response = await fetch(BASE, { headers: { accept: 'text/html' } });
    assert.equal(response.status, 401);
    const body = await response.text();
    assert.match(body, /action="\/__auth\/login"/);
    assert.match(body, /Enter your access key to continue/);
  });

  test('?token= establishes a cookie and strips itself from the URL', async () => {
    const response = await fetch(`${BASE}/?token=${TOKEN}`, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.match(cookie, /unleashd_auth=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);

    const withCookie = await fetch(`${BASE}/api/provider-catalog`, {
      headers: { cookie: `unleashd_auth=${TOKEN}` },
    });
    assert.equal(withCookie.status, 200);
  });

  test('the login form exchanges the key for a cookie', async () => {
    const response = await fetch(`${BASE}/__auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN, redirectTo: '/chat/abc' }).toString(),
      redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/chat/abc');
    assert.match(response.headers.get('set-cookie') ?? '', /unleashd_auth=/);

    const rejected = await fetch(`${BASE}/__auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: 'not-the-key-at-all' }).toString(),
      redirect: 'manual',
    });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.headers.get('set-cookie'), null);
  });

  test('GET /__auth/login answers 200, so a 401 redirect cannot loop', async () => {
    // The client redirects here on any 401. If this path were itself gated the
    // browser would bounce between 401 and redirect forever.
    const response = await fetch(`${BASE}/__auth/login?redirectTo=/chat/xyz`, {
      headers: { accept: 'text/html' },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /name="redirectTo" value="\/chat\/xyz"/);
  });

  test('a crafted redirectTo cannot turn the form into an open redirect', async () => {
    const response = await fetch(`${BASE}/__auth/login?redirectTo=//evil.example.com`, {
      headers: { accept: 'text/html' },
    });
    const body = await response.text();
    assert.match(body, /name="redirectTo" value="\/"/);
    assert.doesNotMatch(body, /evil\.example\.com/);
  });

  test('the JSON login path tells a wrong key apart from an unreachable server', async () => {
    // The form submits with Accept: application/json precisely so it can show
    // "Invalid access key" inline instead of reloading the whole page. A plain
    // 302/HTML response would collapse that distinction.
    const rejected = await fetch(`${BASE}/__auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ token: 'wrong-key-entirely' }).toString(),
    });
    assert.equal(rejected.status, 401);
    assert.deepEqual(await rejected.json(), { ok: false, error: 'invalid_key' });
    assert.equal(rejected.headers.get('set-cookie'), null);

    const accepted = await fetch(`${BASE}/__auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ token: TOKEN, redirectTo: '/buddies' }).toString(),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { ok: true, redirectTo: '/buddies' });
    assert.match(accepted.headers.get('set-cookie') ?? '', /unleashd_auth=/);
  });

  test('the session cookie is persistent, not a session cookie', async () => {
    // Dropping Max-Age turns this into a session cookie, and the only symptom
    // is "my phone makes me sign in again every day" — which is nearly
    // untraceable after the fact. Pin the durability here.
    const response = await fetch(`${BASE}/__auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // What `tailscale serve` sends; it is what makes the cookie Secure.
        'x-forwarded-proto': 'https',
      },
      body: new URLSearchParams({ token: TOKEN }).toString(),
      redirect: 'manual',
    });
    const cookie = response.headers.get('set-cookie') ?? '';

    const maxAge = Number(cookie.match(/Max-Age=(\d+)/)?.[1] ?? '0');
    assert.ok(maxAge >= 60 * 60 * 24 * 30, `Max-Age must outlast a month, got ${maxAge}s`);
    // Chrome silently clamps anything past 400 days.
    assert.ok(maxAge <= 60 * 60 * 24 * 400, `Max-Age must stay under Chrome's 400-day clamp`);

    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Secure/);
    // Strict would withhold the cookie when the app is opened from a link in
    // another app, producing a spurious login prompt.
    assert.match(cookie, /SameSite=Lax/);
  });

  test('the cookie is not marked Secure on a plain-http origin', async () => {
    // A Secure cookie is dropped outright over http, so the loopback/LAN dev
    // path would silently never stay signed in.
    const response = await fetch(`${BASE}/__auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: TOKEN }).toString(),
      redirect: 'manual',
    });
    const cookie = response.headers.get('set-cookie') ?? '';
    assert.doesNotMatch(cookie, /Secure/);
    assert.match(cookie, /Max-Age=\d+/);
  });

  test('the WebSocket command channel refuses unauthenticated upgrades', async () => {
    assert.equal(await connectWebSocket({}), 'rejected');
    assert.equal(await connectWebSocket({ cookie: 'unleashd_auth=wrong' }), 'rejected');
    assert.equal(await connectWebSocket({ cookie: `unleashd_auth=${TOKEN}` }), 'open');
  });
});

describe('auth policy resolution', () => {
  const noFiles = () => {
    throw new Error('ENOENT');
  };

  test('refuses to start when bound off-loopback with no token', () => {
    // The whole point of the feature: exposing the port must not be possible
    // by accident. A regression here reintroduces the original audit finding.
    const resolution = resolveAuthPolicy({
      env: {},
      listenHost: '0.0.0.0',
      dataDirectory: '/nonexistent',
      readFile: noFiles,
    });
    assert.equal(resolution.ok, false);
    assert.match(resolution.ok ? '' : resolution.error, /Refusing to listen on 0\.0\.0\.0/);
  });

  test('loopback without a token stays open so localhost dev keeps working', () => {
    const resolution = resolveAuthPolicy({
      env: {},
      listenHost: '127.0.0.1',
      dataDirectory: '/nonexistent',
      readFile: noFiles,
    });
    assert.equal(resolution.ok, true);
    assert.deepEqual(resolution.ok && resolution.policy, {
      kind: 'open',
      reason: 'loopback-without-token',
    });
  });

  test('a too-short token is a startup error, not a weak accepted secret', () => {
    const resolution = resolveAuthPolicy({
      env: { UNLEASHD_AUTH_TOKEN: 'hunter2' },
      listenHost: '127.0.0.1',
      dataDirectory: '/nonexistent',
      readFile: noFiles,
    });
    assert.equal(resolution.ok, false);
    assert.match(resolution.ok ? '' : resolution.error, /at least 16/);
  });

  test('opting out off-loopback requires the explicit flag', () => {
    const resolution = resolveAuthPolicy({
      env: { UNLEASHD_AUTH_DISABLED: '1' },
      listenHost: '0.0.0.0',
      dataDirectory: '/nonexistent',
      readFile: noFiles,
    });
    assert.equal(resolution.ok, true);
    assert.deepEqual(resolution.ok && resolution.policy, {
      kind: 'open',
      reason: 'explicitly-disabled',
    });
  });
});
