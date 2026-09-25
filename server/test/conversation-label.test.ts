import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationLabel } from '../src/conversations/runtime';

function userMessage(content: string) {
  return { role: 'user' as const, content, timestamp: new Date('2026-09-22T00:00:00.000Z') };
}

// Regression (2026-09-22): Buddy-spawned turns showed the base64
// `<!-- unleashd:buddy-context-v2 … -->` envelope as their sidebar label. The
// label is derived once on the server since T09, so the strip lives here.
test('the label strips hidden envelopes and the oompa tag from the first user line', () => {
  assert.equal(
    conversationLabel(undefined, [
      userMessage('<!-- unleashd:buddy-context-v2 eyJidWRkeUlkIjoiYWJjIn0 11428 -->\nFix labels'),
    ]),
    'Fix labels'
  );
  assert.equal(
    conversationLabel(undefined, [userMessage('[oompa:s1:w0] do the thing')]),
    'do the thing'
  );
  assert.equal(
    conversationLabel(undefined, [userMessage('<!-- a -->\n<!-- b -->')]),
    'New conversation'
  );
});

// Every row carries its label in `hello`; an unbounded first line would undo
// the init budget (wire-v3.test.ts).
test('the label is bounded', () => {
  const label = conversationLabel(undefined, [userMessage(`x${'y'.repeat(500)}`)]);
  assert.ok(label.length <= 80);
  assert.ok(label.endsWith('…'));
});
