import { type ReactNode, useMemo } from 'react';
import Markdown, { type Components, defaultUrlTransform } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { ChatActivity } from '../../ui/ChatActivity';
import { useLazyMarkdownPlugins } from '../../utils/lazyMarkdownPlugins';
import { remarkBreaks } from '../../utils/remark-breaks';
import { splitToolActivity } from '../../utils/tool-activity-segments';
import { type ChannelTask, isVideoSource, mediaUrl, parseChannelLink } from './channel-text';
import './ChannelContent.css';

// Channel post bodies: markdown (GFM, soft breaks, highlighted code; raw HTML
// stays disabled) with three app-level extensions, all ordinary markdown:
//   [@Name](buddy:<id>)  → mention pill linking to the Buddy
//   [Title](task:<id>)   → live Task chip with a hover card
//   ![alt](/abs/path)    → inline image, or a video player for .mp4/.webm/.mov
// A mention reply is the Buddy's final assistant message, and live providers
// embed their tool calls in it as `🔧 name …` / `⚡ Bash …` lines. Those runs
// collapse into the chat's own "N tool calls" disclosure (splitToolActivity +
// ChatActivity, the /chat path), never paint as raw lines: on 2026-09-24 a
// reply opened with 20 of them.

// react-markdown strips unknown URL schemes; buddy: and task: are ours.
function channelUrlTransform(url: string): string {
  return /^(buddy|task):/.test(url) ? url : defaultUrlTransform(url);
}

type TaskStatusView = { glyph: string; label: string; tone: string };

const TASK_STATUS: Readonly<Record<string, TaskStatusView>> = {
  backlog: { glyph: '○', label: 'Backlog', tone: 'idle' },
  ready: { glyph: '○', label: 'Ready', tone: 'idle' },
  in_progress: { glyph: '◐', label: 'In progress', tone: 'active' },
  review: { glyph: '◑', label: 'In review', tone: 'active' },
  blocked: { glyph: '■', label: 'Blocked', tone: 'blocked' },
  done: { glyph: '✓', label: 'Done', tone: 'done' },
  cancelled: { glyph: '✕', label: 'Cancelled', tone: 'idle' },
};

// Status is an open string from the store; an unlisted one shows verbatim.
function statusView(status: string): TaskStatusView {
  return TASK_STATUS[status] ?? { glyph: '•', label: status, tone: 'idle' };
}

function TaskChip({
  taskId,
  label,
  task,
}: {
  taskId: string;
  label: ReactNode;
  task: ChannelTask | undefined;
}) {
  if (!task) {
    return (
      <span className="channel-task-chip" data-tone="missing" title={`Task ${taskId}`}>
        <span className="channel-task-chip-glyph" aria-hidden="true">
          ?
        </span>
        {label}
      </span>
    );
  }
  const status = statusView(task.status);
  return (
    <span className="channel-task-chip-anchor">
      <Link
        className="channel-task-chip"
        data-tone={status.tone}
        to={`/buddies/${encodeURIComponent(task.ownerBuddyId)}/work`}
        aria-label={`${task.title} — ${status.label}`}
      >
        <span className="channel-task-chip-glyph" aria-hidden="true">
          {status.glyph}
        </span>
        {task.title}
      </Link>
      <span className="channel-task-card" role="tooltip">
        <span className="channel-task-card-title">{task.title}</span>
        <span className="channel-task-card-status" data-tone={status.tone}>
          {status.glyph} {status.label}
          <span className="channel-task-card-owner"> · {task.ownerName}</span>
        </span>
        {task.todosTotal > 0 && (
          <span className="channel-task-card-progress">
            <span
              className="channel-task-card-bar"
              style={{ width: `${(task.todosDone / task.todosTotal) * 100}%` }}
            />
            <span className="channel-task-card-count">
              {task.todosDone}/{task.todosTotal} todos
            </span>
          </span>
        )}
        {task.nextAction && <span className="channel-task-card-next">{task.nextAction}</span>}
      </span>
    </span>
  );
}

function channelComponents(
  buddyNames: Readonly<Record<string, string>>,
  tasks: ReadonlyMap<string, ChannelTask>
): Components {
  return {
    a: ({ href, children }) => {
      const link = parseChannelLink(href ?? '');
      switch (link.kind) {
        case 'buddy':
          return (
            <Link className="channel-mention" to={`/buddies/${encodeURIComponent(link.id)}`}>
              @{buddyNames[link.id] ?? String(children).replace(/^@/, '')}
            </Link>
          );
        case 'task':
          return <TaskChip taskId={link.id} label={children} task={tasks.get(link.id)} />;
        case 'web':
          return (
            <a href={link.href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
      }
    },
    img: ({ src, alt }) => {
      const source = typeof src === 'string' ? src : '';
      const url = mediaUrl(source);
      return isVideoSource(source) ? (
        // biome-ignore lint/a11y/useMediaCaption: user-posted clips carry no caption track
        <video className="channel-media" src={url} controls preload="metadata" title={alt} />
      ) : (
        <a className="channel-media-link" href={url} target="_blank" rel="noreferrer">
          <img className="channel-media" src={url} alt={alt ?? ''} loading="lazy" />
        </a>
      );
    },
  };
}

export function ChannelMarkdown({
  body,
  buddyNames,
  tasks,
}: {
  body: string;
  buddyNames: Readonly<Record<string, string>>;
  tasks: ReadonlyMap<string, ChannelTask>;
}) {
  const components = useMemo(() => channelComponents(buddyNames, tasks), [buddyNames, tasks]);
  const segments = useMemo(() => splitToolActivity(body), [body]);
  const rehypePlugins = useLazyMarkdownPlugins();
  const markdown = (text: string, key?: number) => (
    <Markdown
      key={key}
      remarkPlugins={[remarkGfm, remarkBreaks]}
      rehypePlugins={rehypePlugins}
      urlTransform={channelUrlTransform}
      components={components}
    >
      {text}
    </Markdown>
  );
  return (
    <div className="channel-markdown">
      {segments.map((segment, index) =>
        segment.type === 'tool_calls' ? (
          <ChatActivity
            key={index}
            label={`${segment.count} tool ${segment.count === 1 ? 'call' : 'calls'}`}
          >
            {markdown(segment.content)}
          </ChatActivity>
        ) : (
          markdown(segment.content, index)
        )
      )}
    </div>
  );
}

/** Three pulsing dots: "is replying" / "is checking". Respects reduced motion. */
export function TypingDots() {
  return (
    <span className="channel-typing-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
