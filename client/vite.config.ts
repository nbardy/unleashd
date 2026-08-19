import { exec } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { type ViteDevServer, createLogger, defineConfig } from 'vite';
import {
  buildSessionCookie,
  decideAuth,
  isAuthEndpoint,
  isSecureRequest,
} from '../server/src/auth/gate';
import { loginPageHtml } from '../server/src/auth/login-page';
import { type AuthPolicy, describePolicy, resolveAuthPolicy } from '../server/src/auth/policy';

const DEV_CLIENT_PORT = 7489;
const API_SERVER_PORT = 7499;
const LOCAL_DOMAIN = 'unleashd.localhost';
const TAILSCALE_DOMAIN = '.tail58a146.ts.net';
const LOCAL_DEV_URL =
  process.env.UNLEASHD_LOCAL_DOMAIN_ENABLED === '1'
    ? `http://${LOCAL_DOMAIN}`
    : `http://localhost:${DEV_CLIENT_PORT}`;
const viteLogger = createLogger();
const logViteError = viteLogger.error.bind(viteLogger);
const logViteInfo = viteLogger.info.bind(viteLogger);
let lastHmrMessage = '';
let lastHmrAt = 0;
const clientRoot = path.dirname(fileURLToPath(import.meta.url));
const sharedSourceEntry = path.resolve(clientRoot, '../shared/src/index.ts');

viteLogger.error = (message, options) => {
  const transientWebSocketRestart =
    message.includes('ws proxy') &&
    (message.includes('EPIPE') ||
      message.includes('ECONNRESET') ||
      message.includes('ECONNREFUSED'));
  const transientHttpRestart =
    message.includes('http proxy error:') &&
    (message.includes('EPIPE') ||
      message.includes('ECONNRESET') ||
      message.includes('ECONNREFUSED'));
  if (transientWebSocketRestart || transientHttpRestart) return;
  logViteError(message, options);
};

viteLogger.info = (message, options) => {
  if (message.includes('hmr update')) {
    const now = Date.now();
    if (message === lastHmrMessage && now - lastHmrAt < 1_000) return;
    lastHmrMessage = message;
    lastHmrAt = now;
  }
  logViteInfo(message, options);
};

function logUnexpectedProxyError(scope: string, error: NodeJS.ErrnoException) {
  if (error.code === 'EPIPE' || error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
    return;
  }
  console.error(`[${scope} proxy]`, error.message);
}

function openInBrowser(url: string) {
  const startCmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${startCmd} ${url}`);
}

// =============================================================================
// Dev-server auth
//
// The Vite dev server is the LAN-facing surface: it serves the app shell and
// proxies /api and /ws to the loopback-bound backend, so before this gate
// existed anyone on the same wifi had the full API via http://<lan-ip>:7489.
// The backend enforces the same secret independently — this is not the only
// check, it is the one that stops the app shell and the proxy from answering.
// =============================================================================
const APP_DATA_DIR = process.env.UNLEASHD_DATA_DIR ?? path.join(os.homedir(), '.agent-viewer');

function resolveDevAuthPolicy(): AuthPolicy {
  const resolution = resolveAuthPolicy({
    env: process.env,
    // Loopback so an unconfigured dev server is never the thing that refuses to
    // start; `devServerHost` below is what keeps that promise honest.
    listenHost: '127.0.0.1',
    dataDirectory: APP_DATA_DIR,
  });
  if (!resolution.ok) throw new Error(`[auth] ${resolution.error}`);
  return resolution.policy;
}

/**
 * Without a shared secret the dev server binds loopback only. Exposing it on
 * every interface has to be earned by configuring a token, otherwise `pnpm dev`
 * silently republishes the whole API to the local network.
 */
function devServerHost(policy: AuthPolicy): boolean | string {
  return policy.kind === 'required' ? true : '127.0.0.1';
}

function devAuthPlugin(policy: AuthPolicy) {
  return {
    name: 'unleashd-dev-auth',
    configureServer(server: ViteDevServer) {
      console.log(`[unleashd] ${describePolicy(policy)}`);
      if (policy.kind === 'open') return;
      server.middlewares.use((request, response, next) => {
        const gateRequest = {
          method: request.method ?? 'GET',
          url: request.url ?? '/',
          headers: request.headers,
        };
        // /__auth/* is the login form itself; the proxy hands it to the
        // backend, which validates the submitted key and sets the cookie.
        if (isAuthEndpoint(gateRequest.url)) {
          next();
          return;
        }
        const decision = decideAuth(policy, gateRequest);
        if (decision.kind === 'allow') {
          next();
          return;
        }
        if (decision.kind === 'establish') {
          response.statusCode = 302;
          response.setHeader(
            'Set-Cookie',
            buildSessionCookie(decision.token, { secure: isSecureRequest(gateRequest) })
          );
          response.setHeader('Location', decision.location);
          response.end();
          return;
        }
        response.statusCode = 401;
        if (decision.wants === 'json') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(loginPageHtml({ notice: { kind: 'none' }, redirectTo: gateRequest.url }));
      });
    },
  };
}

const devAuthPolicy = resolveDevAuthPolicy();

function openPreferredDevUrlPlugin() {
  return {
    name: 'open-preferred-dev-url',
    configureServer(server: ViteDevServer) {
      server.httpServer?.once('listening', () => {
        console.log(`[unleashd] Opening ${LOCAL_DEV_URL}`);
        openInBrowser(LOCAL_DEV_URL);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  customLogger: viteLogger,
  plugins: [react(), devAuthPlugin(devAuthPolicy), openPreferredDevUrlPlugin()],
  // The shared package's ESM and CJS watch builds update dist file-by-file.
  // Reading that mutable output from Vite creates a window where index.js is
  // absent or inconsistent with its leaf modules. The browser build can
  // consume the canonical TypeScript entry directly and let Vite own HMR.
  resolve: {
    alias: {
      '@unleashd/shared': sharedSourceEntry,
    },
  },
  server: {
    host: devServerHost(devAuthPolicy),
    port: DEV_CLIENT_PORT,
    open: false,
    allowedHosts: [LOCAL_DOMAIN, TAILSCALE_DOMAIN],
    proxy: {
      '/ws': {
        target: `ws://127.0.0.1:${API_SERVER_PORT}`,
        ws: true,
        // Suppress EPIPE/ECONNRESET noise during backend restarts.
        // Vite reconnects automatically — these errors are expected and transient.
        configure: (proxy) => {
          const silence = (err: NodeJS.ErrnoException) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED')
              return;
            console.error('[ws proxy]', err.message);
          };
          proxy.on('error', silence);
          proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
            socket.on('error', silence);
          });
        },
      },
      '/__auth': {
        target: `http://127.0.0.1:${API_SERVER_PORT}`,
        configure: (proxy) => {
          proxy.on('error', (error) => logUnexpectedProxyError('http', error));
        },
      },
      '/api': {
        target: `http://127.0.0.1:${API_SERVER_PORT}`,
        configure: (proxy) => {
          proxy.on('error', (error) => logUnexpectedProxyError('http', error));
        },
      },
    },
  },
});
