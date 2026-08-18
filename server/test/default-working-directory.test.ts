import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveDefaultWorkingDirectory } from '../src/http/path-utils';

/**
 * Regression guard for the 2026-08-18 buddy-creation failure.
 *
 * The dev supervisor spawns the server with `cwd: <repo>/server`
 * (tools/watch-server.mjs), so a default workspace taken from `process.cwd()`
 * put every Buddy Builder conversation in the server PACKAGE directory. The
 * agent then read repo-root-relative paths — `server/src/buddies/...` — which
 * resolved to `<repo>/server/server/src/buddies/...` and failed with
 * "No such file or directory (os error 2)" on its first read_file.
 *
 * Production runs from the repo root, so cwd differed between dev and prod and
 * this only ever reproduced in dev.
 */

const REPO = '/work/unleashd';
const workspaceMarker = path.join(REPO, 'pnpm-workspace.yaml');

// Only the repo root carries the workspace marker.
const onlyRepoRoot = (candidate: string) => candidate === workspaceMarker;
const noMarkerAnywhere = () => false;

test('climbs out of the server package to the workspace root', () => {
  // The exact failing configuration: dev server cwd is <repo>/server.
  assert.equal(
    resolveDefaultWorkingDirectory({}, path.join(REPO, 'server'), onlyRepoRoot),
    REPO
  );
});

test('a cwd already at the workspace root is unchanged', () => {
  assert.equal(resolveDefaultWorkingDirectory({}, REPO, onlyRepoRoot), REPO);
});

test('UNLEASHD_DEFAULT_CWD overrides the workspace root', () => {
  assert.equal(
    resolveDefaultWorkingDirectory(
      { UNLEASHD_DEFAULT_CWD: '/work/elsewhere' },
      path.join(REPO, 'server'),
      onlyRepoRoot
    ),
    '/work/elsewhere'
  );
});

test('falls back to cwd outside a workspace — a global install keeps old behaviour', () => {
  assert.equal(
    resolveDefaultWorkingDirectory({}, '/opt/unleashd/server', noMarkerAnywhere),
    '/opt/unleashd/server'
  );
});

test('does not climb past the search depth into an unrelated parent', () => {
  // A marker far above an unrelated cwd must not capture it: /a/b/c/d/e/f is
  // more than WORKSPACE_SEARCH_DEPTH below /a.
  const farMarker = (candidate: string) => candidate === '/a/pnpm-workspace.yaml';
  assert.equal(resolveDefaultWorkingDirectory({}, '/a/b/c/d/e/f', farMarker), '/a/b/c/d/e/f');
});
