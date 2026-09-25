import type { ClientMessage, ConversationRow, Message } from '@unleashd/shared';
import { connectionAtom, rowsAtom, transcriptStore } from '../../src/atoms/conversations';
import { jotaiStore } from '../../src/atoms/store';
import { syntheticDetail } from './synthetic-conversations';

/** Open the socket; every frame the client sends lands in the returned array. */
export function openSocket(): ClientMessage[] {
  const sent: ClientMessage[] = [];
  jotaiStore.set(connectionAtom, {
    ...jotaiStore.get(connectionAtom),
    socket: { tag: 'open', send: (message) => sent.push(message) },
  });
  return sent;
}

/** Replace every row the client holds. */
export function setRows(rows: readonly ConversationRow[]): void {
  jotaiStore.set(rowsAtom, new Map(rows.map((row) => [row.id, row])));
}

/** Install a loaded transcript (bodies + a synthetic detail) for one conversation. */
export function setLoaded(id: string, messages: readonly Message[], epoch = 0): void {
  jotaiStore.set(transcriptStore.patch, {
    set: [[id, { tag: 'loaded', epoch, messages, detail: syntheticDetail(id) }]],
    remove: [],
  });
}
