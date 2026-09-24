import { execFileSync, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import type { Provider as ProviderName } from '@unleashd/shared';
import {
  FORK_CAPABLE_PROVIDERS,
  buildMergeReviewPrompt,
  providerSupportsFork,
} from '@unleashd/shared';
import { resolveSessionTranscript } from './adapters/registry';
import { resolveBuddyAssignmentConfig } from './buddies/assignment-config';
import { type CoordinationStore, coordinationStore } from './buddies/coordination-store';
import { BuddyOperationInputSchemas } from './buddies/operations';
import { BuddyRunExecutor } from './buddies/run-executor';

import { executeCommand } from '@nbardy/agent-cli';
import express, { type ErrorRequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';
import { loadAllConversations, pollForChanges } from './adapters/loader';
import { NormalizedSessionCache } from './adapters/session-cache';
import { appDataDirectory, uploadsDirectory } from './app-data';
import { createConversationApplicationContext } from './application/context';
import { registerAuthRoutes } from './auth/express';
import { authorizeUpgrade } from './auth/gate';
import { describePolicy, resolveAuthPolicy } from './auth/policy';
import { setIgnorePatterns } from './config';
import {
  EXTERNAL_GRACE_MS,
  FILE_POLL_INTERVAL_MS,
  HOT_RELOAD_FORCE_EXIT_GRACE_MS,
  LOCAL_COMPLETION_SUPPRESS_MS,
  PALETTE_GENERATION_TIMEOUT_MS,
  SHUTDOWN_FLUSH_GRACE_MS,
  SWARM_CONTEXT_COMMAND_TIMEOUT_MS,
} from './constants/timeouts';
import {
  type BuddyCreationService,
  createBuddyCreationService,
} from './conversations/buddy-creation-service';
import { ConversationConfigService } from './conversations/config-service';
import { ConversationConfigStore } from './conversations/config-store';
import { retireLegacyUiState } from './conversations/legacy-ui-state';
import { type ConversationRuntime, createConversationRuntime } from './conversations/runtime';
import { registerConversationRoutes } from './http/conversation-routes';
import { registerCoreRoutes } from './http/core-routes';
import { registerErrorDiagnosticsRoutes } from './http/error-diagnostics-routes';
import { registerFilesystemRoutes } from './http/filesystem-routes';
import { createKnownProjectAuthorizer } from './http/known-projects';
import { resolveDefaultWorkingDirectory, resolveWorkingDirectoryInput } from './http/path-utils';
import { PersistedServerState } from './http/persisted-state';
import { registerSearchRoutes } from './http/search-routes';
import { registerTurnDiagnosticsRoutes } from './http/turn-diagnostics-routes';
import { registerUploadRoutes } from './http/upload-routes';
import { registerUsageRoutes } from './http/usage-routes';
import { createSessionLoader } from './lifecycle/session-loader';
import { type ShutdownController, registerShutdownHandlers } from './lifecycle/shutdown';
import { runServerStartup } from './lifecycle/startup';
import { registerStaticClient } from './lifecycle/static-client';
import { registerMergeRoutes } from './merge/routes';
import { resolveListenHost } from './network';
import {
  ErrorJournal,
  TurnAttemptJournal,
  createJournalTurnAttemptObserver,
  installConsoleErrorCapture,
} from './observability';
import { createPaletteService } from './palettes/palette-service';
import { buildPalettePrompt } from './palettes/prompt';
import { getProvider, providers } from './providers';
import { resolveConfigAgainstProviderCatalog } from './providers/catalog-service';
import { registerSwarmReadModelRoutes } from './swarm/read-model-routes';
import { registerSwarmRuntimeRoutes } from './swarm/routes';
import { isProcessAlive, readLatestSwarmRuntime } from './swarm/runtime';
import { registerConversationWebSocket } from './transport/conversation-websocket';

import { auditLocalAgents } from './audit.js';
import { createBuddyDirect } from './buddies/buddy-direct';
import { BuddyBuilderService, type BuddyBuilderStore } from './buddies/builder';
import { onBuddiesChanged, registerBuddyMutationFeed } from './buddies/change-feed';
import { createChannelResponder } from './buddies/channel-responder';
import { registerChannelRoutes } from './buddies/channel-routes';
import { BuddyControlServer } from './buddies/control-server';
import {
  createBuddyDispatchService,
  createReturnConversationPreparer,
} from './buddies/dispatch-service';
import { createBuddiesIntegration } from './buddies/integration';
import { BuddyMemoryReviewer } from './buddies/memory-review';
import { createMemoryReviewRunner } from './buddies/memory-review-runner';
import { ownerWorkspaceIds } from './buddies/owner-team-configuration';
import { registerBuddyRoutes } from './buddies/routes';
import { BuddyScheduler, nextAutomationRunAt } from './buddies/scheduler';

let startupAuditResults: ReturnType<typeof auditLocalAgents> = [];

const VERBOSE = process.env.VERBOSE === '1' || process.argv.includes('--verbose');

const app = express();
const server = http.createServer(app);
const APP_DATA_DIR = appDataDirectory();
const LISTEN_HOST = resolveListenHost();

const authResolution = resolveAuthPolicy({
  env: process.env,
  listenHost: LISTEN_HOST,
  dataDirectory: APP_DATA_DIR,
});
if (!authResolution.ok) {
  console.error(`[auth] ${authResolution.error}`);
  process.exit(1);
}
const AUTH_POLICY = authResolution.policy;
console.log(`[auth] ${describePolicy(AUTH_POLICY)}`);

// noServer + an explicit upgrade handler is what makes the WebSocket gateable:
// `new WebSocketServer({ server })` accepts every upgrade before any of our
// code runs, so the socket — which carries the full command surface — would
// stay open to anyone who can reach the port.
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const gateRequest = {
    method: request.method ?? 'GET',
    url: request.url ?? '/',
    headers: request.headers,
  };
  if (!authorizeUpgrade(AUTH_POLICY, gateRequest)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (client) => {
    wss.emit('connection', client, request);
  });
});
const conversationConfigStore = new ConversationConfigStore({
  appDataRoot: APP_DATA_DIR,
  logger: {
    warn: (warning) => console.warn('[conversation-config]', warning),
  },
});
const normalizedSessionCache = new NormalizedSessionCache(
  path.join(APP_DATA_DIR, 'session-cache-v1')
);
const conversationConfigService = new ConversationConfigService({
  store: conversationConfigStore,
  resolver: {
    resolve: async (config) => resolveConfigAgainstProviderCatalog(config),
  },
});
const persistedServerState = new PersistedServerState(APP_DATA_DIR, setIgnorePatterns);
const turnAttemptJournal = new TurnAttemptJournal({
  directory: path.join(APP_DATA_DIR, 'observability'),
});
const errorJournal = new ErrorJournal({
  directory: path.join(APP_DATA_DIR, 'observability'),
  serverBootId: turnAttemptJournal.serverBootId,
});
const turnAttemptObserver = createJournalTurnAttemptObserver(turnAttemptJournal);
let buddyScheduler: BuddyScheduler | null = null;
let shutdownController: ShutdownController | null = null;
const beginMutation = (options?: { allowDuringStartup?: boolean }) =>
  shutdownController?.beginMutation(options) ?? null;
const pauseBuddyScheduler = () => {
  buddyScheduler?.pause();
  memoryReviewer.pause();
};
const resumeBuddyScheduler = () => {
  buddyScheduler?.start();
  memoryReviewer.start();
};
const stopBuddyScheduler = () => {
  memoryReviewer.stop();
  buddyScheduler?.stop();
  buddyScheduler = null;
};

const applicationContext = createConversationApplicationContext<ConversationRuntime>({
  webSocketServer: wss,
  completionSuppressionMs: LOCAL_COMPLETION_SUPPRESS_MS,
});
const conversations = applicationContext.registry;
const {
  getStore: getBuddiesStore,
  sendError: sendBuddiesError,
  resolveConversation: resolveBuddyConversation,
  readCurrentConversation: readCurrentBuddyContext,
  updateStatus: updateBuddyConversationLink,
  settleDelegation: settleBuddyDelegation,
  createLink: createBuddyConversationLink,
} = createBuddiesIntegration({
  getConversation: (id) => conversations.get(id),
});

// One hydration barrier governs both the authoritative initial snapshot and
// command admission. Disk state must be loaded before either can proceed.
//
// The barrier means "startup is no longer in progress", NOT "startup succeeded".
// Every terminal outcome must resolve it — see the `.finally` on runServerStartup
// below. A reload IPC arriving mid-startup makes completeStartup() return false,
// and before 2026-08-20 that path left this promise pending forever, so every
// non-create WS command awaited it with no reply and no error, and the client's
// load spinner never cleared. Waiters that resume into a non-idle state are
// refused by beginMutation with a typed rejection, which the client can retry.
let resolveInitialLoad!: () => void;
const initialLoadComplete = new Promise<void>((resolve) => {
  resolveInitialLoad = resolve;
});

// =============================================================================
// Helper Functions
// =============================================================================

const STARTUP_INITIAL_LOAD_LIMIT = readPositiveIntEnv('CWV_STARTUP_INITIAL_LOAD_LIMIT', 500);
const STARTUP_PARSE_CONCURRENCY = readPositiveIntEnv('CWV_STARTUP_PARSE_CONCURRENCY', 16);
const STARTUP_LOAD_BATCH_SIZE = readPositiveIntEnv('CWV_STARTUP_BATCH_SIZE', 100);
const STARTUP_INITIAL_BATCH_SIZE = readPositiveIntEnv('CWV_STARTUP_INITIAL_BATCH_SIZE', 20);
const STARTUP_PROGRESS_FILE_STEP = readPositiveIntEnv('CWV_STARTUP_LOG_EVERY_FILES', 500);
const AGENT_CLI_DEBUG_EVENTS = process.env.AGENT_CLI_DEBUG_EVENTS === '1';

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const buddyCreationService: BuddyCreationService = createBuddyCreationService({
  configService: conversationConfigService,
  resolveBuddyConversation,
  resolveWorkingDirectory: resolveWorkingDirectoryInput,
  isProviderAvailable: (provider) => provider in providers,
  createId: uuidv4,
  getConversation: (id) => applicationContext.registry.get(id),
  createConversation: (options) => new Conversation(options),
  registerConversation: applicationContext.registry.set,
  createConversationLink: createBuddyConversationLink,
  updateConversationStatus: updateBuddyConversationLink,
  broadcast: applicationContext.broadcast,
});

const buddyDispatchService = createBuddyDispatchService({
  getStore: getBuddiesStore,
  resolveAssignmentConfig: (config, conversationId) =>
    resolveBuddyAssignmentConfig(conversationConfigService, config, conversationId),
  prepareReturnConversation: createReturnConversationPreparer({
    getConversation: (id) => conversations.get(id),
    configService: conversationConfigService,
    createConversation: buddyCreationService.createServerBuddyConversation,
  }),
  launchConfig: (context, sourceId) => {
    const source = conversations.get(sourceId);
    return source?.buddyContext?.buddyId === context.buddyId &&
      source.buddyContext.workspaceId === context.workspaceId
      ? source.config
      : undefined;
  },
  createConversation: buddyCreationService.createServerBuddyConversation,
  dispatchInitialMessage: (conversation, options) =>
    buddyCreationService.dispatchInitialMessageIfPending(
      conversation as ConversationRuntime,
      options
    ),
  abandonConversation: (conversation) => {
    const runtime = conversation as ConversationRuntime;
    runtime.stop();
    updateBuddyConversationLink(runtime, 'cancelled');
  },
});
const buddyControlServer = new BuddyControlServer({
  getStore: getBuddiesStore,
  isConversationActive: (conversationId) => conversations.get(conversationId)?.isRunning === true,
  dispatchMessage: buddyDispatchService.send,
});

let coordinationRuntimeStore: CoordinationStore | null = null;
const memoryReviewer = new BuddyMemoryReviewer({
  directory: path.join(APP_DATA_DIR, 'memory-reviews'),
  getStore: getBuddiesStore,
  run: createMemoryReviewRunner(buddyControlServer),
  logger: console,
});
const Conversation = createConversationRuntime({
  readCurrentBuddyContext,
  reviewCompletedBuddyTurn: (turn) => memoryReviewer.enqueue(turn),
  beginBuddyChatRun: (context, conversationId, maxRuntimeMs) => {
    if (!coordinationRuntimeStore) throw new Error('Buddy execution store is not ready');
    const run = coordinationRuntimeStore.beginBuddyChatRun({
      buddyId: context.buddyId,
      workspaceId: context.workspaceId,
      conversationId,
      projectId: context.buddyProjectId,
      allowedOperations: context.allowedBuddyOperations ?? Object.keys(BuddyOperationInputSchemas),
      // Explicitly pass the foreground budget (runtime ms -> package seconds).
      // Do not fall back to a package/background default: that reintroduced the
      // 600s cutoff independently of the already-fixed bridge watchdog.
      maxRuntimeSeconds: maxRuntimeMs / 1000,
    });
    return { id: run.id, claim_token: run.claim_token!, deadline: run.deadline! };
  },
  finishBuddyChatRun: (id, token, status, detail) => {
    if (!coordinationRuntimeStore) throw new Error('Buddy execution store is not ready');
    const run = coordinationRuntimeStore.getBuddyRun(id);
    coordinationRuntimeStore.finishBuddyRun(id, {
      claimToken: token,
      status: run?.status === 'cancel_requested' ? 'cancelled' : status,
      outcome: status === 'complete' ? detail : undefined,
      error: status === 'failed' ? detail : undefined,
    });
  },
  broadcast: applicationContext.broadcast,
  registerSessionAlias: applicationContext.sessions.registerAlias,
  unregisterSessionAlias: applicationContext.sessions.unregisterAlias,
  clearExternalRunningStatus: applicationContext.externalActivity.clear,
  clearLocalCompletionSuppression: applicationContext.completionSuppression.clear,
  markLocalCompletionSuppression: applicationContext.completionSuppression.mark,
  persistCurrentSession: (conversation, sessionId, buddyAudienceKey) =>
    buddyCreationService.persistCurrentSession(conversation, sessionId, buddyAudienceKey),
  persistSessionUsage: async (conversationId, sessionId, usage) => {
    await conversationConfigStore.setCurrentSessionUsage(conversationId, sessionId, usage);
  },
  updateBuddyStatus: updateBuddyConversationLink,
  settleBuddyDelegation,
  getConversation: (id) => conversations.get(id),
  readLatestOompaRuntime: readLatestSwarmRuntime,
  createSessionId: uuidv4,
  issueBuddyControlCapability: (context, conversationId, automationClaimToken) =>
    buddyControlServer.issue(context, conversationId, automationClaimToken),
  revokeBuddyControlCapability: (conversationId) => buddyControlServer.revoke(conversationId),
  issueOwnerControlCapability: (input, conversationId) => {
    if (!coordinationRuntimeStore) throw new Error('Buddy execution store is not ready');
    return buddyControlServer.issueOwner(
      input,
      conversationId,
      ownerWorkspaceIds(coordinationRuntimeStore),
      () => ownerWorkspaceIds(coordinationRuntimeStore!),
      conversations.get(conversationId)?.kind.kind === 'buddy_builder'
    );
  },
  recordBuddyTurnOrigin: (conversationId, input, context, contentHash) => {
    if (!coordinationRuntimeStore) throw new Error('Buddy execution store is not ready');
    coordinationRuntimeStore.recordAuditEvent({
      buddy: context.buddyId,
      workspace: context.workspaceId,
      operation: 'buddy.turn_input',
      payload: {
        conversation_id: conversationId,
        input_id: input.inputId,
        origin: input.origin,
        content_hash: contentHash,
      },
    });
  },
  requestAutomationCancellation: async (runId) => {
    if (!buddyScheduler) throw new Error('Buddy automation scheduler is not ready');
    return buddyScheduler.cancel(runId);
  },
  turnAttempts: turnAttemptObserver,
});

registerConversationWebSocket(wss, {
  registry: applicationContext.registry,
  sessions: applicationContext.sessions,
  externalActivity: applicationContext.externalActivity,
  completionSuppression: applicationContext.completionSuppression,
  initialLoadComplete,
  // Lifecycle: `starting` hydrates disk history, `idle` is the sole ready state
  // for mutations on existing history. WS `init` streams immediately with
  // `loading:true` + summaries; Phase 2 batches arrive via
  // `conversations_updated` and `conversation_load_complete` flips `idle`.
  // Only `create_conversation` is allowed during `starting` (5d79890) — it
  // mints a fresh UUID/config record that cannot collide with disk hydration.
  // All other commands await `initialLoadComplete` in the WS handler so they
  // never race the authoritative restore.
  isInitialLoadComplete: () => shutdownController?.state === 'idle',
  beginCommand: (command) =>
    beginMutation({ allowDuringStartup: command.type === 'create_conversation' }),
  configService: conversationConfigService,
  isBuddyArchived: async (buddyId) =>
    (await getBuddiesStore()).getBuddy(buddyId)?.status === 'archived',
  getArchivedBuddyIds: async () =>
    (await getBuddiesStore())
      .listBuddies()
      .filter((buddy) => buddy.status === 'archived')
      .map((buddy) => buddy.id),
  getDefaultWorkingDirectory: () => resolveDefaultWorkingDirectory(),
  resolveWorkingDirectory: resolveWorkingDirectoryInput,
  resolveBuddyConversation,
  createConversation: (options) => new Conversation(options),
  createConversationLink: createBuddyConversationLink,
  cancelBuddyConversation: (conversation) => {
    updateBuddyConversationLink(conversation, 'cancelled');
    void settleBuddyDelegation(conversation, 'cancelled');
  },
  dispatchInitialMessage: buddyCreationService.dispatchInitialMessageIfPending,
  broadcast: applicationContext.broadcast,
  broadcastExcept: applicationContext.broadcastExcept,
});

// =============================================================================
// Express Routes
// =============================================================================

// Auth first: every route below (API, uploads, and the static app shell) is
// unreachable without the shared secret.
registerAuthRoutes(app, AUTH_POLICY);

// JSON body parser for API routes.
// Default limit is 100kb which is far too small — queue-message, merge, and
// other endpoints routinely carry pasted content, inline images, or full
// conversation histories. Matches client uploads already sized in MB.
app.use(express.json({ limit: '50mb' }));
app.use((request, response, next) => {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    next();
    return;
  }
  const release = beginMutation();
  if (!release) {
    const draining = shutdownController?.state !== 'starting';
    response.status(503).json({
      error: draining ? 'server_draining' : 'server_starting',
      message: draining
        ? 'Backend reload is draining active turns; try again after reconnecting'
        : 'Backend is restoring persisted conversations; try again when startup completes',
      retryable: true,
    });
    return;
  }
  response.once('finish', release);
  response.once('close', release);
  next();
});

const UPLOADS_DIR = uploadsDirectory();
registerUploadRoutes(app, UPLOADS_DIR);
registerCoreRoutes(app, () => startupAuditResults);
registerConversationRoutes(app, (id) => conversations.get(id), {
  getBranch: async (id) => (await conversationConfigService.getRecord(id))?.creation?.branch,
});
registerTurnDiagnosticsRoutes(app, turnAttemptJournal);
registerErrorDiagnosticsRoutes(app, errorJournal);

persistedServerState.registerRoutes(app);

// Buddy change feed → one debounced WS event per burst of writes. 250ms is
// long enough to fold a multi-step owner action (route + operations) into a
// single client refresh and short enough to read as live.
let buddiesChangedTimer: NodeJS.Timeout | null = null;
onBuddiesChanged(() => {
  if (buddiesChangedTimer) return;
  buddiesChangedTimer = setTimeout(() => {
    buddiesChangedTimer = null;
    applicationContext.broadcast({ type: 'buddies_changed' });
  }, 250);
  buddiesChangedTimer.unref();
});
registerBuddyMutationFeed(app);

registerBuddyRoutes(app, {
  onBuddyArchived: async (buddyId) => {
    applicationContext.broadcast({ type: 'buddy_archived', buddyId });
    for (const conversation of conversations.values()) {
      if (conversation.kind.kind === 'buddy' && conversation.kind.buddyId === buddyId) {
        conversation.clearQueue();
        conversation.stop();
      }
    }
  },
  getStore: getBuddiesStore,
  dispatchMessage: buddyDispatchService.send,
  getScheduler: () => buddyScheduler,
  createBuilderConversation: ({ commandId, conversationId }) =>
    buddyCreationService.createBuddyBuilderConversation({
      commandId,
      conversationId,
      // The Builder has no buddy workspace yet — it is the thing that creates
      // one — so it gets the default workspace, not the server's own cwd.
      workingDirectory: resolveDefaultWorkingDirectory(),
    }),
  getBuilderResult: async (conversationId) =>
    new BuddyBuilderService(
      (await getBuddiesStore()) as unknown as BuddyBuilderStore,
      conversationId
    ).getResult(),
  getBuilderResults: async (conversationId) =>
    new BuddyBuilderService(
      (await getBuddiesStore()) as unknown as BuddyBuilderStore,
      conversationId
    ).getResults(),
  sendError: sendBuddiesError,
  getNextAutomationRunAt: nextAutomationRunAt,
  createId: uuidv4,
  // A missing record means "never persisted", not "deleted" — only an explicit
  // tombstone hides a link row.
  isConversationDeleted: async (conversationId) =>
    (await conversationConfigService.getRecord(conversationId))?.status === 'deleted',
});

registerChannelRoutes(app, {
  getStore: getBuddiesStore,
  uploadsRoot: UPLOADS_DIR,
  sendError: sendBuddiesError,
  responder: createChannelResponder({
    getStore: getBuddiesStore,
    getConversation: (id) => applicationContext.registry.get(id),
    ensureConversationReady: buddyCreationService.ensureConversationReady,
    // Owner-origin creation: the mention IS owner input, so the thread gets
    // owner-thread knowledge scope and owner-control MCP, like a talk() chat.
    createConversation: (input) => buddyCreationService.createServerBuddyConversation(input),
    uploadsRoot: () => UPLOADS_DIR,
  }),
  direct: createBuddyDirect({
    getStore: getBuddiesStore,
    getConversation: (id) => applicationContext.registry.get(id),
    ensureConversationReady: buddyCreationService.ensureConversationReady,
    createConversation: (input) => buddyCreationService.createServerBuddyConversation(input),
    isConversationDeleted: async (conversationId) =>
      (await conversationConfigService.getRecord(conversationId))?.status === 'deleted',
  }),
});

registerSearchRoutes(
  app,
  () => conversations.values(),
  async () => {
    const store = await getBuddiesStore();
    return (conversationId) => {
      const kind = conversations.get(conversationId)?.kind;
      return kind?.kind !== 'buddy' || store.getBuddy(kind.buddyId)?.status !== 'archived';
    };
  }
);

const isUnderKnownProject = createKnownProjectAuthorizer(() =>
  Array.from(conversations.values(), (conversation) => conversation.workingDirectory)
);
registerFilesystemRoutes(app, {
  uploadsDirectory: UPLOADS_DIR,
  isUnderKnownProject,
});

registerSwarmRuntimeRoutes(app, {
  isUnderKnownProject,
  listProjectRoots: () =>
    Array.from(conversations.values(), (conversation) => conversation.workingDirectory),
});

registerSwarmReadModelRoutes(app, {
  isUnderKnownProject,
  resolveWorkingDirectory: resolveWorkingDirectoryInput,
  captureSwarmCommand(command, workingDirectory) {
    try {
      return execSync(command, {
        cwd: workingDirectory,
        timeout: SWARM_CONTEXT_COMMAND_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8',
      }).trim();
    } catch (error) {
      if (error === null || typeof error !== 'object') return String(error);
      const commandError = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
      return [commandError.stdout, commandError.stderr, commandError.message]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .trim();
    }
  },
  executeGit: (args, workingDirectory, timeoutMs) =>
    execFileSync('git', args, {
      cwd: workingDirectory,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
    }),
  isProcessAlive,
  now: Date.now,
});

registerMergeRoutes(app, {
  getConversation: (id) => conversations.get(id),
  createAndAddConversation(options) {
    // Merge parents and review children are brand-new records.
    const conversation = new Conversation({ ...options, done: false });
    conversations.set(conversation);
    return conversation;
  },
  configService: conversationConfigService,
  providerSupportsFork,
  forkCapableProviders: FORK_CAPABLE_PROVIDERS,
  buildReviewPrompt: buildMergeReviewPrompt,
  createId: uuidv4,
  broadcast: applicationContext.broadcast,
});

const paletteService = createPaletteService({
  directory: path.join(APP_DATA_DIR, 'palettes'),
  generationTimeoutMs: PALETTE_GENERATION_TIMEOUT_MS,
  debugRawEvents: AGENT_CLI_DEBUG_EVENTS,
  cwd: process.cwd(),
  ports: {
    startGeneration: executeCommand,
    validateProvider: (provider) => {
      getProvider(provider as ProviderName);
    },
    buildPrompt: buildPalettePrompt,
  },
});
paletteService.registerRoutes(app);

registerUsageRoutes(app, Object.keys(providers) as ProviderName[]);
app.get('/api/buddies/:buddyId/memory-reviews', async (req, res) => {
  try {
    const store = await getBuddiesStore();
    if (!store.getBuddy(req.params.buddyId)) {
      res.status(404).json({ error: 'Buddy not found' });
      return;
    }
    res.json(memoryReviewer.list(req.params.buddyId));
  } catch (error) {
    sendBuddiesError(res, error, 500);
  }
});
registerStaticClient(app, path.join(__dirname, '../../client/dist'));

const captureUnhandledHttpError: ErrorRequestHandler = (error, request, response, next) => {
  console.error(`[http] Unhandled ${request.method} ${request.path}:`, error);
  if (response.headersSent) {
    next(error);
    return;
  }
  response.status(500).json({ error: 'Internal server error' });
};
app.use(captureUnhandledHttpError);

const DEV_CLIENT_PORT = 7489;
const DEV_API_PORT = 7499;
const PORT =
  process.env.PORT || (process.env.NODE_ENV === 'development' ? DEV_API_PORT : DEV_CLIENT_PORT);

shutdownController = registerShutdownHandlers(
  {
    forceExitGraceMs: HOT_RELOAD_FORCE_EXIT_GRACE_MS,
    flushGraceMs: SHUTDOWN_FLUSH_GRACE_MS,
  },
  {
    conversations: () => conversations.values(),
    activeSchedulerRuns: () =>
      (buddyScheduler?.health().activeRunIds.length ?? 0) + memoryReviewer.activeCount(),
    pauseScheduler: pauseBuddyScheduler,
    resumeScheduler: resumeBuddyScheduler,
    stopScheduler: stopBuddyScheduler,
    flushState: async () => {
      await Promise.all([turnAttemptJournal.flush(), errorJournal.flush()]);
      await buddyControlServer.close();
    },
    broadcastMessage: (conversationId, content) => {
      applicationContext.broadcast({ type: 'message', conversationId, role: 'system', content });
    },
    exit: (code = 0) => process.exit(code),
  }
);

const sessionLoader = createSessionLoader({
  options: {
    startupLimit: STARTUP_INITIAL_LOAD_LIMIT,
    startupConcurrency: STARTUP_PARSE_CONCURRENCY,
    startupBatchSize: STARTUP_LOAD_BATCH_SIZE,
    startupInitialBatchSize: STARTUP_INITIAL_BATCH_SIZE,
    startupLogEveryFiles: STARTUP_PROGRESS_FILE_STEP,
    pollIntervalMs: FILE_POLL_INTERVAL_MS,
    externalGraceMs: EXTERNAL_GRACE_MS,
    verbose: VERBOSE,
  },
  registry: applicationContext.registry,
  sessions: applicationContext.sessions,
  externalActivity: applicationContext.externalActivity,
  completionSuppression: applicationContext.completionSuppression,
  configStore: conversationConfigStore,
  configService: conversationConfigService,
  loadConversations: (options) =>
    loadAllConversations({ ...options, cache: normalizedSessionCache }),
  pollConversations: (mtimes, activeIds, options) =>
    pollForChanges(mtimes, activeIds, { ...options, cache: normalizedSessionCache }),
  createConversation: (options) => new Conversation(options),
  createId: uuidv4,
  resolveBuddyConversation,
  dispatchInitialMessage: buddyCreationService.dispatchInitialMessageIfPending,
  persistCurrentSession: buddyCreationService.persistCurrentSession,
  broadcast: applicationContext.broadcast,
});

const portNumber = typeof PORT === 'string' ? Number.parseInt(PORT, 10) : PORT;
void runServerStartup(
  {
    port: portNumber,
    host: LISTEN_HOST,
    development: process.env.NODE_ENV === 'development',
    developmentClientPort: DEV_CLIENT_PORT,
  },
  {
    server,
    initialize: async () => {
      await errorJournal.initialize();
      installConsoleErrorCapture(errorJournal);
      await buddyControlServer.start();
      startupAuditResults = auditLocalAgents();
      await normalizedSessionCache.initialize();
      await turnAttemptJournal.initialize();
      await persistedServerState.initialize();
      // Before any conversation loads: runtimes copy record.done at construction.
      await retireLegacyUiState({ dataDirectory: APP_DATA_DIR, store: conversationConfigStore });
      await paletteService.initialize();
    },
    startOptionalScheduler: async () => {
      try {
        const coordinationPackage = await getBuddiesStore();
        coordinationRuntimeStore = coordinationStore(coordinationPackage);
        try {
          await memoryReviewer.initialize();
          memoryReviewer.start();
        } catch (error) {
          console.warn('[buddies] Memory reviewer unavailable:', error);
        }
        buddyScheduler = new BuddyScheduler({
          store: coordinationPackage,
          memoryReviewAfterEachTurn: true,
          pollIntervalMs: 1000,
          coordination: new BuddyRunExecutor({
            cancelLegacyRun: (id) => buddyScheduler?.cancel(id) ?? Promise.resolve(),
            store: coordinationPackage,
            getConversation: (id) => conversations.get(id),
            getConversationRecord: (id) => conversationConfigService.getRecord(id),
            getTranscriptReference: async (id) => {
              const runtime = conversations.get(id);
              const record = await conversationConfigService.getRecord(id);
              const binding =
                record?.currentSession ??
                (runtime ? { provider: runtime.provider, sessionId: runtime.sessionId } : null);
              return binding ? resolveSessionTranscript(binding.provider, binding.sessionId) : null;
            },
            createConversation: buddyCreationService.createServerBuddyConversation,
            ensureConversationReady: buddyCreationService.ensureConversationReady,
          }),
          createConversation: buddyCreationService.createAutomationConversation,
        });
        buddyScheduler.start();
        console.log('Buddy scheduler started');
      } catch (error) {
        console.warn('[buddies] Scheduler unavailable:', error);
      }
    },
    pauseOptionalScheduler: pauseBuddyScheduler,
    isStartupActive: () => shutdownController?.state === 'starting',
    markReady: () => {
      if (!shutdownController?.completeStartup()) return false;
      resolveInitialLoad();
      applicationContext.broadcast({
        type: 'conversation_load_complete',
        conversationIds: Array.from(conversations.keys()),
      });
      return true;
    },
    abortStartup: () => shutdownController?.abortStartup(),
    loadConversations: () =>
      conversationConfigStore.withSessionLookupIndex(sessionLoader.loadExistingConversations),
    startPolling: sessionLoader.startFilePolling,
  }
)
  .catch((error) => {
    console.error('Server startup failed before authoritative state was ready:', error);
    shutdownController?.handleStartupFailure();
  })
  // Startup has three terminal outcomes — ready, aborted early, threw — and only
  // the first resolved this barrier. The other two left every non-create WS
  // command awaiting it forever with no reply (incident 2026-08-20). Resolving
  // here covers all three; it is idempotent with the call in markReady.
  .finally(() => resolveInitialLoad());
