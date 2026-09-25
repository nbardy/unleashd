/**
 * Packaging smoke: the BUILT server (server/dist) runs with its napi addons on a first-time
 * data dir. Run after `pnpm build` (`pnpm test:package` does both).
 *
 * Why: the tsx test suites load crates/* through the workspace symlinks the same way, but never
 * execute `server/dist/server.js`. A tsc output layout change, a `.node` that `napi build` put
 * somewhere else, or an addon missing from server/package.json only shows up when `pnpm start`
 * fails. Replaces test/package-smoke.js, deleted in 6ba123c with the vendored Buddies package.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const ADDONS = ['@unleashd/buddies-core', '@unleashd/ingest'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Each addon resolves FROM server/ (as server/dist requires it) and its `.node` is built. */
function checkAddons() {
  for (const name of ADDONS) {
    const manifest = require.resolve(`${name}/package.json`, { paths: [SERVER_DIR] });
    const binary = path.join(path.dirname(manifest), `${require(manifest).napi.binaryName}.node`);
    assert(fs.existsSync(binary), `${name}: ${binary} is missing (run pnpm addons)`);
    console.log(`ok addon ${name} -> ${path.relative(ROOT, binary)}`);
  }
}

function sparePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startBuiltServer(dataDir, port) {
  const child = spawn(process.execPath, [path.join(SERVER_DIR, 'dist', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, HOME: dataDir, UNLEASHD_DATA_DIR: dataDir, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no "Initial load complete" in 20s:\n${log}`)),
      20_000
    );
    const onData = (chunk) => {
      log += chunk;
      if (log.includes('Initial load complete')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`built server exited ${code}:\n${log}`)));
  });
  return { child, ready };
}

async function main() {
  assert(
    fs.existsSync(path.join(SERVER_DIR, 'dist', 'server.js')),
    'server/dist missing: pnpm build'
  );
  assert(fs.existsSync(path.join(ROOT, 'client', 'dist', 'index.html')), 'client/dist missing');
  checkAddons();

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-package-'));
  const port = await sparePort();
  const { child, ready } = startBuiltServer(dataDir, port);
  const base = `http://127.0.0.1:${port}`;
  try {
    await ready;
    const catalog = await fetch(`${base}/api/provider-catalog`);
    assert(catalog.ok, `provider catalog: HTTP ${catalog.status}`);
    assert((await fetch(base)).ok, 'the built client is not served at /');
    // A Buddies write and read go through buddies-core on a fresh DB (first-time install).
    const created = await fetch(`${base}/api/buddies/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke', rootPath: dataDir }),
    });
    assert(
      created.status === 201,
      `create workspace: HTTP ${created.status} ${await created.text()}`
    );
    const overview = await (await fetch(`${base}/api/buddies/overview`)).json();
    assert(
      overview.some((workspace) => workspace.name === 'Smoke'),
      'workspace not read back'
    );
    console.log('ok built server: catalog, client, Buddies write + read');
  } finally {
    // Wait for exit before deleting the data dir the server still writes to.
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`package smoke failed: ${error.message}`);
    process.exit(1);
  }
);
