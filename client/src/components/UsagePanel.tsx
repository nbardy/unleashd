import { PROVIDER_OPTIONS, type Provider, getProviderMetadata } from '@unleashd/shared';
import { useEffect, useState } from 'react';
import './UsagePanel.css';

interface Props {
  onClose: () => void;
}

interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  sessions: number;
}

interface SessionUsage {
  sessionId: string;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  date: string;
}

interface RateLimit {
  label: string;
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number | null;
  tokenCount?: number;
}

interface UsageData {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSessions: number;
  days: number;
  daily: DailyUsage[];
  topSessions: SessionUsage[];
  rateLimits: Record<Provider, RateLimit[]>;
}

type ProviderTab = 'all' | Provider;

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function formatResetTime(timestamp: number | null): string {
  if (!timestamp) return '';
  const now = Date.now() / 1000;
  const diff = timestamp - now;
  if (diff <= 0) return 'now';
  if (diff < 3600) return `${Math.ceil(diff / 60)}m`;
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h`;
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function barColor(percent: number): string {
  if (percent >= 80) return 'var(--danger)';
  if (percent >= 50) return 'var(--warning)';
  return 'var(--ai)';
}

function RateLimitGauge({ rl }: { rl: RateLimit }) {
  const hasPercent = rl.usedPercent > 0;
  return (
    <div className="usage-rate-gauge">
      <div className="usage-rate-label-row">
        <span className="usage-rate-label">{rl.label}</span>
        <span className="usage-rate-percent">
          {hasPercent
            ? `${rl.usedPercent}% used`
            : rl.tokenCount
              ? `${formatTokens(rl.tokenCount)} tokens`
              : 'no data'}
        </span>
      </div>
      {hasPercent && (
        <div className="usage-rate-bar">
          <div
            className="usage-rate-bar-fill"
            style={{
              width: `${Math.min(rl.usedPercent, 100)}%`,
              background: barColor(rl.usedPercent),
            }}
          />
        </div>
      )}
      {!hasPercent && rl.tokenCount !== undefined && rl.tokenCount > 0 && (
        <div className="usage-rate-bar">
          {/* No % available — show a subtle filled bar */}
          <div
            className="usage-rate-bar-fill"
            style={{ width: '100%', background: 'var(--border-default)', opacity: 0.5 }}
          />
        </div>
      )}
      {rl.resetsAt && (
        <span className="usage-rate-reset">Resets in {formatResetTime(rl.resetsAt)}</span>
      )}
    </div>
  );
}

// Module-level cache so reopening the panel is instant
let clientCache: { days: number; data: UsageData; time: number } | null = null;

export function UsagePanel({ onClose }: Props) {
  // Seed from cache if available for the same days value
  const [data, setData] = useState<UsageData | null>(() =>
    clientCache && clientCache.days === 7 ? clientCache.data : null
  );
  const [loading, setLoading] = useState(data === null);
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<ProviderTab>('all');
  const providerTabs = ['all', ...PROVIDER_OPTIONS.map((provider) => provider.id)] as const;

  useEffect(() => {
    // Show stale data while revalidating (don't flash loading if we have cache)
    if (clientCache && clientCache.days === days) {
      setData(clientCache.data);
      setLoading(false);
    } else {
      setLoading(true);
    }
    // Toggling 7 → 30 → 7 quickly leaves three requests in flight. Without this
    // guard the slowest response wins regardless of which `days` is current, and
    // — because clientCache holds a single entry — it would also overwrite the
    // cache with data for the wrong window. A stale response is dropped entirely.
    let cancelled = false;
    fetch(`/api/usage?days=${days}`)
      .then((r) => r.json())
      .then((d: UsageData) => {
        if (cancelled) return;
        clientCache = { days, data: d, time: Date.now() };
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  // Filter entries by provider tab
  const filteredDaily = data?.daily ?? [];
  const filteredSessions = data
    ? tab === 'all'
      ? data.topSessions
      : data.topSessions.filter((s) => s.provider === tab)
    : [];

  const maxDailyCost =
    filteredDaily.length > 0 ? Math.max(...filteredDaily.map((d) => d.costUsd)) : 0;

  return (
    <div
      className="usage-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="usage-panel">
        <div className="usage-panel-header">
          <h2>Usage</h2>
          <button type="button" className="close-btn" onClick={onClose}>
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="usage-panel-body">
          {loading ? (
            <div className="usage-empty">Loading usage data...</div>
          ) : !data ? (
            <div className="usage-empty">Failed to load usage data.</div>
          ) : (
            <>
              {/* Provider toggle */}
              <div className="usage-tab-row">
                {(['all', ...providerTabs] as ProviderTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`usage-tab ${tab === t ? 'active' : ''}`}
                    onClick={() => setTab(t === 'all' ? 'all' : (t as Provider))}
                  >
                    {t === 'all' ? 'All' : getProviderMetadata(t).label}
                  </button>
                ))}
              </div>

              {/* Rate Limit Gauges (Dynamic for all providers) */}
              {Object.entries(data.rateLimits).map(([p, rls]) => {
                const providerId = p as Provider;
                const metadata = getProviderMetadata(providerId);
                const show = (tab === 'all' || tab === providerId) && rls.length > 0;
                if (!show) return null;

                return (
                  <div key={providerId} className="usage-rate-group">
                    <span className="usage-rate-provider">{metadata.label}</span>
                    {rls.map((rl) => (
                      <RateLimitGauge key={rl.label} rl={rl} />
                    ))}
                  </div>
                );
              })}

              {/* Token + cost summary */}
              <div className="usage-stats-row">
                <div className="usage-token-stat">
                  <span className="usage-token-value">{formatCost(data.totalCostUsd)}</span>
                  <span className="usage-token-label">est. cost ({days}d)</span>
                </div>
                <div className="usage-token-stat">
                  <span className="usage-token-value">{formatTokens(data.totalInputTokens)}</span>
                  <span className="usage-token-label">input</span>
                </div>
                <div className="usage-token-stat">
                  <span className="usage-token-value">{formatTokens(data.totalOutputTokens)}</span>
                  <span className="usage-token-label">output</span>
                </div>
                <div className="usage-token-stat">
                  <span className="usage-token-value">{data.totalSessions}</span>
                  <span className="usage-token-label">sessions</span>
                </div>
              </div>

              {/* Time range selector */}
              <div className="usage-range-row">
                <p className="usage-breakdown-header">Daily breakdown</p>
                <div className="usage-range-buttons">
                  {[7, 30, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`usage-range-btn ${days === d ? 'active' : ''}`}
                      onClick={() => setDays(d)}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>

              {/* Daily chart */}
              {filteredDaily.length > 0 ? (
                <div className="usage-daily-list">
                  {filteredDaily.map((day) => (
                    <div key={day.date} className="usage-daily-row">
                      <span className="usage-daily-date">{day.date.slice(5)}</span>
                      <div className="usage-conv-bar">
                        <div
                          className="usage-conv-bar-fill"
                          style={{
                            width: `${maxDailyCost > 0 ? (day.costUsd / maxDailyCost) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="usage-conv-cost">{formatCost(day.costUsd)}</span>
                      <span className="usage-daily-sessions">{day.sessions}s</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="usage-empty">No sessions found in the last {days} days.</div>
              )}

              {/* Top sessions */}
              {filteredSessions.length > 0 && (
                <>
                  <p className="usage-breakdown-header">Top sessions by cost</p>
                  <div className="usage-session-list">
                    {filteredSessions.slice(0, 10).map((s) => (
                      <div key={s.sessionId} className="usage-daily-row">
                        <span className="usage-session-provider">
                          {getProviderMetadata(s.provider).shortLabel}
                        </span>
                        <span className="usage-session-id">{s.sessionId.slice(0, 8)}</span>
                        <span className="usage-daily-date">{s.date.slice(5)}</span>
                        <div className="usage-conv-bar">
                          <div
                            className="usage-conv-bar-fill"
                            style={{ width: `${(s.costUsd / filteredSessions[0].costUsd) * 100}%` }}
                          />
                        </div>
                        <span className="usage-conv-cost">{formatCost(s.costUsd)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
