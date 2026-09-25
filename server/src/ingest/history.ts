/**
 * Message bodies read from the ingest store (crates/unleashd-ingest), in the shape the client
 * pages (`Message`).
 *
 * Why this exists (T13b S2): bodies used to be parsed by the TS loader into every hydrated
 * runtime, capped at the newest 500 transcripts, and re-parsed by a 5 s poller. The store already
 * holds every session's visible history by `seq`, so a conversation's history is read on demand:
 * its bound sessions' messages merged with the live-turn overlay by the existing dedupe
 * (`mergeSessionMessages`). Guards: server/test/ingest-history.test.ts.
 */

import type { Ingest, Message as NativeMessage, SessionRow } from '@unleashd/ingest';
import type { Message } from '@unleashd/shared';

const READ_PAGE = 5_000;

/** A native message as the client shows it. `at` is absent on a few formats: keep the previous. */
function toMessage(native: NativeMessage, previousAt: number): Message {
  const at = native.at ?? previousAt;
  return {
    role: native.role,
    content: native.content,
    timestamp: new Date(at),
    ...(native.toolCall ? { toolCall: native.toolCall } : {}),
    ...(native.completedAt !== undefined ? { completedAt: new Date(native.completedAt) } : {}),
  };
}

/** The first `count` messages of one session (its settled prefix). */
export async function sessionMessages(
  ingest: Pick<Ingest, 'messages'>,
  session: Pick<SessionRow, 'sessionId' | 'createdAt'>,
  count: number
): Promise<Message[]> {
  const out: Message[] = [];
  let previousAt = session.createdAt;
  let afterSeq = -1;
  while (out.length < count) {
    const page = await ingest.messages(session.sessionId, {
      afterSeq,
      limit: Math.min(READ_PAGE, count - out.length),
    });
    for (const native of page) {
      const message = toMessage(native, previousAt);
      previousAt = message.timestamp.getTime();
      out.push(message);
    }
    if (page.length === 0) break;
    afterSeq = page[page.length - 1].seq;
  }
  return out;
}

/**
 * `next` keeps every message of `previous` except possibly the last (a streamed reply that grew),
 * so a client may keep its prefix and refetch the tail. The last message is exempt because
 * clients always re-read it.
 */
export function extendsHistory(previous: readonly Message[], next: readonly Message[]): boolean {
  if (next.length < previous.length) return false;
  for (let index = 0; index < previous.length - 1; index += 1) {
    const a = previous[index];
    const b = next[index];
    if (a !== b && (a.role !== b.role || a.content !== b.content)) return false;
  }
  return true;
}
