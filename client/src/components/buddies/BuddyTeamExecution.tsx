import type { BuddyTeamObservation } from '@unleashd/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { buddyApi } from './api';

type TeamExecutionProps = {
  buddyId: string;
  workspaceId: string;
  availableConversationIds: ReadonlySet<string>;
};

export function BuddyTeamExecution(props: TeamExecutionProps) {
  return <BuddyTeamExecutionScope key={`${props.buddyId}:${props.workspaceId}`} {...props} />;
}

function BuddyTeamExecutionScope({
  buddyId,
  workspaceId,
  availableConversationIds,
}: TeamExecutionProps) {
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<{
    runId: string;
    checkpointOffset: number;
    deliveryOffset: number;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const observation = usePolledFetch<BuddyTeamObservation>(
    `/api/buddies/${encodeURIComponent(buddyId)}/team-state?workspaceId=${encodeURIComponent(workspaceId)}&offset=${detail ? 0 : offset}${detail ? `&runId=${encodeURIComponent(detail.runId)}&checkpointOffset=${detail.checkpointOffset}&deliveryOffset=${detail.deliveryOffset}` : ''}`,
    5000
  );
  const { data, refetch } = observation;
  const loadFailure =
    observation.kind === 'failed' || observation.kind === 'stale'
      ? observation.error.message
      : null;
  return (
    <section className="buddy-team-execution" aria-label="Team execution">
      <h2>Team execution</h2>
      {detail && (
        <button type="button" onClick={() => setDetail(null)}>
          All executions
        </button>
      )}
      {(failure ?? loadFailure) && <p role="alert">{failure ?? loadFailure}</p>}
      {observation.kind === 'loading' && <p>Loading execution receipts…</p>}
      {data && (
        <>
          <BuddyTeamExecutionList
            data={data}
            availableConversationIds={availableConversationIds}
            saving={saving}
            checkpointOffset={detail?.checkpointOffset ?? 0}
            deliveryOffset={detail?.deliveryOffset ?? 0}
            onMoreCheckpoints={(runId, checkpointOffset) =>
              setDetail({
                runId,
                checkpointOffset,
                deliveryOffset: detail?.runId === runId ? detail.deliveryOffset : 0,
              })
            }
            onDeliveryPage={(runId, deliveryOffset) =>
              setDetail({
                runId,
                deliveryOffset,
                checkpointOffset: detail?.runId === runId ? detail.checkpointOffset : 0,
              })
            }
            onInspectRun={(runId) => setDetail({ runId, checkpointOffset: 0, deliveryOffset: 0 })}
            onRetry={async (runId, reason) => {
              setSaving(true);
              setFailure(null);
              try {
                await buddyApi(`/api/buddies/runs/${encodeURIComponent(runId)}/retry`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    key: newId(),
                    reason,
                  }),
                });
                refetch();
              } catch (cause) {
                setFailure(cause instanceof Error ? cause.message : String(cause));
              } finally {
                setSaving(false);
              }
            }}
          />
          {!detail && (
            <nav aria-label="Execution pages">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={data.nextOffset === null}
                onClick={() => setOffset(data.nextOffset!)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

export function BuddyTeamExecutionList({
  data,
  availableConversationIds,
  onRetry,
  saving = false,
  onMoreCheckpoints,
  onDeliveryPage,
  onInspectRun,
  checkpointOffset = 0,
  deliveryOffset = 0,
}: {
  data: BuddyTeamObservation;
  availableConversationIds: ReadonlySet<string>;
  saving?: boolean;
  onMoreCheckpoints?: (runId: string, offset: number) => void;
  onDeliveryPage?: (runId: string, offset: number) => void;
  onInspectRun?: (runId: string) => void;
  checkpointOffset?: number;
  deliveryOffset?: number;
  onRetry: (runId: string, reason: string) => Promise<void>;
}) {
  return (
    <>
      <p>
        {/* observedAt is the SERVER's clock at read time, so the screenshot tool's
            frozen page clock cannot pin it; data-volatile hides it from shots. */}
        Updated <span data-volatile>{new Date(data.observedAt).toLocaleString()}</span>. Execution
        status is separate from project completion.
      </p>
      {!data.items.length && <p>No coordination executions in this workspace.</p>}
      {data.items.map((run) => (
        <article className="buddy-team-execution__run" key={run.runId}>
          <header>
            <strong>{run.buddyName}</strong>
            <span>
              {run.state} · attempt {run.attempt}
            </span>
          </header>
          {run.project && (
            <p>
              Project {run.project.status} · {run.project.evidenceCount} evidence references
            </p>
          )}
          {run.error && (
            <p role="status">
              {run.errorCode ?? 'Execution error'}: {run.error}
            </p>
          )}
          <details className="buddy-team-execution__details">
            <summary>Execution details & recovery</summary>
            <p>
              {run.inputKind} · {run.runId}
            </p>
            <p>
              Input admitted: {run.acknowledgedAt ?? 'not recorded'} · Deadline:{' '}
              {run.deadline ?? 'not admitted'}
            </p>
            {run.project && (
              <p>
                Current project {run.project.id}: {run.project.status} · revision{' '}
                {run.project.revision} · {run.project.evidenceCount} evidence references · updated{' '}
                {run.project.updatedAt}
              </p>
            )}
            {run.reply && (
              <div>
                <p>
                  Reply persisted: {run.reply.persistedAt ?? 'pending'} · {run.reply.evidenceCount}{' '}
                  reply references. {run.reply.deliveryCount} return delivery attempts.
                </p>
                <details>
                  <summary>Return delivery history ({run.reply.deliveryCount} attempts)</summary>
                  {run.reply.deliveries.length ? (
                    run.reply.deliveries.map((delivery) => (
                      <div key={delivery.runId}>
                        <p>
                          {delivery.kind}: {delivery.state} · attempt {delivery.attempt} ·{' '}
                          {delivery.runId}
                        </p>
                        <p>
                          Queued: {delivery.createdAt} · Input admitted:{' '}
                          {delivery.acknowledgedAt ?? 'not recorded'} · Ended:{' '}
                          {delivery.endedAt ?? 'not recorded'}
                        </p>
                        {delivery.retryOfRunId && <p>Retry of {delivery.retryOfRunId}</p>}
                        {delivery.error && (
                          <p>
                            {delivery.errorCode ?? 'Delivery error'}: {delivery.error}
                          </p>
                        )}
                        {onInspectRun && (
                          <button type="button" onClick={() => onInspectRun(delivery.runId)}>
                            Inspect delivery attempt {delivery.attempt}
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p>
                      Return delivery:{' '}
                      {run.reply.deliveryStates.join(', ') || 'no separate delivery recorded'}.
                    </p>
                  )}
                  {!!deliveryOffset && onDeliveryPage && (
                    <button
                      type="button"
                      onClick={() => onDeliveryPage(run.runId, Math.max(0, deliveryOffset - 3))}
                    >
                      Newer deliveries
                    </button>
                  )}
                  {run.reply.deliveryNextOffset !== null && onDeliveryPage && (
                    <button
                      type="button"
                      onClick={() => onDeliveryPage(run.runId, run.reply!.deliveryNextOffset!)}
                    >
                      Older deliveries ({run.reply.deliveryCount} attempts)
                    </button>
                  )}
                </details>
                <p>Delivery completion does not record consumer review.</p>
              </div>
            )}
            {run.error && (
              <p>
                {run.errorCode ?? 'Execution error'}: {run.error}
              </p>
            )}
            <p>
              {run.execution
                ? 'Recorded attempt cap'
                : 'Configured cap (historical snapshot unavailable)'}
              : {run.limits.turnCapSeconds}s · Remaining managed runs:{' '}
              {run.recovery.remainingRuns ?? 'not managed'} · Remaining managed time:{' '}
              {run.recovery.remainingSeconds === null
                ? 'not managed'
                : `${run.recovery.remainingSeconds}s`}
            </p>
            <p>
              {run.execution
                ? `${run.execution.provider} · ${run.execution.model ?? 'provider default'} · effort ${run.execution.reasoningEffort ?? 'provider default'} · limited by ${run.execution.limitingSource}`
                : 'Execution configuration not recorded for this attempt.'}
            </p>
            <p>
              Incoming work: {run.limits.backgroundEnabled ? 'enabled' : 'disabled'} · Active-run
              limit: {run.limits.maxActiveRuns ?? 'unknown'}
              {run.limits.pausedReason ? ` · ${run.limits.pausedReason}` : ''}
            </p>
            <p>
              Recovery controllers:{' '}
              {run.recovery.controllerBuddyIds.join(', ') || 'owner conversation'}.
            </p>
            {run.checkpoints.map((checkpoint) => (
              <details key={checkpoint.id}>
                <summary>
                  Historical checkpoint {checkpoint.created_at} · {checkpoint.artifacts.length}{' '}
                  saved references
                </summary>
                <p>
                  Producer {checkpoint.buddy_id} · attempt {checkpoint.run_id} ·{' '}
                  {checkpoint.visibility}
                </p>
                <ul>
                  {checkpoint.artifacts.map((a, i) => (
                    <li key={`${i}:${a.ref}`}>
                      {a.ref} · version {a.version} · SHA256 {a.sha256 ?? 'not recorded'}
                    </li>
                  ))}
                </ul>
                <p>Recorded effects: {checkpoint.effects.join('; ') || 'producer declared none'}</p>
                <p>{checkpoint.resume}</p>
              </details>
            ))}
            {!!checkpointOffset && onMoreCheckpoints && (
              <button
                type="button"
                onClick={() => onMoreCheckpoints(run.runId, Math.max(0, checkpointOffset - 3))}
              >
                Newer checkpoints
              </button>
            )}
            {run.checkpointNextOffset !== null && onMoreCheckpoints && (
              <button
                type="button"
                onClick={() => onMoreCheckpoints(run.runId, run.checkpointNextOffset!)}
              >
                Older checkpoints ({run.checkpointCount} saved)
              </button>
            )}
            {run.recovery.mode === 'successor_request' && (
              <p>
                Recovery creates a successor request. This failed reply stays recorded, and the
                original budget and permissions still apply.
              </p>
            )}
            {run.recovery.successorRunId && (
              <p>Recovery successor: {run.recovery.successorRunId}</p>
            )}
            {run.recovery.canRetry ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void onRetry(run.runId, String(form.get('reason')));
                }}
              >
                <label>
                  Recovery reason after reviewing effects
                  <input name="reason" required disabled={saving} />
                </label>
                <button type="submit" disabled={saving}>
                  {run.recovery.mode === 'successor_request'
                    ? 'Recover closed timeout'
                    : 'Retry this input'}
                </button>
              </form>
            ) : (
              <p>Recovery: {run.recovery.reason}</p>
            )}
          </details>
          {run.conversationId && availableConversationIds.has(run.conversationId) && (
            <Link to={`/chat/${encodeURIComponent(run.conversationId)}`}>Open conversation</Link>
          )}
        </article>
      ))}
      <details>
        <summary>Observation limits</summary>
        <ul>
          {data.limitations.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
