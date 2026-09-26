/**
 * Record a channel thread from the running app as footage for the edit.
 *
 *   node product/releases/launch-2.0/capture/record-thread.mjs --out /tmp/cap \
 *     --workspace project_… --channel list_… --thread post_… [--seconds 12]
 *
 * Headless Chrome laid out at 1487×941 CSS px, rendered 2×, so frames are 2974×1882: the same size and
 * layout as the owner's macOS screen recordings, and the two cut together. Writes
 * f00000.jpg… at 60 fps.
 *
 * The shot: open the thread, hold on the top, ease-scroll the thread pane down to the last
 * inline <video> in the thread pane (not the channel column, whose own embeds would match too),
 * then play it. No puppeteer: CDP over Node's WebSocket, the
 * same approach as tools/lib/headless-chrome.mjs (which does not expose raw CDP events).
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 && fallback === undefined) throw new Error(`--${name} is required`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const out = arg('out');
const workspace = arg('workspace');
const channel = arg('channel');
const thread = arg('thread');
const seconds = Number(arg('seconds', '12'));
const baseUrl = arg('url', 'http://localhost:7489');
const token = fs.readFileSync(path.join(os.homedir(), '.agent-viewer', 'auth-token'), 'utf8').trim();

fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-capture-'));
const chrome = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
const exited = new Promise((r) => chrome.once('exit', r));

let ws;
try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  while (!fs.existsSync(portFile) || !fs.readFileSync(portFile, 'utf8').includes('\n')) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  });
  let session;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(session && { sessionId: session }) }));
    });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable');
  // A 2974×1882 DPR-1 viewport with the page zoomed 2×: the layout of a 1487×941 window at retina
  // resolution. (Chosen while trying a live CDP screencast, whose frames ignore deviceScaleFactor;
  // the frame-stepped screenshots below would honour DPR 2 as well.)
  await send('Emulation.setDeviceMetricsOverride', { width: 2974, height: 1882, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) =>
    (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const goto = async (url, settle) => {
    await send('Page.navigate', { url });
    await sleep(settle);
  };

  await goto(`${baseUrl}/?token=${encodeURIComponent(token)}`, 1500);
  const q = `channel=${encodeURIComponent(channel)}&thread=${encodeURIComponent(thread)}`;
  await goto(`${baseUrl}/buddies/workspaces/${encodeURIComponent(workspace)}/channels?${q}`, 4000);
  await evaluate(`document.documentElement.style.zoom = '2'`);
  await sleep(800);

  // The thread pane's scroller: the scrollable ancestor of the last inline video.
  const found = await evaluate(`(() => {
    const v = [...document.querySelectorAll('aside.channel-thread video.channel-media')].at(-1);
    if (!v) return 'no video';
    let s = v.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (!s) return 'no scroller';
    window.__v = v; window.__s = s;
    s.scrollTop = 0;
    return 'ok';
  })()`);
  if (found !== 'ok') throw new Error(`thread setup failed: ${found}`);
  await sleep(500);

  // Frame-stepped, not real time. A live CDP screencast managed 5 fps at 2974×1882 (JPEG encode
  // is the bottleneck), so each output frame is posed and shot: the pane's scrollTop and the
  // video's currentTime are set from the timeline, then one screenshot. The app renders every
  // frame itself; only the clock is ours. True 60 fps at any machine speed.
  const FPS = 60;
  const HOLD = 1.0; // on the owner's request at the top of the thread
  const SCROLL = 1.4; // ease down to the reply's video
  const PLAY = HOLD + SCROLL + 0.2; // video starts; controls hide, as they do mid-playback
  // Centre the video in the pane from layout offsets. Rect arithmetic is wrong under CSS zoom
  // (rects and scrollTop disagree by the zoom factor; the video ended up off-screen), and
  // scrollIntoView also scrolls outer containers, which pushed the pane header out of frame.
  const target = await evaluate(`(() => {
    const s = window.__s, v = window.__v; // s.scrollTop is 0 here
    const pageTop = (e) => (e ? e.offsetTop + pageTop(e.offsetParent) : 0);
    return Math.max(0, pageTop(v) - pageTop(s) - (s.clientHeight - v.offsetHeight) / 2);
  })()`);
  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
  const total = Math.round(seconds * FPS);
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    const scroll = target * easeInOut(Math.min(1, Math.max(0, (t - HOLD) / SCROLL)));
    const videoTime = Math.max(0, t - PLAY);
    await evaluate(`new Promise((done) => {
      const s = window.__s, v = window.__v;
      s.scrollTop = ${scroll};
      v.controls = ${t < PLAY};
      if (Math.abs(v.currentTime - ${videoTime}) < 1e-4 && v.readyState >= 2) return requestAnimationFrame(() => done());
      v.addEventListener('seeked', () => requestAnimationFrame(() => done()), { once: true });
      v.currentTime = ${videoTime};
    })`);
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
    fs.writeFileSync(path.join(out, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
  }
  console.log(`${total} frames at ${FPS} fps; encode: ffmpeg -framerate ${FPS} -i ${out}/f%05d.jpg …`);
} finally {
  ws?.close();
  chrome.kill('SIGKILL');
  await exited;
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
