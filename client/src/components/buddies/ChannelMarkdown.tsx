import { Fragment, type ReactNode, memo, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Components, type ExtraProps, defaultUrlTransform } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { ChatActivity } from '../../ui/ChatActivity';
import { parseBuddyReviewResult } from '../../utils/buddy-review-message';
import { useMarkdownPipeline } from '../../utils/lazyMarkdownPlugins';
import { defineMarkdownFlavor, renderMarkdownCached } from '../../utils/markdown-pipeline';
import { remarkBreaks } from '../../utils/remark-breaks';
import {
  type StructuredMessageSegment,
  splitStructuredMessageContent,
} from '../../utils/structured-message-segments';
import { splitToolActivity } from '../../utils/tool-activity-segments';
import { AskUserQuestionWidget, parseAskUserQuestion } from '../AskUserQuestion';
import { BuddyReviewResultCard } from '../BuddyReviewMessage';
import { InlineBuddyBuilderResult } from './BuddyBuilderResultCard';
import { InlineBuddyTeamConfiguration } from './BuddyTeamConfiguration';
import { type ChannelTask, isVideoSource, mediaUrl, parseChannelLink } from './channel-text';
import { taskStatusView } from './ui-contract';
import './ChannelContent.css';

// Channel post bodies: markdown (GFM, soft breaks, highlighted code; raw HTML
// stays disabled) with three app-level extensions, all ordinary markdown:
//   [@Name](buddy:<id>)  → mention pill linking to the Buddy
//   [Title](task:<id>)   → live Task: a one-line chip with a hover card in
//                          running text; a card of its own when the ref is
//                          the whole paragraph or list item
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

const CHANNEL_MARKDOWN = defineMarkdownFlavor([remarkGfm, remarkBreaks], channelUrlTransform);

const CARD_WIDTH = 280;
const CARD_GAP = 6;
const VIEWPORT_MARGIN = 8;

// Title, status, owner, todo progress and next action: the one Task card
// layout, shared by the hover card and the block card so they cannot drift.
function TaskCardBody({ task }: { task: ChannelTask }) {
  const status = taskStatusView(task.status);
  return (
    <>
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
    </>
  );
}

function taskHref(task: ChannelTask): string {
  return `/buddies/${encodeURIComponent(task.ownerBuddyId)}/work`;
}

type CardPlacement = { left: number; top: number } | { left: number; bottom: number };

// The hover card is portalled and fixed to the viewport, clamped to its
// edges. It used to be absolute inside the post, so the thread pane's
// overflow cut it off at the right edge (#buddies-dev, 2026-09-24).
function placeCard(trigger: DOMRect): CardPlacement {
  const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * VIEWPORT_MARGIN);
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(trigger.left, window.innerWidth - VIEWPORT_MARGIN - width)
  );
  return trigger.top > window.innerHeight - trigger.bottom
    ? { left, bottom: window.innerHeight - trigger.top + CARD_GAP }
    : { left, top: trigger.bottom + CARD_GAP };
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
  const chipRef = useRef<HTMLAnchorElement>(null);
  const [placement, setPlacement] = useState<CardPlacement | null>(null);
  if (!task) {
    return (
      <span className="channel-task-chip" data-tone="missing" title={`Task ${taskId}`}>
        <span className="channel-task-chip-glyph" aria-hidden="true">
          ?
        </span>
        <span className="channel-task-chip-title">{label}</span>
      </span>
    );
  }
  const status = taskStatusView(task.status);
  const open = () => {
    const chip = chipRef.current;
    if (chip) setPlacement(placeCard(chip.getBoundingClientRect()));
  };
  const close = () => setPlacement(null);
  return (
    <>
      <Link
        ref={chipRef}
        className="channel-task-chip"
        data-tone={status.tone}
        to={taskHref(task)}
        aria-label={`${task.title} — ${status.label}`}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
      >
        <span className="channel-task-chip-glyph" aria-hidden="true">
          {status.glyph}
        </span>
        <span className="channel-task-chip-title">{task.title}</span>
      </Link>
      {placement &&
        createPortal(
          <span className="channel-task-card" role="tooltip" style={placement}>
            <TaskCardBody task={task} />
          </span>,
          document.body
        )}
    </>
  );
}

// A ref that stands alone — a paragraph or list item holding nothing else —
// is a card; one inside a sentence stays a chip so it never splits the line.
function standaloneTaskId(node: ExtraProps['node']): string | null {
  const content = (node?.children ?? []).filter(
    (child) => !(child.type === 'text' && child.value.trim() === '')
  );
  if (content.length !== 1) return null;
  const [only] = content;
  if (only.type !== 'element' || only.tagName !== 'a') return null;
  const link = parseChannelLink(String(only.properties.href ?? ''));
  return link.kind === 'task' ? link.id : null;
}

function TaskBlock({ taskId, task }: { taskId: string; task: ChannelTask | undefined }) {
  if (!task) return <TaskChip taskId={taskId} label={`Task ${taskId}`} task={undefined} />;
  return (
    <Link
      className="channel-task-block"
      data-tone={taskStatusView(task.status).tone}
      to={taskHref(task)}
    >
      <TaskCardBody task={task} />
    </Link>
  );
}

function channelComponents(
  buddyNames: Readonly<Record<string, string>>,
  tasks: ReadonlyMap<string, ChannelTask>
): Components {
  return {
    p: ({ node, children }) => {
      const taskId = standaloneTaskId(node);
      return taskId === null ? (
        <p>{children}</p>
      ) : (
        <TaskBlock taskId={taskId} task={tasks.get(taskId)} />
      );
    },
    li: ({ node, children, className }) => {
      const taskId = standaloneTaskId(node);
      return taskId === null ? (
        <li className={className}>{children}</li>
      ) : (
        <li className="channel-task-block-item">
          <TaskBlock taskId={taskId} task={tasks.get(taskId)} />
        </li>
      );
    },
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

// Memoized: a markdown render still walks the hast into React, and a row re-renders
// whenever who is replying changes. The cache keeps an unchanged post's body,
// names and Tasks identical (atoms/resources.ts settledEntry), so only a post
// that actually changed is parsed again.
export const ChannelMarkdown = memo(function ChannelMarkdown({
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
  const pipeline = useMarkdownPipeline(CHANNEL_MARKDOWN);
  const markdown = (text: string, key?: number) => (
    <Fragment key={key}>{renderMarkdownCached(pipeline, text, components)}</Fragment>
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
          <ChannelTextBody
            key={index}
            content={segment.content}
            markdown={markdown}
            startIndex={index * 1000}
          />
        )
      )}
    </div>
  );
});

// Text runs can carry the same provider markers /chat strips
// (splitStructuredMessageContent): a mention reply is the Buddy's final
// assistant message, including the server-injected tool-result markers. Raw
// HTML stays disabled, so an unstripped marker paints as literal text — on
// 2026-09-24 a team-configuration blob leaked into #general this way. Each
// marker renders the same widget /chat uses; oompa run lines keep their
// long-standing plain-text rendering.
function ChannelTextBody({
  content,
  markdown,
  startIndex,
}: {
  content: string;
  markdown: (text: string, key?: number) => ReactNode;
  startIndex: number;
}) {
  const parts = useMemo(() => splitStructuredMessageContent(content), [content]);
  return (
    <>{parts.map((part, offset) => channelStructuredPart(part, markdown, startIndex + offset))}</>
  );
}

function channelStructuredPart(
  part: StructuredMessageSegment,
  markdown: (text: string, key?: number) => ReactNode,
  key: number
): ReactNode {
  if (part.type === 'text' || part.type === 'oompa_run') {
    if (!part.content.trim()) return null;
    return markdown(part.content, key);
  }
  if (part.type === 'buddy_worker_thread') return null;
  if (part.type === 'buddy_team_configuration') {
    return <InlineBuddyTeamConfiguration key={key} payload={part.json} />;
  }
  if (part.type === 'buddy_builder_result') {
    return <InlineBuddyBuilderResult key={key} payload={part.json} />;
  }
  if (part.type === 'buddy_review_result') {
    const result = parseBuddyReviewResult(part.json);
    return result ? (
      <BuddyReviewResultCard key={key} result={result} />
    ) : (
      <code key={key}>Buddy review result (parse error)</code>
    );
  }
  try {
    const data = parseAskUserQuestion(part.json);
    return <AskUserQuestionWidget key={key} data={data} />;
  } catch {
    return <code key={key}>AskUserQuestion (parse error)</code>;
  }
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
