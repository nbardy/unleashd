import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { BuddyTaskPanel } from './BuddyWork';
import type { ChannelTask } from './channel-text';
import { taskStatusView } from './ui-contract';

// A Task ref stays in Channels (493c1c7): the chip's hover card is the one-line preview, and a
// click opens the Task itself over the transcript — criteria, todos, runs, comments — instead of
// leaving for the owner's Work tab. "Open in Work" is still one click away.
export function ChannelTaskOverlay({
  task,
  names,
  onClose,
}: {
  task: ChannelTask;
  names: Readonly<Record<string, string>>;
  onClose(): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const status = taskStatusView(task.status);

  // Native <dialog>: showModal() gives the top layer, focus trap and Escape (as `cancel`).
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

  // No portal: showModal() already lifts the dialog into the top layer. A click on ::backdrop
  // reaches the dialog itself; one inside the sheet reaches a child.
  return (
    <dialog
      ref={dialogRef}
      className="channel-task-overlay ui-card ui-stack"
      aria-label={task.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="channel-task-overlay-header ui-row">
        <strong>{task.title}</strong>
        <span className="ui-muted">
          {status.glyph} {status.label} · {task.ownerName}
        </span>
        <Link to={`/buddies/${encodeURIComponent(task.ownerId)}/work`}>Open in Work</Link>
        <button type="button" onClick={onClose} aria-label="Close task" title="Close task">
          ✕
        </button>
      </header>
      <BuddyTaskPanel taskId={task.id} names={names} />
    </dialog>
  );
}
