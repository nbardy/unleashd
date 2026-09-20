import type { Conversation, ConversationBranch } from '@unleashd/shared';
import type { Express } from 'express';
import { BUDDY_BUILDER_BRIEFING } from '../buddies/builder';
import { buddyBuilderMcpServers, buddyMcpServers } from '../buddies/mcp-config';
import { type ContextWindow, resolveContextWindow } from '../conversations/context-window';
import { type SessionContextReading, lookupSessionContext } from '../conversations/session-context';
import { type SessionProviderUsage, lookupProviderUsageForSession } from './usage-routes';

export interface ConversationDetail {
  toJSON(): Conversation;
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
  provider: Conversation['provider'];
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
  lookupUsage?: (sessionId: string) => SessionProviderUsage | null;
  lookupContext?: (sessionId: string) => SessionContextReading | null;
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

function mcpSpecJson(conversation: Conversation): string {
  try {
    if (conversation.kind.kind === 'buddy_builder') {
      return JSON.stringify(buddyBuilderMcpServers(conversation.id));
    }
    if (conversation.kind.kind === 'buddy' && conversation.buddyContext) {
      return JSON.stringify(buddyMcpServers(conversation.buddyContext, conversation.id));
    }
  } catch {
    /* meter must never break the conversation read */
  }
  return '';
}

export function buildContextBreakdown(
  conversation: Conversation,
  snapshotBriefing: string | null,
  branch: ConversationBranch | null | undefined,
  usage: SessionProviderUsage | null,
  contextWindow: ContextWindow,
  sessionContext: SessionContextReading | null = null
): ContextBreakdownResponse {
  const historyChars = conversation.messages.reduce(
    (sum, message) => sum + (typeof message.content === 'string' ? message.content.length : 0),
    0
  );

  let briefingText = '';
  let memoryText = '';
  if (conversation.kind.kind === 'buddy_builder') {
    briefingText = BUDDY_BUILDER_BRIEFING;
  } else if (conversation.kind.kind === 'buddy') {
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
  if (conversation.mergeParentMeta) handoffParts.push(JSON.stringify(conversation.mergeParentMeta));
  if (conversation.mergeChildMeta) handoffParts.push(JSON.stringify(conversation.mergeChildMeta));
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
  // ONLY source for muse, whose stdout carries no token fields at all). Live
  // wins when present; the file is what makes an idle thread read correctly
  // instead of falling back to chars/4.
  const measuredTokens =
    conversation.providerUsage?.contextTokens ?? sessionContext?.contextTokens ?? null;
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
    modelName: conversation.modelName ?? null,
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

export function registerConversationRoutes(
  app: Express,
  getConversation: (id: string) => ConversationDetail | undefined,
  deps: ContextBreakdownDeps = {}
): void {
  app.get('/api/conversations/:conversationId/context-breakdown', async (request, response) => {
    const conversation = getConversation(request.params.conversationId);
    if (!conversation) {
      response.status(404).json({ error: 'Conversation not found' });
      return;
    }
    const data = conversation.toJSON();
    let branch: ConversationBranch | null | undefined;
    try {
      branch = (await deps.getBranch?.(data.id)) ?? null;
    } catch {
      branch = null;
    }
    let usage: SessionProviderUsage | null = null;
    try {
      usage = data.sessionId
        ? (deps.lookupUsage ?? lookupProviderUsageForSession)(data.sessionId)
        : null;
    } catch {
      usage = null;
    }
    const snapshot = (() => {
      try {
        return conversation.getMemorySnapshot?.()?.briefing ?? null;
      } catch {
        return null;
      }
    })();
    // The harness's own session log: the latest request's context, plus the
    // window and compaction markers it recorded. Retroactive, so a thread that
    // has not taken a turn since the live event shipped still reads correctly.
    let sessionContext: SessionContextReading | null = null;
    try {
      sessionContext = data.sessionId
        ? (deps.lookupContext ?? lookupSessionContext)(data.sessionId)
        : null;
    } catch {
      sessionContext = null;
    }
    const contextWindow = resolveContextWindow({
      modelId: data.model ?? null,
      reportedModelName: data.modelName ?? data.reportedModel ?? null,
      // codex reports its window on the same record as its usage, so the file
      // supplies the denominator too when the live event has not run.
      reportedWindow: data.providerUsage?.contextWindow ?? sessionContext?.contextWindow ?? null,
    });
    response.json(
      buildContextBreakdown(data, snapshot, branch, usage, contextWindow, sessionContext)
    );
  });

  app.get('/api/conversations/:conversationId', (request, response) => {
    const conversation = getConversation(request.params.conversationId);
    if (!conversation) {
      response.status(404).json({ error: 'Conversation not found' });
      return;
    }
    response.json(conversation.toJSON());
  });
}
