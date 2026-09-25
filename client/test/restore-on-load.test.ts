import assert from 'node:assert/strict';
import test from 'node:test';
import { type ServerMessage, encodeRows } from '@unleashd/shared';
import { handleMessage } from '../src/atoms/actions';
import { rowFamily } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { prefsAtom, setSavedActiveConversationId } from '../src/atoms/ui';
import { syntheticConversation } from './fixtures/synthetic-conversations';

const conversation = (index: number) => syntheticConversation(index, { kind: { t: 'chat' } });

// Regression (review of 984d00f): App's restore-on-load re-runs only when the
// signal it reads changes. Startup hydrates in batches; a "has any
// conversation" flag flipped on the first batch and never again, so a saved
// chat arriving in a later batch was never reopened and the page stayed on
// "/". App reads rowFamily(saved id), which flips on the batch that holds it.
test('restore-on-load signal flips when the saved conversation arrives in a later batch', () => {
  const saved = conversation(2);
  setSavedActiveConversationId(saved.id);
  const savedId = jotaiStore.get(prefsAtom).activeConversationId ?? '';
  handleMessage({
    type: 'hello',
    protocol: { version: 3 },
    defaultCwd: '/',
    loading: true,
    archivedBuddyIds: [],
    ...encodeRows([conversation(1)]),
  } as unknown as ServerMessage);
  assert.equal(jotaiStore.get(rowFamily(savedId)), null);
  handleMessage({ type: 'rows', ...encodeRows([saved]) } as unknown as ServerMessage);
  assert.equal(jotaiStore.get(rowFamily(savedId))?.id, saved.id);
});
