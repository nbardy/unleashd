import { useMemo } from 'react';
import type { WorkspaceDirectory } from './channel-data';
import type { Post } from './types';

// The Task picker offers the Tasks this channel's loaded posts are about, plus
// the one the URL names (a pasted link may name a Task this page has not loaded).
// Shared by both trees: desktop's channel header and mobile's channel screen.
// Mobile lost its only Task filter when the Buddy Mailbox channel reader went
// (d382234 restored it once; the lean rewrite dropped it again). Feature audit
// 2026-09-26; guarded by client/test/mobile-channels.test.tsx.
export function TaskFilter({
  className,
  posts,
  taskFilter,
  tasks,
  onTaskFilter,
}: {
  className: string;
  posts: readonly Post[] | null;
  taskFilter: string | null;
  tasks: WorkspaceDirectory['taskById'];
  onTaskFilter: (taskId: string | null) => void;
}) {
  const taskIds = useMemo(() => {
    const ids = new Set(posts?.flatMap((post) => (post.taskId === undefined ? [] : [post.taskId])));
    if (taskFilter !== null) ids.add(taskFilter);
    return [...ids];
  }, [posts, taskFilter]);
  return taskIds.length === 0 ? null : (
    <select
      className={`${className} ui-control`}
      aria-label="Filter by Task"
      value={taskFilter ?? ''}
      onChange={(event) => onTaskFilter(event.target.value || null)}
    >
      <option value="">All posts</option>
      {taskIds.map((taskId) => (
        <option key={taskId} value={taskId}>
          Task: {tasks.get(taskId)?.title ?? taskId}
        </option>
      ))}
    </select>
  );
}
