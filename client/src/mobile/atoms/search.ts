import { atom } from 'jotai';
import { listField, rowFamily } from '../../atoms/conversations';
import { fuzzyMatch } from '../../utils/fuzzyMatch';

// =============================================================================
// Mobile search state — sum type, never string sentinel (T2)
// =============================================================================

export type MobileSearchState = { kind: 'idle' } | { kind: 'searching'; query: string };

export const mobileSearchStateAtom = atom<MobileSearchState>({ kind: 'idle' });

// Derived: matching conversation ids, newest-first. Idle → every id (rows
// subscribe per id). Searching → fuzzyMatch over the folder, id and label
// (rows carry no bodies; deep search is /api/search). Only a live query reads
// rows, so an idle search page does no work on conversation events.
export const mobileSearchResultsAtom = atom((get): readonly string[] => {
  const state = get(mobileSearchStateAtom);
  const ids = get(listField('order'));
  if (state.kind === 'idle' || state.query.length === 0) return ids;

  const query = state.query;
  return ids.filter((id) => {
    const conv = get(rowFamily(id));
    if (!conv) return false;
    return (
      fuzzyMatch(query, conv.cwd) !== null ||
      fuzzyMatch(query, conv.id) !== null ||
      fuzzyMatch(query, conv.label) !== null
    );
  });
});
