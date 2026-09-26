import { resource } from '../../hooks/usePolledFetch';

/**
 * Deep-history search (GET /api/search) shaping, shared by the desktop palette
 * and the mobile Search tab: one parse, one grouping, one highlighter.
 */

export const MIN_QUERY_LENGTH = 2;
export const HIT_LIMIT = 50;

export interface SearchHit {
  conversationId: string;
  messageIndex: number;
  role: string;
  snippet: string;
  workingDirectory: string;
  timestamp: Date;
}

/** Every hit for one conversation, newest conversation first. */
export interface HitGroup {
  conversationId: string;
  workingDirectory: string;
  hits: SearchHit[];
  latest: Date;
}

interface WireHit extends Omit<SearchHit, 'timestamp'> {
  timestamp: string;
}

/**
 * Keyed by the request URL, so a query typed again (or the page revisited)
 * renders its cached hits immediately. The server's own error text is the
 * failure message.
 */
export function historySearch(query: string, folder: string) {
  const params = new URLSearchParams({ q: query, limit: String(HIT_LIMIT) });
  if (folder) params.set('filterDirectory', folder);
  const url = `/api/search?${params.toString()}`;
  return resource<SearchHit[]>(url, async (signal) => {
    const response = await fetch(url, { signal });
    const body = (await response.json().catch(() => null)) as {
      results?: WireHit[];
      error?: string;
    } | null;
    if (!response.ok) throw new Error(body?.error ?? `Search failed (${response.status})`);
    return (body?.results ?? []).map((hit) => ({ ...hit, timestamp: new Date(hit.timestamp) }));
  });
}

export function groupHits(hits: readonly SearchHit[]): HitGroup[] {
  const groups = new Map<string, HitGroup>();
  for (const hit of hits) {
    const group = groups.get(hit.conversationId);
    if (group) {
      group.hits.push(hit);
      if (hit.timestamp > group.latest) group.latest = hit.timestamp;
    } else {
      groups.set(hit.conversationId, {
        conversationId: hit.conversationId,
        workingDirectory: hit.workingDirectory,
        hits: [hit],
        latest: hit.timestamp,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.latest.getTime() - a.latest.getTime());
}

export interface Segment {
  text: string;
  match: boolean;
}

/** Case-insensitive, non-overlapping occurrences of `query` in `text`. */
export function highlight(text: string, query: string): Segment[] {
  const needle = query.toLowerCase();
  if (!needle) return [{ text, match: false }];
  const haystack = text.toLowerCase();
  const segments: Segment[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) segments.push({ text: text.slice(from, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) segments.push({ text: text.slice(from), match: false });
  return segments;
}
