/**
 * headless-chrome.mjs — the shared driver behind the screenshot tools.
 *
 * Zero dependencies: drives headless Chrome over the DevTools Protocol using
 * Node's global WebSocket (Node >= 22). Deliberately does NOT add playwright or
 * puppeteer — this repo has neither, and a screenshot script is not worth a
 * browser download in every install.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome/Chromium found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet one of these paths, or install Chrome.`
    );
  }
  return found;
}

/**
 * The server's shared secret, resolved in the server's own order
 * (server/src/auth/policy.ts): UNLEASHD_AUTH_TOKEN, UNLEASHD_AUTH_TOKEN_FILE,
 * then <UNLEASHD_DATA_DIR or ~/.agent-viewer>/auth-token. Null means no secret
 * is configured; a gated server then answers 401 and `openSession` says so.
 */
export function resolveAuthToken(env = process.env) {
  const inline = env.UNLEASHD_AUTH_TOKEN?.trim();
  if (inline) return inline;
  const dataDir = env.UNLEASHD_DATA_DIR?.trim() || path.join(os.homedir(), '.agent-viewer');
  const file = env.UNLEASHD_AUTH_TOKEN_FILE?.trim() || path.join(dataDir, 'auth-token');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() || null : null;
}

/** Minimal CDP client: one socket, id-matched responses, event waiters. */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        else resolve(msg.result);
      }
      for (const listener of this.listeners) listener(msg);
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`CDP connect failed: ${wsUrl}`)), {
        once: true,
      });
    });
    return new Cdp(ws);
  }

  // `params` keeps its default on purpose. The rule's unsafe fix removed it on
  // 2026-09-06, which changed this method's contract (a two-arg call would send
  // `params: undefined` to CDP instead of `{}`). Reordering is not an option
  // either: `sessionId` is optional and must stay last.
  // biome-ignore lint/style/useDefaultParameterLast: sessionId must remain the trailing optional
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  once(method, sessionId, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const listener = (msg) => {
        if (msg.method !== method) return;
        if (sessionId && msg.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(msg.params);
      };
      this.listeners.add(listener);
    });
  }
}

async function launchChrome(chromePath) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unleashd-shots-'));
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      // The dev server is plain http on a LAN-ish origin; no need for the
      // sandbox in a throwaway profile, and it avoids CI permission issues.
      '--no-sandbox',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );

  // Chrome writes the chosen port here once the debugger is listening.
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const [port] = fs.readFileSync(portFile, 'utf8').split('\n');
      if (port) return { child, userDataDir, port: Number(port) };
    }
    await sleep(100);
  }
  child.kill('SIGKILL');
  throw new Error('Chrome did not expose a DevTools port within 20s');
}

/**
 * One headless tab against the running app, already authenticated: the
 * `?token=` navigation sets the gate's cookie for every later page load.
 *
 * Returns { goto, evaluate, setViewport, capture, close }. `await close()` must
 * run (use try/finally) or a Chrome process outlives the script.
 */
export async function openSession({ baseUrl, token }) {
  const { child, userDataDir, port } = await launchChrome(findChrome());
  let cdp;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  // Wait for Chrome to exit before deleting its profile: a killed Chrome still
  // flushes files for a moment, and rmSync then fails ENOTEMPTY — which, from a
  // `finally`, replaced the real error the script was about to report.
  const close = async () => {
    try {
      cdp?.ws.close();
    } catch {
      // socket already gone
    }
    child.kill('SIGKILL');
    await exited;
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  try {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);

    const goto = async (url, settleMs) => {
      const loaded = cdp.once('Page.loadEventFired', sessionId, 30_000);
      await cdp.send('Page.navigate', { url }, sessionId);
      await loaded;
      await sleep(settleMs);
    };

    const evaluate = async (expression) => {
      const result = await cdp.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId
      );
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
      }
      return result.result?.value;
    };

    /** viewport: { width, height, deviceScaleFactor, mobile } — touch follows `mobile`. */
    const setViewport = async (viewport) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', viewport, sessionId);
      // The app picks its tree by width alone, but touch keeps hover/pointer
      // media queries honest for the phone and tablet sizes.
      await cdp.send(
        'Emulation.setTouchEmulationEnabled',
        // maxTouchPoints must be 1..16 even when disabling.
        { enabled: viewport.mobile, maxTouchPoints: 5 },
        sessionId
      );
    };

    const capture = async (file) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    };

    await goto(token ? `${baseUrl}/?token=${encodeURIComponent(token)}` : `${baseUrl}/`, 500);
    const gated = await evaluate(`document.title.toLowerCase().includes('sign in') ||
      !!document.querySelector('form input[type=password]')`);
    if (gated) {
      throw new Error(
        token
          ? 'The auth gate rejected the token — is it the running server’s secret?'
          : 'The server is gated and no token was found (UNLEASHD_AUTH_TOKEN, UNLEASHD_AUTH_TOKEN_FILE, ~/.agent-viewer/auth-token).'
      );
    }

    return { goto, evaluate, setViewport, capture, close };
  } catch (error) {
    await close();
    throw error;
  }
}
