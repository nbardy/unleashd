import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { loadConversationDetails } from '../atoms/actions';
import {
  conversationAtomFamily,
  conversationDetailsLoadedAtomFamily,
} from '../atoms/conversations';

/**
 * Load one conversation's detail and message bodies on demand (protocol v3:
 * lists carry rows only). Returns whether they are loaded and the last load
 * error. The atoms hold the data — per id, so a remount renders what is
 * already there — and the request is deduped in flight (actions.ts).
 */
export function useConversationBodies(conversationId: string | null): {
  loaded: boolean;
  error: string | null;
} {
  const row = useAtomValue(conversationAtomFamily(conversationId ?? ''));
  const loaded = useAtomValue(conversationDetailsLoadedAtomFamily(conversationId ?? ''));
  const [error, setError] = useState<string | null>(null);
  const present = row !== null;
  useEffect(() => {
    if (!conversationId || !present || loaded) return;
    setError(null);
    void loadConversationDetails(conversationId).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [conversationId, present, loaded]);
  return { loaded, error };
}
