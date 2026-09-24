#!/usr/bin/env node
/**
 * screenshots.mjs — shoot the Channels screens at phone, tablet and desktop
 * sizes into one reviewable collection.
 *
 * Usage (dev server running, `pnpm dev`):
 *   pnpm screenshots                                   # every screen × every size
 *   pnpm screenshots --sizes phone,desktop
 *   pnpm screenshots --only thread,mention-menu
 *   pnpm screenshots --workspace project_… --open      # pin a workspace, open the sheet
 *   pnpm screenshots --url http://host:7489 --out /tmp/shots
 *
 * Each run writes output/screenshots/<timestamp>/ (gitignored):
 *   <screen>@<size>.png   one per screen and size
 *   index.html            contact sheet: a row per screen, a column per size
 *   manifest.json         what was shot, what was skipped and why
 *
 * Runs are kept side by side, so a review → fix → rerun loop can compare the
 * previous sheet with the new one. The committed mobile gallery in
 * docs/screenshots/mobile/ is `pnpm screenshot:mobile`, not this tool.
 *
 * Screens point at real data found through the API: the richest channel across
 * every Buddy workspace (unless --workspace), and its most-replied thread. A screen whose data is absent is skipped and recorded,
 * never faked.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSession, resolveAuthToken, sleep } from './lib/headless-chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The app picks its tree with matchMedia('(max-width: 768px)'), so iPad
 * portrait gets the MOBILE tree and iPad landscape the desktop one. Both are
 * listed so the sheet shows exactly where that switch lands.
 */
const SIZES = {
  phone: { width: 375, height: 812, deviceScaleFactor: 2, mobile: true },
  'ipad-portrait': { width: 768, height: 1024, deviceScaleFactor: 2, mobile: true },
  'ipad-landscape': { width: 1024, height: 768, deviceScaleFactor: 2, mobile: true },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
};

function treeFor(size) {
  return size.width <= 768 ? 'mobile' : 'desktop';
}

function parseArgs(argv) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const args = {
    url: 'http://localhost:7489',
    out: path.join(ROOT, 'output/screenshots', stamp),
    sizes: Object.keys(SIZES),
    only: null,
    workspace: null,
    open: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--url') args.url = argv[++i].replace(/\/$/, '');
    else if (flag === '--out') args.out = path.resolve(argv[++i]);
    else if (flag === '--sizes') args.sizes = argv[++i].split(',').map((s) => s.trim());
    else if (flag === '--only') args.only = new Set(argv[++i].split(',').map((s) => s.trim()));
    else if (flag === '--workspace') args.workspace = argv[++i];
    else if (flag === '--open') args.open = true;
    else throw new Error(`Unknown flag ${flag}`);
  }
  const unknown = args.sizes.filter((name) => !SIZES[name]);
  if (unknown.length) {
    throw new Error(`Unknown size ${unknown.join(', ')}; known: ${Object.keys(SIZES).join(', ')}`);
  }
  return args;
}

// ── Discovery ──────────────────────────────────────────────────────────────

function apiClient(baseUrl, token) {
  return async (pathname) => {
    const response = await fetch(`${baseUrl}${pathname}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`GET ${pathname} → HTTP ${response.status}`);
    return response.json();
  };
}

/** One workspace's best channel: the most-replied thread, then the most posts. */
async function discoverWorkspace(api, workspace) {
  const lists = await api(`/api/buddies/lists?workspaceId=${encodeURIComponent(workspace.id)}`);
  const candidates = await Promise.all(
    lists
      .filter((list) => list.postCount > 0)
      .map(async (list) => {
        const posts = await api(`/api/buddies/lists/${encodeURIComponent(list.id)}/posts?limit=50`);
        const thread = posts
          .filter((post) => post.threadRootId === null && post.replyCount > 0)
          .sort((a, b) => b.replyCount - a.replyCount)[0];
        return {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          channelId: list.id,
          channelName: list.name,
          threadRootId: thread?.id ?? null,
          taskId: posts.find((post) => post.projectId)?.projectId ?? null,
          postCount: list.postCount,
        };
      })
  );
  return (
    candidates.sort(richness)[0] ?? {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      channelId: null,
      channelName: null,
      threadRootId: null,
      taskId: null,
      postCount: 0,
    }
  );
}

// Richest first: a channel that fills every screen (a thread, a Task filter)
// beats a merely busy one, so a default run leaves as few blanks as possible.
function richness(a, b) {
  return (
    Number(b.threadRootId !== null) - Number(a.threadRootId !== null) ||
    Number(b.taskId !== null) - Number(a.taskId !== null) ||
    b.postCount - a.postCount
  );
}

/**
 * --workspace pins one; otherwise every workspace a Buddy belongs to is
 * scanned and the richest channel wins. Deliberately NOT the workspace
 * `/channels` opens: that is the most recently active one, which is often a
 * quiet channel with no threads, and the sheet came back half empty.
 */
async function discover(api, pinnedWorkspaceId) {
  const overview = await api('/api/buddies/overview');
  const byId = new Map();
  for (const employee of overview.employees) {
    for (const workspace of employee.workspaces) byId.set(workspace.id, workspace);
  }
  if (pinnedWorkspaceId) {
    const pinned = byId.get(pinnedWorkspaceId);
    if (!pinned) {
      throw new Error(
        `No Buddy workspace ${pinnedWorkspaceId}; known: ${[...byId.keys()].join(', ')}`
      );
    }
    return discoverWorkspace(api, pinned);
  }
  const scanned = await Promise.all([...byId.values()].map((w) => discoverWorkspace(api, w)));
  const best = scanned.sort(richness)[0];
  if (!best) throw new Error('No Buddy workspaces — create a Buddy in a workspace first.');
  return best;
}

// ── Screens ────────────────────────────────────────────────────────────────

// Type "@" into the channel composer (one component on both trees) so the
// mention picker opens. React only sees a value set through the native setter.
const OPEN_MENTION_MENU = `(() => {
  const input = document.querySelector('.channel-composer textarea');
  if (!input) return 'SKIP';
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  input.focus();
  setter.call(input, '@');
  input.setSelectionRange(1, 1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return document.querySelector('.channel-composer-picker') ? 'OK' : 'SKIP';
})()`;

/**
 * Every screen, as data. `path` needs the ids it names; a screen whose ids
 * were not found is skipped with that reason. `trees` limits a screen to the
 * device trees that render it (the Task filter has no mobile UI).
 */
function buildScreens(found) {
  const base = `/buddies/workspaces/${encodeURIComponent(found.workspaceId)}/channels`;
  const channel = found.channelId && `channel=${encodeURIComponent(found.channelId)}`;
  return [
    { name: 'home', path: base },
    { name: 'channel', needs: channel, path: `${base}?${channel}` },
    {
      name: 'thread',
      needs: channel && found.threadRootId,
      path: `${base}?${channel}&thread=${encodeURIComponent(found.threadRootId)}`,
    },
    {
      name: 'mention-menu',
      needs: channel,
      path: `${base}?${channel}`,
      prepare: OPEN_MENTION_MENU,
    },
    {
      name: 'task-filter',
      needs: channel && found.taskId,
      trees: ['desktop'],
      path: `${base}?${channel}&task=${encodeURIComponent(found.taskId)}`,
    },
  ];
}

// ── Contact sheet ──────────────────────────────────────────────────────────

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function contactSheet(manifest) {
  const header = manifest.sizes
    .map((name) => {
      const s = SIZES[name];
      return `<th>${escapeHtml(name)}<small>${s.width}×${s.height} · ${treeFor(s)} tree</small></th>`;
    })
    .join('');
  const rows = manifest.screens
    .map((screen) => {
      const cells = manifest.sizes
        .map((size) => {
          const shot = manifest.shots.find((s) => s.screen === screen && s.size === size);
          if (shot) {
            return `<td><a href="${escapeHtml(shot.file)}" target="_blank"><img src="${escapeHtml(shot.file)}" loading="lazy"></a></td>`;
          }
          const skip = manifest.skipped.find((s) => s.screen === screen && s.size === size);
          return `<td class="skip">${escapeHtml(skip?.reason ?? 'not shot')}</td>`;
        })
        .join('');
      return `<tr><th scope="row">${escapeHtml(screen)}</th>${cells}</tr>`;
    })
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>Channels screenshots · ${escapeHtml(manifest.createdAt)}</title>
<style>
  body { margin: 0; background: #111418; color: #c9ccd1; font: 13px/1.4 system-ui, sans-serif; }
  header { padding: 16px 20px; border-bottom: 1px solid #2a2f36; }
  header h1 { margin: 0 0 4px; font-size: 16px; }
  header p { margin: 0; color: #8a919b; }
  table { border-collapse: collapse; }
  th, td { padding: 12px; border-bottom: 1px solid #2a2f36; vertical-align: top; text-align: left; }
  thead th { position: sticky; top: 0; background: #111418; z-index: 1; }
  thead small { display: block; color: #8a919b; font-weight: 400; }
  tbody th { width: 110px; }
  img { display: block; max-height: 640px; max-width: 520px; border: 1px solid #2a2f36; border-radius: 6px; }
  td.skip { color: #8a919b; font-style: italic; }
</style>
<header>
  <h1>Channels · ${escapeHtml(manifest.channelName ?? 'no channel')}</h1>
  <p>${escapeHtml(manifest.createdAt)} · ${escapeHtml(manifest.baseUrl)} · workspace ${escapeHtml(manifest.workspaceName)} · click a shot for full size</p>
</header>
<table>
  <thead><tr><th></th>${header}</tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
`;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = resolveAuthToken();
  const api = apiClient(args.url, token);
  fs.mkdirSync(args.out, { recursive: true });

  const session = await openSession({ baseUrl: args.url, token });
  const shots = [];
  const skipped = [];
  let found;
  let screens;
  try {
    found = await discover(api, args.workspace);
    process.stdout.write(`workspace ${found.workspaceName} · #${found.channelName}\n`);
    screens = buildScreens(found).filter((screen) => !args.only || args.only.has(screen.name));

    for (const sizeName of args.sizes) {
      const size = SIZES[sizeName];
      await session.setViewport(size);
      for (const screen of screens) {
        const record = (reason) => skipped.push({ screen: screen.name, size: sizeName, reason });
        if ('needs' in screen && !screen.needs) {
          record('no matching data in this workspace');
          continue;
        }
        if (screen.trees && !screen.trees.includes(treeFor(size))) {
          record(`${treeFor(size)} tree has no such screen`);
          continue;
        }
        await session.goto(`${args.url}${screen.path}`, 2000);
        if (screen.prepare) {
          if ((await session.evaluate(screen.prepare)) === 'SKIP') {
            record('precondition absent on the page');
            continue;
          }
          await sleep(600);
        }
        const file = `${screen.name}@${sizeName}.png`;
        await session.capture(path.join(args.out, file));
        shots.push({ screen: screen.name, size: sizeName, file, path: screen.path });
        process.stdout.write(`saved ${file}\n`);
      }
    }
  } finally {
    await session.close();
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    baseUrl: args.url,
    ...found,
    sizes: args.sizes,
    screens: screens.map((screen) => screen.name),
    shots,
    skipped,
  };
  fs.writeFileSync(path.join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const sheet = path.join(args.out, 'index.html');
  fs.writeFileSync(sheet, contactSheet(manifest));

  process.stdout.write(`\n${shots.length} screenshot(s), ${skipped.length} skipped\n${sheet}\n`);
  for (const skip of skipped) {
    process.stdout.write(`  skipped ${skip.screen}@${skip.size}: ${skip.reason}\n`);
  }
  if (args.open) execFile('open', [sheet]);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
