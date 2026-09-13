import type { Express, Request, Response } from 'express';

export interface SearchableConversation {
  id: string;
  workingDirectory: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date | string;
  }>;
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
  getConversations: () => Iterable<SearchableConversation>,
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

      const lowerQuery = query.toLowerCase();
      const matches = [];
      for (const conversation of getConversations()) {
        if (visible && !visible(conversation.id)) continue;
        if (filterDirectory && !conversation.workingDirectory.startsWith(filterDirectory)) {
          continue;
        }
        for (let index = 0; index < conversation.messages.length; index++) {
          const message = conversation.messages[index];
          if (!message.content.toLowerCase().includes(lowerQuery)) continue;
          matches.push({
            conversationId: conversation.id,
            messageIndex: index,
            role: message.role,
            snippet: buildSnippet(message.content, query),
            workingDirectory: conversation.workingDirectory,
            timestampMs: new Date(message.timestamp).getTime(),
          });
        }
      }

      matches.sort((a, b) => b.timestampMs - a.timestampMs);
      res.json({
        query,
        results: matches.slice(0, limit).map(({ timestampMs, ...match }) => ({
          ...match,
          timestamp: new Date(timestampMs).toISOString(),
        })),
      });
    } catch (error) {
      next(error);
    }
  });
}
