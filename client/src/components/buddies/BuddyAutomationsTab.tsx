import { useState } from 'react';
import { Link } from 'react-router-dom';
import { asArray, buddyApi } from './api';
import { conversationPath } from './buddy-tabs';
import type { AutomationRun, BuddyApprovalRequest, BuddyAutomation, BuddyMutation } from './types';
import type { ConversationLink } from './types';

interface BuddyAutomationsTabProps {
  automations: BuddyAutomation[];
  approvals: BuddyApprovalRequest[];
  busy: boolean;
  mutate: BuddyMutation;
  refresh: () => Promise<void>;
  /** Conversation ids the client actually holds — a run outlives its thread. */
  availableConversationIds: Set<string>;
  automationConversations: ConversationLink[];
}

/**
 * Automation threads are LINKS (`<a href="/chat/:id">`), not onClick handlers:
 * they open in a new tab, show their target in the status bar, and land in
 * history. They also have to be availability-checked the same way the
 * Conversations tab is — deleting a conversation only terminalises its link
 * row, and an automation run keeps its `conversation_id` forever. Navigating to
 * a thread the client no longer holds bounces off Chat.tsx straight back to
 * `/`, which is exactly the "Open sends me to the conversation list" bug.
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
      <span aria-disabled="true" className={`${className} ${className}--unavailable`}>
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

export function BuddyAutomationsTab({
  automations,
  approvals,
  busy,
  mutate,
  refresh,
  availableConversationIds,
  automationConversations,
}: BuddyAutomationsTabProps) {
  return (
    <section className="buddy-section">
      <div className="buddy-approval-list">
        <h2>Human approvals</h2>
        {approvals
          .filter((approval) => approval.status === 'pending')
          .map((approval) => (
            <article key={approval.id} className="buddy-approval-card">
              <div>
                <strong>{approval.action}</strong>
                <span>{approval.reason}</span>
                <small>Risk: {approval.risk}</small>
              </div>
              <div className="buddy-record-actions">
                {(['approved', 'rejected'] as const).map((decision) => (
                  <button
                    type="button"
                    key={decision}
                    disabled={busy}
                    onClick={() =>
                      void mutate(`approval-${approval.id}-${decision}`, () =>
                        buddyApi(
                          `/api/buddies/approvals/${encodeURIComponent(approval.id)}/resolve`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              decision,
                              resolvedBy: 'Owner',
                            }),
                          }
                        )
                      )
                    }
                  >
                    {decision === 'approved' ? 'Approve' : 'Reject'}
                  </button>
                ))}
              </div>
            </article>
          ))}
        {approvals.every((approval) => approval.status !== 'pending') && (
          <p className="buddy-empty">No pending approvals.</p>
        )}
      </div>
      <div className="buddy-record-list">
        {automations.map((automation) => (
          <AutomationCard
            key={automation.id}
            automation={automation}
            busy={busy}
            onMutate={mutate}
            onRefresh={refresh}
            availableConversationIds={availableConversationIds}
          />
        ))}
      </div>
      <div className="buddy-automation-conversations">
        <h2>Automation conversations</h2>
        {automationConversations.map((conversation) => {
          const conversationId =
            conversation.conversation_id ?? conversation.unleashd_conversation_id;
          if (!conversationId) return null;
          const available = availableConversationIds.has(conversationId);
          return (
            <div className="buddy-automation-conversation" key={conversation.id ?? conversationId}>
              <span>
                <strong>Automation run</strong>
                {conversation.last_active_at
                  ? new Date(conversation.last_active_at).toLocaleString()
                  : 'No activity recorded'}
              </span>
              <OpenConversationLink
                conversationId={conversationId}
                available={available}
                className="buddy-automation-conversation__open"
              />
            </div>
          );
        })}
        {automationConversations.length === 0 && (
          <p className="buddy-empty">No automation conversations yet.</p>
        )}
      </div>
    </section>
  );
}

interface AutomationCardProps {
  automation: BuddyAutomation;
  busy: boolean;
  onMutate: BuddyMutation;
  onRefresh: () => Promise<void>;
  availableConversationIds: Set<string>;
}

function AutomationCard({
  automation,
  busy,
  onMutate,
  onRefresh,
  availableConversationIds,
}: AutomationCardProps) {
  const [runs, setRuns] = useState<AutomationRun[]>(automation.runs ?? []);
  const [showRuns, setShowRuns] = useState(false);
  const base = `/api/buddies/automations/${encodeURIComponent(automation.id)}`;
  const loadRuns = async () => {
    const payload = await buddyApi<unknown>(`${base}/runs`);
    setRuns(asArray<AutomationRun>(payload, 'runs'));
    setShowRuns(true);
  };
  return (
    <article className="buddy-automation-card">
      <div>
        <strong>{automation.name}</strong>
        <span className="buddy-automation-card__schedule">
          {automation.schedule_kind} · {automation.schedule_expression} · {automation.timezone}
        </span>
        <span className="buddy-automation-card__next">
          {automation.next_run_at
            ? `Next ${new Date(automation.next_run_at).toLocaleString()}`
            : 'Not scheduled'}
          {automation.last_run_at
            ? ` · Last ${new Date(automation.last_run_at).toLocaleString()}`
            : ''}
        </span>
      </div>
      <div className="buddy-record-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void onMutate(`toggle-${automation.id}`, () =>
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
          disabled={busy}
          onClick={() =>
            void onMutate(`run-${automation.id}`, () => buddyApi(`${base}/run`, { method: 'POST' }))
          }
        >
          Run now
        </button>
        <button type="button" onClick={() => void loadRuns()}>
          History
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${automation.name}"?`))
              void onMutate(`delete-${automation.id}`, () => buddyApi(base, { method: 'DELETE' }));
          }}
        >
          Delete
        </button>
      </div>
      {showRuns && (
        <div className="buddy-run-history">
          {runs.map((run) => (
            <div key={run.id}>
              <span>
                {run.status === 'claimed' ? 'starting' : run.status} ·{' '}
                {new Date(run.scheduled_for).toLocaleString()}
              </span>
              {run.conversation_id && (
                <OpenConversationLink
                  conversationId={run.conversation_id}
                  available={availableConversationIds.has(run.conversation_id)}
                  className="buddy-run-open"
                />
              )}
              <small>{run.outcome ?? run.error}</small>
              {(run.tokens_used !== undefined || run.cost_usd !== undefined) && (
                <small>
                  {run.tokens_used ?? 0} tokens · ${(run.cost_usd ?? 0).toFixed(2)}
                </small>
              )}
            </div>
          ))}
          {runs.length === 0 && <span>No runs yet.</span>}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {busy ? 'Updating automation' : ''}
      </span>
      <button className="sr-only" type="button" onClick={() => void onRefresh()}>
        Refresh
      </button>
    </article>
  );
}
