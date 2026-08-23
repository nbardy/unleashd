import { useState } from 'react';
import { Link } from 'react-router-dom';
import { buddyApi } from '../../components/buddies/api';
import { conversationPath } from '../../components/buddies/buddy-tabs';
import type { BuddyAutomation, ConversationLink } from '../../components/buddies/types';
import { EmptyState } from '../components/EmptyState';

// Automation ITEM routes are not buddy-scoped: the server registers
// `/api/buddies/automations/:automationId` (+ `/run`), while the LIST route is
// `/api/buddies/:buddyId/automations`. This tab generalised from the list and
// built buddy-scoped item URLs, which matched no route at all — and both
// handlers swallowed the failure with `.catch(() => {})`, so the list simply
// refetched unchanged and the buttons looked like they had worked.
const automationItemUrl = (automationId: string) =>
  `/api/buddies/automations/${encodeURIComponent(automationId)}`;

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

  const runAction = (key: string, request: Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    void request
      .then(() => onRefresh())
      .catch((cause: unknown) =>
        setActionError(cause instanceof Error ? cause.message : String(cause))
      )
      .finally(() => setBusy(null));
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
            <article key={automation.id} className="mobile-automation-card">
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
                <p className="mobile-muted">
                  Next: {new Date(automation.next_run_at).toLocaleString()}
                </p>
              )}
              <div className="mobile-automation-card__actions">
                <button
                  type="button"
                  className="mobile-cta mobile-cta--small"
                  disabled={busy !== null}
                  onClick={() =>
                    runAction(
                      `run-${automation.id}`,
                      buddyApi(`${automationItemUrl(automation.id)}/run`, { method: 'POST' })
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
                    runAction(
                      `toggle-${automation.id}`,
                      buddyApi(automationItemUrl(automation.id), {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: !automation.enabled }),
                      })
                    )
                  }
                >
                  {automation.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
              {automation.runs && automation.runs.length > 0 && (
                <ul className="mobile-automation-runs">
                  {automation.runs.slice(0, 3).map((run) => (
                    <li key={run.id} className="mobile-muted">
                      {run.status === 'claimed' ? 'starting' : run.status} ·{' '}
                      {new Date(run.scheduled_for).toLocaleString()}
                      {run.conversation_id && (
                        <OpenConversationLink
                          conversationId={run.conversation_id}
                          available={availableIds.has(run.conversation_id)}
                          className="mobile-link"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
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
