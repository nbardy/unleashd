import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discardCursorTranscript } from '../src/buddies/detached-cli';

// Regression: the first version removed only agent-transcripts/<sessionId>, so
// every Cursor reply gate / memory review leaked its project dir, including
// agent-tools/*.txt holding raw Buddy memory tool output (7 found on 2026-09-25).
test('discarding the only Cursor run in a private cwd removes its whole project dir and nothing else', () => {
  const projects = mkdtempSync(join(tmpdir(), 'cursor-projects-'));
  const run = join(projects, 'private-var-folders-T-unleashd-memory-review-abc');
  mkdirSync(join(run, 'agent-transcripts', 'session-1'), { recursive: true });
  mkdirSync(join(run, 'agent-tools'));
  writeFileSync(join(run, 'agent-tools', 'memory-search.txt'), 'private memory');
  const other = join(projects, 'Users-me-git-repo');
  mkdirSync(join(other, 'agent-transcripts', 'session-2'), { recursive: true });

  discardCursorTranscript('session-1', projects);

  assert.equal(existsSync(run), false);
  assert.equal(existsSync(join(other, 'agent-transcripts', 'session-2')), true);
});

// The memory reviewer runs in the Buddy's workspace root (2026-09-26), whose Cursor project dir
// also holds the owner's own sessions: removing the whole dir there would erase their history.
test('discarding a Cursor run in a shared workspace removes only its transcript and spills', () => {
  const projects = mkdtempSync(join(tmpdir(), 'cursor-projects-'));
  const repo = join(projects, 'Users-me-git-repo');
  mkdirSync(join(repo, 'agent-transcripts', 'review-1'), { recursive: true });
  mkdirSync(join(repo, 'agent-transcripts', 'owner-1'), { recursive: true });
  mkdirSync(join(repo, 'agent-tools'));
  writeFileSync(
    join(repo, 'agent-transcripts', 'review-1', 'review-1.jsonl'),
    `{"path":"${repo}/agent-tools/aa-11.txt"}\n`
  );
  writeFileSync(join(repo, 'agent-tools', 'aa-11.txt'), 'private memory');
  writeFileSync(join(repo, 'agent-tools', 'bb-22.txt'), 'owner tool output');

  discardCursorTranscript('review-1', projects);

  assert.equal(existsSync(join(repo, 'agent-transcripts', 'review-1')), false);
  assert.equal(existsSync(join(repo, 'agent-tools', 'aa-11.txt')), false);
  assert.equal(existsSync(join(repo, 'agent-transcripts', 'owner-1')), true);
  assert.equal(existsSync(join(repo, 'agent-tools', 'bb-22.txt')), true);
});
