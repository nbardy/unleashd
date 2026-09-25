import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationsAtom, savedActiveConversationPresentAtom } from '../src/atoms/conversations';
import { jotaiStore } from '../src/atoms/store';
import { setSavedActiveConversationId } from '../src/atoms/ui';
import { syntheticConversation } from './fixtures/synthetic-conversations';

const conversation = (id: string) => syntheticConversation(1, { id });

// Regression (review of 984d00f): App's restore-on-load re-runs only when this
// atom changes. Startup hydrates in batches; a "has any conversation" flag
// flipped on the first batch and never again, so a saved chat arriving in a
// later batch was never reopened and the page stayed on "/".
test('restore-on-load signal flips when the saved conversation arrives in a later batch', () => {
  setSavedActiveConversationId('saved');
  jotaiStore.set(conversationsAtom, new Map([['first', conversation('first')]]));
  assert.equal(jotaiStore.get(savedActiveConversationPresentAtom), false);
  jotaiStore.set(
    conversationsAtom,
    new Map([
      ['first', conversation('first')],
      ['saved', conversation('saved')],
    ])
  );
  assert.equal(jotaiStore.get(savedActiveConversationPresentAtom), true);
});
