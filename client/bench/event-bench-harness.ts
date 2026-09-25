import {
  type ConversationDetail,
  type Message,
  type ServerMessage,
  encodeRows,
} from '@unleashd/shared';
import type { Atom, createStore } from 'jotai';
import {
  syntheticConversation,
  syntheticConversations,
  syntheticDetail,
  syntheticTranscript,
} from '../test/fixtures/synthetic-conversations';

type Store = ReturnType<typeof createStore>;

export interface BenchTarget {
  store: Store;
  handleMessage: (message: ServerMessage) => void;
  /** The WS boundary: raw decoded JSON → a dispatchable message (or null). Timed with the event. */
  parseFrame: (raw: unknown) => ServerMessage | null;
  /** Seed the open chat's loaded detail and bodies (what opening it fetches). */
  open: (id: string, detail: ConversationDetail, messages: readonly Message[]) => void;
  /** Every atom the mounted components read; subscribed like useAtomValue does. */
  mount: (idsNewestFirst: readonly string[], openId: string) => Atom<unknown>[];
  /** The open chat's message groups; a replaced group is a re-rendered row. */
  groups: (openId: string) => Atom<readonly unknown[]>;
  /** Render-time work a component redoes when an atom it reads changes. */
  renderWork?: Array<{ atom: Atom<unknown>; run: (value: unknown) => void }>;
}

const COUNT = 1_200;
const WARMUP = 50;
const RUNS = 400;

function installShims(): FrameRequestCallback[] {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  console.log = () => {};
  return frames;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export function runEventBench(target: BenchTarget): void {
  const frames = installShims();
  const flush = () => {
    for (const frame of frames.splice(0)) frame(0);
  };
  // Every event goes through the real boundary: JSON text → parseFrame → handleMessage.
  const deliver = (message: unknown) => {
    const parsed = target.parseFrame(JSON.parse(JSON.stringify(message)));
    if (parsed) target.handleMessage(parsed);
  };
  const rows = syntheticConversations(COUNT);
  deliver({
    type: 'hello',
    protocol: { version: 3 },
    defaultCwd: '/',
    loading: false,
    archivedBuddyIds: [],
    ...encodeRows(rows),
  });
  const idsNewestFirst = rows.map((row) => row.id).reverse();
  const openId = idsNewestFirst[0];
  // The open chat carries a long transcript (150 turns, 600 records), so a
  // stream frame shows whether it regroups the whole thing.
  target.open(openId, syntheticDetail(openId), syntheticTranscript(150));
  const atoms = target.mount(idsNewestFirst, openId);
  const last = new Map<Atom<unknown>, unknown>();
  for (const atom of atoms) {
    last.set(atom, target.store.get(atom));
    target.store.sub(atom, () => {});
  }
  for (const { atom, run } of target.renderWork ?? []) {
    run(target.store.get(atom));
    target.store.sub(atom, () => run(target.store.get(atom)));
  }
  const others = rows.filter((row) => row.id !== openId);
  let clock = Date.parse('2026-09-25T00:00:00.000Z');

  const kinds: Record<string, (i: number) => void> = {
    'status flip (another conversation)': (i) => {
      const running = Math.floor(i / others.length) % 2 === 0;
      deliver({
        type: 'patch',
        id: others[i % others.length].id,
        patch: { t: 'run', run: running ? 'running' : 'idle' },
      });
    },
    'queue patch (another conversation)': (i) => {
      deliver({
        type: 'patch',
        id: others[i % others.length].id,
        patch: {
          t: 'queue',
          queue: [{ id: `q${i}`, content: 'next', status: 'pending', queuedAt: new Date(clock) }],
        },
      });
    },
    'poller batch, 1 row (another conversation)': (i) => {
      clock += 1_000;
      const index = (i * 7) % others.length;
      // A fresh row each batch, as the wire delivers it.
      const row = syntheticConversation(0, {
        ...others[index],
        activityAt: clock,
        messageCount: 3 + i,
      });
      deliver({ type: 'rows', ...encodeRows([row]) });
    },
    'message + activity (another conversation)': (i) => {
      clock += 1_000;
      const id = others[(i * 13) % others.length].id;
      deliver({ type: 'message', conversationId: id, role: 'user', content: `message ${i}` });
      deliver({
        type: 'patch',
        id,
        patch: { t: 'activity', activityAt: clock, messageCount: 3 + i },
      });
    },
    'stream frame (open chat)': (i) => {
      deliver({ type: 'chunk', conversationId: openId, text: ` token${i}` });
      flush();
    },
  };

  const groupsAtom = target.groups(openId);
  target.store.sub(groupsAtom, () => {});
  const table: string[] = [];
  for (const [name, run] of Object.entries(kinds)) {
    const timings: number[] = [];
    let changed = 0;
    let replacedGroups = 0;
    for (let i = 0; i < WARMUP + RUNS; i++) {
      const groupsBefore = target.store.get(groupsAtom);
      const start = performance.now();
      run(i);
      const elapsed = performance.now() - start;
      if (i < WARMUP) {
        for (const atom of atoms) last.set(atom, target.store.get(atom));
        continue;
      }
      timings.push(elapsed);
      const groupsAfter = target.store.get(groupsAtom);
      replacedGroups += groupsAfter.filter((group, index) => group !== groupsBefore[index]).length;
      for (const atom of atoms) {
        const value = target.store.get(atom);
        if (value !== last.get(atom)) changed += 1;
        last.set(atom, value);
      }
    }
    timings.sort((a, b) => a - b);
    table.push(
      `| ${name} | ${percentile(timings, 0.5).toFixed(3)} | ${percentile(timings, 0.95).toFixed(3)} | ${(changed / RUNS).toFixed(1)} | ${(replacedGroups / RUNS).toFixed(1)} |`
    );
  }
  process.stdout.write(
    [
      `${COUNT} conversations, ${atoms.length} mounted atoms, ${RUNS} runs per event (after ${WARMUP} warm-up)`,
      '',
      '| event | median ms | p95 ms | subscribed atoms changed | open-chat groups replaced |',
      '|---|---:|---:|---:|---:|',
      ...table,
      '',
    ].join('\n')
  );
}
