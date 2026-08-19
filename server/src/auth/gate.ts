import { timingSafeEqual } from 'node:crypto';
import { type AuthPolicy, digestToken } from './policy';

/**
 * Framework-agnostic auth decisions. Express, the Vite dev server, and the
 * WebSocket upgrade all adapt to this one gate rather than each re-deriving
 * "is this request allowed" — one clean path, three thin adapters.
 */

export const SESSION_COOKIE = 'unleashd_auth';
/** Login/logout must answer without a credential, or the form cannot be reached. */
export const AUTH_PATH_PREFIX = '/__auth';
export const LOGIN_PATH = '/__auth/login';
export const LOGOUT_PATH = '/__auth/logout';
/** Query parameter for bookmarkable links: /?token=… sets the cookie once. */
export const TOKEN_QUERY_PARAM = 'token';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface GateRequest {
  readonly method: string;
  /** Origin-form target, e.g. "/api/models?provider=claude". */
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** Where a credential came from. Absence is a named case, not `undefined`. */
export type Credential =
  | { readonly source: 'header'; readonly token: string }
  | { readonly source: 'cookie'; readonly token: string }
  | { readonly source: 'query'; readonly token: string }
  | { readonly source: 'none' };

export type AuthDecision =
  | { readonly kind: 'allow' }
  /** Valid ?token= on a navigation: store it as a cookie and strip the query. */
  | { readonly kind: 'establish'; readonly token: string; readonly location: string }
  | { readonly kind: 'challenge'; readonly wants: 'html' | 'json' };

function headerValue(request: GateRequest, name: string): string | undefined {
  const raw = request.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name || name in jar) continue;
    jar[name] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return jar;
}

function requestUrl(request: GateRequest): URL {
  // The origin is a placeholder: only pathname/search are ever read back out.
  return new URL(request.url, 'http://unleashd.invalid');
}

export function readCredential(request: GateRequest): Credential {
  const authorization = headerValue(request, 'authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return { source: 'header', token: bearer };

  const cookie = parseCookies(headerValue(request, 'cookie'))[SESSION_COOKIE];
  if (cookie) return { source: 'cookie', token: cookie };

  const query = requestUrl(request).searchParams.get(TOKEN_QUERY_PARAM)?.trim();
  if (query) return { source: 'query', token: query };

  return { source: 'none' };
}

/**
 * Constant-time comparison. Both sides are SHA-256 digests so the lengths
 * always match — `timingSafeEqual` neither throws nor leaks the token length.
 */
export function tokenMatches(presented: string, expected: Buffer): boolean {
  return timingSafeEqual(digestToken(presented), expected);
}

function wantsHtml(request: GateRequest): 'html' | 'json' {
  const accept = headerValue(request, 'accept') ?? '';
  const navigation = request.method === 'GET' || request.method === 'HEAD';
  return navigation && accept.includes('text/html') ? 'html' : 'json';
}

function locationWithoutToken(request: GateRequest): string {
  const url = requestUrl(request);
  url.searchParams.delete(TOKEN_QUERY_PARAM);
  return `${url.pathname}${url.search}`;
}

/** δ: thin dispatcher on the credential's source. */
function decideForRequiredPolicy(request: GateRequest, digest: Buffer): AuthDecision {
  const credential = readCredential(request);
  if (credential.source === 'none') return { kind: 'challenge', wants: wantsHtml(request) };
  if (!tokenMatches(credential.token, digest)) {
    return { kind: 'challenge', wants: wantsHtml(request) };
  }
  if (credential.source === 'query' && (request.method === 'GET' || request.method === 'HEAD')) {
    return { kind: 'establish', token: credential.token, location: locationWithoutToken(request) };
  }
  return { kind: 'allow' };
}

/** δ: thin dispatcher on the policy variant. */
export function decideAuth(policy: AuthPolicy, request: GateRequest): AuthDecision {
  if (policy.kind === 'open') return { kind: 'allow' };
  return decideForRequiredPolicy(request, policy.digest);
}

/**
 * A WebSocket upgrade has no way to render a login page and browsers cannot
 * set an Authorization header on `new WebSocket()` — the cookie established by
 * the page load is what authorizes the socket.
 */
export function authorizeUpgrade(policy: AuthPolicy, request: GateRequest): boolean {
  const decision = decideAuth(policy, request);
  return decision.kind === 'allow' || decision.kind === 'establish';
}

export function isAuthEndpoint(url: string): boolean {
  return requestUrl({ method: 'GET', url, headers: {} }).pathname.startsWith(AUTH_PATH_PREFIX);
}

export function isSecureRequest(request: GateRequest): boolean {
  const forwarded = headerValue(request, 'x-forwarded-proto');
  return forwarded?.split(',')[0]?.trim() === 'https';
}

export function buildSessionCookie(token: string, options: { secure: boolean }): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (options.secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/**
 * Only same-origin paths are honoured after login, so a crafted `redirectTo`
 * cannot turn the login form into an open redirect.
 */
export function safeRedirectTarget(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
