const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const repositoryRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(repositoryRoot, 'vendor');
const buddiesProvenancePath = path.join(vendorRoot, 'nbardy-buddies-0.1.0.provenance.json');
if (!fs.existsSync(buddiesProvenancePath)) {
  throw new Error('Vendored Buddies provenance is missing; run pnpm vendor:buddies');
}
const buddiesProvenance = JSON.parse(fs.readFileSync(buddiesProvenancePath, 'utf8'));
const buddiesArchivePath = path.resolve(repositoryRoot, buddiesProvenance.archive);
if (!buddiesArchivePath.startsWith(`${vendorRoot}${path.sep}`)) {
  throw new Error(`Buddies provenance points outside vendor/: ${buddiesProvenance.archive}`);
}
const buddiesArchiveHash = createHash('sha256')
  .update(fs.readFileSync(buddiesArchivePath))
  .digest('hex');

function archiveFiles(archivePath) {
  const listed = spawnSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
  if (listed.status !== 0) {
    throw new Error(
      `Could not inspect archive ${archivePath}:\n${listed.stdout}\n${listed.stderr}`
    );
  }
  return listed.stdout
    .trim()
    .split('\n')
    .map((entry) => entry.replace(/^package\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .sort();
}

function isRuntimePath(filePath) {
  return (
    /(^|\/)memory(\/|$)/i.test(filePath) ||
    /(^|\/)(?:memory|working_memory|long_term_memory)\.md$/i.test(filePath) ||
    /(^|\/)agent_notes(\/|$)/i.test(filePath) ||
    /(^|\/)provenance(?:\.[^/]+)?\.json$/i.test(filePath)
  );
}

function assertSafeArchive(archivePath, label) {
  const files = archiveFiles(archivePath);
  const forbidden = files.filter(isRuntimePath);
  if (forbidden.length) {
    throw new Error(`${label} contains runtime state or provenance: ${forbidden.join(', ')}`);
  }
  return files;
}

const buddiesArchiveFiles = assertSafeArchive(buddiesArchivePath, 'Vendored Buddies archive');
const buddiesManifest = buddiesProvenance.manifest ?? {};
const expectedBuddiesFiles = buddiesManifest.packedFiles;
if (
  buddiesProvenance.package !== '@nbardy/buddies' ||
  typeof buddiesProvenance.version !== 'string' ||
  buddiesProvenance.schemaVersion !== 2 ||
  buddiesProvenance.reproduciblePack !== true ||
  !/^[0-9a-f]{40}$/i.test(buddiesProvenance.sourceCommit ?? '') ||
  buddiesProvenance.sourceDirty !== false ||
  !Array.isArray(buddiesProvenance.sourceStatus) ||
  buddiesProvenance.sourceStatus.length !== 0 ||
  buddiesProvenance.releaseReady !== true ||
  !Array.isArray(expectedBuddiesFiles) ||
  !Array.isArray(buddiesManifest.packageFiles) ||
  buddiesManifest.packageFiles.some(isRuntimePath) ||
  buddiesManifest.ignoredFiles?.length !== 0 ||
  buddiesManifest.untrackedFiles?.length !== 0 ||
  buddiesManifest.runtimeFiles?.length !== 0 ||
  createHash('sha256').update(JSON.stringify(expectedBuddiesFiles)).digest('hex') !==
    buddiesManifest.sha256 ||
  JSON.stringify(buddiesArchiveFiles) !== JSON.stringify([...expectedBuddiesFiles].sort()) ||
  buddiesArchiveHash !== buddiesProvenance.sha256
) {
  throw new Error(
    'Vendored Buddies archive is dirty, not release-ready, or does not match its provenance record'
  );
}
const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-package-install-'));
const artifactRoot = path.join(installRoot, 'artifacts');
fs.mkdirSync(artifactRoot, { recursive: true });

const packed = spawnSync('npm', ['pack', '--silent', '--pack-destination', artifactRoot], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
if (packed.status !== 0) {
  throw new Error(`npm pack failed:\n${packed.stdout}\n${packed.stderr}`);
}
const tarballName = packed.stdout.trim().split('\n').at(-1);
if (!tarballName) throw new Error('npm pack did not report a tarball');

fs.writeFileSync(
  path.join(installRoot, 'package.json'),
  JSON.stringify({ name: 'unleashd-package-smoke', private: true }),
  'utf8'
);
const installed = spawnSync(
  'npm',
  [
    'install',
    '--ignore-scripts',
    '--omit=optional',
    '--no-audit',
    '--no-fund',
    path.join(artifactRoot, tarballName),
  ],
  { cwd: installRoot, encoding: 'utf8' }
);
if (installed.status !== 0) {
  throw new Error(`clean npm install failed:\n${installed.stdout}\n${installed.stderr}`);
}

const installedPackageRoot = path.join(installRoot, 'node_modules', 'unleashd');
const installedRequire = createRequire(path.join(installedPackageRoot, 'package.json'));
const shared = installedRequire('@unleashd/shared');
const cli = installedRequire('@nbardy/agent-cli');
const buddiesModule = installedRequire('@nbardy/buddies');

if (!shared.ConversationConfigSchema || !cli.executeCommand || !buddiesModule.BuddiesStore) {
  throw new Error('Compiled package exports are missing');
}

const tarballPath = path.join(artifactRoot, tarballName);
const tarballSize = fs.statSync(tarballPath).size;
if (tarballSize > 3_000_000) {
  throw new Error(`Packed artifact unexpectedly exceeds 3 MB: ${tarballSize} bytes`);
}
assertSafeArchive(tarballPath, 'Unleashd package archive');
for (const unwantedPath of [
  'shared',
  path.join('node_modules', '@unleashd', 'shared', 'src'),
  path.join('server', 'dist', 'providers', 'model-validation.js'),
  path.join('client', 'dist', 'icons', 'save-prompt.png'),
]) {
  if (fs.existsSync(path.join(installedPackageRoot, unwantedPath))) {
    throw new Error(`Packed artifact contains obsolete or source-only path: ${unwantedPath}`);
  }
}

const appDataRoot = path.join(installRoot, 'app-data');
let output = '';
let finished = false;
let child = null;
let mcpChild = null;
let timer = null;

function finish(error) {
  if (finished) return;
  finished = true;
  if (timer) clearTimeout(timer);
  child?.kill('SIGTERM');
  mcpChild?.kill('SIGTERM');
  fs.rmSync(installRoot, { recursive: true, force: true });
  if (error) {
    console.error(error);
    process.exitCode = 1;
  } else {
    console.log('Compiled package and plain-node server smoke passed');
  }
}

/**
 * The source-mode MCP regression is necessary but cannot prove the npm artifact
 * contains a runnable compiled entrypoint. Exercise the installed JS over its
 * real newline-delimited stdio protocol before accepting the package. See
 * agent_notes/2026-08-24_automation-execution-ownership-design.md §13/10.
 */
function verifyInstalledMcpEntrypoint() {
  return new Promise((resolve, reject) => {
    const entrypoint = path.join(
      installedPackageRoot,
      'server',
      'dist',
      'buddies',
      'mcp-server.js'
    );
    if (!fs.existsSync(entrypoint)) {
      reject(new Error(`Packed Buddy MCP entrypoint is missing: ${entrypoint}`));
      return;
    }
    let stderr = '';
    let stdout = '';
    const timeout = setTimeout(() => {
      mcpChild?.kill('SIGTERM');
      reject(new Error(`Packed Buddy MCP handshake timed out:\n${stderr}`));
    }, 10_000);
    const settle = (error) => {
      clearTimeout(timeout);
      mcpChild?.kill('SIGTERM');
      mcpChild = null;
      error ? reject(error) : resolve();
    };
    mcpChild = spawn(
      process.execPath,
      [entrypoint, '--builder', '--conversation', 'package-smoke'],
      {
        cwd: installedPackageRoot,
        env: {
          ...process.env,
          HOME: appDataRoot,
          BUDDIES_HOME: path.join(appDataRoot, 'buddies'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    mcpChild.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    mcpChild.stdout.on('data', (chunk) => {
      stdout += chunk;
      while (stdout.includes('\n')) {
        const newline = stdout.indexOf('\n');
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          settle(new Error(`Packed Buddy MCP emitted invalid JSON: ${line}`, { cause: error }));
          return;
        }
        if (message.id === 1) {
          mcpChild?.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
          );
          mcpChild?.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`
          );
        } else if (message.id === 2) {
          const names = message.result?.tools?.map((tool) => tool.name) ?? [];
          settle(
            names.includes('create_buddy') && names.includes('list_workspaces')
              ? null
              : new Error(`Packed Buddy MCP tools are invalid: ${JSON.stringify(names)}`)
          );
        }
      }
    });
    mcpChild.on('exit', (code) => {
      if (mcpChild) settle(new Error(`Packed Buddy MCP exited with ${code}:\n${stderr}`));
    });
    mcpChild.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'unleashd-package-smoke', version: '1.0.0' },
        },
      })}\n`
    );
  });
}

function requestJson(port, requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: requestPath }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        try {
          resolve({
            status: response.statusCode,
            body: body ? JSON.parse(body) : null,
          });
        } catch (error) {
          reject(new Error(`Invalid JSON from ${requestPath}: ${body}`, { cause: error }));
        }
      });
    });
    request.on('error', reject);
  });
}

async function verifyInstalledServer(port) {
  const catalog = await requestJson(port, '/api/provider-catalog');
  if (
    catalog.status !== 200 ||
    typeof catalog.body?.revision !== 'string' ||
    !Array.isArray(catalog.body?.providers)
  ) {
    throw new Error(`Packed provider catalog is invalid: ${JSON.stringify(catalog)}`);
  }

  const buddies = await requestJson(port, '/api/buddies');
  if (buddies.status !== 200 || !Array.isArray(buddies.body?.buddies)) {
    throw new Error(`Bundled Buddies package is unavailable: ${JSON.stringify(buddies)}`);
  }
}

function startInstalledServer(port) {
  child = spawn(process.execPath, ['server/dist/server.js'], {
    cwd: installedPackageRoot,
    env: {
      ...process.env,
      HOME: appDataRoot,
      UNLEASHD_DATA_DIR: appDataRoot,
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  timer = setTimeout(
    () => finish(new Error(`Compiled server startup timed out:\n${output}`)),
    10_000
  );

  let verifying = false;
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (!verifying && output.includes('Server running')) {
      verifying = true;
      void verifyInstalledServer(port).then(() => finish(), finish);
    }
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  child.on('exit', (code) => {
    if (!finished) finish(new Error(`Compiled server exited with ${code}:\n${output}`));
  });
}

void verifyInstalledMcpEntrypoint().then(() => {
  const portProbe = net.createServer();
  portProbe.on('error', finish);
  portProbe.listen(0, '127.0.0.1', () => {
    const address = portProbe.address();
    if (!address || typeof address === 'string') {
      finish(new Error('Could not allocate a test port'));
      return;
    }
    portProbe.close(() => startInstalledServer(address.port));
  });
}, finish);
