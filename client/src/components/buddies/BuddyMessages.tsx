import type { BuddyMessage } from '@unleashd/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddyTeamConfigurationRequest } from './BuddyTeamConfiguration';
import { buddyApi } from './api';

const EMPTY_NAMES: Readonly<Record<string, string>> = {};

export interface BuddyOwnerReply {
  outcome: string;
  body: string;
  evidence: string[];
}

export function BuddyMessages({
  buddyId,
  buddyNames = EMPTY_NAMES,
  messages,
  availableConversationIds,
  onReply,
}: {
  buddyId?: string;
  buddyNames?: Readonly<Record<string, string>>;
  messages: BuddyMessage[];
  availableConversationIds: ReadonlySet<string>;
  onReply(messageId: string, reply: BuddyOwnerReply): Promise<void>;
}) {
  const { data, error, refetch } = usePolledFetch<BuddyMessage[]>(
    buddyId ? `/api/buddies/messages?buddyId=${encodeURIComponent(buddyId)}` : null,
    5000
  );
  const visibleMessages = data ?? messages;
  return (
    <section className="buddy-messages" aria-label="Mailbox">
      <h2>Mailbox</h2>
      <p>Messages, replies, and requests for your approval.</p>
      {error && <p role="alert">Mailbox could not refresh: {error.message}</p>}
      {visibleMessages.length === 0 && <p>No messages yet.</p>}
      {visibleMessages.map((message) => (
        <BuddyMessageCard
          key={message.id}
          message={message}
          buddyNames={buddyNames}
          availableConversationIds={availableConversationIds}
          onChanged={refetch}
          onReply={async (id, reply) => {
            await onReply(id, reply);
            refetch();
          }}
        />
      ))}
    </section>
  );
}

function BuddyMessageCard({
  message,
  buddyNames,
  availableConversationIds,
  onReply,
  onChanged,
}: {
  message: BuddyMessage;
  buddyNames: Readonly<Record<string, string>>;
  availableConversationIds: ReadonlySet<string>;
  onReply(messageId: string, reply: BuddyOwnerReply): Promise<void>;
  onChanged(): void;
}) {
  const [outcome, setOutcome] = useState('answered');
  const [body, setBody] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incomingEnabled, setIncomingEnabled] = useState(false);
  const conversationId = message.child_conversation_id ?? message.parent_conversation_id;
  const canReply =
    message.expects_reply !== 0 &&
    message.to_buddy_id === null &&
    ['pending', 'active'].includes(message.status);
  return (
    <article className="buddy-messages__card">
      <div className="buddy-messages__heading">
        <strong>{message.purpose}</strong>
        <span>
          Request {message.status}
          {message.execution ? ` · Execution ${message.execution.state}` : ''}
          {message.to_buddy_id === null ? ' · To you' : ''}
        </span>
      </div>
      {message.approval && (
        <div>
          <strong>Approval: {message.approval.operation}</strong>
          <pre>{JSON.stringify(message.approval.arguments, null, 2)}</pre>
          <p>Expires {message.approval.expires_at}. Reply with outcome approved or rejected.</p>
        </div>
      )}
      <p className="buddy-messages__participants">
        <Link to={`/buddies/${encodeURIComponent(message.from_buddy_id)}`}>
          {buddyNames[message.from_buddy_id] ?? message.from_buddy_id}
        </Link>
        {' → '}
        {message.to_buddy_id === null ? (
          'You'
        ) : (
          <Link to={`/buddies/${encodeURIComponent(message.to_buddy_id)}`}>
            {buddyNames[message.to_buddy_id] ?? message.to_buddy_id}
          </Link>
        )}
      </p>
      <p className="buddy-messages__body">{message.body}</p>
      {message.execution && (
        <details className="buddy-messages__receipt">
          <summary>Delivery and execution details</summary>
          {message.execution.reason && <p>{message.execution.reason}</p>}
          {message.execution.remedy && <p>{message.execution.remedy}</p>}
          {message.execution.code === 'background_disabled' && message.to_buddy_id && (
            <div>
              <p>
                Enable incoming work for this recipient to admit existing queued tasks. Recurring
                schedules and document permissions stay separately controlled.
              </p>
              <button
                type="button"
                disabled={busy || incomingEnabled}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void buddyApi(
                    `/api/buddies/${encodeURIComponent(message.to_buddy_id!)}/memberships/${encodeURIComponent(message.workspace_id)}`,
                    {
                      method: 'PATCH',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ background_enabled: true }),
                    }
                  )
                    .then(() => {
                      setIncomingEnabled(true);
                      onChanged();
                    })
                    .catch((cause: unknown) => {
                      setError(cause instanceof Error ? cause.message : String(cause));
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {incomingEnabled
                  ? 'Incoming work enabled; awaiting admission'
                  : 'Enable incoming work'}
              </button>
            </div>
          )}
          {message.execution.acknowledgedAt && (
            <p>Input admitted {new Date(message.execution.acknowledgedAt).toLocaleString()}.</p>
          )}
          {message.execution.projectSnapshot && (
            <p>
              Current project: {message.execution.projectSnapshot.status} · revision{' '}
              {message.execution.projectSnapshot.revision} ·{' '}
              {message.execution.projectSnapshot.evidenceCount} evidence references. This is current
              project state, separate from this request.
            </p>
          )}
          {message.execution.delivery?.map((delivery) => (
            <p key={delivery.runId}>
              {delivery.mailboxOnly
                ? 'Saved in mailbox. No automated turn was started in your chat.'
                : `Return delivery: ${delivery.kind} · ${delivery.state} · attempt ${delivery.attempt}`}
              {delivery.error ? ` · ${delivery.error}` : ''}
            </p>
          ))}
          {message.execution.acceptedAt && (
            <p>Reply recorded {new Date(message.execution.acceptedAt).toLocaleString()}.</p>
          )}
          {message.execution.completionEvidence.length > 0 && (
            <p>Reply evidence: {message.execution.completionEvidence.join(' · ')}</p>
          )}
        </details>
      )}
      {message.team_configuration &&
        (canReply || message.outcome === 'team_configuration_applied') && (
          <BuddyTeamConfigurationRequest
            key={`${message.id}:${message.team_configuration.key}`}
            request={message.team_configuration}
            messageId={message.id}
            applied={message.outcome === 'team_configuration_applied'}
            onApplied={onChanged}
          />
        )}
      {message.evidence.length > 0 && (
        <details>
          <summary>Evidence</summary>
          <ul>
            {message.evidence.map((item, index) => (
              <li key={`${index}:${item}`}>{item}</li>
            ))}
          </ul>
        </details>
      )}
      {message.reply_body && (
        <div className="buddy-messages__reply">
          <strong>{message.outcome ?? 'Reply'}</strong>
          <p className="buddy-messages__body">{message.reply_body}</p>
          {message.reply_evidence.length > 0 && (
            <ul>
              {message.reply_evidence.map((item, index) => (
                <li key={`${index}:${item}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message.wait_status === 'timed_out' && (
        <p>The sender stopped waiting. A reply can still be recorded.</p>
      )}
      {conversationId && availableConversationIds.has(conversationId) && (
        <Link to={`/chat/${encodeURIComponent(conversationId)}`}>Open conversation</Link>
      )}
      {canReply && (
        <details className="buddy-messages__decision">
          <summary>{message.team_configuration ? 'Decline setup' : 'Reply'}</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              void onReply(message.id, {
                outcome: message.team_configuration ? 'rejected' : outcome,
                body: body.trim(),
                evidence: message.team_configuration
                  ? [message.id]
                  : evidence
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
              })
                .catch((cause: unknown) => {
                  setError(cause instanceof Error ? cause.message : String(cause));
                })
                .finally(() => setBusy(false));
            }}
          >
            {!message.team_configuration && (
              <label>
                Outcome
                <input
                  required
                  value={outcome}
                  maxLength={200}
                  onChange={(event) => setOutcome(event.target.value)}
                  disabled={busy}
                  placeholder="For example: approved, rejected, or answered"
                />
              </label>
            )}
            <label>
              {message.team_configuration ? 'Reason for declining' : 'Reply'}
              <textarea
                required
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={busy}
              />
            </label>
            {!message.team_configuration && (
              <label>
                Evidence or decision basis
                <textarea
                  required
                  placeholder="One reference or observation per line"
                  value={evidence}
                  onChange={(event) => setEvidence(event.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            <button
              type="submit"
              disabled={
                busy ||
                !body.trim() ||
                (!message.team_configuration && (!outcome.trim() || !evidence.trim()))
              }
            >
              {busy ? 'Saving…' : message.team_configuration ? 'Decline setup' : 'Send reply'}
            </button>
          </form>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
