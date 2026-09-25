import type { SubAgent } from '@unleashd/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './SubAgentPanel.css';

interface SubAgentPanelProps {
  subAgents: SubAgent[];
  workingDirectory: string;
}

/**
 * SubAgentPanel - Displays active sub-agents from all providers.
 *
 * Shows a tree-like display with:
 * - Description of the task
 * - Tool use count and token usage
 * - Current action being performed
 * - Status indicator (spinner for running, checkmark for done)
 *
 * Auto-collapses when all agents finish. Can be manually toggled via Ctrl+O.
 */
export function SubAgentPanel({ subAgents, workingDirectory }: SubAgentPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  // Track whether the user has manually toggled — if so, don't auto-collapse/expand on hover
  const userToggledRef = useRef(false);

  // Filter to show only active (running) sub-agents, plus recently completed ones
  const activeAgents = subAgents.filter((a) => a.status === 'running' || a.status === 'pending');
  const recentlyCompleted = subAgents
    .filter((a) => a.status === 'completed' || a.status === 'error')
    .slice(-3); // Show last 3 completed

  const displayAgents = [...activeAgents, ...recentlyCompleted];

  // Auto-collapse when all agents complete (unless user manually toggled)
  const hasRunning = activeAgents.length > 0;
  const hadRunningRef = useRef(hasRunning);
  useEffect(() => {
    if (hadRunningRef.current && !hasRunning && !userToggledRef.current) {
      // Transition from running → all done: auto-collapse
      setIsExpanded(false);
    }
    if (hasRunning && !hadRunningRef.current) {
      // New agents started — reset manual toggle flag but stay collapsed by default
      userToggledRef.current = false;
    }
    hadRunningRef.current = hasRunning;
  }, [hasRunning]);

  const handleMouseEnter = () => {
    if (!userToggledRef.current) {
      setIsExpanded(true);
    }
  };

  const handleMouseLeave = () => {
    if (!userToggledRef.current) {
      setIsExpanded(false);
    }
  };

  // Don't show if no agents
  if (displayAgents.length === 0) {
    return null;
  }

  const runningCount = activeAgents.length;

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  };

  const toggleExpanded = () => {
    userToggledRef.current = true;
    setIsExpanded((prev) => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+O to toggle expansion (matches Claude CLI behavior)
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
      e.preventDefault();
      toggleExpanded();
    }
  };

  return (
    <div
      className="subagent-panel"
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Header - always visible */}
      <button
        type="button"
        className="subagent-header ui-row"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <span className={`subagent-indicator ${runningCount > 0 ? 'running' : 'done'}`} />
        <span className="subagent-summary">
          {runningCount > 0 ? (
            <>
              <strong>{runningCount}</strong> sub-agent{runningCount !== 1 ? 's' : ''} running
            </>
          ) : (
            <>Sub-agents completed</>
          )}
        </span>
        <span className="subagent-shortcut ui-muted">Ctrl+O</span>
        <svg
          className={`subagent-chevron ui-muted${isExpanded ? ' expanded' : ''}`}
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Tree view - collapsible with CSS transition */}
      <div className={`subagent-tree-wrapper ${isExpanded ? 'expanded' : ''}`}>
        <div className="subagent-tree">
          {displayAgents.map((agent, index) => {
            const isLast = index === displayAgents.length - 1;
            const isRunning = agent.status === 'running' || agent.status === 'pending';

            return (
              <div key={agent.id} className="subagent-item">
                {/* Tree connector */}
                <span className="tree-connector ui-muted">
                  {isLast ? '\u2514\u2500' : '\u251C\u2500'}
                </span>

                {/* Status indicator */}
                <span className={`subagent-status ui-inline-row ${agent.status}`}>
                  {isRunning ? (
                    <span className="status-spinner" />
                  ) : agent.status === 'completed' ? (
                    '\u2713'
                  ) : (
                    '\u2717'
                  )}
                </span>

                {/* Agent info */}
                <div className="subagent-info">
                  <span className="subagent-description ui-truncate">
                    {agent.id.startsWith('swarm-') ? (
                      <Link
                        to={`/workers/detail?project=${encodeURIComponent(workingDirectory)}`}
                        className="swarm-link"
                      >
                        {truncateDescription(agent.description)}
                      </Link>
                    ) : (
                      truncateDescription(agent.description)
                    )}
                  </span>
                  <span className="subagent-stats ui-row">
                    {agent.toolUses > 0 && (
                      <>
                        <span className="ui-muted">{'\u00B7'}</span>
                        <span className="stat">
                          {agent.toolUses} tool use{agent.toolUses !== 1 ? 's' : ''}
                        </span>
                      </>
                    )}
                    {agent.tokens > 0 && (
                      <>
                        <span className="ui-muted">{'\u00B7'}</span>
                        <span className="stat">{formatTokens(agent.tokens)} tokens</span>
                      </>
                    )}
                  </span>
                </div>

                {/* Current action (shown on second line for running agents) */}
                {agent.currentAction && (
                  <div className="subagent-current-action ui-row">
                    <span className="tree-connector-sub ui-muted">
                      {isLast ? '   ' : '\u2502  '}
                    </span>
                    <span className="action-connector ui-muted">{'\u2514'}</span>
                    <span className={`current-action ui-truncate ${isRunning ? 'active' : 'done'}`}>
                      {agent.currentAction}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Truncate long descriptions for display
 */
function truncateDescription(description: string, maxLength = 60): string {
  // Remove leading/trailing whitespace and normalize
  const normalized = description.trim().replace(/\s+/g, ' ');

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.substring(0, maxLength - 3)}...`;
}
