import { useMemo, useState } from 'react';
import './SwarmConvoPrefix.css';

import {
  parseAvailableConfigs,
  parseStatsFromPrefix,
  parseWorkerTable,
} from '../utils/swarmConvoParsers';

// Re-export parsers for mobile (utils path is canonical; component re-export keeps old import paths working)
export {
  parseAvailableConfigs,
  parseStatsFromPrefix,
  parseWorkerTable,
} from '../utils/swarmConvoParsers';

interface SwarmConvoPrefixProps {
  prefix: string;
  swarmId: string | null;
}

export function SwarmConvoPrefix({ prefix, swarmId }: SwarmConvoPrefixProps) {
  const [expanded, setExpanded] = useState(true);

  const stats = useMemo(() => parseStatsFromPrefix(prefix), [prefix]);
  const workerTable = useMemo(() => parseWorkerTable(prefix), [prefix]);
  const availableConfigs = useMemo(() => parseAvailableConfigs(prefix), [prefix]);

  const isSetup = prefix.includes('You are helping create and run a NEW oompa swarm configuration');
  const label = isSetup ? 'Setup' : (swarmId ?? 'debug');
  const title = isSetup ? 'SWARM SETUP INFORMATION' : 'SWARM DEBUG';

  // Build a compact stats summary for the collapsed state
  const statChips: Array<{ label: string; value: string; kind: string }> = [];
  if (stats.completed) statChips.push({ label: 'Done', value: stats.completed, kind: 'neutral' });
  if (stats.merges) statChips.push({ label: 'Merges', value: stats.merges, kind: 'success' });
  if (stats.rejections && stats.rejections !== '0')
    statChips.push({ label: 'Rej', value: stats.rejections, kind: 'warning' });
  if (stats.errors && stats.errors !== '0')
    statChips.push({ label: 'Err', value: stats.errors, kind: 'error' });

  return (
    <div className="swarm-convo-prefix">
      <button
        type="button"
        className={`swarm-prefix-token ${expanded ? 'expanded' : 'collapsed'}`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="swarm-prefix-indicator">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="swarm-prefix-label">{title}</span>
        <span className="swarm-prefix-id">{label}</span>
        {statChips.length > 0 && (
          <span className="swarm-prefix-stats">
            {statChips.map((chip) => (
              <span key={chip.label} className={`swarm-stat-chip chip-${chip.kind}`}>
                {chip.value} {chip.label}
              </span>
            ))}
          </span>
        )}
        {stats.started && <span className="swarm-prefix-time">{stats.started}</span>}
      </button>
      {expanded && (
        <div className="swarm-prefix-content">
          {/* Structured summary card */}
          <div className="swarm-prefix-summary">
            {stats.project && (
              <div className="swarm-prefix-row">
                <span className="swarm-prefix-key">Project</span>
                <code className="swarm-prefix-val">{stats.project}</code>
              </div>
            )}
            {stats.generatedAt && (
              <div className="swarm-prefix-row">
                <span className="swarm-prefix-key">Generated At</span>
                <span className="swarm-prefix-val">{stats.generatedAt}</span>
              </div>
            )}
            {stats.primaryConfig && (
              <div className="swarm-prefix-row">
                <span className="swarm-prefix-key">Primary Config</span>
                <code className="swarm-prefix-val">{stats.primaryConfig}</code>
              </div>
            )}
            {stats.oompaConfigSummary && (
              <div className="swarm-prefix-row">
                <span className="swarm-prefix-key">Summary</span>
                <span className="swarm-prefix-val">{stats.oompaConfigSummary}</span>
              </div>
            )}
            {availableConfigs.length > 0 && (
              <div className="swarm-prefix-row" style={{ alignItems: 'flex-start' }}>
                <span className="swarm-prefix-key" style={{ marginTop: '2px' }}>
                  Available Configs
                </span>
                <div
                  className="swarm-prefix-val"
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}
                >
                  {availableConfigs.map((cfg) => (
                    <span
                      key={cfg}
                      className="swarm-stat-chip chip-neutral"
                      style={{ margin: 0, padding: '2px 6px', fontSize: '10px' }}
                    >
                      {cfg}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {stats.started && (
              <div className="swarm-prefix-row">
                <span className="swarm-prefix-key">Started</span>
                <span className="swarm-prefix-val">{stats.started}</span>
              </div>
            )}
            {stats.runsDir && (
              <div className="swarm-prefix-row">
                <span className="swarm-prefix-key">Run Artifacts</span>
                <code className="swarm-prefix-val">{stats.runsDir}</code>
              </div>
            )}
          </div>

          {/* Stats grid */}
          {stats.iterations && (
            <div className="swarm-prefix-stat-grid">
              <div className="swarm-prefix-stat">
                <span className="swarm-prefix-stat-value">{stats.completed ?? '—'}</span>
                <span className="swarm-prefix-stat-label">Completed</span>
              </div>
              <div className="swarm-prefix-stat">
                <span className="swarm-prefix-stat-value">{stats.iterations}</span>
                <span className="swarm-prefix-stat-label">Total Cycles</span>
              </div>
              <div className="swarm-prefix-stat">
                <span className="swarm-prefix-stat-value stat-success">{stats.merges ?? '0'}</span>
                <span className="swarm-prefix-stat-label">Merges</span>
              </div>
              <div className="swarm-prefix-stat">
                <span className="swarm-prefix-stat-value stat-warning">
                  {stats.rejections ?? '0'}
                </span>
                <span className="swarm-prefix-stat-label">Rejections</span>
              </div>
              <div className="swarm-prefix-stat">
                <span className="swarm-prefix-stat-value stat-error">{stats.errors ?? '0'}</span>
                <span className="swarm-prefix-stat-label">Errors</span>
              </div>
            </div>
          )}

          {/* Worker table */}
          {workerTable && (
            <div className="swarm-prefix-workers">
              <table className="swarm-prefix-table">
                <thead>
                  <tr>
                    {workerTable.headers.map((h, i) => (
                      <th key={i}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workerTable.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} className={ci === 0 ? 'worker-id-cell' : undefined}>
                          {ci === 2 ? (
                            <span className={`swarm-prefix-status status-${cell}`}>{cell}</span>
                          ) : (
                            cell
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Raw prefix text (collapsible) */}
          <details className="swarm-prefix-raw">
            <summary>Raw CLI Context</summary>
            <pre className="swarm-prefix-text">{prefix}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
