import { newId } from '../../utils/ids';

export class BuddyApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'BuddyApiError';
    this.status = status;
    this.payload = payload;
  }
}

/** One request to the Buddy owner API; a non-2xx answer throws its `{error}` text. */
export async function buddyApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new BuddyApiError(
      'This feature is unavailable on the running server. It will retry after the server updates.',
      response.status,
      null
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new BuddyApiError(
      (payload as { error?: string }).error ?? `Request failed (${response.status})`,
      response.status,
      payload
    );
  }
  return payload as T;
}

/**
 * A JSON write. Every owner write carries an idempotency `key` (the server
 * parses it strictly); a fresh one is added here unless the caller keyed the
 * write itself, so no call site can forget it.
 */
// Pattern: idempotency-keys (docs/patterns.md#idempotency-keys)
export function buddyWrite<T>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH',
  body: Record<string, unknown>
): Promise<T> {
  return buddyApi<T>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: newId(), ...body }),
  });
}

/** A body-less action (`/direct`, `/wake`, `/builder`, run cancel, archive). */
export function buddyAction<T>(path: string, method: 'POST' | 'DELETE' = 'POST'): Promise<T> {
  return buddyApi<T>(path, { method });
}

export const errorText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
