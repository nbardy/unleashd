import assert from 'node:assert/strict';
import test from 'node:test';
import { parseServerFrame } from '../src/hooks/useWebSocket';

// Pattern: parse-dont-validate (docs/patterns.md#parse-dont-validate)
// `chunk` frames skip the 13-way ServerMessage Zod parse (the stream path's
// hot spot, 06-target-client §1.4) and get a tag + two-field check instead.
// That check is the only boundary a chunk crosses: a frame without a
// conversation id would otherwise buffer text under the key "undefined".

test('a well-formed chunk passes with exactly its three fields', () => {
  assert.deepEqual(
    parseServerFrame({ type: 'chunk', conversationId: 'c1', text: 'hi', stray: 1 }),
    { t: 'message', message: { type: 'chunk', conversationId: 'c1', text: 'hi' } }
  );
});

test('a malformed chunk is invalid, not delivered', () => {
  for (const frame of [
    { type: 'chunk', text: 'hi' },
    { type: 'chunk', conversationId: '', text: 'hi' },
    { type: 'chunk', conversationId: 'c1', text: 42 },
  ]) {
    assert.equal(parseServerFrame(frame).t, 'invalid', JSON.stringify(frame));
  }
});

test('every other frame still gets the full schema', () => {
  assert.equal(parseServerFrame({ type: 'message', conversationId: 'c1' }).t, 'invalid');
  assert.equal(parseServerFrame(null).t, 'invalid');
  assert.deepEqual(parseServerFrame({ type: 'buddies_changed' }), {
    t: 'message',
    message: { type: 'buddies_changed' },
  });
});
