import type { Application } from 'express';
import type { TurnAttemptJournal } from '../observability';

export function registerTurnDiagnosticsRoutes(app: Application, journal: TurnAttemptJournal): void {
  app.get('/api/conversations/:conversationId/diagnostics', async (request, response) => {
    try {
      const conversationId = request.params.conversationId;
      const limit = parseLimit(request.query.limit);
      const attempts = await journal.queryAttempts({ conversationId, limit });
      const includeEvents = request.query.includeEvents === 'true';
      const recentEvents = includeEvents
        ? await journal.recentEvents({
            conversationId,
            limit: Math.min(limit * 10, 1_000),
          })
        : undefined;
      response.json({
        serverBootId: journal.serverBootId,
        latestAttempt: attempts[0] ?? null,
        attempts,
        ...(recentEvents ? { recentEvents } : {}),
      });
    } catch (error) {
      console.error('[turn-diagnostics] Failed to read turn diagnostics:', error);
      if (!response.headersSent) {
        response.status(500).json({ error: 'Failed to read turn diagnostics' });
      }
    }
  });
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string') return 20;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 20;
}
