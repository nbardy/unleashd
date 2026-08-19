import { createStore } from 'jotai';

// =============================================================================
// Vanilla Jotai Store
//
// Exported so the WebSocket bridge (App.tsx) and mutation functions (actions.ts)
// can call store.get() / store.set() outside of React.
//
// The <Provider store={jotaiStore}> in App.tsx connects this same store to all
// React components, so useAtom/useAtomValue in components and jotaiStore.set()
// in actions always touch the same state.
// =============================================================================

declare global {
  // eslint-disable-next-line no-var
  var __unleashdJotaiStore: ReturnType<typeof createStore> | undefined;
}

type GlobalStore = typeof globalThis & { __unleashdJotaiStore?: ReturnType<typeof createStore> };

export const jotaiStore: ReturnType<typeof createStore> =
  (globalThis as GlobalStore).__unleashdJotaiStore ?? createStore();

// HMR-safe: survives Vite Fast Refresh of this module
(globalThis as GlobalStore).__unleashdJotaiStore = jotaiStore;
