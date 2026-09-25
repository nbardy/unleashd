import { useState } from 'react';
import { usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddyRunList } from './BuddyRunList';
import { BuddyTaskCommentForm, BuddyTaskCommentList } from './BuddyTaskComments';
import { buddyWrite } from './api';
import type { Task, TaskDetail, TaskStatus } from './types';
import { TASK_STATUS, isTaskOpen } from './ui-contract';
import { ActionError, useBuddyAction } from './useBuddyAction';

export const taskDetailUrl = (taskId: string): string =>
  `/api/buddies/tasks/${encodeURIComponent(taskId)}`;

const STATUSES = Object.keys(TASK_STATUS) as TaskStatus[];

/** Status, next action and blocker, sent as a patch of the changed fields only. */
function TaskEditForm({ task, refresh }: { task: Task; refresh: () => Promise<void> }) {
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [nextAction, setNextAction] = useState(task.nextAction ?? '');
  const [blockedReason, setBlockedReason] = useState(task.blockedReason ?? '');
  const action = useBuddyAction(refresh);
  const changes = {
    ...(status !== task.status ? { status } : {}),
    ...(nextAction !== (task.nextAction ?? '') ? { nextAction } : {}),
    ...(blockedReason !== (task.blockedReason ?? '') ? { blockedReason } : {}),
  };
  return (
    <form
      className="buddy-panel__form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run('task', () =>
          buddyWrite(taskDetailUrl(task.id), 'PATCH', { baseRevision: task.revision, changes })
        );
      }}
    >
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {TASK_STATUS[value].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Next action
        <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
      </label>
      <label>
        Blocker
        <input value={blockedReason} onChange={(event) => setBlockedReason(event.target.value)} />
      </label>
      <button type="submit" disabled={action.busy || Object.keys(changes).length === 0}>
        Save task
      </button>
      <ActionError state={action.state} />
    </form>
  );
}

function TaskDetailBody({
  detail,
  names,
  refresh,
}: {
  detail: TaskDetail;
  names: Readonly<Record<string, string>>;
  refresh: () => Promise<void>;
}) {
  const { task } = detail;
  return (
    <>
      <p className="buddy-panel__criteria">
        <strong>Done when</strong> {task.doneCriteria}
      </p>
      {task.evidence.length > 0 && (
        <ul className="buddy-post-list__evidence">
          {task.evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {/* Keyed by revision: a saved or concurrent edit resets the draft to the stored task. */}
      <TaskEditForm key={task.revision} task={task} refresh={refresh} />
      {detail.children.length > 0 && (
        <>
          <h4 className="buddy-panel__heading">Todos</h4>
          <ul className="buddy-task-list__todos">
            {detail.children.map((child) => (
              <li key={child.id} data-tone={TASK_STATUS[child.status].tone}>
                <span aria-hidden="true">{TASK_STATUS[child.status].glyph}</span> {child.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="buddy-panel__heading">Runs</h4>
      <BuddyRunList runs={detail.runs} refresh={refresh} empty="No runs for this task yet." />
      <h4 className="buddy-panel__heading">Comments</h4>
      <BuddyTaskCommentForm channelId={detail.channel.id} refresh={refresh} />
      <BuddyTaskCommentList comments={detail.comments} names={names} />
    </>
  );
}

/** One task's detail, read only while its card is open. */
export function BuddyTaskPanel({
  taskId,
  names,
}: {
  taskId: string;
  names: Readonly<Record<string, string>>;
}) {
  const detail = usePolledFetch<TaskDetail>(taskDetailUrl(taskId), 0);
  switch (detail.kind) {
    case 'idle':
    case 'loading':
      return <p className="buddy-panel__empty">Loading comments…</p>;
    case 'failed':
      return (
        <p className="buddy-panel__error" role="alert">
          {detail.error.message}
        </p>
      );
    case 'ready':
    case 'stale':
      return <TaskDetailBody detail={detail.data} names={names} refresh={detail.refetch} />;
  }
}

function TaskCard({ task, names }: { task: Task; names: Readonly<Record<string, string>> }) {
  const [open, setOpen] = useState(false);
  const status = TASK_STATUS[task.status];
  return (
    <details
      className="buddy-work-disclosure"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <strong>{task.title}</strong>
        <span>
          {status.label}
          {task.paused ? ' · Paused' : ''} · {task.nextAction ?? 'No next action'}
        </span>
      </summary>
      {open && <BuddyTaskPanel taskId={task.id} names={names} />}
    </details>
  );
}

/** A Buddy's tasks: top-level ones (todos are child tasks, shown inside their task). */
export function BuddyWork({
  tasks,
  names,
}: {
  tasks: readonly Task[];
  names: Readonly<Record<string, string>>;
}) {
  const topLevel = tasks.filter((task) => task.parentId === undefined);
  const current = topLevel.filter((task) => isTaskOpen(task.status));
  const finished = topLevel.filter((task) => !isTaskOpen(task.status));
  return (
    <section className="buddy-panel" aria-label="Work">
      <div className="buddy-panel__title">
        <h2>Current tasks</h2>
        <span>{current.length} open</span>
      </div>
      {current.length === 0 && <p className="buddy-panel__empty">No open tasks.</p>}
      {current.map((task) => (
        <TaskCard key={task.id} task={task} names={names} />
      ))}
      {finished.length > 0 && (
        <details className="buddy-work-history">
          <summary>Completed & cancelled · {finished.length}</summary>
          {finished.map((task) => (
            <TaskCard key={task.id} task={task} names={names} />
          ))}
        </details>
      )}
    </section>
  );
}
