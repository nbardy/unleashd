import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { loadConversationDetails, refreshTranscript } from '../atoms/actions';
import { rowFamily, transcriptFamily } from '../atoms/conversations';

/**
 * Keep one open conversation's bodies current (protocol v3: lists carry rows
 * only). The transcript atom holds the data per id, so a remount renders what
 * is already there; requests are deduped in flight (actions.ts).
 *
 * Absent → load. Loaded but the row's messageCount differs from the messages
 * held → page in the tail. Only the open view does this: a count moving on a
 * conversation nobody shows fetches nothing.
 */
export function useConversationBodies(conversationId: string | null): {
  loaded: boolean;
  error: string | null;
} {
  const id = conversationId ?? '';
  const messageCount = useAtomValue(rowFamily(id))?.messageCount ?? null;
  const transcript = useAtomValue(transcriptFamily(id));
  const held = transcript.tag === 'loaded' ? transcript.messages.length : null;
  useEffect(() => {
    if (!conversationId || messageCount === null) return;
    switch (transcript.tag) {
      case 'absent':
        void loadConversationDetails(conversationId);
        return;
      case 'loaded':
        if (held !== messageCount) void refreshTranscript(conversationId);
        return;
      case 'loading':
      case 'failed':
        return;
    }
  }, [conversationId, messageCount, transcript.tag, held]);
  return {
    loaded: transcript.tag === 'loaded',
    error: transcript.tag === 'failed' ? transcript.error : null,
  };
}
