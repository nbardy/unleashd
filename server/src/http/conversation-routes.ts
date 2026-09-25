import type {
  ConfigResolution,
  ConversationBranch,
  ConversationDetail,
  ConversationKind,
  Message,
  Provider,
  ProviderTurnUsage,
} from '@unleashd/shared';
import type { Express, Request, RequestHandler, Response } from 'express';
import { BUDDY_BUILDER_BRIEFING } from '../buddies/builder';
import { toolManifest } from '../buddies/mcp';
import { type ContextWindow, resolveContextWindow } from '../conversations/context-window';
import {
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
  type MessageSource,
} from '../conversations/messages';
import { type SessionContextReading, lookupSessionContext } from '../conversations/session-context';
import type { IngestAccessor, IngestSlot } from '../ingest/instance';
import { type SessionProviderUsage, lookupProviderUsageForSession } from './usage-routes';

/** What the context meter reads about a conversation. */
export interface ContextSubject {
  readonly id: string;
  readonly sessionId: string;
  readonly provider: Provider;
  readonly kind: ConversationKind;
  /** Provider-reported model of the latest turn. */
  readonly observedModel: string | null;
  readonly providerUsage: ProviderTurnUsage | null;
  readonly swarmDebugPrefix: string | null;
  readonly resumedFromConversationId: string | null;
}

/** The conversation as these routes see it. */
export interface RoutedConversation extends ContextSubject {
  readonly configResolution: ConfigResolution;
  toDetail(): ConversationDetail;
  getMemorySnapshot?: () => { briefing: string; generation: string } | null;
}

export interface ContextBreakdownSection {
  chars: number;
  /** Heuristic estimate (chars/4), not provider tokenization. */
  tokensEst: number;
  /**
   * `tokensEst` rescaled so the five sections sum to the provider's measured
   * context. Equal to `tokensEst` when there is nothing measured to scale to.
   */
  tokensScaled: number;
}

/**
 * How the headline number was obtained. `measured` is the provider's own count
 * for the latest request; `estimated` is our chars/4 fallback for a thread that
 * has not reported usage yet (or a harness that reports none, like muse).
 */
export type ContextReadingSource = 'measured' | 'estimated';

export interface ContextBreakdownResponse {
  conversationId: string;
  sessionId: string;
  provider: Provider;
  modelName: string | null;
  /**
   * The meter's denominator and where it came from. Replaces the former
   * hardcoded 200_000, which read ~5x too full on every 1M-window model.
   */
  contextWindow: ContextWindow;
  /** Alias of `contextWindow.tokens`, kept so older clients keep rendering. */
  budgetTokens: number;
  /** Which of `totalTokens` / `totalTokensEst` the meter is actually showing. */
  readingSource: ContextReadingSource;
  /** The headline: measured context when available, else the estimate. */
  totalTokens: number;
  /**
   * Measured context minus what our five sections model — the harness's own
   * system prompt and tool schemas, which we never see. Measured at ~39.5k for
   * a one-word claude prompt, so it is not a rounding error. Zero when the
   * reading is an estimate, or after a compaction (sections are scaled down
   * instead).
   */
  residualTokens: number;
  /**
   * Set when our full-history estimate exceeds the provider's measured context:
   * the provider dropped history we still hold. Our store is append-only, so
   * this is the only way that inequality arises.
   */
  compaction: {
    detected: boolean;
    /**
     * `marker` means the harness recorded the boundary in its own log — exact,
     * and the only form that can report pre/post counts. `inferred` means we
     * only know the measured context came in under what we model. Never blend
     * the two: one is the provider's word, the other is our arithmetic.
     */
    source: 'marker' | 'inferred';
    historyTokensEst: number;
    measuredTokens: number;
    /** Boundaries crossed. Null on an inferred detection — we cannot count them. */
    count: number | null;
    preTokens: number | null;
    postTokens: number | null;
    trigger: string | null;
  } | null;
  sections: {
    history: ContextBreakdownSection;
    briefing: ContextBreakdownSection;
    memory: ContextBreakdownSection;
    mcp: ContextBreakdownSection;
    handoff: ContextBreakdownSection;
  };
  totalChars: number;
  totalTokensEst: number;
  pctOfBudget: number;
  providerUsage: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Provider-priced cumulative input (re-read across turns). Billing truth. */
    cumulativeInputTokens: number;
    ourSentChars: number;
    deltaTokens: number;
    deltaMultiple: number;
  } | null;
  expansion: { message: string; project: string };
  observedAt: string;
}

export interface ContextBreakdownDeps {
  getBranch?: (
    conversationId: string
  ) => Promise<ConversationBranch | null | undefined> | ConversationBranch | null | undefined;
  /** The ingest store's session usage and latest context (server/src/ingest/instance.ts). */
  ingest: IngestAccessor;
}

interface ProviderReadings {
  usage: SessionProviderUsage | null;
  context: SessionContextReading | null;
}

/** While the store is starting the meter shows its estimates only, as for an unknown session. */
async function providerReadings(slot: IngestSlot, sessionId: string): Promise<ProviderReadings> {
  switch (slot.t) {
    case 'starting':
      return { usage: null, context: null };
    case 'ready': {
      const [usage, context] = await Promise.all([
        lookupProviderUsageForSession(slot.ingest, sessionId),
        lookupSessionContext(slot.ingest, sessionId),
      ]);
      return { usage, context };
    }
  }
}

/**
 * Below this ratio of measured-to-modelled we call it a compaction rather than
 * estimator drift. chars/4 is rough in both directions, and the measured number
 * additionally INCLUDES harness overhead our sections omit, so a measured total
 * that still lands meaningfully under our estimate cannot be explained by
 * estimator error alone -- history was dropped provider-side.
 */
const COMPACTION_RATIO = 0.9;

/** Heuristic estimate: ceil(chars/4). Labeled estimate everywhere it surfaces. */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

function sectionOf(chars: number): ContextBreakdownSection {
  const normalized = Math.max(0, Math.floor(chars));
  const tokensEst = estimateTokens(normalized);
  return { chars: normalized, tokensEst, tokensScaled: tokensEst };
}

function scaleSection(section: ContextBreakdownSection, factor: number): ContextBreakdownSection {
  return { ...section, tokensScaled: Math.round(section.tokensEst * factor) };
}

// composeConversation (buddies/integration.ts) joins prefix + middle + suffix.
// The middle's memory/work/activity tail is the "memory" segment; the head
// (prefix, role brief, relationships, skills, suffix) is the "briefing" segment.
const MEMORY_TAIL_MARKER = 'BUDDY MEMORY (descriptive data';

export function splitBriefing(briefing: string): { briefing: string; memory: string } {
  const index = briefing.indexOf(MEMORY_TAIL_MARKER);
  if (index < 0) return { briefing, memory: '' };
  return { briefing: briefing.slice(0, index), memory: briefing.slice(index) };
}

// The tool definitions a turn's provider loads from the one Buddy endpoint (mcp.ts).
function mcpSpecJson(conversation: ContextSubject): string {
  switch (conversation.kind.t) {
    case 'builder':
      return toolManifest('builder');
    case 'buddy':
      return toolManifest('worker');
    case 'chat':
    case 'worker':
      return '';
  }
}

export function buildContextBreakdown(
  conversation: ContextSubject,
  history: readonly Message[],
  snapshotBriefing: string | null,
  branch: ConversationBranch | null | undefined,
  usage: SessionProviderUsage | null,
  contextWindow: ContextWindow,
  sessionContext: SessionContextReading | null = null
): ContextBreakdownResponse {
  const historyChars = history.reduce(
    (sum, message) => sum + (typeof message.content === 'string' ? message.content.length : 0),
    0
  );

  let briefingText = '';
  let memoryText = '';
  if (conversation.kind.t === 'builder') {
    briefingText = BUDDY_BUILDER_BRIEFING;
  } else if (conversation.kind.t === 'buddy') {
    const split = splitBriefing(snapshotBriefing ?? '');
    briefingText = split.briefing;
    memoryText = split.memory;
  } else {
    briefingText = conversation.swarmDebugPrefix ?? '';
  }

  const mcpText = mcpSpecJson(conversation);

  const handoffParts: string[] = [];
  if (branch?.handoff) handoffParts.push(branch.handoff);
  if (conversation.resumedFromConversationId) {
    handoffParts.push(
      `Soft handoff: resumed from /chat/${conversation.resumedFromConversationId} (fork lineage; original kept).`
    );
  }
  const handoffText = handoffParts.join('\n');

  const sections = {
    history: sectionOf(historyChars),
    briefing: sectionOf(briefingText.length),
    memory: sectionOf(memoryText.length),
    mcp: sectionOf(mcpText.length),
    handoff: sectionOf(handoffText.length),
  };
  const totalChars =
    sections.history.chars +
    sections.briefing.chars +
    sections.memory.chars +
    sections.mcp.chars +
    sections.handoff.chars;
  const totalTokensEst =
    sections.history.tokensEst +
    sections.briefing.tokensEst +
    sections.memory.tokensEst +
    sections.mcp.tokensEst +
    sections.handoff.tokensEst;

  // The provider's own count for the latest request. `providerUsage` on the
  // conversation is the live path (an agent-cli `usage` event, persisted on the
  // session binding); the session-file parser remains the fallback for turns
  // that predate it. Neither is an estimate.
  // Two provider-truth paths, same question. The live `usage` event is freshest
  // but only exists for turns taken since we started listening; the harness's
  // own session log is retroactive and covers every turn ever taken (and is the
  // ONLY source for codex and muse, whose stdout carries no per-request token
  // fields at all). Live wins when present; the file is what makes an idle
  // thread read correctly instead of falling back to chars/4.
  //
  // A live reading that exceeds a KNOWN window is not a context size at all --
  // it is a cumulative aggregate a parser passed through (2026-09-22: codex
  // exec stdout reported the session total 16,062,762 as the context on a
  // 258,400 window). A real per-request context cannot pass the window the
  // provider enforces, so the implausible live value is dropped and the file
  // (or the estimate) answers instead. This also heals sessions whose stored
  // binding still carries a pre-fix aggregate. Operator budgets and
  // unknown-model floors are excluded: exceeding a configured budget is
  // meaningful over-budget signal, and a floor is a display guess, not physics.
  const liveTokens = conversation.providerUsage?.contextTokens ?? null;
  const livePlausible =
    liveTokens === null ||
    contextWindow.source === 'operator' ||
    contextWindow.source === 'unknown' ||
    liveTokens <= contextWindow.tokens;
  const measuredTokens =
    (livePlausible ? liveTokens : null) ?? sessionContext?.contextTokens ?? null;
  const budgetTokens = contextWindow.tokens;

  // Two readings, two clean paths. Measured: sections keep their estimate and
  // the unmodelled harness overhead becomes its own band -- unless the measured
  // total came in UNDER what we model, which only happens when the provider
  // compacted, and then the sections scale down to fit.
  const reading = ((): {
    source: ContextReadingSource;
    total: number;
    sections: typeof sections;
    residual: number;
    compaction: ContextBreakdownResponse['compaction'];
  } => {
    if (measuredTokens === null) {
      return {
        source: 'estimated',
        total: totalTokensEst,
        sections,
        residual: 0,
        compaction: null,
      };
    }

    // Whether history was DROPPED and whether our bands FIT the measured total
    // are two different questions, and the old code answered them with one
    // branch. A marker can fire while the bands still fit; the bands can
    // overflow slightly from estimator drift with no compaction at all.

    // Did the provider drop history? Prefer the harness's own marker: it is
    // exact, needs no tuned margin, and cannot false-positive when our chars/4
    // estimate happens to run hot. The ratio stays only as the fallback for a
    // reading with no session log behind it.
    const marker = sessionContext?.compaction ?? null;
    const compaction: ContextBreakdownResponse['compaction'] = marker
      ? {
          detected: true,
          source: 'marker',
          historyTokensEst: sections.history.tokensEst,
          measuredTokens,
          count: marker.count,
          preTokens: marker.preTokens,
          postTokens: marker.postTokens,
          trigger: marker.trigger,
        }
      : measuredTokens < totalTokensEst * COMPACTION_RATIO
        ? {
            detected: true,
            source: 'inferred',
            historyTokensEst: sections.history.tokensEst,
            measuredTokens,
            count: null,
            preTokens: null,
            postTokens: null,
            trigger: null,
          }
        : null;

    // Do the bands fit? They may never sum to more than the real context, so
    // scale them down when they overflow and show the unmodelled harness
    // overhead as a residual when they leave room.
    if (measuredTokens >= totalTokensEst) {
      return {
        source: 'measured',
        total: measuredTokens,
        sections,
        residual: measuredTokens - totalTokensEst,
        compaction,
      };
    }
    const factor = totalTokensEst > 0 ? measuredTokens / totalTokensEst : 0;
    return {
      source: 'measured',
      total: measuredTokens,
      sections: {
        history: scaleSection(sections.history, factor),
        briefing: scaleSection(sections.briefing, factor),
        memory: scaleSection(sections.memory, factor),
        mcp: scaleSection(sections.mcp, factor),
        handoff: scaleSection(sections.handoff, factor),
      },
      residual: 0,
      compaction,
    };
  })();

  return {
    conversationId: conversation.id,
    // Empty before the first turn starts a provider session; the provider
    // join then yields null usage and the meter shows estimates only.
    sessionId: conversation.sessionId ?? '',
    provider: conversation.provider,
    modelName: conversation.observedModel,
    contextWindow,
    budgetTokens,
    readingSource: reading.source,
    totalTokens: reading.total,
    residualTokens: reading.residual,
    compaction: reading.compaction,
    sections: reading.sections,
    totalChars,
    totalTokensEst,
    pctOfBudget: budgetTokens > 0 ? (reading.total / budgetTokens) * 100 : 0,
    providerUsage: usage
      ? {
          sessionId: usage.sessionId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          cumulativeInputTokens: usage.cumulativeInputTokens,
          ourSentChars: totalChars,
          deltaTokens: usage.cumulativeInputTokens - totalTokensEst,
          deltaMultiple: usage.cumulativeInputTokens / Math.max(1, totalTokensEst),
        }
      : null,
    expansion: { message: 'get_message({messageId})', project: 'get_current_work({projectId})' },
    observedAt: new Date().toISOString(),
  };
}

/** Express 4 does not catch a rejected async handler: route the error to the error handler. */
function handled(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request, response, next) => {
    handler(request, response).catch(next);
  };
}

export function registerConversationRoutes(
  app: Express,
  /** The conversation's runtime, built from its record on first use; undefined = none. */
  getConversation: (id: string) => Promise<RoutedConversation | undefined>,
  messages: MessageSource,
  deps: ContextBreakdownDeps
): void {
  app.get(
    '/api/conversations/:conversationId/context-breakdown',
    handled(async (request, response) => {
      const conversation = await getConversation(request.params.conversationId);
      if (!conversation) {
        response.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const data = conversation;
      let branch: ConversationBranch | null | undefined;
      try {
        branch = (await deps.getBranch?.(data.id)) ?? null;
      } catch {
        branch = null;
      }
      // The harness's own session log (via the ingest store): cumulative usage, plus the latest
      // request's context, window and compaction markers. Retroactive, so a thread that has not
      // taken a turn since the live event shipped still reads correctly.
      let readings: ProviderReadings = { usage: null, context: null };
      try {
        readings = data.sessionId
          ? await providerReadings(deps.ingest(), data.sessionId)
          : readings;
      } catch (error) {
        console.warn('[context-breakdown] ingest read failed:', error);
      }
      const { usage, context: sessionContext } = readings;
      const snapshot = (() => {
        try {
          return conversation.getMemorySnapshot?.()?.briefing ?? null;
        } catch {
          return null;
        }
      })();
      const resolved =
        data.configResolution.status === 'resolved'
          ? data.configResolution.value
          : data.configResolution.lastResolved;
      const contextWindow = resolveContextWindow({
        modelId: resolved?.modelId ?? null,
        reportedModelName: data.observedModel,
        // codex reports its window on the same record as its usage, so the file
        // supplies the denominator too when the live event has not run.
        reportedWindow: data.providerUsage?.contextWindow ?? sessionContext?.contextWindow ?? null,
      });
      const history =
        (await messages(data.id, { afterSeq: -1, limit: Number.MAX_SAFE_INTEGER }))?.messages ?? [];
      response.json(
        buildContextBreakdown(data, history, snapshot, branch, usage, contextWindow, sessionContext)
      );
    })
  );

  // Detail: config, queue, sub-agents, latest turn. No message bodies.
  app.get(
    '/api/conversations/:conversationId',
    handled(async (request, response) => {
      const conversation = await getConversation(request.params.conversationId);
      if (!conversation) {
        response.status(404).json({ error: 'Conversation not found' });
        return;
      }
      response.json(conversation.toDetail());
    })
  );

  // Bodies, paged: messages with seq > afterSeq, at most `limit` of them.
  app.get(
    '/api/conversations/:conversationId/messages',
    handled(async (request, response) => {
      const afterSeq = integerParam(request.query.afterSeq, -1);
      const limit = integerParam(request.query.limit, MESSAGE_PAGE_DEFAULT_LIMIT);
      if (afterSeq === null || afterSeq < -1 || limit === null || limit < 1) {
        response.status(400).json({ error: 'afterSeq must be an integer >= -1, limit >= 1' });
        return;
      }
      const page = await messages(request.params.conversationId, {
        afterSeq,
        limit: Math.min(limit, MESSAGE_PAGE_MAX_LIMIT),
      });
      if (!page) {
        response.status(404).json({ error: 'Conversation not found' });
        return;
      }
      response.json(page);
    })
  );
}

/** An absent param takes the default; anything but an integer is null (a 400). */
function integerParam(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  return Number(value);
}
