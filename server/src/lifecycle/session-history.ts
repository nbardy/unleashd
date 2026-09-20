import type { Message } from '@unleashd/shared';

// A native user event follows the host send, including provider initialization.
// Beyond this bound an identical prompt could be a different historical turn;
// retaining both is safer than silently deleting history without an identity.
const MAX_SEND_EVENT_OFFSET_MS = 5 * 60_000;

function contentKey(message: Message): string {
  return JSON.stringify([
    message.role,
    message.content,
    message.toolCall?.name,
    message.toolCall?.input,
  ]);
}

function exactKey(message: Message): string {
  return JSON.stringify([new Date(message.timestamp).getTime(), contentKey(message)]);
}

function userTurns(messages: readonly Message[]): { start: number; end: number }[] {
  const turns: { start: number; end: number }[] = [];
  for (let index = 0; index < messages.length; index++) {
    if (messages[index].role !== 'user') continue;
    if (turns.length) turns[turns.length - 1].end = index;
    turns.push({ start: index, end: messages.length });
  }
  return turns;
}

/**
 * Native transcripts replace their matching live turns, while fallback turns
 * whose native file is unavailable survive even between two available sessions.
 * This is a display projection only; none of these rows authorize provider reuse.
 */
export function mergeSessionMessages(
  nativeSets: readonly (readonly Message[])[],
  runtimeFallback?: readonly Message[]
): Message[] {
  const sets = [...nativeSets];
  if (runtimeFallback?.length) {
    const liveTurns = userTurns(runtimeFallback);
    const replacements = new Map<number, readonly Message[]>();
    for (const native of nativeSets) {
      let afterLiveTurn = -1;
      for (const turn of userTurns(native)) {
        const user = native[turn.start];
        const userKey = contentKey(user);
        const userTime = new Date(user.timestamp).getTime();
        let closest = -1;
        let distance = Number.POSITIVE_INFINITY;
        for (let index = afterLiveTurn + 1; index < liveTurns.length; index++) {
          const candidate = runtimeFallback[liveTurns[index].start];
          if (contentKey(candidate) !== userKey) continue;
          const offset = Math.abs(new Date(candidate.timestamp).getTime() - userTime);
          if (offset <= MAX_SEND_EVENT_OFFSET_MS && offset < distance) {
            closest = index;
            distance = offset;
          }
        }
        if (closest === -1) continue;
        afterLiveTurn = closest;
        const live = liveTurns[closest];
        const replacement = native
          .slice(turn.start, turn.end)
          .filter((message) => message.role !== 'system');
        if (replacement.length >= (replacements.get(live.start)?.length ?? 0)) {
          replacements.set(live.start, replacement);
        }
      }
    }
    const replaced = new Set<number>();
    for (const live of liveTurns) {
      const replacement = replacements.get(live.start);
      if (replacement) {
        // A user-only file may be a partial provider flush. Replace that user
        // row, but do not erase a completed live answer absent from the file.
        const hasAnswer = replacement.slice(1).some((message) => message.role === 'assistant');
        const end = hasAnswer ? live.end : live.start + 1;
        for (let index = live.start; index < end; index++) {
          if (runtimeFallback[index].role !== 'system') replaced.add(index);
        }
      }
    }
    // Retain runtime sequence constraints across replacements. A host notice
    // recorded before a delayed native timestamp must still follow its turn.
    const fallback: Message[] = [];
    runtimeFallback.forEach((message, index) => {
      const replacement = replacements.get(index);
      if (replacement) fallback.push(...replacement);
      if (!replaced.has(index)) fallback.push(message);
    });
    sets.push(fallback);
  }

  // Inherited prefixes may occur in several native files. Keep the maximum
  // count per exact row across sources, including repeated rows within a file.
  const rows: {
    message: Message;
    following: Set<number>;
    predecessors: number;
  }[] = [];
  const identities = new Map<string, number[]>();
  for (const messages of sets) {
    const occurrences = new Map<string, number>();
    let previous: number | undefined;
    for (const message of messages) {
      const key = exactKey(message);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      const matches = identities.get(key) ?? [];
      let index = matches[occurrence];
      if (index === undefined) {
        index = rows.length;
        matches.push(index);
        identities.set(key, matches);
        rows.push({ message, following: new Set(), predecessors: 0 });
      }
      if (previous !== undefined && !rows[previous].following.has(index)) {
        rows[previous].following.add(index);
        rows[index].predecessors++;
      }
      previous = index;
    }
  }

  // Native event order is stronger evidence than wall clocks: providers can
  // stamp a later assistant event earlier than its initiating user event.
  // Chronology chooses between independent rows, never reverses a source.
  const compare = (left: number, right: number) =>
    new Date(rows[left].message.timestamp).getTime() -
      new Date(rows[right].message.timestamp).getTime() || left - right;
  const ready = rows.map((_, index) => index).filter((index) => rows[index].predecessors === 0);
  const emitted = new Set<number>();
  const merged: Message[] = [];
  while (ready.length) {
    ready.sort(compare);
    const index = ready.shift()!;
    emitted.add(index);
    merged.push(rows[index].message);
    for (const next of rows[index].following) {
      if (--rows[next].predecessors === 0) ready.push(next);
    }
  }
  // Contradictory order in overlapping artifacts must not discard any rows.
  // Retain their first-observed source order when no consistent order exists.
  rows.forEach((row, index) => {
    if (!emitted.has(index)) merged.push(row.message);
  });
  return merged;
}
