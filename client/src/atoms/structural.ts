import { type Atom, type Getter, type Setter, type WritableAtom, atom } from 'jotai';
import { atomFamily } from 'jotai-family';

// =============================================================================
// Building blocks that keep a write's cost proportional to what it changed.
// =============================================================================

/**
 * A map of per-key values that readers subscribe to ONE KEY at a time.
 *
 * A plain `atom(new Map())` read through `atomFamily(id => atom(get =>
 * get(mapAtom).get(id)))` recomputes every mounted per-id atom on every write,
 * whatever key changed. Here each key has its own primitive atom and a write
 * sets only the keys it touched, so a reader of key B does no work at all when
 * key A changes.
 *
 * - `all`: read the whole map (imperative reads); write replaces the whole map,
 *   diffing by `Object.is` to find the touched keys.
 * - `patch`: set and remove named keys without visiting the others.
 * - `byKey(key)`: the per-key atom; `absent` when the key is not present.
 * - `onCommit`: runs inside the same write with the touched keys, for indexes
 *   that must move in step with the map.
 */
export interface KeyedAtoms<V, A> {
  all: WritableAtom<ReadonlyMap<string, V>, [ReadonlyMap<string, V>], void>;
  patch: WritableAtom<null, [KeyedPatch<V>], void>;
  byKey: (key: string) => Atom<V | A>;
  /** Drop the memoized per-key atom (deleted conversations; PWA sessions are long). */
  forget: (key: string) => void;
}

export interface KeyedPatch<V> {
  set: ReadonlyArray<readonly [string, V]>;
  remove: readonly string[];
}

export function keyedAtoms<V, A>(options: {
  label: string;
  absent: A;
  onCommit?: (
    get: Getter,
    set: Setter,
    next: ReadonlyMap<string, V>,
    changed: ReadonlySet<string>
  ) => void;
}): KeyedAtoms<V, A> {
  const mapAtom = atom<ReadonlyMap<string, V>>(new Map());
  const family = atomFamily((key: string) => {
    const value = atom<V | A>(options.absent);
    value.debugLabel = `${options.label}:${key}`;
    return value;
  });

  const commit = (
    get: Getter,
    set: Setter,
    next: ReadonlyMap<string, V>,
    changed: ReadonlySet<string>
  ) => {
    if (changed.size === 0) return;
    set(mapAtom, next);
    for (const key of changed)
      set(family(key), next.has(key) ? (next.get(key) as V) : options.absent);
    options.onCommit?.(get, set, next, changed);
  };

  const all = atom(
    (get) => get(mapAtom),
    (get, set, next: ReadonlyMap<string, V>) => {
      const previous = get(mapAtom);
      const changed = new Set<string>();
      for (const [key, value] of next) {
        if (!previous.has(key) || !Object.is(previous.get(key), value)) changed.add(key);
      }
      for (const key of previous.keys()) if (!next.has(key)) changed.add(key);
      commit(get, set, next, changed);
    }
  );

  const patch = atom(null, (get, set, change: KeyedPatch<V>) => {
    const next = new Map(get(mapAtom));
    const changed = new Set<string>();
    for (const [key, value] of change.set) {
      if (next.has(key) && Object.is(next.get(key), value)) continue;
      next.set(key, value);
      changed.add(key);
    }
    for (const key of change.remove) if (next.delete(key)) changed.add(key);
    commit(get, set, next, changed);
  });

  return { all, patch, byKey: (key) => family(key), forget: (key) => family.remove(key) };
}

/**
 * A derived atom that hands back its PREVIOUS value when `equals(previous,
 * next)` holds, so subscribers see the same reference and skip re-rendering.
 * Same self-reference technique as jotai's `selectAtom`, which keeps the
 * previous value per store rather than in a closure.
 */
export function stableAtom<T>(
  read: (get: Getter) => T,
  equals: (previous: T, next: T) => boolean
): Atom<T> {
  const EMPTY = Symbol('stableAtom.empty');
  const self: Atom<T | typeof EMPTY> & { init?: typeof EMPTY } = atom((get) => {
    const previous = get(self);
    const next = read(get);
    return previous !== EMPTY && equals(previous as T, next) ? previous : next;
  });
  self.init = EMPTY;
  return self as Atom<T>;
}

export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

export function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function sameMap<K, V>(
  a: ReadonlyMap<K, V>,
  b: ReadonlyMap<K, V>,
  sameValue: (x: V, y: V) => boolean = Object.is
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (!b.has(key) || !sameValue(value, b.get(key) as V)) return false;
  }
  return true;
}
