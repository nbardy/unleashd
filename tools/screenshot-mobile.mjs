#!/usr/bin/env node
/**
 * screenshot-mobile.mjs — capture every mobile screen at a phone viewport.
 *
 * Zero dependencies: drives headless Chrome over the DevTools Protocol using
 * Node's global WebSocket (Node >= 22). Deliberately does NOT add playwright or
 * puppeteer — this repo has neither, and a screenshot script is not worth a
 * browser download in every install.
 *
 * Usage:
 *   node tools/screenshot-mobile.mjs                     # against http://localhost:7489
 *   node tools/screenshot-mobile.mjs --url http://...    # another origin
 *   node tools/screenshot-mobile.mjs --out /tmp/shots    # another output dir
 *   node tools/screenshot-mobile.mjs --only chats,buddies
 *
 * The dev server must already be running (pnpm dev). Screens that need a real
 * conversation or buddy resolve an id from the live app at runtime, so the set
 * degrades gracefully on an empty install rather than failing.
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

// 375x812 = iPhone X..13 mini CSS pixels, the viewport the mobile tree targets
// (useDeviceKind switches at max-width: 768px).
const VIEWPORT = { width: 375, height: 812, deviceScaleFactor: 2, mobile: true };

function parseArgs(argv) {
  const args = { url: 'http://localhost:7489', out: path.join(ROOT, 'docs/screenshots/mobile'), only: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--only') args.only = new Set(argv[++i].split(',').map((s) => s.trim()));
  }
  return args;
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome/Chromium found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}\n` +
        'Set one of these paths, or install Chrome.'
    );
  }
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * The screens. `prepare` runs in the page after navigation and may return a
 * value; returning the string 'SKIP' drops the screen (e.g. no conversations
 * exist yet). `path` may be a function resolved against earlier discoveries.
 */
function buildScreens(ids) {
  return [
    { name: '01-chats', path: '/' },
    { name: '02-swarms', path: '/workers' },
    { name: '03-buddies', path: '/buddies' },
    { name: '04-search', path: '/search' },
    {
      name: '05-new-chat-sheet',
      path: '/',
      prepare: `document.querySelector('.mobile-ui-header-action')?.click()`,
      settleMs: 700,
    },
    {
      name: '06-new-swarm-sheet',
      path: '/workers',
      prepare: `document.querySelector('.mobile-ui-header-action')?.click()`,
      settleMs: 700,
    },
    ids.conversationId
      ? { name: '07-conversation', path: `/chat/${ids.conversationId}`, settleMs: 1800 }
      : null,
    ids.conversationId
      ? {
          name: '08-conversation-composer-filled',
          path: `/chat/${ids.conversationId}`,
          settleMs: 1800,
          prepare: `(() => {
            const ta = document.querySelector('.mobile-composer__input');
            if (!ta) return 'SKIP';
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, 'Drafting a message from the screenshot script.');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.focus();
          })()`,
        }
      : null,
    ids.conversationId
      ? {
          name: '09-model-modal',
          path: `/chat/${ids.conversationId}`,
          settleMs: 1800,
          prepare: `(() => {
            const btn = document.querySelector('.mobile-chat__model');
            if (!btn) return 'SKIP';
            btn.click();
          })()`,
        }
      : null,
    ids.buddyId
      ? { name: '10-buddy-detail-work', path: `/buddies/${ids.buddyId}`, settleMs: 2000 }
      : null,
    ids.buddyId
      ? {
          name: '11-buddy-detail-chats',
          path: `/buddies/${ids.buddyId}`,
          settleMs: 2000,
          prepare: `(() => {
            const tab = [...document.querySelectorAll('.mobile-buddy-detail__tab')]
              .find((b) => b.textContent.trim() === 'Chats');
            if (!tab) return 'SKIP';
            tab.click();
          })()`,
        }
      : null,
    ids.buddyId
      ? {
          name: '12-buddy-detail-memory',
          path: `/buddies/${ids.buddyId}`,
          settleMs: 2000,
          prepare: `(() => {
            const tab = [...document.querySelectorAll('.mobile-buddy-detail__tab')]
              .find((b) => b.textContent.trim() === 'Memory');
            if (!tab) return 'SKIP';
            tab.click();
          })()`,
        }
      : null,
    ids.swarmProject
      ? {
          name: '13-swarm-detail',
          path: `/workers/detail?project=${encodeURIComponent(ids.swarmProject)}`,
          settleMs: 2000,
        }
      : null,
  ].filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });

  const chromePath = findChrome();
  const { child, userDataDir, port } = await launchChrome(chromePath);

  let cdp;
  const saved = [];
  const skipped = [];
  try {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT, sessionId);
    // Without a touch-capable UA the app still renders mobile (it switches on
    // width), but this keeps hover/pointer media queries honest.
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);

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

    // Discover real ids from the running app so conversation/buddy/swarm
    // screens point at something that exists.
    await goto(`${args.url}/`, 2500);
    const ids = await evaluate(`(() => {
      const firstConv = document.querySelector('.mobile-conversation-item');
      const fiberId = (el) => {
        if (!el) return null;
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
        let fiber = el[key];
        for (let i = 0; i < 12 && fiber; i++) {
          if (fiber.memoizedProps?.id) return fiber.memoizedProps.id;
          fiber = fiber.return;
        }
        return null;
      };
      return { conversationId: fiberId(firstConv) };
    })()`);

    // Click the first card and read the resulting URL. More robust than
    // reading ids out of React internals, and it exercises the real nav path.
    const idFromFirstCard = async (listPath, cardSelector, pattern) => {
      await goto(`${args.url}${listPath}`, 2500);
      const clicked = await evaluate(
        `(() => { const el = document.querySelector('${cardSelector}'); if (!el) return false; el.click(); return true; })()`
      );
      if (!clicked) return null;
      await sleep(1600);
      const url = await evaluate('location.pathname + location.search');
      const match = pattern.exec(url ?? '');
      return match ? decodeURIComponent(match[1]) : null;
    };

    ids.buddyId = await idFromFirstCard('/buddies', '.mobile-buddy-card', /^\/buddies\/([^?]+)/);
    ids.swarmProject = await idFromFirstCard('/workers', '.mobile-swarm-card', /project=([^&]+)/);

    const screens = buildScreens(ids).filter((s) => !args.only || args.only.has(s.name.replace(/^\d+-/, '')));

    for (const screen of screens) {
      await goto(`${args.url}${screen.path}`, screen.settleMs ?? 1500);
      if (screen.prepare) {
        const outcome = await evaluate(screen.prepare);
        if (outcome === 'SKIP') {
          skipped.push(`${screen.name} (precondition absent)`);
          continue;
        }
        await sleep(900);
      }
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      const file = path.join(args.out, `${screen.name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      saved.push(file);
      process.stdout.write(`saved ${file}\n`);
    }
  } finally {
    try {
      cdp?.ws.close();
    } catch {
      // socket already gone
    }
    child.kill('SIGKILL');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  process.stdout.write(`\n${saved.length} screenshot(s) in ${args.out}\n`);
  if (skipped.length) process.stdout.write(`skipped: ${skipped.join(', ')}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
