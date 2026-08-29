import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configuredSourceRoot = process.env.BUDDIES_SOURCE_DIR;
const sourceCandidates = configuredSourceRoot
  ? [configuredSourceRoot]
  : [
      join(repositoryRoot, '..', 'buddies'),
      join(repositoryRoot, '..', '..', 'buddies'),
      join(repositoryRoot, '..', '..', '..', 'buddies'),
    ];
const sourceRoot = resolve(
  sourceCandidates.find((candidate) => existsSync(join(candidate, 'package.json'))) ??
    sourceCandidates[0]
);
const allowUncommitted = process.argv.includes('--allow-uncommitted');

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed in ${cwd}\n${result.stdout}\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function npmManifest(cwd) {
  const output = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], cwd);
  const manifests = JSON.parse(output);
  if (!Array.isArray(manifests) || manifests.length !== 1 || !Array.isArray(manifests[0].files)) {
    throw new Error('npm pack dry-run did not return one manifest with files');
  }
  return manifests[0];
}

function archiveFiles(path) {
  return run('tar', ['-tzf', path], repositoryRoot)
    .split('\n')
    .map((entry) => entry.replace(/^package\//, '').replace(/\/$/, ''))
    .filter(Boolean)
    .sort();
}

function isRuntimePath(path) {
  return (
    /(^|\/)memory(\/|$)/i.test(path) ||
    /(^|\/)(?:memory|working_memory|long_term_memory)\.md$/i.test(path) ||
    /(^|\/)agent_notes(\/|$)/i.test(path) ||
    /(^|\/)provenance(?:\.[^/]+)?\.json$/i.test(path)
  );
}

function isIgnored(path) {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '--', path], {
    cwd: sourceRoot,
  });
  return result.status === 0;
}

function validateManifest(manifest, trackedPaths) {
  const packedFiles = manifest.files.map((file) => file.path).sort();
  const ignoredFiles = packedFiles.filter((path) => isIgnored(path));
  const untrackedFiles = packedFiles.filter((path) => !trackedPaths.has(path));
  const runtimeFiles = packedFiles.filter(isRuntimePath);

  if (ignoredFiles.length || untrackedFiles.length || runtimeFiles.length) {
    throw new Error(
      `Buddies package manifest contains forbidden files: ${JSON.stringify({
        ignoredFiles,
        untrackedFiles,
        runtimeFiles,
      })}`
    );
  }

  return {
    packageFiles: Array.isArray(packageJson.files) ? packageJson.files : [],
    packedFiles,
    ignoredFiles,
    untrackedFiles,
    runtimeFiles,
    sha256: sha256Json(packedFiles),
  };
}

const packageJson = JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
if (packageJson.name !== '@nbardy/buddies') {
  throw new Error(
    `Expected @nbardy/buddies source, found ${packageJson.name ?? 'unnamed package'}`
  );
}

const gitStatus = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], sourceRoot);
const sourceStatus = gitStatus ? gitStatus.split('\n') : [];
const sourceDirty = sourceStatus.length > 0;
const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: sourceRoot,
  encoding: 'utf8',
});
const sourceCommit = commitResult.status === 0 ? commitResult.stdout.trim() : null;

if ((!sourceCommit || sourceDirty) && !allowUncommitted) {
  throw new Error(
    'Buddies source must have a clean commit before release packaging. ' +
      'Use --allow-uncommitted only for an explicitly non-release local snapshot.'
  );
}

const trackedPaths = new Set(
  run('git', ['ls-files', '-z'], sourceRoot).split('\0').filter(Boolean)
);
const manifest = validateManifest(npmManifest(sourceRoot), trackedPaths);

const firstPackRoot = mkdtempSync(join(tmpdir(), 'unleashd-buddies-pack-a-'));
const secondPackRoot = mkdtempSync(join(tmpdir(), 'unleashd-buddies-pack-b-'));

try {
  const firstName = run(
    'npm',
    ['pack', '--silent', '--pack-destination', firstPackRoot],
    sourceRoot
  )
    .split('\n')
    .at(-1);
  const secondName = run(
    'npm',
    ['pack', '--silent', '--pack-destination', secondPackRoot],
    sourceRoot
  )
    .split('\n')
    .at(-1);
  if (!firstName || !secondName || firstName !== secondName) {
    throw new Error('npm pack did not produce one stable archive name');
  }

  const firstArchive = join(firstPackRoot, firstName);
  const secondArchive = join(secondPackRoot, secondName);
  const firstHash = sha256(firstArchive);
  const secondHash = sha256(secondArchive);
  if (firstHash !== secondHash) {
    throw new Error(`Buddies package is not reproducible: ${firstHash} != ${secondHash}`);
  }

  const firstArchiveFiles = archiveFiles(firstArchive);
  if (sha256Json(firstArchiveFiles) !== manifest.sha256) {
    throw new Error('npm pack archive contents do not match its dry-run manifest');
  }

  const destination = join(repositoryRoot, 'vendor', firstName);
  copyFileSync(firstArchive, destination);
  const provenancePath = join(
    repositoryRoot,
    'vendor',
    `${basename(firstName, '.tgz')}.provenance.json`
  );
  writeFileSync(
    provenancePath,
    `${JSON.stringify(
      {
        schemaVersion: 2,
        package: packageJson.name,
        version: packageJson.version,
        archive: `vendor/${firstName}`,
        sha256: firstHash,
        reproduciblePack: true,
        sourceCommit,
        sourceDirty,
        sourceStatus,
        manifest,
        releaseReady: Boolean(sourceCommit) && !sourceDirty,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        archive: destination,
        sha256: firstHash,
        sourceCommit,
        sourceDirty,
        releaseReady: Boolean(sourceCommit) && !sourceDirty,
      },
      null,
      2
    )
  );
} finally {
  rmSync(firstPackRoot, { recursive: true, force: true });
  rmSync(secondPackRoot, { recursive: true, force: true });
}
