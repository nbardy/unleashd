import assert from 'node:assert/strict';
import test from 'node:test';
import { formatToolUse, isCompletionOnlyToolUse } from '../src/turns/tool-format';

// The `oompa <sub> ::` marker is what client/src/utils/structured-message-segments.ts
// matches to render a swarm launch; the raw command alone is truncated and wrapped
// (env prefixes, sh -c) past what that pattern recognises. Assert on the marker, not
// on "oompa run" appearing somewhere — the raw command always contains that.

test('formatToolUse marks oompa launches through env prefixes, shell wrappers, chains and paths', () => {
  const cases: Array<[string, string]> = [
    ['env -u CLAUDECODE -u CLAUDECODE_SESSION_ID oompa swarm oompa/oompa.spark4.json', 'swarm'],
    [`bash -lc 'env FOO=1 oompa run oompa/oompa.spark4.json'`, 'run'],
    ['echo pre && env FOO=bar oompa swarm oompa/oompa.spark4.json', 'swarm'],
    ['/usr/local/bin/oompa run oompa/oompa.spark4.json; echo done', 'run'],
    [`sh -c "env -u A -u B /opt/bin/oompa swarm oompa/oompa.spark4.json"`, 'swarm'],
  ];
  for (const [command, subcommand] of cases) {
    const line = formatToolUse('shell', { command });
    assert.ok(line.startsWith('⚡ shell '), `Unexpected shell prefix: ${line}`);
    assert.ok(line.includes(`oompa ${subcommand} ::`), `No launch marker for ${command}: ${line}`);
  }
});

test('formatToolUse does not mark status, dry-run or help oompa commands as launches', () => {
  for (const command of [
    'oompa status',
    'oompa run --dry-run --config oompa/oompa.spark4.json',
    'oompa swarm --help',
  ]) {
    const line = formatToolUse('shell', { command });
    assert.ok(!line.includes(' :: '), `Should not classify as a launch: ${line}`);
  }
});

test('formatToolUse falls back to displayText command for shell tools', () => {
  const line = formatToolUse('shell', {}, 'env -u CLAUDECODE oompa run oompa/oompa.spark4.json');
  assert.ok(line.includes('oompa run ::'), `Expected oompa run marker from displayText: ${line}`);
});

test('isCompletionOnlyToolUse suppresses codex completion-only shell events', () => {
  assert.equal(
    isCompletionOnlyToolUse('shell', { command: 'ls -la', exit_code: 0 }, undefined),
    true
  );
  assert.equal(isCompletionOnlyToolUse('shell', { exit_code: 0 }, 'ls -la'), false);
  assert.equal(isCompletionOnlyToolUse('Bash', { exit_code: 0 }, undefined), false);
});
