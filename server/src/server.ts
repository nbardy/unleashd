import { execFileSync, execSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Provider as ProviderName } from '@unleashd/shared';
import {
  FORK_CAPABLE_PROVIDERS,
  buildMergeReviewPrompt,
  providerSupportsFork,
} from '@unleashd/shared';

import { executeCommand } from '@nbardy/agent-cli';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';
import { loadAllConversations, pollForChanges } from './adapters/loader';
import { NormalizedSessionCache } from './adapters/session-cache';
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
  SWARM_CONTEXT_COMMAND_TIMEOUT_MS,
} from './constants/timeouts';
import {
  type BuddyCreationService,
  createBuddyCreationService,
} from './conversations/buddy-creation-service';
import { ConversationConfigService } from './conversations/config-service';
import { ConversationConfigStore } from './conversations/config-store';
import { type ConversationRuntime, createConversationRuntime } from './conversations/runtime';
import { registerConversationRoutes } from './http/conversation-routes';
import { registerCoreRoutes } from './http/core-routes';
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
import { TurnAttemptJournal, createJournalTurnAttemptObserver } from './observability';
import { createPaletteService } from './palettes/palette-service';
import { buildPalettePrompt } from './palettes/prompt';
import { getProvider, providers } from './providers';
import { resolveConfigAgainstProviderCatalog } from './providers/catalog-service';
import { registerSwarmReadModelRoutes } from './swarm/read-model-routes';
import { registerSwarmRuntimeRoutes } from './swarm/routes';
import { isProcessAlive, readLatestSwarmRuntime } from './swarm/runtime';
import { registerConversationWebSocket } from './transport/conversation-websocket';

import { auditLocalAgents } from './audit.js';
import { BuddyBuilderService, type BuddyBuilderStore } from './buddies/builder';
import { createBuddiesIntegration } from './buddies/integration';
import { registerBuddyRoutes } from './buddies/routes';
import { BuddyScheduler, nextAutomationRunAt } from './buddies/scheduler';

let startupAuditResults: ReturnType<typeof auditLocalAgents> = [];

const VERBOSE = process.env.VERBOSE === '1' || process.argv.includes('--verbose');

const app = express();
const server = http.createServer(app);
const APP_DATA_DIR = path.resolve(
  process.env.UNLEASHD_DATA_DIR ?? path.join(os.homedir(), '.agent-viewer')
);
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
const turnAttemptObserver = createJournalTurnAttemptObserver(turnAttemptJournal);
let buddyScheduler: BuddyScheduler | null = null;
let shutdownController: ShutdownController | null = null;
const beginMutation = (options?: { allowDuringStartup?: boolean }) =>
  shutdownController?.beginMutation(options) ?? null;
const pauseBuddyScheduler = () => buddyScheduler?.pause();
const stopBuddyScheduler = () => {
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
  updateStatus: updateBuddyConversationLink,
  settleDelegation: settleBuddyDelegation,
  createLink: createBuddyConversationLink,
} = createBuddiesIntegration({
  getConversation: (id) => conversations.get(id),
});

// One hydration barrier governs both the authoritative initial snapshot and
// command admission. Disk state must be loaded before either can proceed.
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
  createConversation: (options) => new Conversation(options),
  registerConversation: applicationContext.registry.set,
  createConversationLink: createBuddyConversationLink,
  updateConversationStatus: updateBuddyConversationLink,
  broadcast: applicationContext.broadcast,
});

const Conversation = createConversationRuntime({
  broadcast: applicationContext.broadcast,
  registerSessionAlias: applicationContext.sessions.registerAlias,
  unregisterSessionAlias: applicationContext.sessions.unregisterAlias,
  clearExternalRunningStatus: applicationContext.externalActivity.clear,
  clearLocalCompletionSuppression: applicationContext.completionSuppression.clear,
  markLocalCompletionSuppression: applicationContext.completionSuppression.mark,
  persistCurrentSession: (conversation, sessionId) =>
    buddyCreationService.persistCurrentSession(conversation, sessionId),
  updateBuddyStatus: updateBuddyConversationLink,
  settleBuddyDelegation,
  getConversation: (id) => conversations.get(id),
  readLatestOompaRuntime: readLatestSwarmRuntime,
  createSessionId: uuidv4,
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
  getUIState: () => persistedServerState.getUIState(),
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
  creationFingerprint: buddyCreationService.creationFingerprint,
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

const UPLOADS_DIR = path.join(APP_DATA_DIR, 'uploads');
registerUploadRoutes(app, UPLOADS_DIR);
registerCoreRoutes(app, () => startupAuditResults);
registerConversationRoutes(app, (id) => conversations.get(id));
registerTurnDiagnosticsRoutes(app, turnAttemptJournal);

persistedServerState.registerRoutes(app);

registerBuddyRoutes(app, {
  getStore: getBuddiesStore,
  getScheduler: () => buddyScheduler,
  createConversation: buddyCreationService.createServerBuddyConversation,
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
  sendError: sendBuddiesError,
  getNextAutomationRunAt: nextAutomationRunAt,
  createId: uuidv4,
  // A missing record means "never persisted", not "deleted" — only an explicit
  // tombstone hides a link row.
  isConversationDeleted: async (conversationId) =>
    (await conversationConfigService.getRecord(conversationId))?.status === 'deleted',
});

registerSearchRoutes(app, () => conversations.values());

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
    const conversation = new Conversation(options);
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
registerStaticClient(app, path.join(__dirname, '../../client/dist'));

const DEV_CLIENT_PORT = 7489;
const DEV_API_PORT = 7499;
const PORT =
  process.env.PORT || (process.env.NODE_ENV === 'development' ? DEV_API_PORT : DEV_CLIENT_PORT);

shutdownController = registerShutdownHandlers(
  {
    forceExitGraceMs: HOT_RELOAD_FORCE_EXIT_GRACE_MS,
  },
  {
    conversations: () => conversations.values(),
    activeSchedulerRuns: () => buddyScheduler?.health().activeRunIds.length ?? 0,
    pauseScheduler: pauseBuddyScheduler,
    stopScheduler: stopBuddyScheduler,
    flushState: async () => {
      persistedServerState.flushUIStateSync();
      await turnAttemptJournal.flush();
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
  pollConversations: (mtimes, activeIds) =>
    pollForChanges(mtimes, activeIds, { cache: normalizedSessionCache }),
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
      startupAuditResults = auditLocalAgents();
      await normalizedSessionCache.initialize();
      await turnAttemptJournal.initialize();
      await persistedServerState.initialize();
      await paletteService.initialize();
    },
    startOptionalScheduler: async () => {
      try {
        buddyScheduler = new BuddyScheduler({
          store: await getBuddiesStore(),
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
      applicationContext.broadcast({ type: 'conversation_load_complete' });
      return true;
    },
    abortStartup: () => shutdownController?.abortStartup(),
    loadConversations: sessionLoader.loadExistingConversations,
    startPolling: sessionLoader.startFilePolling,
  }
).catch((error) => {
  console.error('Server startup failed before authoritative state was ready:', error);
  shutdownController?.handleStartupFailure();
});
