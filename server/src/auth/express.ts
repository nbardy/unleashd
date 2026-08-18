import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  type AuthDecision,
  LOGIN_PATH,
  LOGOUT_PATH,
  buildClearedSessionCookie,
  buildSessionCookie,
  decideAuth,
  isSecureRequest,
  loginPageHtml,
  safeRedirectTarget,
  tokenMatches,
} from './gate';
import type { AuthPolicy } from './policy';

/**
 * Express adapter over `decideAuth`. Mount this before every route — the app
 * shell, the API, and uploads are all behind it, so an unauthenticated caller
 * cannot even discover which endpoints exist.
 */

function gateRequest(request: Request) {
  return { method: request.method, url: request.originalUrl, headers: request.headers };
}

function sendChallenge(request: Request, response: Response, wants: 'html' | 'json'): void {
  if (wants === 'json') {
    response.status(401).json({ error: 'unauthorized', message: 'Missing or invalid access key' });
    return;
  }
  response
    .status(401)
    .type('html')
    .send(loginPageHtml({ failed: false, redirectTo: request.originalUrl }));
}

function applyDecision(
  decision: AuthDecision,
  request: Request,
  response: Response,
  next: NextFunction
): void {
  if (decision.kind === 'allow') {
    next();
    return;
  }
  if (decision.kind === 'establish') {
    response.setHeader(
      'Set-Cookie',
      buildSessionCookie(decision.token, { secure: isSecureRequest(gateRequest(request)) })
    );
    response.redirect(302, decision.location);
    return;
  }
  sendChallenge(request, response, decision.wants);
}

export function registerAuthRoutes(app: Express, policy: AuthPolicy): void {
  // Login and logout must stay reachable without a credential, so they are
  // registered ahead of the gate rather than exempted from inside it.
  app.post(
    LOGIN_PATH,
    express.urlencoded({ extended: false, limit: '4kb' }),
    (request: Request, response: Response) => {
      const redirectTo = safeRedirectTarget(request.body?.redirectTo);
      if (policy.kind === 'open') {
        response.redirect(302, redirectTo);
        return;
      }
      const submitted = typeof request.body?.token === 'string' ? request.body.token.trim() : '';
      if (!submitted || !tokenMatches(submitted, policy.digest)) {
        response
          .status(401)
          .type('html')
          .send(loginPageHtml({ failed: true, redirectTo }));
        return;
      }
      response.setHeader(
        'Set-Cookie',
        buildSessionCookie(submitted, { secure: isSecureRequest(gateRequest(request)) })
      );
      response.redirect(302, redirectTo);
    }
  );

  app.get(LOGOUT_PATH, (_request: Request, response: Response) => {
    response.setHeader('Set-Cookie', buildClearedSessionCookie());
    response
      .status(200)
      .type('html')
      .send(loginPageHtml({ failed: false, redirectTo: '/' }));
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    applyDecision(decideAuth(policy, gateRequest(request)), request, response, next);
  });
}
