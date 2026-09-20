// Local browser fixture: real store and HTTP routes; never starts a provider.
import express from 'express';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { BuddiesStore } from '@nbardy/buddies';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import routes from '../../../server/src/buddies/routes';
const { registerBuddyRoutes } = routes;
const root = mkdtempSync(join(tmpdir(), 'wave-ceo-browser-'));
const store = new BuddiesStore(':memory:');
const a = store.createWorkspace({ name: 'Wave fixture', rootPath: join(root, 'a') });
const b = store.createWorkspace({ name: 'Second workspace', rootPath: join(root, 'b') });
const lead = store.createBuddy({ project: a.id, name: 'Project Lead', role: 'Coordinate' });
const worker = store.createBuddy({ project: a.id, name: 'Product Engineer', role: 'Verify M0' });
store.reparentBuddy(worker.id, { managerId: lead.id, key: 'manager' });
store.assignBuddyToWorkspace({ buddy: lead.id, workspace: b.id });
for (const buddy of [lead, worker])
  store.setCoordinationMembership(buddy.id, a.id, {
    background_enabled: true,
    max_pending_runs: 100,
    max_sends_per_hour: 1000,
  });
store.setCoordinationMembership(lead.id, b.id, { background_enabled: true });
for (let i = 0; i < 22; i++)
  store.sendCoordinatedMessage(
    {
      fromBuddy: lead.id,
      to: worker.id,
      workspace: a.id,
      key: `older-${i}`,
      purpose: 'Earlier fixture work',
      body: 'Earlier fixture work',
      parentConversationId: 'lead',
      expectsReply: false,
    },
    { policy: { allowed_operations: [] } }
  );
const project = store.createCoordinatedProject(
  {
    workspaceId: a.id,
    ownerId: worker.id,
    title: 'M0 deciding fixture',
    definitionOfDone: 'Reviewed controls and evidence',
  },
  { actor: lead.id, key: 'project' }
);
const message = store.sendCoordinatedMessage(
  {
    fromBuddy: lead.id,
    to: worker.id,
    workspace: a.id,
    project: project.id,
    key: 'checkpoint-work',
    parentConversationId: 'lead',
    purpose: 'Verify M0',
    body: 'Verify the fixture controls',
    execution: { mode: 'until_done', maxRuns: 4, maxDurationSeconds: 7200 },
  },
  { policy: { allowed_operations: ['buddy.checkpoint', 'buddy.reply'] } }
);
const run = store.listBuddyRuns({ buddyId: worker.id, order: 'newest' })[0];
store.claimBuddyRun(run.id, { claimToken: 'fixture', conversationId: 'worker' });
store.startBuddyRun(run.id, 'fixture');
for (let i = 0; i < 5; i++) {
  const ref = join(root, `m0-${i}.md`),
    content = `M0 fixture checkpoint ${i}\n`;
  writeFileSync(ref, content);
  store.checkpointBuddyRun(run.id, {
    key: `checkpoint-${i}`,
    claimToken: 'fixture',
    artifacts: [
      { ref, version: `v${i}`, sha256: createHash('sha256').update(content).digest('hex') },
    ],
    effects: ['Saved local fixture evidence'],
    resume: 'Read and verify the saved bytes.',
    visibility: 'team',
  });
}
store.finishBuddyRun(run.id, {
  claimToken: 'fixture',
  status: 'failed',
  errorCode: 'max_runtime_timeout',
  error: 'Attempt expired after saving evidence.',
});
store.settleBackgroundReply(store.getMessage(message.id), 'failed', 'Legacy timeout', [
  `run:${run.id}`,
]);
let delivery = store
  .listBuddyRuns({ buddyId: lead.id })
  .find((r) => r.input_kind === 'message_reply')!;
for (let i = 0; i < 4; i++) {
  store.claimBuddyRun(delivery.id, { claimToken: `delivery-${i}`, conversationId: 'lead' });
  store.finishBuddyRun(delivery.id, {
    claimToken: `delivery-${i}`,
    status: 'failed',
    errorCode: 'delivery_unavailable',
    error: `Fixture return failure ${i + 1} before admission`,
  });
  if (i < 3)
    delivery = store.retryBuddyRun(delivery.id, {
      key: `delivery-retry-${i}`,
      actor: lead.id,
      reason: 'Inspected pre-admission failure',
    });
}
const app = express();
app.use(express.json());
app.get('/favicon.ico', (_req, res) => res.status(204).end());
const requests: Array<{ method: string; url: string; body?: unknown }> = [];
app.use((req, _res, next) => {
  if (req.path.startsWith('/api/buddies/'))
    requests.push({ method: req.method, url: req.url, body: req.body });
  next();
});
app.get('/qa-context', (_req, res) =>
  res.json({ buddyId: lead.id, workspaceId: a.id, otherWorkspaceId: b.id, runId: run.id })
);
app.get('/qa-requests', (_req, res) => res.json(requests));
let rejectOnce = true;
app.post('/api/buddies/runs/:id/retry', (_req, res, next) => {
  if (rejectOnce) {
    rejectOnce = false;
    res.status(503).json({ error: 'Fixture transient failure; draft must survive' });
  } else next();
});
registerBuddyRoutes(app, {
  getStore: async () => store,
  getScheduler: () => null,
  createConversation: async () => {
    throw new Error('Browser fixture never starts providers');
  },
  sendError: (res, error, status) => res.status(status).json({ error: String(error) }),
  getNextAutomationRunAt: () => null,
  createId: () => 'unused-fixture-id',
  isConversationDeleted: async () => false,
});
const vite = await createServer({
  configFile: false,
  root: resolve('client'),
  plugins: [react()],
  server: { middlewareMode: true },
  appType: 'custom',
});
app.get('/', async (_req, res) =>
  res
    .type('html')
    .send(
      await vite.transformIndexHtml(
        '/',
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/test/fixtures/ceo-browser-entry.tsx"></script></body></html>'
      )
    )
);
app.use(vite.middlewares);
const http = app.listen(5199, '127.0.0.1', () => console.log('CEO fixture http://127.0.0.1:5199'));
process.on('SIGTERM', () => {
  http.close();
  void vite.close();
  store.close();
  process.exit();
});
