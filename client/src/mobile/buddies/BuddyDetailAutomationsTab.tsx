import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { asArray, buddyApi } from '../../components/buddies/api';
import { conversationPath } from '../../components/buddies/buddy-tabs';
import type {
  AutomationRun,
  BuddyAutomation,
  ConversationLink,
} from '../../components/buddies/types';
import { EmptyState } from '../components/EmptyState';

// Automation ITEM routes are not buddy-scoped: the server registers
// `/api/buddies/automations/:automationId` (+ `/run`), while the LIST route is
// `/api/buddies/:buddyId/automations`. This tab generalised from the list and
// built buddy-scoped item URLs, which matched no route at all — and both
// handlers swallowed the failure with `.catch(() => {})`, so the list simply
// refetched unchanged and the buttons looked like they had worked.
const automationItemUrl = (automationId: string) =>
  `/api/buddies/automations/${encodeURIComponent(automationId)}`;

type AutomationAction = (key: string, request: () => Promise<unknown>) => Promise<boolean>;

/**
 * Automation threads are LINKS (`<a href="/chat/:id">`), not onClick handlers,
 * and they are availability-checked exactly like the Conversations tab.
 * Deleting a conversation only terminalises its link row and an automation run
 * keeps its `conversation_id` forever, so navigating to a thread the client no
 * longer holds bounces off Chat.tsx back to `/` — that was the "Open sends me
 * to the conversation list" bug.
 */
function OpenConversationLink({
  conversationId,
  available,
  className,
}: {
  conversationId: string;
  available: boolean;
  className: string;
}) {
  if (!available) {
    return (
      <span aria-disabled="true" className={className}>
        Deleted
      </span>
    );
  }
  return (
    <Link className={className} to={conversationPath(conversationId)}>
      Open →
    </Link>
  );
}

function MobileAutomationCard({
  automation,
  busy,
  runAction,
  availableIds,
}: {
  automation: BuddyAutomation;
  busy: string | null;
  runAction: AutomationAction;
  availableIds: Set<string>;
}) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [showRuns, setShowRuns] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const base = automationItemUrl(automation.id);
  const hasActiveRun = runs.some((run) =>
    ['claimed', 'running', 'cancel_requested'].includes(run.status)
  );
  const loadRuns = useCallback(async () => {
    setRunsError(null);
    try {
      const payload = await buddyApi<unknown>(`${base}/runs`);
      setRuns(asArray<AutomationRun>(payload, 'runs'));
      setShowRuns(true);
    } catch (cause) {
      setRunsError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [base]);
  const cancelRun = async (run: AutomationRun) => {
    const changed = await runAction(`cancel-${run.id}`, () =>
      buddyApi(`/api/buddies/automation-runs/${encodeURIComponent(run.id)}/cancel`, {
        method: 'POST',
      })
    );
    if (changed) await loadRuns();
  };
  const mutateAndRefreshRuns = async (key: string, request: () => Promise<unknown>) => {
    const changed = await runAction(key, request);
    if (changed && showRuns) await loadRuns();
  };
  useEffect(() => {
    if (!showRuns || !hasActiveRun) return;
    const timer = window.setInterval(() => void loadRuns(), 2_000);
    return () => window.clearInterval(timer);
  }, [showRuns, hasActiveRun, loadRuns]);

  return (
    <article className="mobile-automation-card">
      <div className="mobile-automation-card__header">
        <h4>{automation.name}</h4>
        <span
          className={`mobile-badge ${automation.enabled ? 'mobile-badge--done' : 'mobile-badge--blocked'}`}
        >
          {automation.enabled ? 'enabled' : 'disabled'}
        </span>
      </div>
      <p className="mobile-muted">
        {automation.schedule_kind}: {automation.schedule_expression} · {automation.timezone}
      </p>
      <p className="mobile-muted">Job: {automation.job_kind}</p>
      {automation.next_run_at && (
        <p className="mobile-muted">Next: {new Date(automation.next_run_at).toLocaleString()}</p>
      )}
      <div className="mobile-automation-card__actions">
        <button
          type="button"
          className="mobile-cta mobile-cta--small"
          disabled={busy !== null}
          onClick={() =>
            void mutateAndRefreshRuns(`run-${automation.id}`, () =>
              buddyApi(`${base}/run`, { method: 'POST' })
            )
          }
        >
          Run now
        </button>
        <button
          type="button"
          className="mobile-cta mobile-cta--small mobile-cta--secondary"
          disabled={busy !== null}
          onClick={() =>
            void mutateAndRefreshRuns(`toggle-${automation.id}`, () =>
              buddyApi(base, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !automation.enabled }),
              })
            )
          }
        >
          {automation.enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          className="mobile-cta mobile-cta--small mobile-cta--secondary"
          disabled={busy !== null}
          onClick={() => void loadRuns()}
        >
          History
        </button>
        <button
          type="button"
          className="mobile-cta mobile-cta--small mobile-cta--secondary"
          disabled={busy !== null}
          onClick={() => {
            if (window.confirm(`Archive "${automation.name}" and preserve its run history?`)) {
              void runAction(`archive-${automation.id}`, () =>
                buddyApi(base, { method: 'DELETE' })
              );
            }
          }}
        >
          Archive
        </button>
      </div>
      {runsError && (
        <div className="mobile-error" role="alert">
          {runsError}
        </div>
      )}
      {showRuns && (
        <ul className="mobile-automation-runs">
          {runs.slice(0, 10).map((run) => (
            <li key={run.id} className="mobile-muted">
              {run.status === 'claimed'
                ? 'starting'
                : run.status === 'cancel_requested'
                  ? 'cancelling'
                  : run.status}{' '}
              · {new Date(run.scheduled_for).toLocaleString()}
              {run.conversation_id && (
                <OpenConversationLink
                  conversationId={run.conversation_id}
                  available={availableIds.has(run.conversation_id)}
                  className="mobile-link"
                />
              )}
              {(run.outcome || run.error) && <small>{run.outcome ?? run.error}</small>}
              {['claimed', 'running'].includes(run.status) && (
                <button
                  type="button"
                  className="mobile-cta mobile-cta--small mobile-cta--secondary"
                  disabled={busy !== null}
                  onClick={() => void cancelRun(run)}
                >
                  Cancel
                </button>
              )}
            </li>
          ))}
          {runs.length === 0 && <li className="mobile-muted">No runs yet.</li>}
        </ul>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Automations tab (lightweight, reuses asArray + automationConversations filter)
// ---------------------------------------------------------------------------

export function AutomationsTab({
  automations,
  automationConversations,
  busy,
  setBusy,
  error,
  availableIds,
  onRefresh,
}: {
  buddyId: string;
  workspaceId?: string;
  automations: BuddyAutomation[];
  automationConversations: ConversationLink[];
  busy: string | null;
  setBusy: (value: string | null) => void;
  error: string | null;
  /** Conversation ids the client actually holds — a run outlives its thread. */
  availableIds: Set<string>;
  onRefresh: () => void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction: AutomationAction = async (key, request) => {
    setBusy(key);
    setActionError(null);
    try {
      await request();
      onRefresh();
      return true;
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (error) {
    return (
      <section className="mobile-buddy-section">
        <EmptyState
          icon="⚠"
          title="Could not load automations"
          message={error}
          actionLabel="Retry"
          onAction={onRefresh}
        />
      </section>
    );
  }
  return (
    <section className="mobile-buddy-section" aria-label="Automations">
      <div className="mobile-buddy-section__toolbar">
        <button type="button" className="mobile-cta mobile-cta--secondary" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {actionError && (
        <div className="mobile-error" role="alert">
          {actionError}
        </div>
      )}

      {automations.length === 0 ? (
        <EmptyState message="No automations for this buddy." />
      ) : (
        <div className="mobile-automation-list">
          {automations.map((automation) => (
            <MobileAutomationCard
              key={automation.id}
              automation={automation}
              busy={busy}
              runAction={runAction}
              availableIds={availableIds}
            />
          ))}
        </div>
      )}

      {automationConversations.length > 0 && (
        <>
          <h3 className="mobile-buddy-section__heading">Automation conversations</h3>
          <div className="mobile-buddy-convo-list">
            {automationConversations.map((conversation) => {
              const conversationId =
                conversation.conversation_id ?? conversation.unleashd_conversation_id;
              if (!conversationId) return null;
              return (
                <article key={conversationId} className="mobile-buddy-convo-card">
                  <span className={`mobile-badge mobile-badge--${conversation.status}`}>
                    {conversation.status}
                  </span>
                  <OpenConversationLink
                    conversationId={conversationId}
                    available={availableIds.has(conversationId)}
                    className="mobile-cta"
                  />
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
