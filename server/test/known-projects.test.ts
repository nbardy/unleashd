import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createKnownProjectAuthorizer } from '../src/http/known-projects';

test('known-project authorizer rejects sibling prefix collisions and traversal', () => {
  const projectRoot = path.resolve('/workspace/project');
  const isUnderKnownProject = createKnownProjectAuthorizer(() => [projectRoot]);

  assert.equal(isUnderKnownProject(path.resolve('/workspace/project-secret')), false);
  assert.equal(isUnderKnownProject(path.resolve(projectRoot, '..', 'outside')), false);
});

test('known-project authorizer reads fresh roots for every request', () => {
  const roots = new Set([path.resolve('/workspace/first')]);
  const isUnderKnownProject = createKnownProjectAuthorizer(() => roots);

  assert.equal(isUnderKnownProject(path.resolve('/workspace/second/file.ts')), false);
  roots.add(path.resolve('/workspace/second'));
  assert.equal(isUnderKnownProject(path.resolve('/workspace/second/file.ts')), true);
});
