const LOGIN_PATH = '/__auth/login';

/**
 * Session recovery for the shared-secret gate.
 *
 * A 401 arriving mid-session — the server restarted with a new token, the
 * cookie expired, the key was rotated — used to leave a blank or half-broken
 * shell: every request failed and nothing told the user why. There is no single
 * API client to hook (45-odd call sites use `fetch` directly), so the wrapper
 * goes on `fetch` itself, once, at boot. That keeps the recovery in one place
 * instead of spreading an auth concern across every caller.
 */

let redirecting = false;

function isSameOrigin(input: RequestInfo | URL): boolean {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : '';
  if (!url) return false;
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

export function redirectToLogin(): void {
  // The gate serves the login page for /__auth/* itself; redirecting from
  // there would loop.
  if (redirecting || window.location.pathname.startsWith('/__auth/')) return;
  redirecting = true;
  const target = window.location.pathname + window.location.search;
  window.location.assign(`${LOGIN_PATH}?redirectTo=${encodeURIComponent(target)}`);
}

/**
 * The WebSocket carries no status code to its error handler, so a 401 upgrade
 * is indistinguishable from a dead server there. One cheap probe tells them
 * apart: a 401 response trips the fetch wrapper and redirects; anything else
 * means the socket failure was not about auth and the app keeps retrying.
 */
export async function probeSessionAfterSocketFailure(): Promise<void> {
  try {
    await fetch('/api/settings', { method: 'GET', cache: 'no-store' });
  } catch {
    // Network down rather than unauthenticated — the reconnect loop owns this.
  }
}

export function installAuthGuard(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    if (response.status === 401 && isSameOrigin(input)) redirectToLogin();
    return response;
  };
}
