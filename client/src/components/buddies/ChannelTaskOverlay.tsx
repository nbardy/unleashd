import { BuddyProjectExecutionViewSchema } from '@unleashd/shared';
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { resource, usePolledFetch } from '../../hooks/usePolledFetch';
import { BuddyTaskComments } from './BuddyTaskComments';
import { buddyApi } from './api';
import type { ChannelTask } from './channel-text';
import { taskStatusView } from './ui-contract';
import './BuddyProjectExecution.css';

// A Task ref stays in Channels. The chip's hover card is the one-line preview;
// this overlay is the project itself: outcome, criteria, todos, evidence, comments.
export function ChannelTaskOverlay({
  taskId,
  summary,
  onClose,
}: {
  taskId: string;
  summary: ChannelTask | undefined;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const path = `/api/buddies/projects/${encodeURIComponent(taskId)}/execution`;
  const source = useMemo(
    () =>
      resource(path, async (signal: AbortSignal) =>
        BuddyProjectExecutionViewSchema.parse(await buddyApi(path, { signal }))
      ),
    [path]
  );
  const view = usePolledFetch(source, 5000);
  const project = view.data?.project;
  const title = project?.title ?? summary?.title ?? 'Task';
  const status = taskStatusView(project?.status ?? summary?.status ?? '');
  const owner = summary?.ownerName;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
    };
  }, [onClose]);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="channel-task-overlay-dialog"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="channel-task-overlay-header">
        <div>
          <h2 className="channel-task-overlay-title">{title}</h2>
          <p className="channel-task-overlay-meta">
            {status.glyph} {status.label}
            {owner && <span> · {owner}</span>}
          </p>
        </div>
        <button
          type="button"
          className="channel-task-overlay-close"
          onClick={onClose}
          aria-label="Close task"
        >
          ✕
        </button>
      </header>

      {view.kind === 'loading' && <p className="channel-task-overlay-meta">Loading task…</p>}
      {view.kind === 'failed' && (
        <p className="channel-task-overlay-error" role="alert">
          {view.error.message}
        </p>
      )}
      {view.kind === 'stale' && (
        <p className="channel-task-overlay-error" role="alert">
          Could not refresh: {view.error.message}
        </p>
      )}

      {summary?.nextAction && !project && (
        <OverlaySection label="Next action">{summary.nextAction}</OverlaySection>
      )}

      {project && (
        <>
          {project.objective && (
            <OverlaySection label="Objective">{project.objective}</OverlaySection>
          )}
          {project.next_action && (
            <OverlaySection label="Next action">{project.next_action}</OverlaySection>
          )}
          {project.blocked_reason && (
            <OverlaySection label="Blocked">{project.blocked_reason}</OverlaySection>
          )}
          <OverlaySection label="Done when">{project.definition_of_done}</OverlaySection>
          {project.todos.length > 0 && (
            <section className="channel-task-overlay-section">
              <h3>Todos</h3>
              <ul className="channel-task-overlay-todos">
                {project.todos.map((todo) => (
                  <li key={todo.id}>
                    <strong>{todo.title}</strong>
                    <span> · {todo.status.replaceAll('_', ' ')}</span>
                    {todo.definition_of_done && <p>{todo.definition_of_done}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {project.completion_evidence.length > 0 && (
            <section className="channel-task-overlay-section">
              <h3>Evidence</h3>
              <ul className="channel-task-overlay-todos">
                {project.completion_evidence.map((item, index) => (
                  <li key={`${index}:${item}`}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          <BuddyTaskComments projectId={project.id} />
        </>
      )}
    </dialog>,
    document.body
  );
}

function OverlaySection({ label, children }: { label: string; children: string }) {
  return (
    <section className="channel-task-overlay-section">
      <h3>{label}</h3>
      <p>{children}</p>
    </section>
  );
}
