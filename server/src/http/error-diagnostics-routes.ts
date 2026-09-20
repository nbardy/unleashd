import type { Application } from 'express';
import type { ErrorJournal, ErrorJournalStatus } from '../observability';

const CLIENT_ERROR_SOURCES = new Set([
  'browser-error',
  'unhandled-rejection',
  'react-boundary',
  'react-recoverable',
  'react-uncaught',
]);
const MAX_CLIENT_MESSAGE_CHARACTERS = 8_000;
const MAX_CLIENT_STACK_CHARACTERS = 16_000;
const MAX_CLIENT_ROUTE_CHARACTERS = 500;

interface ErrorDiagnosticsRouteOptions {
  clientReportLimit?: number;
  clientReportWindowMs?: number;
  now?: () => number;
}

export function registerErrorDiagnosticsRoutes(
  app: Application,
  journal: ErrorJournal,
  options: ErrorDiagnosticsRouteOptions = {}
): void {
  const acceptClientReport = createClientReportLimiter(options);

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

  app.post('/api/diagnostics/errors/client', async (request, response) => {
    const report = parseClientErrorReport(request.body);
    if (!report) {
      response.status(400).json({ error: 'Invalid client error report' });
      return;
    }
    if (!acceptClientReport(request.ip || request.socket.remoteAddress || 'unknown')) {
      response.status(429).json({ error: 'Client error report rate limit exceeded' });
      return;
    }
    try {
      const group = await journal.capture({
        severity: 'error',
        component: `client.${report.source}`,
        message: report.message,
        stack: report.stack,
        context: {
          origin: 'client',
          ...(report.route ? { route: report.route } : {}),
        },
      });
      response.status(202).json({ accepted: true, fingerprint: group.fingerprint });
    } catch (error) {
      console.error('[error-journal] Failed to persist client error:', error);
      if (!response.headersSent)
        response.status(500).json({ error: 'Failed to persist client error' });
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

function parseClientErrorReport(value: unknown): {
  source: string;
  message: string;
  stack?: string;
  route?: string;
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.source !== 'string' ||
    !CLIENT_ERROR_SOURCES.has(record.source) ||
    typeof record.message !== 'string' ||
    record.message.trim().length === 0 ||
    record.message.length > MAX_CLIENT_MESSAGE_CHARACTERS ||
    (record.stack !== undefined &&
      (typeof record.stack !== 'string' || record.stack.length > MAX_CLIENT_STACK_CHARACTERS)) ||
    (record.route !== undefined &&
      (typeof record.route !== 'string' || record.route.length > MAX_CLIENT_ROUTE_CHARACTERS))
  ) {
    return null;
  }
  return {
    source: record.source,
    message: record.message,
    ...(typeof record.stack === 'string' && record.stack ? { stack: record.stack } : {}),
    ...(typeof record.route === 'string' && record.route ? { route: record.route } : {}),
  };
}

function createClientReportLimiter(
  options: ErrorDiagnosticsRouteOptions
): (key: string) => boolean {
  const limit = Math.max(1, options.clientReportLimit ?? 20);
  const windowMs = Math.max(1_000, options.clientReportWindowMs ?? 60_000);
  const now = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: number; count: number }>();
  return (key) => {
    const timestamp = now();
    const current = windows.get(key);
    if (!current || timestamp - current.startedAt >= windowMs) {
      if (windows.size >= 100) {
        for (const [candidate, window] of windows) {
          if (timestamp - window.startedAt >= windowMs) windows.delete(candidate);
        }
        if (windows.size >= 100) windows.delete(windows.keys().next().value as string);
      }
      windows.set(key, { startedAt: timestamp, count: 1 });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  };
}

function parseStatus(value: unknown): ErrorJournalStatus | 'all' {
  return value === 'acknowledged' || value === 'all' ? value : 'unresolved';
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string') return 100;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1_000) : 100;
}
