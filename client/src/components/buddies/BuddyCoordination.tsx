import type { BuddyRun } from '@unleashd/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { BuddyTeamSettings } from './BuddyTeamConfiguration';
import { buddyApi } from './api';

interface Membership {
  project_id: string;
  name: string;
  background_enabled: number;
  background_paused_reason: string | null;
  read_all_work: number;
  dispatch: number;
  max_active_runs: number;
  max_background_runs_per_hour: number;
  max_sends_per_hour: number;
  max_pending_runs: number;
}
interface CoordinationView {
  projects: Array<{
    id: string;
    title: string;
    revision: number;
    execution_state: string;
    pending_owner_id: string | null;
  }>;
  buddies: Array<{ id: string; name: string }>;
  conversations: Array<{
    unleashd_conversation_id: string;
    workspace_id: string;
    last_active_at: string;
  }>;
  memberships: Membership[];
  runs: BuddyRun[];
}

export function BuddyCoordination({
  buddyId,
  availableConversationIds,
}: {
  buddyId: string;
  availableConversationIds: ReadonlySet<string>;
}) {
  const [searchParams] = useSearchParams();
  const requestedWorkspace = searchParams.get('workspaceId');
  const requestedTarget = searchParams.get('targetBuddyId');
  const coordinationPath = `/api/buddies/${encodeURIComponent(buddyId)}/coordination`;
  const source = useMemo(
    () =>
      resource(coordinationPath, (signal: AbortSignal) =>
        buddyApi<CoordinationView>(coordinationPath, { signal })
      ),
    [coordinationPath]
  );
  const { data, error, refetch } = usePolledFetch<CoordinationView>(source, 5000);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  async function change(path: string, body: unknown, method = 'POST') {
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      await buddyApi(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      refetch();
      setSaved(true);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="buddy-coordination" aria-label="Coordination">
      {saved && <output>Saved.</output>}
      {(error || failure) && <p role="alert">{failure ?? error?.message}</p>}
      <details className="buddy-coordination__section">
        <summary>Background work & team</summary>
        {data?.memberships.map((m) => (
          <fieldset key={m.project_id} disabled={saving}>
            <legend>{m.name}</legend>
            <BuddyTeamSettings
              key={`${buddyId}:${m.project_id}:${requestedWorkspace}:${requestedTarget}`}
              buddyId={buddyId}
              workspaceId={m.project_id}
              initialTargetId={
                requestedWorkspace === m.project_id ? (requestedTarget ?? undefined) : undefined
              }
            />
            <label>
              <input
                type="checkbox"
                checked={!!m.background_enabled}
                onChange={(event) =>
                  void change(
                    `/api/buddies/${buddyId}/memberships/${m.project_id}`,
                    { background_enabled: event.target.checked },
                    'PATCH'
                  )
                }
              />{' '}
              Allow background work
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!m.read_all_work}
                onChange={(event) =>
                  void change(
                    `/api/buddies/${buddyId}/memberships/${m.project_id}`,
                    { read_all_work: event.target.checked },
                    'PATCH'
                  )
                }
              />{' '}
              Read all workspace projects
            </label>
            <label>
              <input
                type="checkbox"
                checked={!!m.dispatch}
                onChange={(event) =>
                  void change(
                    `/api/buddies/${buddyId}/memberships/${m.project_id}`,
                    { dispatch: event.target.checked },
                    'PATCH'
                  )
                }
              />{' '}
              Send work to other Buddies
            </label>
            <p>
              Up to {m.max_active_runs} active runs and {m.max_background_runs_per_hour} starts per
              hour.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void change(
                  `/api/buddies/${buddyId}/memberships/${m.project_id}`,
                  {
                    max_active_runs: Number(form.get('active')),
                    max_background_runs_per_hour: Number(form.get('starts')),
                    max_sends_per_hour: Number(form.get('sends')),
                    max_pending_runs: Number(form.get('pending')),
                  },
                  'PATCH'
                );
              }}
            >
              <label>
                Concurrent runs{' '}
                <input
                  type="number"
                  name="active"
                  min="1"
                  max="100"
                  defaultValue={m.max_active_runs}
                  required
                />
              </label>
              <label>
                Starts per hour{' '}
                <input
                  type="number"
                  name="starts"
                  min="1"
                  max="10000"
                  defaultValue={m.max_background_runs_per_hour}
                  required
                />
              </label>
              <label>
                Messages per hour{' '}
                <input
                  type="number"
                  name="sends"
                  min="1"
                  max="10000"
                  defaultValue={m.max_sends_per_hour}
                  required
                />
              </label>
              <label>
                Pending runs{' '}
                <input
                  type="number"
                  name="pending"
                  min="1"
                  max="10000"
                  defaultValue={m.max_pending_runs}
                  required
                />
              </label>
              <button type="submit">Save limits</button>
            </form>
            {m.background_paused_reason && (
              <p>
                {m.background_paused_reason}{' '}
                <button
                  type="button"
                  onClick={() =>
                    void change(
                      `/api/buddies/${buddyId}/memberships/${m.project_id}`,
                      { background_paused_reason: null },
                      'PATCH'
                    )
                  }
                >
                  Resume background work
                </button>
              </p>
            )}
          </fieldset>
        ))}
      </details>
      {!!data?.projects.length && (
        <details className="buddy-coordination__section">
          <summary>Project controls</summary>
          {data?.projects.map((project) => (
            <fieldset key={project.id} disabled={saving || project.execution_state === 'draining'}>
              <legend>{project.title}</legend>
              <p>
                {project.execution_state}
                {project.pending_owner_id ? ' · transferring ownership' : ''}
              </p>
              {project.execution_state !== 'cancelled' && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      void change(
                        `/api/buddies/projects/${project.id}/execution`,
                        {
                          key: newId(),
                          baseRevision: project.revision,
                          executionState:
                            project.execution_state === 'enabled' ? 'paused' : 'enabled',
                        },
                        'PATCH'
                      )
                    }
                  >
                    {project.execution_state === 'enabled' ? 'Pause work' : 'Resume work'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void change(
                        `/api/buddies/projects/${project.id}/execution`,
                        {
                          key: newId(),
                          baseRevision: project.revision,
                          executionState: 'cancelled',
                        },
                        'PATCH'
                      )
                    }
                  >
                    Cancel project work
                  </button>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void change(
                        `/api/buddies/projects/${project.id}/execution`,
                        {
                          key: newId(),
                          baseRevision: project.revision,
                          ownerId: form.get('owner'),
                        },
                        'PATCH'
                      );
                    }}
                  >
                    <label>
                      New project owner{' '}
                      <select name="owner" required defaultValue="">
                        <option value="" disabled>
                          Choose a Buddy
                        </option>
                        {data.buddies.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Transfer after active work stops</button>
                  </form>
                </>
              )}
            </fieldset>
          ))}
        </details>
      )}
      <details className="buddy-coordination__section">
        <summary>Recurring check-in</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const conversation = data?.conversations.find(
              (c) => c.unleashd_conversation_id === form.get('conversation')
            );
            if (!conversation) return;
            void change(`/api/buddies/${buddyId}/automations`, {
              name: 'Progress check-in',
              workspaceId: conversation.workspace_id,
              scheduleKind: 'interval',
              scheduleExpression: String(Number(form.get('minutes')) * 60),
              timezone: 'UTC',
              jobKind: 'prompt',
              jobPayload: {
                prompt: form.get('prompt'),
                conversationId: conversation.unleashd_conversation_id,
              },
              enabled: true,
            });
          }}
        >
          <fieldset disabled={saving}>
            <label>
              Conversation{' '}
              <select name="conversation" required defaultValue="">
                <option value="" disabled>
                  Choose a conversation
                </option>
                {data?.conversations.map((c) =>
                  availableConversationIds.has(c.unleashd_conversation_id) ? (
                    <option key={c.unleashd_conversation_id} value={c.unleashd_conversation_id}>
                      Conversation · {new Date(c.last_active_at).toLocaleString()}
                    </option>
                  ) : null
                )}
              </select>
            </label>
            <label>
              Every <input name="minutes" type="number" min="1" defaultValue="30" required />{' '}
              minutes
            </label>
            <label>
              Check-in instructions{' '}
              <textarea
                name="prompt"
                required
                maxLength={32000}
                defaultValue="Read current work and inbox. Check completed results, steer unfinished work, and report material changes."
              />
            </label>
            <p>Uses this Buddy’s background-work permission and limits.</p>
            <button type="submit">Schedule check-in</button>
          </fieldset>
        </form>
      </details>
      <details className="buddy-coordination__section">
        <summary>Reporting line</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void change(`/api/buddies/${buddyId}/reparent`, {
              key: newId(),
              managerId: form.get('manager'),
            });
          }}
        >
          <fieldset disabled={saving}>
            <label>
              Manager{' '}
              <select name="manager" required defaultValue="">
                <option value="" disabled>
                  Choose a manager
                </option>
                {data?.buddies.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Change manager</button>
          </fieldset>
        </form>
      </details>
      <details className="buddy-coordination__section">
        <summary>Execution history</summary>
        {data?.runs.length === 0 && <p>No queued work yet.</p>}
        {data?.runs.map((run) => (
          <article key={run.id}>
            <p>
              {run.input_kind} · {run.status} · attempt {run.attempt}
            </p>
            {run.error && <p>{run.error}</p>}
            {run.conversation_id && availableConversationIds.has(run.conversation_id) && (
              <Link to={`/chat/${run.conversation_id}`}>Open conversation</Link>
            )}
            {['queued', 'claimed', 'running'].includes(run.status) && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void change(`/api/buddies/runs/${run.id}/cancel`, {})}
              >
                Cancel run
              </button>
            )}
            {run.input_kind !== 'chat' && ['failed', 'cancelled'].includes(run.status) && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void change(`/api/buddies/runs/${run.id}/retry`, { key: newId() })}
              >
                Retry after reviewing effects
              </button>
            )}
            {run.status === 'queued' && run.error_code === 'held' && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void change(`/api/buddies/runs/${run.id}/repair`, {
                    key: newId(),
                    conversationId: form.get('destination'),
                  });
                }}
              >
                <label>
                  Move this pending input to{' '}
                  <select name="destination" required defaultValue="">
                    <option value="" disabled>
                      Choose a conversation
                    </option>
                    {data.conversations.map((c) =>
                      availableConversationIds.has(c.unleashd_conversation_id) ? (
                        <option key={c.unleashd_conversation_id} value={c.unleashd_conversation_id}>
                          Conversation · {new Date(c.last_active_at).toLocaleString()}
                        </option>
                      ) : null
                    )}
                  </select>
                </label>
                <button type="submit" disabled={saving}>
                  Repair destination
                </button>
              </form>
            )}
            {run.root_message_id && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void change(`/api/buddies/messages/${run.root_message_id}/stop`, {})}
              >
                Stop this work chain
              </button>
            )}
          </article>
        ))}
      </details>
    </section>
  );
}
