import crypto from 'node:crypto';
import type { McpServerSpec } from '@nbardy/agent-cli';
import type {
  BuddyContext,
  BuddyKind,
  BuddyVisibility,
  ConversationKind,
  Message,
  Provider as ProviderName,
  ResolvedExecutionConfig,
} from '@unleashd/shared';
import {
  BUDDY_TEAM_CONTRACT_VERSION,
  formatBuddyBuilderToolResult,
  matchConversationKind,
} from '@unleashd/shared';
import { TURN_MAX_RUNTIME_MS } from '../constants/timeouts';
import type { ConversationRuntimeView } from '../conversations/runtime';
import type { TurnTerminalCause } from '../observability';
import { noteActivity } from '../observability/event-loop-stall';
import { type SessionRelativePrompt, type TurnInput, sameEitherWay } from '../turns/input';
import {
  type CoordinationDrained,
  type MemorySnapshot,
  type TurnEnd,
  type TurnGate,
  type TurnPolicy,
  chatFirstTurnPrompt,
  formatCommonToolResult,
} from '../turns/policy';
import { BUDDY_BUILDER_BRIEFING } from './builder';
import {
  BUDDY_AUTOMATION_CLAIM_TOKEN_ENV,
  buddyBuilderMcpServers,
  buddyMcpServers,
  buddyOwnerMcpServers,
} from './mcp-config';
import type { CompletedBuddyTurn } from './memory-review';
import { assertBuddyProviderSupportsMcp } from './provider-capability';

/**
 * The Buddy and Buddy Builder turn policies: everything a Buddy thread adds to
 * a turn (run-slot admission, briefing and memory snapshot, audience fence,
 * tool grants / MCP servers, coordination and automation runs, memory review).
 * Moved intact out of conversations/runtime.ts (T08 S7); T11 replaces it on
 * the new Buddies core.
 */

export type { MemorySnapshot } from '../turns/policy';

export type OwnedBuddyChatRun = { id: string; claim_token: string; deadline: string };
export type BuddyChatAdmission =
  | { kind: 'admitted'; run: OwnedBuddyChatRun }
  | { kind: 'waiting'; reason: string }
  // The queued row was cancelled elsewhere (e.g. another host's startup sweep).
  | { kind: 'gone' };

/**
 * The disclosure audience a Buddy turn runs under. `key` is persisted with the
 * provider session built under it; `continuityFrom` asks the Buddies package
 * (knowledgeAudienceContinuity owns the rule) whether a session built under an
 * earlier key may continue: 'contained' when only read access grew, 'changed'
 * when access narrowed or the audience differs, 'unverified' when the saved key
 * cannot be compared (a revision hash saved before 2026-09-25).
 */
export type BuddyTurnAudience = Readonly<{
  key: string;
  continuityFrom(sessionKey: string): BuddyAudienceContinuity;
}>;
export type BuddyAudienceContinuity = 'contained' | 'changed' | 'unverified';

/** What the Buddy policies need from the host server. */
export interface BuddyTurnPolicyDependencies {
  updateBuddyStatus(
    conversation: ConversationRuntimeView,
    status: 'active' | 'complete' | 'failed' | 'cancelled'
  ): void;
  settleBuddyDelegation(
    conversation: ConversationRuntimeView,
    status: 'complete' | 'failed' | 'cancelled',
    outcome?: string
  ): void;
  readCurrentBuddyContext?(context: BuddyContext): {
    briefing: string;
    memoryGeneration: string;
    audience?: BuddyTurnAudience;
  };
  /** Enqueue memory maintenance only after a successful CLI exit and normalized event drain. */
  reviewCompletedBuddyTurn?(turn: CompletedBuddyTurn): void;
  /**
   * A Buddy chat/channel turn takes its place in its Buddy's FIFO run line
   * (per-Buddy limit, owner decision 2026-09-25), then polls until admitted.
   */
  enqueueBuddyChatRun?(context: BuddyContext, conversationId: string): { id: string };
  startBuddyChatRun?(
    runId: string,
    conversationId: string,
    maxRuntimeMs: number
  ): BuddyChatAdmission;
  abandonBuddyChatRun?(runId: string): void;
  finishBuddyChatRun?(
    id: string,
    token: string,
    status: 'complete' | 'failed' | 'cancelled',
    detail?: string
  ): void;
  issueBuddyControlCapability?(
    context: BuddyContext,
    conversationId: string,
    automationClaimToken?: string
  ): Readonly<Record<string, string>>;
  revokeBuddyControlCapability?(conversationId: string): void;
  issueOwnerControlCapability?(
    input: Readonly<{ origin: 'owner_input'; inputId: string }>,
    conversationId: string
  ): Readonly<Record<string, string>>;
  recordBuddyTurnOrigin?(
    conversationId: string,
    input: TurnInput,
    context: BuddyContext,
    contentHash: string
  ): void;
  requestAutomationCancellation?(runId: string): Promise<unknown>;
}

/** What a Buddy policy may see and do on its conversation. */
export interface BuddyPolicyHost {
  readonly id: string;
  readonly view: ConversationRuntimeView;
  visibility(): BuddyVisibility;
  provider(): ProviderName;
  hasProcess(): boolean;
  hasStartedSession(): boolean;
  resetProcess(): void;
  /** A sending queue head that did not start goes back to pending. */
  releaseQueueHead(broadcast: boolean): void;
  /** Drop a pending head whose turn will never start (cancels its attempt). */
  dropPendingHead(): void;
  processQueue(): void;
  maxRuntimeReached(): void;
  refuseAutomationTranscript(message?: string): void;
  send(prompt: SessionRelativePrompt, input: TurnInput): void;
  on(event: string, listener: (...args: string[]) => void): void;
  once(event: string, listener: (...args: string[]) => void): void;
  off(event: string, listener: (...args: string[]) => void): void;
  emit(event: string, ...args: string[]): void;
}

// --- Memory snapshots -----------------------------------------------------

/** Boundary input accepts the numeric generation used by the v2 package; the runtime stores only an opaque string. */
export type MemoryGenerationInput = string | number;

export type AutomationMemoryWritePolicy = 'not_applicable' | 'denied' | 'allowed' | 'unsupported';

const MEMORY_WRITE_OPERATIONS = new Set([
  'buddy.remember',
  'buddy.remember_note',
  'buddy.update_memory',
  'buddy.compact_memory',
]);

function providerSupportsRequiredBuddyMcp(provider: ProviderName): boolean {
  try {
    assertBuddyProviderSupportsMcp(provider);
    return true;
  } catch {
    return false;
  }
}

export function memoryGenerationForBriefing(briefing: string): string {
  return `briefing-sha256:${crypto.createHash('sha256').update(briefing, 'utf8').digest('hex')}`;
}

export function createMemorySnapshot(
  briefing: string | null | undefined,
  generation?: MemoryGenerationInput | null
): MemorySnapshot | null {
  if (briefing === null || briefing === undefined) return null;
  const normalizedGeneration =
    generation === null || generation === undefined
      ? memoryGenerationForBriefing(briefing)
      : String(generation).trim() || memoryGenerationForBriefing(briefing);
  return Object.freeze({ briefing, generation: normalizedGeneration });
}

/**
 * Resolve automation memory-write policy before provider startup.  A missing
 * allowlist is intentionally read-only; durable run policy remains the final
 * operation gate inside the Buddy control plane.  This helper only makes the
 * provider/capability boundary explicit and never creates a worker.
 */
export function resolveAutomationMemoryWritePolicy(input: {
  isAutomation: boolean;
  provider: ProviderName;
  allowedOperations?: readonly string[];
  hasClaimToken: boolean;
}): AutomationMemoryWritePolicy {
  if (!input.isAutomation) return 'not_applicable';
  const requestsMemoryWrite = (input.allowedOperations ?? []).some((operation) =>
    MEMORY_WRITE_OPERATIONS.has(operation)
  );
  if (!requestsMemoryWrite) return 'denied';
  if (!input.hasClaimToken || !providerSupportsRequiredBuddyMcp(input.provider)) {
    return 'unsupported';
  }
  return 'allowed';
}

const BUDDY_CONTEXT_V2_HEADER_RE =
  /^<!-- unleashd:buddy-context-v2 ([A-Za-z0-9_-]+) ([0-9]+) -->\n/;
const BUDDY_CONTEXT_V2_SUFFIX = '\n<!-- /unleashd:buddy-context-v2 -->\n\n';
const MEMORY_GENERATION_RE = /^<!-- unleashd:buddy-memory-generation ([A-Za-z0-9_-]+) -->\n/;

/**
 * Recover the hidden snapshot embedded in a first provider prompt.  This is a
 * compatibility bridge for restart/hydration: the application conversation
 * keeps the same briefing even if the current Buddy memory has advanced.
 */
export function extractBuddyMemorySnapshot(content: string): MemorySnapshot | null {
  const header = content.match(BUDDY_CONTEXT_V2_HEADER_RE);
  if (!header) return null;
  const briefingLength = Number.parseInt(header[2], 10);
  const briefingStart = header[0].length;
  const suffixStart = briefingStart + briefingLength;
  if (
    !Number.isSafeInteger(briefingLength) ||
    briefingLength < 0 ||
    !content.startsWith(BUDDY_CONTEXT_V2_SUFFIX, suffixStart)
  ) {
    return null;
  }
  const encodedBriefing = content.slice(briefingStart, suffixStart);
  const generationMarker = encodedBriefing.match(MEMORY_GENERATION_RE);
  if (!generationMarker) {
    return createMemorySnapshot(encodedBriefing);
  }
  let generation: string;
  try {
    generation = Buffer.from(generationMarker[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!generation) return null;
  return createMemorySnapshot(encodedBriefing.slice(generationMarker[0].length), generation);
}

// --- First-turn provider prompts ---------------------------------------------

function buddyFirstTurnPrompt(input: {
  kind: BuddyKind;
  content: string;
  firstUnstartedTurn: boolean;
  refreshBriefing: boolean;
  briefing: string | null;
  memoryGeneration: MemoryGenerationInput | null;
}): string {
  if ((!input.firstUnstartedTurn && !input.refreshBriefing) || input.briefing === null)
    return input.content;
  const ctx: BuddyContext = input.kind.context;
  const encodedContext = Buffer.from(JSON.stringify(ctx), 'utf8').toString('base64url');
  const snapshot = createMemorySnapshot(input.briefing, input.memoryGeneration) as MemorySnapshot;
  const encodedGeneration = Buffer.from(snapshot.generation, 'utf8').toString('base64url');
  const snapshotBriefing = `<!-- unleashd:buddy-memory-generation ${encodedGeneration} -->\n${snapshot.briefing}`;
  return `<!-- unleashd:buddy-context-v2 ${encodedContext} ${snapshotBriefing.length} -->\n${snapshotBriefing}\n<!-- /unleashd:buddy-context-v2 -->\n\n${input.content}`;
}

function builderFirstTurnPrompt(content: string, firstUnstartedTurn: boolean): string {
  if (!firstUnstartedTurn) return content;
  return `<!-- unleashd:buddy-builder-v1 ${BUDDY_BUILDER_BRIEFING.length} -->\n${BUDDY_BUILDER_BRIEFING}\n<!-- /unleashd:buddy-builder-v1 -->\n\n${content}`;
}

/**
 * The provider prompt for a turn, by kind: thin dispatcher over the three
 * first-turn encoders. History keeps clean user text; only the provider sees
 * the markers.
 */
export function buildFirstTurnCliContent(input: {
  content: string;
  messageCount: number;
  hasStartedSession: boolean;
  kind: ConversationKind;
  buddyBriefing: string | null;
  buddyMemoryGeneration?: MemoryGenerationInput | null;
  refreshBuddyContext?: boolean;
  swarmDebugPrefix: string | null;
}): string {
  const firstUnstartedTurn = input.messageCount === 0 && !input.hasStartedSession;
  const chatPrompt = () =>
    chatFirstTurnPrompt({
      content: input.content,
      firstUnstartedTurn,
      swarmDebugPrefix: input.swarmDebugPrefix,
    });
  return matchConversationKind(input.kind, {
    buddy: (kind) =>
      buddyFirstTurnPrompt({
        kind,
        content: input.content,
        firstUnstartedTurn,
        refreshBriefing: input.refreshBuddyContext === true,
        briefing: input.buddyBriefing,
        memoryGeneration: input.buddyMemoryGeneration ?? null,
      }),
    builder: () => builderFirstTurnPrompt(input.content, firstUnstartedTurn),
    chat: chatPrompt,
    worker: chatPrompt,
  });
}

// --- Run-slot admission tick -----------------------------------------------

const CHAT_ADMISSION_POLL_MS = 1000;

/**
 * ONE admission tick shared by every Buddy chat waiting for a run slot. Until
 * 2026-09-25 each waiting conversation owned its own 1 s setInterval, so N
 * queued chats meant N timers at unrelated phases, each hitting sync SQLite
 * (03-app-core.md §5 #2). Waiters retry in the order they began waiting, and
 * the tick exists only while someone waits. Slots are also released by runs
 * this process never sees finish (automations, lease expiry), so a tick is
 * still needed rather than wake-on-release alone.
 */
// Pattern: wake-on-write (docs/patterns.md#wake-on-write)
const admissionWaiters = new Set<() => void>();
let admissionTick: ReturnType<typeof setInterval> | null = null;

/** Retry `admit` on the shared tick until the returned function is called. */
function waitForChatRunSlot(admit: () => void): () => void {
  admissionWaiters.add(admit);
  admissionTick ??= setInterval(() => {
    noteActivity('timer buddy-chat-admission');
    for (const waiter of [...admissionWaiters]) waiter();
  }, CHAT_ADMISSION_POLL_MS);
  return () => {
    admissionWaiters.delete(admit);
    if (admissionWaiters.size > 0 || !admissionTick) return;
    clearInterval(admissionTick);
    admissionTick = null;
  };
}

// --- Owner controls (shared by both Buddy kinds) ------------------------------

function ownerControls(
  dependencies: BuddyTurnPolicyDependencies,
  input: TurnInput,
  conversationId: string
): Readonly<Record<string, string>> | null {
  // Owner authority comes from input provenance alone: a 'buddy_post' seat
  // turn (another Buddy's channel post) never reaches here as owner.
  if (input.origin !== 'owner_input' || !dependencies.issueOwnerControlCapability) return null;
  return dependencies.issueOwnerControlCapability(
    { origin: 'owner_input', inputId: input.inputId },
    conversationId
  );
}

function rejectAutomation(): never {
  throw new Error('Automation turn requires current server-private execution authority');
}

// --- Buddy Builder -------------------------------------------------------------

/** The Buddy Builder thread: owner tools on owner input, its own briefing, no Buddy identity. */
export class BuddyBuilderTurnPolicy implements TurnPolicy {
  readonly acceptsUserInput = true;

  constructor(
    private readonly host: BuddyPolicyHost,
    private readonly dependencies: BuddyTurnPolicyDependencies
  ) {}

  gate(): TurnGate {
    return 'send';
  }
  releaseUnspawned(): void {}
  prepare(): boolean {
    return false;
  }
  memorySnapshot(): MemorySnapshot | null {
    return null;
  }
  providerPrompt(turn: { content: string; messageCount: number; hasStartedSession: boolean }) {
    return builderFirstTurnPrompt(turn.content, turn.messageCount === 0 && !turn.hasStartedSession);
  }
  admitted(): void {}
  preflight(provider: ProviderName): void {
    assertBuddyProviderSupportsMcp(provider);
  }
  startTurn(input: TurnInput, config: ResolvedExecutionConfig) {
    const ownerEnv = ownerControls(this.dependencies, input, this.host.id);
    if (!ownerEnv) return {};
    assertBuddyProviderSupportsMcp(config.provider);
    return {
      mcpServers: {
        ...buddyBuilderMcpServers(this.host.id, undefined, ownerEnv),
        ...buddyOwnerMcpServers(ownerEnv),
      },
    };
  }
  spawned(): void {}
  spawnFailed(): void {
    this.revoke();
  }
  formatToolResult(output: unknown): string | null {
    return formatCommonToolResult(output) ?? formatBuddyBuilderToolResult(output);
  }
  streamCompleted(): void {}
  reviewCompleted(): void {}
  ended(): void {
    this.revoke();
  }
  revoke(): void {
    this.dependencies.revokeBuddyControlCapability?.(this.host.id);
  }
  stop(): boolean {
    this.revoke();
    return true;
  }
  dropWaitingTurn(): boolean {
    return false;
  }
  waitingForRunSlot(): boolean {
    return false;
  }
  queueEmptied(): void {}
  attemptFinished(): void {}
  sessionReset(): void {}
  audienceKey(): string | undefined {
    return undefined;
  }
  runCoordination(): Promise<string> {
    return Promise.reject(new Error('Coordination identity or claim is missing'));
  }
  sendAutomation(): void {
    rejectAutomation();
  }
  stopAutomation(): void {
    this.revoke();
    throw new Error('Automation stop requires current server-private execution authority');
  }
}

// --- Buddy ---------------------------------------------------------------------

type CoordinationExecution = {
  onAdmitted?: (config: ResolvedExecutionConfig) => void;
  context: BuddyContext;
  claimToken: string;
  terminalCause?: TurnTerminalCause;
};

export interface BuddyTurnPolicySeed {
  readonly memorySnapshot: MemorySnapshot | null;
  /** Host-owned audience key of the restored provider session, if any. */
  readonly audienceKey: string | null;
  /** Server-private automation ownership. Never serialized or placed in BuddyContext. */
  readonly automationClaimToken: string | null;
}

export class BuddyTurnPolicy implements TurnPolicy {
  private memory: MemorySnapshot | null;
  private providerAudienceKey: string | null;
  // Memory generation the current provider session was last briefed with;
  // null means "unknown" (new, reset, restored, or failed spawn) and forces
  // one re-brief. Same lifetime as providerAudienceKey.
  private briefedMemoryGeneration: string | null = null;
  private readonly automationClaimToken: string | null;
  // Buddy chat turns wait here for a run slot. The head of the queue stays
  // pending while chatRunTicket waits on the shared admission tick. On
  // admission, the run is held in admittedChatRun until startTurn takes it.
  private chatRunTicket: { runId: string; stopWaiting: () => void } | null = null;
  private admittedChatRun: OwnedBuddyChatRun | null = null;
  private coordination: CoordinationExecution | null = null;
  private reviewTicket: {
    attemptId: string;
    messageStart: number;
    context: BuddyContext;
  } | null = null;

  constructor(
    private readonly kind: BuddyKind,
    private readonly host: BuddyPolicyHost,
    private readonly dependencies: BuddyTurnPolicyDependencies,
    seed: BuddyTurnPolicySeed
  ) {
    this.memory = seed.memorySnapshot;
    this.providerAudienceKey = seed.audienceKey;
    this.automationClaimToken = seed.automationClaimToken;
  }

  private get context(): BuddyContext {
    return this.kind.context;
  }

  get acceptsUserInput(): boolean {
    return !this.context.automationRunId;
  }

  // --- admission -------------------------------------------------------------

  gate(input: TurnInput, fromQueue: boolean): TurnGate {
    // Automation and coordination runs already own a run; only chat turns queue for one.
    if (this.context.automationRunId || this.coordination || !this.dependencies.enqueueBuddyChatRun)
      return 'send';
    // Buddy chat turns are admitted through the queue, so a turn waiting for a
    // run slot is visible as pending and later sends line up behind it. The
    // queue keeps the input's provenance whatever its origin: a 'buddy_post'
    // seat turn dropped here would come back 'unknown' and run under the
    // workspace audience, resetting the seat's session.
    if (!fromQueue) return 'enqueue';
    const owned = this.admitForegroundChatRun(input);
    if (!owned) return 'wait';
    this.admittedChatRun = owned;
    return 'admitted';
  }

  // Admitted: the owned run. Otherwise the queue head goes back to pending and
  // the shared tick re-runs processQueue once this Buddy's line reaches it.
  private admitForegroundChatRun(input: TurnInput): OwnedBuddyChatRun | null {
    // Per-input context: a fresh owner input drops delegated restrictions for
    // its turn (contextForInput). The run's allowed operations come from it.
    this.chatRunTicket ??= {
      runId: this.dependencies.enqueueBuddyChatRun!(this.contextForInput(input), this.host.id).id,
      stopWaiting: waitForChatRunSlot(() => this.host.processQueue()),
    };
    // Foreground tool authority must cover the provider's explicit runtime
    // budget: TURN_MAX_RUNTIME_MS, never the background claim default (600 s
    // killed live owner chats on 2026-09-10). Guards: buddy-coordination.test.ts,
    // `foreground Buddy deadline uses the conversation budget and reports
    // timeout after joined drain`; docs/incident-2026-09-10-buddy-chat-timeout.md.
    const admission = this.dependencies.startBuddyChatRun!(
      this.chatRunTicket.runId,
      this.host.id,
      TURN_MAX_RUNTIME_MS
    );
    switch (admission.kind) {
      case 'admitted':
        this.releaseChatRunTicket(false);
        return admission.run;
      case 'waiting':
        this.host.releaseQueueHead(true);
        return null;
      case 'gone':
        // Lost its place; rejoin at the back of the line on the next poll.
        this.chatRunTicket.stopWaiting();
        this.chatRunTicket = null;
        setTimeout(() => this.host.processQueue(), CHAT_ADMISSION_POLL_MS);
        this.host.releaseQueueHead(false);
        return null;
    }
  }

  private releaseChatRunTicket(abandon: boolean): void {
    const ticket = this.chatRunTicket;
    if (!ticket) return;
    ticket.stopWaiting();
    this.chatRunTicket = null;
    if (abandon) this.dependencies.abandonBuddyChatRun?.(ticket.runId);
  }

  // The admitted turn can return before spawning (preflight refusal, rejected
  // fork). An unconsumed admitted run must be settled here, or it stays
  // 'running' and holds one of its Buddy's slots forever.
  releaseUnspawned(): void {
    const owned = this.admittedChatRun;
    if (!owned) return;
    this.admittedChatRun = null;
    this.dependencies.finishBuddyChatRun?.(
      owned.id,
      owned.claim_token,
      'cancelled',
      'Turn did not start'
    );
  }

  waitingForRunSlot(): boolean {
    return this.chatRunTicket !== null && !this.host.hasProcess();
  }

  dropWaitingTurn(): boolean {
    if (!this.chatRunTicket || this.host.hasProcess()) return false;
    // Stopping a turn that is still waiting for a run slot drops that turn.
    this.host.dropPendingHead();
    this.releaseChatRunTicket(true);
    return true;
  }

  queueEmptied(): void {
    this.releaseChatRunTicket(true);
  }

  // --- context, audience and briefing ----------------------------------------------

  private contextForInput(input: TurnInput): BuddyContext {
    if (this.coordination) {
      const context = this.coordination.context;
      switch (input.origin) {
        case 'owner_input':
        case 'buddy_post':
          return {
            ...context,
            knowledgeScope: { kind: 'owner_thread', conversationId: this.host.id },
          };
        case 'buddy_message':
        case 'schedule':
        case 'unknown':
          return {
            ...context,
            knowledgeScope:
              context.knowledgeScope ??
              (context.buddyProjectId
                ? { kind: 'project', projectId: context.buddyProjectId }
                : { kind: 'workspace', workspaceId: context.workspaceId }),
          };
      }
    }
    const context = this.context;
    switch (input.origin) {
      // A new owner input gets a new foreground claim. Never rewrite a worker claim.
      case 'owner_input':
        return {
          ...context,
          knowledgeScope: { kind: 'owner_thread', conversationId: this.host.id },
          delegatedByBuddyId: null,
          allowedBuddyOperations: undefined,
          coordinationRunId: undefined,
        };
      // Same audience as the seat's owner turns, so its provider session
      // continues (a different scope fails the audience fence and resets it),
      // but no new claim: only the owner may lift the context's restrictions.
      case 'buddy_post':
        return {
          ...context,
          knowledgeScope: { kind: 'owner_thread', conversationId: this.host.id },
        };
      case 'buddy_message':
      case 'schedule':
      case 'unknown':
        return {
          ...context,
          knowledgeScope: context.buddyProjectId
            ? { kind: 'project', projectId: context.buddyProjectId }
            : { kind: 'workspace', workspaceId: context.workspaceId },
        };
    }
  }

  // A provider session resumes only while the current audience CONTAINS the
  // one it was built under. Until 2026-09-25 any change to the audience key
  // reset it, and the key covers every readable Task: a Buddy that created a
  // Task from inside a channel-thread seat started the seat's next turn in a
  // fresh session (live 03:30Z, no --resume). Narrowed or different access,
  // or a saved key that cannot be compared (none saved, or a hash saved
  // before descriptors), still starts fresh; display history remains. A
  // resumed session adopts the grown key, which session.started persists.
  private admitAudience(audience: BuddyTurnAudience): void {
    const continuity: BuddyAudienceContinuity =
      this.providerAudienceKey === null
        ? 'unverified'
        : audience.continuityFrom(this.providerAudienceKey);
    switch (continuity) {
      case 'contained':
        break;
      case 'changed':
      case 'unverified':
        if (this.host.hasStartedSession()) {
          console.log(
            `[${this.host.id}] Buddy context reset: reason=audience_${continuity}, provider-session=${this.host.view.sessionId}`
          );
          this.host.resetProcess();
        }
        break;
    }
    this.providerAudienceKey = audience.key;
  }

  prepare(input: TurnInput): boolean {
    const readCurrent = this.dependencies.readCurrentBuddyContext;
    if (!readCurrent) return false;
    const current = readCurrent(this.contextForInput(input));
    if (current.audience) this.admitAudience(current.audience);
    this.memory = createMemorySnapshot(current.briefing, current.memoryGeneration);
    // Re-brief only when this provider session has not yet seen the current
    // memory generation. From 5c0cec4 (2026-09-20) until 2026-09-24 this was
    // true on EVERY Buddy turn, so each turn appended another full ~20k-char
    // briefing to the provider transcript and every later step re-read all
    // accumulated copies: one basketball-model session carried 44 copies
    // (~835k chars) and re-priced them across 1,081 requests. Guard:
    // `resumed Buddy turns re-brief only when the memory generation changes`.
    return (this.memory?.generation ?? null) !== this.briefedMemoryGeneration;
  }

  memorySnapshot(): MemorySnapshot | null {
    return this.memory;
  }

  providerPrompt(turn: {
    content: string;
    messageCount: number;
    hasStartedSession: boolean;
    refreshBriefing: boolean;
  }): string {
    return buddyFirstTurnPrompt({
      kind: this.kind,
      content: turn.content,
      firstUnstartedTurn: turn.messageCount === 0 && !turn.hasStartedSession,
      refreshBriefing: turn.refreshBriefing,
      briefing: this.memory?.briefing ?? null,
      memoryGeneration: this.memory?.generation ?? null,
    });
  }

  admitted(input: TurnInput, content: string): void {
    // Every path leaves the provider session holding this generation: injected
    // now, injected on an earlier turn, or inherited by a native fork (which
    // requires matching generations).
    this.briefedMemoryGeneration = this.memory?.generation ?? null;
    // Buddy audit events require an existing Buddy and workspace; owner tool
    // authority uses input provenance, never transcript text.
    this.dependencies.recordBuddyTurnOrigin?.(
      this.host.id,
      input,
      this.contextForInput(input),
      crypto.createHash('sha256').update(content).digest('hex')
    );
  }

  preflight(provider: ProviderName): void {
    assertBuddyProviderSupportsMcp(provider);
  }

  audienceKey(): string | undefined {
    return this.providerAudienceKey ?? undefined;
  }

  sessionReset(): void {
    this.providerAudienceKey = null;
    this.briefedMemoryGeneration = null;
  }

  // --- the turn ----------------------------------------------------------------

  startTurn(input: TurnInput, config: ResolvedExecutionConfig) {
    const owned = this.admittedChatRun;
    this.admittedChatRun = null;
    if (owned) this.ownForegroundRun(owned, input);
    const hasOwnerControls =
      input.origin === 'owner_input' && !!this.dependencies.issueOwnerControlCapability;
    const context = this.coordination?.context ?? this.context;
    const claimToken = this.coordination?.claimToken ?? this.automationClaimToken ?? undefined;
    const servers: Record<string, McpServerSpec> = {
      ...buddyMcpServers(context, this.host.id, undefined, {
        UNLEASHD_BUDDY_OWNER_CONTROL_AVAILABLE: hasOwnerControls ? '1' : '0',
        UNLEASHD_BUDDY_OWNER_CONTROL_CONTRACT: BUDDY_TEAM_CONTRACT_VERSION,
        ...this.dependencies.issueBuddyControlCapability?.(context, this.host.id, claimToken),
        ...(this.coordination
          ? {
              UNLEASHD_BUDDY_COORDINATION_RUN_ID: this.coordination.context.coordinationRunId!,
              [BUDDY_AUTOMATION_CLAIM_TOKEN_ENV]: this.coordination.claimToken,
            }
          : {}),
        ...(this.automationClaimToken && !this.coordination
          ? { [BUDDY_AUTOMATION_CLAIM_TOKEN_ENV]: this.automationClaimToken }
          : {}),
      }),
    };
    // Issued AFTER the Buddy capability: BuddyControlServer.issue() revokes the
    // conversation's previous grants, owner token included.
    const ownerEnv = ownerControls(this.dependencies, input, this.host.id);
    if (ownerEnv) Object.assign(servers, buddyOwnerMcpServers(ownerEnv));
    assertBuddyProviderSupportsMcp(config.provider);
    // Capture exactly the resolved request at the provider boundary, after all awaits.
    this.coordination?.onAdmitted?.(config);
    return { mcpServers: servers };
  }

  /**
   * The admitted foreground run owns this turn until it drains: its deadline
   * (set from TURN_MAX_RUNTIME_MS at admission) expires as max_runtime_timeout,
   * and the run settles once on the turn's terminal event.
   */
  private ownForegroundRun(owned: OwnedBuddyChatRun, input: TurnInput): void {
    this.coordination = {
      context: { ...this.contextForInput(input), coordinationRunId: owned.id },
      claimToken: owned.claim_token,
    };
    const timer = setTimeout(
      () => {
        // Automatic expiry is max_runtime_timeout. stop() records user_stop
        // and hid the 600s regression; retain timeout cleanup and joined drain.
        this.host.maxRuntimeReached();
      },
      Math.max(0, Date.parse(owned.deadline) - Date.now())
    );
    const settle = (status: 'complete' | 'failed', detail: string) => {
      clearTimeout(timer);
      this.host.off('buddy-turn-complete', complete);
      this.host.off('buddy-turn-failed', failed);
      this.coordination = null;
      try {
        this.dependencies.finishBuddyChatRun?.(owned.id, owned.claim_token, status, detail);
      } catch (error) {
        console.error('[buddies] Could not settle owner turn', owned.id, error);
      }
    };
    let pendingFailure: string | null = null;
    const complete = (output: string) =>
      settle(pendingFailure ? 'failed' : 'complete', pendingFailure ?? output);
    const failed = (error: string) => {
      if (this.host.hasProcess()) {
        pendingFailure = error;
        return;
      }
      settle('failed', error);
    };
    this.host.once('buddy-turn-complete', complete);
    this.host.on('buddy-turn-failed', failed);
  }

  spawned(input: TurnInput, review: { attemptId: string; messageStart: number }): void {
    this.reviewTicket = { ...review, context: this.contextForInput(input) };
    this.dependencies.updateBuddyStatus(this.host.view, 'active');
  }

  spawnFailed(): void {
    this.revoke();
    // The briefing in this prompt never reached the provider transcript.
    this.briefedMemoryGeneration = null;
  }

  formatToolResult(output: unknown): string | null {
    return formatCommonToolResult(output);
  }

  streamCompleted(): void {
    this.dependencies.updateBuddyStatus(this.host.view, 'active');
  }

  // The reviewer owns a separate process with no Buddy execution identity.
  // Called before completion listeners or processQueue can start another turn.
  reviewCompleted(messages: readonly Message[]): void {
    const ticket = this.reviewTicket;
    if (!ticket) return;
    try {
      this.dependencies.reviewCompletedBuddyTurn?.({
        attemptId: ticket.attemptId,
        conversationId: this.host.id,
        context: { ...ticket.context },
        completedAt: new Date().toISOString(),
        messages: messages
          .slice(ticket.messageStart)
          .map(({ role, content }) => ({ role, content })),
      });
    } catch (error) {
      console.error('[buddies] Could not enqueue memory review', this.host.id, error);
    }
  }

  ended(end: TurnEnd): void {
    this.revoke();
    switch (end.t) {
      case 'succeeded':
        return;
      case 'failed':
        this.dependencies.updateBuddyStatus(this.host.view, 'failed');
        this.dependencies.settleBuddyDelegation(this.host.view, 'failed', end.detail);
        return;
      case 'cancelled':
        this.dependencies.updateBuddyStatus(this.host.view, 'cancelled');
        this.dependencies.settleBuddyDelegation(this.host.view, 'cancelled', end.detail);
        return;
    }
  }

  revoke(): void {
    this.dependencies.revokeBuddyControlCapability?.(this.host.id);
  }

  attemptFinished(cause: TurnTerminalCause): void {
    if (this.coordination && !this.coordination.terminalCause) {
      this.coordination.terminalCause = cause;
    }
  }

  stop(reason: 'user_stop' | 'server_restart'): boolean {
    this.revoke();
    const automationRunId = this.context.automationRunId;
    if (reason !== 'user_stop' || !automationRunId) return true;
    const requestCancellation = this.dependencies.requestAutomationCancellation;
    if (!requestCancellation) {
      this.host.refuseAutomationTranscript(
        'Automation cancellation is temporarily unavailable. The owned run was left running.'
      );
      return false;
    }
    void requestCancellation(automationRunId).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error('[buddies] Automation cancellation failed', automationRunId, error);
      this.host.refuseAutomationTranscript(`Automation cancellation failed: ${detail}`);
    });
    return false;
  }

  // --- coordination and automation runs ---------------------------------------------

  runCoordination(
    content: string,
    context: BuddyContext,
    claimToken: string,
    onDrained?: CoordinationDrained,
    onAdmitted?: (config: ResolvedExecutionConfig) => void
  ): Promise<string> {
    if (this.coordination) return Promise.reject(new Error('Conversation is busy'));
    if (
      !context.coordinationRunId ||
      !claimToken ||
      context.buddyId !== this.context.buddyId ||
      context.workspaceId !== this.context.workspaceId
    ) {
      return Promise.reject(new Error('Coordination identity or claim is missing'));
    }
    this.coordination = { context, claimToken, onAdmitted };
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        this.host.off('buddy-turn-complete', complete);
        this.host.off('buddy-turn-failed', failed);
        this.coordination = null;
      };
      let pendingFailure: string | null = null;
      const complete = (output: string) => {
        if (pendingFailure) {
          failed(pendingFailure);
          return;
        }
        try {
          onDrained?.('complete', output, this.coordination?.terminalCause);
          cleanup();
          resolve(output);
        } catch (error) {
          cleanup();
          reject(error);
        }
      };
      const failed = (reason: string) => {
        if (this.host.hasProcess()) {
          pendingFailure = reason;
          return;
        }
        try {
          onDrained?.('failed', reason, this.coordination?.terminalCause);
        } catch (error) {
          cleanup();
          reject(error);
          return;
        }
        cleanup();
        reject(new Error(reason));
      };
      this.host.once('buddy-turn-complete', complete);
      this.host.on('buddy-turn-failed', failed);
      try {
        this.host.send(sameEitherWay(content), {
          origin: 'buddy_message',
          inputId: context.coordinationRunId!,
        });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  /**
   * Coordinator-only admission for an owned automation occurrence. Public
   * sendMessage deliberately refuses durable automation transcripts so a
   * historical thread cannot mint another turn from expired authority. See
   * invariant I4 in
   * agent_notes/2026-08-24_automation-execution-ownership-design.md.
   */
  sendAutomation(content: string): void {
    const automationRunId = this.context.automationRunId;
    if (!automationRunId || !this.automationClaimToken) rejectAutomation();
    const memoryPolicy = resolveAutomationMemoryWritePolicy({
      isAutomation: true,
      provider: this.host.provider(),
      allowedOperations: this.context.allowedBuddyOperations,
      hasClaimToken: true,
    });
    if (memoryPolicy === 'unsupported') {
      throw new Error(
        `Automation memory writes are unsupported for provider "${this.host.provider()}" or this run lacks an explicit memory-write capability.`
      );
    }
    this.host.send(sameEitherWay(content), { origin: 'schedule', inputId: automationRunId });
  }

  /**
   * Coordinator-only process stop. The scheduler first persists
   * cancel_requested, revoking MCP authority, and only then enters here. Do
   * not expose this on the public command path; see invariant I4 in
   * agent_notes/2026-08-24_automation-execution-ownership-design.md.
   */
  stopAutomation(): void {
    this.revoke();
    if (!this.context.automationRunId || !this.automationClaimToken) {
      throw new Error('Automation stop requires current server-private execution authority');
    }
  }
}
