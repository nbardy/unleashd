import type { BuddyTurnAudience } from '../../src/conversations/runtime';

// Fixture: a stub audience that continues only its own key. The containment
// rule itself (grown read access continues a session) belongs to the Buddies
// package; channel-seat-continuity.test.ts exercises it through a real store.
export function sameKeyAudience(key: string): BuddyTurnAudience {
  return {
    key,
    continuityFrom: (sessionKey) => (sessionKey === key ? 'contained' : 'changed'),
  };
}
