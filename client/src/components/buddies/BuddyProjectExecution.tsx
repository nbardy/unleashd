import {
  type BuddyMessageExecution,
  type BuddyProjectExecutionView,
  BuddyProjectExecutionViewSchema,
} from '@unleashd/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { newId } from '../../utils/ids';
import { BuddyTaskComments } from './BuddyTaskComments';
import { buddyApi } from './api';
import type { BuddyProject } from './types';

interface CriteriaDraft {
  key: string;
  baseRevision: number;
  definitionOfDone: string;
  todos: Array<{ id: string; title: string; definitionOfDone: string }>;
}

interface PendingStart {
  key: string;
  maxRuns: number;
  maxDurationSeconds: number;
}

export function BuddyBackgroundProgress({
  execution,
  messageStatus,
  queuedRunCount,
}: {
  execution: BuddyMessageExecution | undefined;
  messageStatus: string;
  queuedRunCount: number;
}) {
  const background = execution?.background;
  const disposition =
    background?.disposition === 'queued' && execution?.state === 'held'
      ? 'held'
      : (background?.disposition ?? execution?.state ?? messageStatus);
  return (
    <>
      <p>
        Background work: <strong>{disposition.replaceAll('_', ' ')}</strong>
        {background
          ? ` · ${background.runsUsed}/${background.maxRuns} attempts started`
          : ` · ${queuedRunCount} runs`}
      </p>
      {background?.deadline && (
        <p>
          Execution deadline:{' '}
          <time dateTime={background.deadline}>
            {new Date(background.deadline).toLocaleString()}
          </time>
        </p>
      )}
    </>
  );
}

export function BuddyProjectExecution({
  project: initialProject,
  availableConversationIds,
}: {
  project: BuddyProject;
  availableConversationIds: ReadonlySet<string>;
}) {
  const path = `/api/buddies/projects/${encodeURIComponent(initialProject.id)}`;
  const source = useMemo(
    () =>
      resource(`${path}/execution`, async (signal: AbortSignal) =>
        BuddyProjectExecutionViewSchema.parse(await buddyApi(`${path}/execution`, { signal }))
      ),
    [path]
  );
  const { data: polled, error, refetch } = usePolledFetch<BuddyProjectExecutionView>(source, 5000);
  const [startReceipt, setStartReceipt] = useState<{
    view: BuddyProjectExecutionView;
    previousPoll: BuddyProjectExecutionView | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<CriteriaDraft | null>(null);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  // A successful start is authoritative immediately, before its follow-up GET returns.
  const data = startReceipt?.previousPoll === polled ? startReceipt.view : polled;
  const project = data?.project ?? initialProject;
  const message = data?.message;
  const execution = message?.execution;
  const active = Boolean(message && ['pending', 'active'].includes(message.status));
  const closed = ['done', 'cancelled'].includes(project.status);
  const conversationId = execution?.conversationId ?? message?.child_conversation_id;
  const evidence = project.completion_evidence;

  async function mutate(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await action();
      refetch();
      setNotice(success);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="buddy-project-execution"
      aria-label={`Background work for ${project.title}`}
    >
      <div className="buddy-project-execution-heading">
        <strong>Completion criteria</strong>
        {!draft && (
          <button
            type="button"
            disabled={busy || !data || !!error}
            onClick={() => {
              if (!data) return;
              setFailure(null);
              setDraft({
                key: newId(),
                baseRevision: data.project.revision,
                definitionOfDone: data.project.definition_of_done,
                todos: data.project.todos.map((todo) => ({
                  id: todo.id,
                  title: todo.title,
                  definitionOfDone: todo.definition_of_done ?? '',
                })),
              });
            }}
          >
            Edit criteria
          </button>
        )}
      </div>
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(async () => {
              await buddyApi(path, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  key: draft.key,
                  baseRevision: draft.baseRevision,
                  definitionOfDone: draft.definitionOfDone,
                  todoOperations: draft.todos.map((todo) => ({
                    operation: 'update',
                    todoId: todo.id,
                    definitionOfDone: todo.definitionOfDone.trim() || null,
                  })),
                }),
              });
              setDraft(null);
            }, 'Completion criteria saved.');
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Project is complete when
              <textarea
                required
                value={draft.definitionOfDone}
                onChange={(event) =>
                  setDraft({ ...draft, key: newId(), definitionOfDone: event.target.value })
                }
              />
            </label>
            {draft.todos.map((todo) => (
              <label key={todo.id}>
                {todo.title} is complete when
                <textarea
                  value={todo.definitionOfDone}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      key: newId(),
                      todos: draft.todos.map((item) =>
                        item.id === todo.id
                          ? { ...item, definitionOfDone: event.target.value }
                          : item
                      ),
                    })
                  }
                />
              </label>
            ))}
            <div className="buddy-project-execution-actions">
              <button type="submit">Save criteria</button>
              <button type="button" onClick={() => setDraft(null)}>
                Cancel edit
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <>
          <p className="buddy-project-execution-copy">{project.definition_of_done}</p>
          {project.todos.length > 0 && (
            <ul className="buddy-project-execution-todos">
              {project.todos.map((todo) => (
                <li key={todo.id}>
                  <strong>{todo.title}</strong> · {todo.status.replaceAll('_', ' ')}
                  <p className="buddy-project-execution-copy">
                    {todo.definition_of_done || 'Completion criteria not set'}
                  </p>
                  {todo.completion_evidence?.length ? (
                    <ul aria-label={`Evidence for ${todo.title}`}>
                      {todo.completion_evidence.map((item, index) => (
                        <li key={`${index}:${item}`}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p>
        Work status: <strong>{project.status.replaceAll('_', ' ')}</strong>
      </p>
      {project.blocked_reason && <output>Blocked: {project.blocked_reason}</output>}
      {typeof evidence === 'string' && evidence ? <p>{evidence}</p> : null}
      {Array.isArray(evidence) && evidence.length > 0 && (
        <ul aria-label="Completion evidence">
          {evidence.map((item, index) => (
            <li key={`${index}:${item}`}>{item}</li>
          ))}
        </ul>
      )}
      {message && (
        <div className="buddy-project-execution-status" aria-live="polite">
          <BuddyBackgroundProgress
            execution={execution}
            messageStatus={message.status}
            queuedRunCount={data?.runs.length ?? 0}
          />
          {execution?.reason && <p>{execution.reason}</p>}
          {execution?.remedy && <p>{execution.remedy}</p>}
          {execution?.error && <p role="alert">{execution.error}</p>}
          {message.reply_body && (
            <p className="buddy-project-execution-copy">{message.reply_body}</p>
          )}
          {active && (
            <>
              <p>Stopping this chain also stops related delegated work.</p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      buddyApi(
                        `/api/buddies/messages/${encodeURIComponent(message.root_message_id ?? message.id)}/stop`,
                        {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: '{}',
                        }
                      ),
                    'Stop requested. Waiting for active work to finish stopping.'
                  )
                }
              >
                Stop this work chain
              </button>
            </>
          )}
          {conversationId && availableConversationIds.has(conversationId) && (
            <Link to={`/chat/${conversationId}`}>Inspect work transcript</Link>
          )}
        </div>
      )}
      {!active && !closed && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const input = pendingStart ?? {
              key: newId(),
              maxRuns: Number(form.get('maxRuns')),
              maxDurationSeconds: Number(form.get('maxDurationMinutes')) * 60,
            };
            setPendingStart(input);
            void mutate(async () => {
              const view = BuddyProjectExecutionViewSchema.parse(
                await buddyApi(`${path}/run`, {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(input),
                })
              );
              setStartReceipt({ view, previousPoll: polled });
              setPendingStart(null);
            }, 'Background work requested. Checking admission.');
          }}
        >
          <p>
            Work continues until completion, a blocker, or the limits below. Progress stays here.
          </p>
          <details>
            <summary>Execution limits</summary>
            <fieldset disabled={busy || pendingStart !== null}>
              <label>
                Maximum attempts
                <input name="maxRuns" type="number" min="1" max="100" defaultValue="20" required />
              </label>
              <label>
                Maximum elapsed minutes
                <input
                  name="maxDurationMinutes"
                  type="number"
                  min="1"
                  max="1440"
                  defaultValue="60"
                  required
                />
              </label>
            </fieldset>
          </details>
          <button type="submit" disabled={busy || !!draft || !data || !!error}>
            {pendingStart ? 'Retry background request' : 'Run in background'}
          </button>
        </form>
      )}
      <BuddyTaskComments projectId={project.id} />
      {notice && <output>{notice}</output>}
      {(failure || error) && (
        <div role="alert">
          <p>{failure ?? error?.message}</p>
          <button type="button" onClick={refetch} disabled={busy}>
            Refresh work status
          </button>
        </div>
      )}
    </section>
  );
}
