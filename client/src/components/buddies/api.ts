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

export async function buddyApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
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

export function asArray<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}
