import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BuddiesStore } from '@nbardy/buddies';
// Local browser fixture: real store and owner routes; never starts a provider.
import express from 'express';
import { createServer } from 'vite';
import routes from '../../../server/src/buddies/routes';

const { registerBuddyRoutes } = routes;
const root = mkdtempSync(join(tmpdir(), 'team-settings-draft-browser-'));
const store = new BuddiesStore(':memory:');
const workspace = store.createWorkspace({ name: 'Draft fixture', rootPath: root });
const lead = store.createBuddy({ project: workspace.id, name: 'Fixture Lead', role: 'Coordinate' });
const target = store.createBuddy({
  project: workspace.id,
  name: 'Target Alpha',
  role: 'Research',
});
const secondTarget = store.createBuddy({
  project: workspace.id,
  name: 'Target Beta',
  role: 'Review',
});
store.setBuddyAccess({
  granteeId: lead.id,
  workspaceId: workspace.id,
  targetBuddyId: target.id,
  capabilities: ['profile.read'],
  baseRevision: 0,
  key: 'fixture-alpha',
  reason: 'Initial Alpha grant',
});
store.setBuddyAccess({
  granteeId: lead.id,
  workspaceId: workspace.id,
  targetBuddyId: secondTarget.id,
  capabilities: ['soul.read'],
  baseRevision: 0,
  key: 'fixture-beta',
  reason: 'Initial Beta grant',
});

const app = express();
app.use(express.json());
app.get('/favicon.ico', (_req, res) => res.status(204).end());
const requests: Array<{ method: string; url: string; body?: unknown }> = [];
let delayNextAccessRead = false;
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/buddies/'))
    requests.push({ method: req.method, url: req.url, body: req.body });
  if (
    req.method === 'POST' &&
    req.path === '/api/buddies/team-configuration' &&
    req.body?.preview === false
  ) {
    delayNextAccessRead = true;
  }
  if (
    delayNextAccessRead &&
    req.method === 'GET' &&
    /^\/api\/buddies\/[^/]+\/access\/[^/]+$/.test(req.path)
  ) {
    delayNextAccessRead = false;
    setTimeout(next, 1_200);
    return;
  }
  next();
});
app.get('/qa-context', (_req, res) =>
  res.json({ buddyId: lead.id, workspaceId: workspace.id, targetId: target.id })
);
app.get('/qa-requests', (_req, res) => res.json(requests));
app.get('/qa-state', (_req, res) =>
  res.json({
    alpha: store.getBuddyAccess(lead.id, workspace.id, target.id),
    beta: store.getBuddyAccess(lead.id, workspace.id, secondTarget.id),
  })
);
app.post('/qa-external-change', (_req, res) => {
  const current = store.getBuddyAccess(lead.id, workspace.id, target.id)!;
  const next = store.setBuddyAccess({
    granteeId: lead.id,
    workspaceId: workspace.id,
    targetBuddyId: target.id,
    capabilities: ['memory.read'],
    baseRevision: current.revision,
    key: `fixture-external-${current.revision}`,
    reason: 'Concurrent owner update',
  });
  res.json({ revision: next.revision });
});
registerBuddyRoutes(app, {
  getStore: async () => store,
  getScheduler: () => null,
  createConversation: async () => {
    throw new Error('Browser fixture never starts providers');
  },
  sendError: (res, error, status) => res.status(status).json({ error: String(error) }),
  getNextAutomationRunAt: () => null,
  createId: () => 'draft-fixture-owner-input',
  isConversationDeleted: async () => false,
});
const vite = await createServer({
  configFile: false,
  root: resolve('client'),
  server: { middlewareMode: true },
  appType: 'custom',
});
app.get('/', async (_req, res) =>
  res
    .type('html')
    .send(
      await vite.transformIndexHtml(
        '/',
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/test/fixtures/team-settings-draft-entry.tsx"></script></body></html>'
      )
    )
);
app.use(vite.middlewares);
const http = app.listen(5201, '127.0.0.1', () =>
  console.log('Team settings draft fixture http://127.0.0.1:5201')
);
process.on('SIGTERM', () => {
  http.close();
  void vite.close();
  store.close();
  process.exit();
});
