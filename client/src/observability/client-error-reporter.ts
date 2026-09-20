export type ClientErrorSource =
  | 'browser-error'
  | 'unhandled-rejection'
  | 'react-boundary'
  | 'react-recoverable'
  | 'react-uncaught';

export interface ClientErrorDescription {
  message: string;
  stack?: string;
}

interface ClientErrorReport {
  source: ClientErrorSource;
  error: unknown;
  componentStack?: string | null;
}

interface ReporterOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  route?: () => string;
  maxReports?: number;
  windowMs?: number;
  duplicateWindowMs?: number;
}

const MAX_MESSAGE_CHARACTERS = 8_000;
const MAX_STACK_CHARACTERS = 16_000;
const MAX_ROUTE_CHARACTERS = 500;

export function createClientErrorReporter(options: ReporterOptions = {}) {
  const fetcher = options.fetcher ?? window.fetch.bind(window);
  const now = options.now ?? Date.now;
  const route = options.route ?? (() => window.location.pathname);
  const maxReports = options.maxReports ?? 5;
  const windowMs = options.windowMs ?? 60_000;
  const duplicateWindowMs = options.duplicateWindowMs ?? 1_000;
  let reportTimes: number[] = [];
  const recentObjects = new WeakMap<object, number>();
  const recentValues = new Map<string, number>();

  return ({ source, error, componentStack }: ClientErrorReport): boolean => {
    const timestamp = now();
    const normalized = describeClientError(error, componentStack);
    const duplicateKey = `${normalized.message}\n${normalized.stack ?? ''}`;
    if (error && typeof error === 'object') {
      const lastSeen = recentObjects.get(error);
      if (lastSeen !== undefined && timestamp - lastSeen < duplicateWindowMs) return false;
      recentObjects.set(error, timestamp);
    } else {
      for (const [key, lastSeen] of recentValues) {
        if (timestamp - lastSeen >= duplicateWindowMs) recentValues.delete(key);
      }
      const lastSeen = recentValues.get(duplicateKey);
      if (lastSeen !== undefined && timestamp - lastSeen < duplicateWindowMs) return false;
      recentValues.set(duplicateKey, timestamp);
    }

    reportTimes = reportTimes.filter((reportedAt) => timestamp - reportedAt < windowMs);
    if (reportTimes.length >= maxReports) return false;
    reportTimes.push(timestamp);

    const pathname = bound(route(), MAX_ROUTE_CHARACTERS);
    try {
      void fetcher('/api/diagnostics/errors/client', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source,
          message: normalized.message,
          ...(normalized.stack ? { stack: normalized.stack } : {}),
          ...(pathname ? { route: pathname } : {}),
        }),
        keepalive: true,
      }).catch(() => {
        // Error reporting must never create another user-visible or unhandled failure.
      });
    } catch {
      // A synchronous reporting failure is equally non-fatal and must stay contained.
    }
    return true;
  };
}

let defaultReporter: ReturnType<typeof createClientErrorReporter> | undefined;

export function reportClientError(report: ClientErrorReport): boolean {
  defaultReporter ??= createClientErrorReporter();
  return defaultReporter(report);
}

export function installClientErrorReporting(): void {
  window.addEventListener('error', (event) => {
    if (!event.message && !event.error) return;
    reportClientError({ source: 'browser-error', error: event.error ?? event.message });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError({ source: 'unhandled-rejection', error: event.reason });
  });
}

/**
 * The one canonicalization of an unknown thrown value. The reporter sends this
 * to the journal and the boundary fallback renders it, so what the user reads
 * on screen is byte-identical to what `pnpm errors:list` shows.
 */
export function describeClientError(
  error: unknown,
  componentStack?: string | null
): ClientErrorDescription {
  const message = errorMessage(error);
  const errorStack = errorStackFrom(error);
  const combinedStack = [errorStack, componentStack?.trim() || undefined]
    .filter((value): value is string => Boolean(value))
    .join('\nReact component stack:\n');
  return {
    message: bound(message || 'Unknown client error', MAX_MESSAGE_CHARACTERS),
    ...(combinedStack ? { stack: bound(combinedStack, MAX_STACK_CHARACTERS) } : {}),
  };
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  try {
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.message === 'string') return record.message;
      if (typeof record.name === 'string') return `${record.name} without a message`;
      return 'Non-Error object thrown by the client';
    }
  } catch {
    return 'Unreadable object thrown by the client';
  }
  return 'Unknown client error';
}

function errorStackFrom(value: unknown): string | undefined {
  if (value instanceof Error) return value.stack;
  try {
    if (value && typeof value === 'object') {
      const stack = (value as Record<string, unknown>).stack;
      return typeof stack === 'string' ? stack : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function bound(value: string, maximumCharacters: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maximumCharacters
    ? trimmed
    : `${trimmed.slice(0, maximumCharacters - 16)}\n… [truncated]`;
}
