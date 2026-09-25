import type { Express, Request, Response } from 'express';

/**
 * One matching message and the conversation it belongs to. Bodies are not in memory (T13b S2):
 * matches come from the ingest store's deep search (`Ingest.search`). `messageIndex` is the
 * message's position in its session (the conversation's own index when it has one session).
 */
export interface SearchMatch {
  conversationId: string;
  workingDirectory: string;
  messageIndex: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

const SNIPPET_RADIUS = 60;
const MAX_RESULTS = 50;
const HARD_RESULT_LIMIT = 200;

function buildSnippet(content: string, query: string): string {
  const matchIndex = content.toLowerCase().indexOf(query.toLowerCase());
  if (matchIndex === -1) return content.substring(0, 120);
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? '...' : ''}${content.substring(start, end)}${
    end < content.length ? '...' : ''
  }`;
}

export function registerSearchRoutes(
  app: Express,
  search: (query: string, limit: number) => Promise<SearchMatch[]>,
  getVisibility?: () => Promise<(conversationId: string) => boolean>
): void {
  app.get('/api/search', async (req: Request, res: Response, next) => {
    try {
      const visible = await getVisibility?.();
      const rawQuery = req.query.q;
      const filterDirectory =
        typeof req.query.filterDirectory === 'string' ? req.query.filterDirectory.trim() : '';
      const rawLimit = Number(req.query.limit);
      const limit =
        Number.isInteger(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, HARD_RESULT_LIMIT)
          : MAX_RESULTS;

      if (typeof rawQuery !== 'string') {
        res.status(400).json({ error: 'q is required' });
        return;
      }
      const query = rawQuery.trim();
      if (query.length < 2) {
        res.json({ query, results: [] });
        return;
      }

      // The store returns newest first; filters apply after, so over-read to fill `limit`.
      const matches = (await search(query, HARD_RESULT_LIMIT * 5)).filter(
        (match) =>
          (!visible || visible(match.conversationId)) &&
          (!filterDirectory || match.workingDirectory.startsWith(filterDirectory))
      );
      res.json({
        query,
        results: matches.slice(0, limit).map((match) => ({
          conversationId: match.conversationId,
          messageIndex: match.messageIndex,
          role: match.role,
          snippet: buildSnippet(match.content, query),
          workingDirectory: match.workingDirectory,
          timestamp: match.timestamp.toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  });
}
