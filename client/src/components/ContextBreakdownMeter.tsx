import { resource, usePolledFetch } from '../hooks/usePolledFetch';
import './ContextBreakdownMeter.css';

export interface ContextBreakdownSection {
  chars: number;
  tokensEst: number;
  /** `tokensEst` rescaled to the provider's measured context. */
  tokensScaled: number;
}

export type ContextWindow =
  | { source: 'operator'; tokens: number }
  | { source: 'provider'; tokens: number }
  | { source: 'model'; tokens: number; modelId: string }
  | { source: 'unknown'; tokens: number; modelId: string | null };

export interface ContextBreakdownData {
  conversationId: string;
  sessionId: string;
  provider: string;
  modelName: string | null;
  contextWindow: ContextWindow;
  budgetTokens: number;
  readingSource: 'measured' | 'estimated';
  totalTokens: number;
  residualTokens: number;
  compaction: {
    detected: boolean;
    /** 'marker' = the harness recorded the boundary; 'inferred' = our arithmetic. */
    source: 'marker' | 'inferred';
    historyTokensEst: number;
    measuredTokens: number;
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
    cumulativeInputTokens: number;
    ourSentChars: number;
    deltaTokens: number;
    deltaMultiple: number;
  } | null;
  expansion: { message: string; project: string };
  observedAt: string;
}

export type BreakdownTone = 'normal' | 'warn' | 'strong';

/** Warn at >=70% of budget, strong at >=85%. Same palette as UsagePanel gauges. */
export function breakdownTone(pctOfBudget: number): BreakdownTone {
  if (pctOfBudget >= 85) return 'strong';
  if (pctOfBudget >= 70) return 'warn';
  return 'normal';
}

/** Idle-gap cache expiry shows up as a fresh full-context write. */
export function isWriteSpike(data: ContextBreakdownData): boolean {
  const usage = data.providerUsage;
  if (!usage || usage.cumulativeInputTokens <= 0) return false;
  return usage.cacheWriteTokens > 0.5 * usage.cumulativeInputTokens;
}

export function formatBreakdownTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(Math.round(n));
}

const SECTION_ORDER = ['history', 'briefing', 'memory', 'mcp', 'handoff'] as const;
type SectionKey = (typeof SECTION_ORDER)[number];

const SECTION_CLASS: Record<SectionKey, string> = {
  history: 'ctx-seg-history',
  briefing: 'ctx-seg-briefing',
  memory: 'ctx-seg-memory',
  mcp: 'ctx-seg-mcp',
  handoff: 'ctx-seg-handoff',
};

const WINDOW_LABEL: Record<ContextWindow['source'], string> = {
  operator: 'configured budget',
  provider: 'model window',
  model: 'model window',
  // Never call a guess a window. An unrecognised model gets a conservative
  // floor, and the label says so rather than implying we measured it.
  unknown: 'assumed minimum window',
};

function toneColor(tone: BreakdownTone): string {
  if (tone === 'strong') return 'var(--danger)';
  if (tone === 'warn') return 'var(--warning)';
  return 'var(--ai)';
}

export function ContextBreakdownView({ data }: { data: ContextBreakdownData }) {
  // "Compact & continue" and "auto-compact at 90%" used to live here. Neither
  // did anything: the button only revealed a notice saying so, and the checkbox
  // wrote ctx-autocompact:<id> to localStorage that nothing ever read. A control
  // that implies an action which does not happen is worse than no control, so
  // they are gone rather than left as decoration.
  //
  // Both CLIs already auto-compact on their own (claude at ~967k on a 1M model,
  // codex exec persists a `compacted` record), and this card now SHOWS that
  // happening. Re-adding a manual lever means wiring claude's --autocompact /
  // CLAUDE_CODE_AUTO_COMPACT_WINDOW at spawn time -- and accepting that codex
  // exec exposes no equivalent flag, so the control would be claude-only.
  const tone = breakdownTone(data.pctOfBudget);
  const writeSpike = isWriteSpike(data);
  const measured = data.readingSource === 'measured';
  const total = Math.max(1, data.totalTokens);
  const usage = data.providerUsage;
  const cacheHitPct =
    usage && usage.cumulativeInputTokens > 0
      ? (usage.cacheReadTokens / usage.cumulativeInputTokens) * 100
      : null;
  // A measured reading is the provider's own count, so it gets no "~". Only the
  // estimate keeps the tilde -- the distinction is the whole point of the card.
  const headline = `${measured ? '' : '~'}${formatBreakdownTokens(data.totalTokens)}/${formatBreakdownTokens(
    data.budgetTokens
  )} tok (${Math.round(data.pctOfBudget)}% of ${WINDOW_LABEL[data.contextWindow.source]})`;

  return (
    <div className={`ctx-breakdown ctx-breakdown--${tone}`} data-testid="context-breakdown">
      {/* In the chat header this is the bar alone — no digits. The numbers live
          in the hover card and in this label, which is all a screen reader gets
          because the bar itself is decorative. */}
      <button
        type="button"
        className="ctx-breakdown__trigger"
        aria-label={`Context usage ${headline}`}
      >
        <span className="ctx-breakdown__track" aria-hidden="true">
          <span
            className="ctx-breakdown__fill"
            style={{ background: toneColor(tone), width: `${Math.min(data.pctOfBudget, 100)}%` }}
          />
        </span>
      </button>
      {/* Always in the DOM; CSS reveals it on hover and focus-within. Holding
          "open" in React state would race the pointer crossing the gap to the
          card, and keyboard users would need a second code path. */}
      <div className="ctx-breakdown__details">
        <p className="ctx-breakdown__headline">{headline}</p>
        <p className="ctx-breakdown__note">
          {measured
            ? 'total is the provider\u2019s own count for this turn; the per-section split is a chars/4 estimate.'
            : 'chars/4 estimate \u2014 no provider count reported for this session yet.'}
        </p>
        {data.compaction?.detected && (
          <output className="ctx-breakdown__compaction">
            compacted provider-side
            {data.compaction.count !== null && data.compaction.count > 1
              ? ` ${data.compaction.count}x`
              : ''}
            : we still hold ~{formatBreakdownTokens(data.compaction.historyTokensEst)} tok of
            history, the provider is carrying{' '}
            {formatBreakdownTokens(data.compaction.measuredTokens)}.
            {/* Only a harness marker carries real pre/post counts; an inferred
                detection has nothing to show and must not invent any. */}
            {data.compaction.preTokens !== null && (
              <>
                {' '}
                Last boundary dropped {formatBreakdownTokens(data.compaction.preTokens)} to{' '}
                {data.compaction.postTokens === null
                  ? 'a summary'
                  : `${formatBreakdownTokens(data.compaction.postTokens)} tok`}
                {data.compaction.trigger ? ` (${data.compaction.trigger})` : ''}.
              </>
            )}
          </output>
        )}
        <div
          className="ctx-breakdown__stacked"
          role="img"
          aria-label={`Context stack estimate: ${SECTION_ORDER.map(
            (key) => `${key} ${formatBreakdownTokens(data.sections[key].tokensEst)} tokens`
          ).join(', ')}`}
        >
          {SECTION_ORDER.map((key) => (
            <div
              key={key}
              className={`ctx-breakdown__seg ${SECTION_CLASS[key]}`}
              style={{ width: `${(data.sections[key].tokensScaled / total) * 100}%` }}
              title={`${key}: ${data.sections[key].chars} chars, ~${formatBreakdownTokens(data.sections[key].tokensScaled)} tokens (est.)`}
            />
          ))}
          {data.residualTokens > 0 && (
            <div
              className="ctx-breakdown__seg ctx-seg-residual"
              style={{ width: `${(data.residualTokens / total) * 100}%` }}
              title={`harness overhead: ${formatBreakdownTokens(data.residualTokens)} tokens (measured, not modelled) — the CLI's own system prompt and tool schemas`}
            />
          )}
        </div>
        <ul className="ctx-breakdown__legend">
          {SECTION_ORDER.map((key) => (
            <li key={key}>
              <span className={`ctx-breakdown__swatch ${SECTION_CLASS[key]}`} aria-hidden="true" />
              <span className="ctx-breakdown__seg-name">{key}</span>
              <span className="ctx-breakdown__seg-values">
                {data.sections[key].chars} chars · ~
                {formatBreakdownTokens(data.sections[key].tokensScaled)} tok est.
              </span>
            </li>
          ))}
          {data.residualTokens > 0 && (
            <li>
              <span className="ctx-breakdown__swatch ctx-seg-residual" aria-hidden="true" />
              <span className="ctx-breakdown__seg-name">harness</span>
              <span className="ctx-breakdown__seg-values">
                {formatBreakdownTokens(data.residualTokens)} tok measured
              </span>
            </li>
          )}
        </ul>
        {usage ? (
          <p className="ctx-breakdown__provider">
            we sent ~{formatBreakdownTokens(data.totalTokensEst)} tok this turn stack; provider
            priced {formatBreakdownTokens(usage.cumulativeInputTokens)} cumulative input (
            {usage.deltaMultiple.toFixed(1)}x re-read
            {cacheHitPct !== null ? `, ${Math.round(cacheHitPct)}% cache hit` : ''})
          </p>
        ) : (
          <p className="ctx-breakdown__provider ctx-breakdown__provider--none">
            provider usage unavailable for this session — estimates only.
          </p>
        )}
        {writeSpike && (
          <p className="ctx-breakdown__alert" role="alert">
            write spike: cache writes exceed 50% of cumulative input — likely cache TTL expiry after
            an idle gap, not a compaction boundary.
          </p>
        )}
        <p className="ctx-breakdown__expansion">
          full bodies via {data.expansion.message} · {data.expansion.project}
        </p>
      </div>
    </div>
  );
}

export function ContextBreakdownMeter({ conversationId }: { conversationId: string }) {
  const source = conversationId
    ? resource<ContextBreakdownData>(`context-breakdown:${conversationId}`, (signal) =>
        fetch(`/api/conversations/${encodeURIComponent(conversationId)}/context-breakdown`, {
          signal,
        }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json() as Promise<ContextBreakdownData>;
        })
      )
    : null;
  // Refetch on key change + WS-reconnect refresh; header and details share the
  // keyed cache entry via usePolledFetch.
  const { data } = usePolledFetch<ContextBreakdownData>(source, 0);
  if (!data) return null;
  return <ContextBreakdownView data={data} />;
}
