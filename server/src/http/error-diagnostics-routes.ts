import type { Application } from 'express';
import type { ErrorJournal, ErrorJournalStatus } from '../observability';

export function registerErrorDiagnosticsRoutes(app: Application, journal: ErrorJournal): void {
  app.get('/api/diagnostics/errors', async (request, response) => {
    try {
      const groups = await journal.queryGroups({
        status: parseStatus(request.query.status),
        since: typeof request.query.since === 'string' ? request.query.since : undefined,
        limit: parseLimit(request.query.limit),
      });
      response.json({ serverBootId: journal.serverBootId, groups });
    } catch (error) {
      console.error('[error-journal] Failed to read error journal:', error);
      if (!response.headersSent)
        response.status(500).json({ error: 'Failed to read error journal' });
    }
  });

  app.post('/api/diagnostics/errors/:fingerprint/acknowledge', async (request, response) => {
    try {
      const note =
        typeof request.body?.note === 'string' ? request.body.note : 'Reviewed by local operator';
      const group = await journal.acknowledge(request.params.fingerprint, note);
      response.json({ group });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(message.startsWith('Error group not found:') ? 404 : 400).json({
        error: message,
      });
    }
  });
}

function parseStatus(value: unknown): ErrorJournalStatus | 'all' {
  return value === 'acknowledged' || value === 'all' ? value : 'unresolved';
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string') return 100;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1_000) : 100;
}
