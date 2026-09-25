import type { Conversation, ServerMessage } from '@unleashd/shared';
import type { Atom, createStore } from 'jotai';
import {
  syntheticConversations,
  syntheticMessage,
  syntheticTranscript,
} from '../test/fixtures/synthetic-conversations';

type Store = ReturnType<typeof createStore>;

export interface BenchTarget {
  store: Store;
  handleMessage: (message: ServerMessage) => void;
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
  const conversations = syntheticConversations(COUNT);
  // The open chat carries a long transcript (150 turns, 600 records), so a
  // stream frame shows whether it regroups the whole thing.
  const newest = conversations.length - 1;
  conversations[newest] = {
    ...conversations[newest],
    messages: syntheticTranscript(150),
    messageCount: 600,
  };
  target.handleMessage({
    type: 'init',
    conversations,
    defaultCwd: '/',
    summaries: true,
  } as unknown as ServerMessage);
  const idsNewestFirst = conversations.map((conversation) => conversation.id).reverse();
  const openId = idsNewestFirst[0];
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
  const others = conversations.filter((conversation) => conversation.id !== openId);
  let clock = Date.parse('2026-09-25T00:00:00.000Z');

  const kinds: Record<string, (i: number) => void> = {
    'status flip (another conversation)': (i) => {
      const conversation = others[i % others.length];
      const running = Math.floor(i / others.length) % 2 === 0;
      target.handleMessage({
        type: 'status',
        conversationId: conversation.id,
        isRunning: running,
        isStreaming: false,
      } as ServerMessage);
    },
    'queue_updated (another conversation)': (i) => {
      target.handleMessage({
        type: 'queue_updated',
        conversationId: others[i % others.length].id,
        queue: [{ id: `q${i}`, content: 'next', status: 'pending', queuedAt: new Date(clock) }],
      } as unknown as ServerMessage);
    },
    'poller batch, 1 summary (another conversation)': (i) => {
      clock += 1_000;
      const index = (i * 7) % others.length;
      // A fresh summary object each batch, as the wire delivers it.
      const conversation: Conversation = {
        ...others[index],
        messages: [syntheticMessage('assistant', `polled ${i}`, new Date(clock))],
        messageCount: 3 + i,
      };
      target.handleMessage({
        type: 'conversations_updated',
        summaries: true,
        conversations: [conversation],
      } as ServerMessage);
    },
    'message (another conversation)': (i) => {
      target.handleMessage({
        type: 'message',
        conversationId: others[(i * 13) % others.length].id,
        role: 'user',
        content: `message ${i}`,
      } as ServerMessage);
    },
    'stream frame (open chat)': (i) => {
      target.handleMessage({
        type: 'chunk',
        conversationId: openId,
        text: ` token${i}`,
      } as ServerMessage);
      flush();
    },
  };

  const groupsAtom = target.groups(openId);
  target.store.sub(groupsAtom, () => {});
  const rows: string[] = [];
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
    rows.push(
      `| ${name} | ${percentile(timings, 0.5).toFixed(3)} | ${percentile(timings, 0.95).toFixed(3)} | ${(changed / RUNS).toFixed(1)} | ${(replacedGroups / RUNS).toFixed(1)} |`
    );
  }
  process.stdout.write(
    [
      `${COUNT} conversations, ${atoms.length} mounted atoms, ${RUNS} runs per event (after ${WARMUP} warm-up)`,
      '',
      '| event | median ms | p95 ms | subscribed atoms changed | open-chat groups replaced |',
      '|---|---:|---:|---:|---:|',
      ...rows,
      '',
    ].join('\n')
  );
}
