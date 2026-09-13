import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '@unleashd/shared';
import { mergeSessionMessages } from '../src/lifecycle/session-history';

function message(role: Message['role'], content: string, offset: number): Message {
  return { role, content, timestamp: new Date(Date.UTC(2026, 8, 12) + offset) };
}

test('missing middle sessions survive while native turns replace live rows with shifted timestamps', () => {
  const a = [message('user', 'First question', 0), message('assistant', 'First answer', 1)];
  const b = [
    message('user', 'Middle question', 600_000),
    message('assistant', 'Middle answer', 600_001),
  ];
  const liveC = [
    message('user', 'Current question', 1_200_000),
    message('assistant', 'Live answer', 1_200_001),
  ];
  const nativeC = [
    message('user', 'Current question', 1_290_000),
    message('assistant', 'Native final answer', 1_290_001),
  ];
  const fallback = [...a, ...b, ...liveC];
  assert.deepEqual(mergeSessionMessages([a, nativeC], fallback), [...a, ...b, ...nativeC]);
  // A later native transcript may include an inherited prefix with a gap.
  assert.deepEqual(mergeSessionMessages([a, [...a, ...nativeC]], fallback), [
    ...a,
    ...b,
    ...nativeC,
  ]);
  assert.deepEqual(fallback, [...a, ...b, ...liveC], 'the runtime input remains untouched');
});

test('identical prompts use ordered nearest turns and preserve genuinely missing occurrences', () => {
  const first = [message('user', 'Continue', 0), message('assistant', 'First', 1)];
  const middle = [message('user', 'Continue', 600_000), message('assistant', 'Middle', 600_001)];
  const last = [message('user', 'Continue', 1_200_000), message('assistant', 'Last', 1_200_001)];
  const nativeLast = last.map((entry) => ({
    ...entry,
    timestamp: new Date(entry.timestamp.getTime() + 10),
  }));
  assert.deepEqual(mergeSessionMessages([first, nativeLast], [...first, ...middle, ...last]), [
    ...first,
    ...middle,
    ...nativeLast,
  ]);
  assert.deepEqual(mergeSessionMessages([nativeLast], first), [...first, ...nativeLast]);
});

test('exact inherited rows deduplicate without collapsing repeated tool occurrences', () => {
  const user = message('user', 'Inspect', 0);
  const tool = { ...message('assistant', '', 1), toolCall: { name: 'read', input: 'a.txt' } };
  const otherInput = { ...tool, toolCall: { name: 'read', input: 'b.txt' } };
  const next = message('assistant', 'Done', 2);
  const original = [user, tool, { ...tool }, otherInput];
  assert.deepEqual(mergeSessionMessages([original, [...original, next]]), [...original, next]);
});

test('host-only system notices survive matched native turns and repeated merges', () => {
  const user = message('user', 'Question', 0);
  const notice = message('system', 'Turn stopped by runtime deadline', 2);
  const native = [user, message('assistant', 'Native answer', 1)];
  const fallback = [user, message('assistant', 'Old live answer', 1), notice];
  const merged = mergeSessionMessages([native], fallback);
  assert.deepEqual(merged, [...native, notice]);
  assert.deepEqual(mergeSessionMessages([native], merged), merged);
  assert.deepEqual(mergeSessionMessages([[...native, notice]], merged), merged);
  const delayed = native.map((entry) => ({
    ...entry,
    timestamp: new Date(entry.timestamp.getTime() + 90_000),
  }));
  assert.deepEqual(mergeSessionMessages([delayed], fallback), [...delayed, notice]);
});

test('a partial user-only native flush does not erase the completed runtime answer', () => {
  const user = message('user', 'Question', 0);
  const nativeUser = { ...user, timestamp: new Date(user.timestamp.getTime() + 10) };
  const answer = message('assistant', 'Completed live answer', 20);
  assert.deepEqual(mergeSessionMessages([[nativeUser]], [user, answer]), [nativeUser, answer]);
});

test('polling an old native source preserves the live tail when the current file is missing', () => {
  const old = [message('user', 'Old question', 0), message('assistant', 'Old answer', 1)];
  const current = [
    message('user', 'New question', 600_000),
    message('assistant', 'New answer', 600_001),
  ];
  assert.deepEqual(mergeSessionMessages([old], [...old, ...current]), [...old, ...current]);
});

test('native event order survives corrected or backward timestamps', () => {
  const old = [message('user', 'Old question', 0), message('assistant', 'Old answer', -1)];
  const current = [
    message('user', 'New question', 600_000),
    message('assistant', 'New answer', 599_999),
  ];
  assert.deepEqual(mergeSessionMessages([old, [...old, ...current]]), [...old, ...current]);
});
