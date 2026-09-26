import type { Message } from '@unleashd/shared';
import { Fragment, memo, useMemo } from 'react';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { AskUserQuestionWidget, parseAskUserQuestion } from '../../components/AskUserQuestion';
import { InlineBuddyBuilderResult } from '../../components/buddies/BuddyBuilderResultCard';
import { InlineSwarmRunWidget } from '../../swarm';
import { ChatActivity } from '../../ui/ChatActivity';
import type { AssistantResponse, MessageGroup } from '../../utils/chat-message-groups';
import { messageTranscriptContent } from '../../utils/conversation-transcript';
import { useMarkdownPipeline } from '../../utils/lazyMarkdownPlugins';
import {
  type MarkdownPipeline,
  type MarkdownRenderer,
  defineMarkdownFlavor,
  renderMarkdownCached,
  renderMarkdownLive,
} from '../../utils/markdown-pipeline';
import { remarkBreaks } from '../../utils/remark-breaks';
import { splitStructuredMessageContent } from '../../utils/structured-message-segments';
import { splitToolActivity } from '../../utils/tool-activity-segments';
import {
  CopyButton,
  makeMarkdownComponents,
  normalizeLatexDelimiters,
} from './markdown-components';
import './Transcript.css';

/** A readable label for freeform exec calls; the full input stays below it. */
function execInputPreview(toolCall: Message['toolCall']): string | null {
  if (!toolCall || !['exec', 'functions.exec'].includes(toolCall.name)) return null;
  const input = toolCall.input?.replace(/\s+/g, ' ').trim();
  if (!input) return null;
  return input.length > 120 ? `${input.slice(0, 119)}…` : input;
}

/**
 * One transcript row per message group, rendered by BOTH list containers:
 * the desktop virtual list (components/VirtualizedMessageList) and the mobile
 * windowed list (mobile/conversations/ConversationView). Only the containers
 * differ (virtual vs flat, iOS momentum — docs/client-state.md); the rows are
 * this one view.
 *
 * `presentation` picks where a row's actions live, chosen by the caller:
 * - `hover`: an icon Copy button revealed on row hover/focus (pointer devices).
 * - `footer`: a permanent footer with the time and a Copy pill. Touch has no
 *   hover, and a long-press menu would fight the browser's own text-selection
 *   gesture, so the action is always visible but quiet.
 */
export type TranscriptPresentation = 'hover' | 'footer';

interface RowActionsProps {
  text: string;
  timestamp: Message['timestamp'];
  forwardedRef?: React.RefObject<HTMLDivElement | null>;
}

function HoverActions({ text, forwardedRef }: RowActionsProps) {
  return (
    <div className="message-actions" ref={forwardedRef}>
      {text.trim() && (
        <CopyButton text={text} className="message-action-btn ui-control ui-inline-row ui-muted" />
      )}
    </div>
  );
}

function FooterActions({ text, timestamp, forwardedRef }: RowActionsProps) {
  return (
    <div className="message-actions message-actions--footer" ref={forwardedRef}>
      <span className="message-actions__time">{new Date(timestamp).toLocaleTimeString()}</span>
      {/* Raw content, not the rendered markdown: copying gives back what was written. */}
      {text.trim() && <CopyButton text={text} className="message-footer-copy ui-card ui-muted" />}
    </div>
  );
}

const ROW_ACTIONS: Record<TranscriptPresentation, (props: RowActionsProps) => React.JSX.Element> = {
  hover: HoverActions,
  footer: FooterActions,
};

const CHAT_MARKDOWN = defineMarkdownFlavor([remarkGfm, remarkMath, remarkBreaks]);

function MessageMarkdown({
  content,
  collapseTools,
  pipeline,
  components,
  markdown,
}: {
  content: string;
  collapseTools: boolean;
  pipeline: MarkdownPipeline;
  components: Components;
  markdown: MarkdownRenderer;
}) {
  const segments = useMemo(
    () => (collapseTools ? splitToolActivity(content) : []),
    [content, collapseTools]
  );
  if (!segments.some((segment) => segment.type === 'tool_calls')) {
    return markdown(pipeline, content, components);
  }
  return segments.map((segment, index) =>
    segment.type === 'tool_calls' ? (
      <ChatActivity
        key={index}
        label={`${segment.count} tool ${segment.count === 1 ? 'call' : 'calls'}`}
      >
        {markdown(pipeline, segment.content, components)}
      </ChatActivity>
    ) : (
      <Fragment key={index}>{markdown(pipeline, segment.content, components)}</Fragment>
    )
  );
}

interface MessageContentProps {
  msg: Message;
  collapseTools?: boolean;
  workingDirectory: string;
  /** `renderMarkdownLive` only for the message a streaming turn is growing. */
  markdown: MarkdownRenderer;
}

const MessageContent = memo(
  function MessageContent({
    msg,
    collapseTools = true,
    workingDirectory,
    markdown,
  }: MessageContentProps) {
    // katex + highlight.js arrive asynchronously; markdown renders immediately
    // with the remark plugins and re-renders once the chunk lands.
    const pipeline = useMarkdownPipeline(CHAT_MARKDOWN);

    const displayContent = useMemo(
      () => normalizeLatexDelimiters(msg.content || '...'),
      [msg.content]
    );
    const collapseToolActivity = collapseTools && msg.role === 'assistant' && !msg.toolCall;

    // Split content into text + AskUserQuestion widget segments
    const segments = useMemo(() => splitStructuredMessageContent(displayContent), [displayContent]);
    const execPreview = execInputPreview(msg.toolCall);
    const hasWidget = segments.some((s) => s.type !== 'text');
    // Stable components per workingDirectory so react-markdown doesn't re-mount its tree.
    const mdComponents = useMemo(
      () => makeMarkdownComponents(workingDirectory),
      [workingDirectory]
    );

    return (
      <div className="message-content">
        {execPreview !== null ? (
          <p>
            🔧 exec <code>{execPreview}</code>
          </p>
        ) : hasWidget ? (
          // Mixed content: interleave Markdown and interactive widgets
          segments.map((seg, i) => {
            if (seg.type === 'text') {
              const trimmed = seg.content.trim();
              if (!trimmed) return null;
              return (
                <MessageMarkdown
                  key={i}
                  content={trimmed}
                  collapseTools={collapseToolActivity}
                  pipeline={pipeline}
                  components={mdComponents}
                  markdown={markdown}
                />
              );
            }
            if (seg.type === 'oompa_run') {
              return <InlineSwarmRunWidget key={i} workingDirectory={workingDirectory} />;
            }
            if (seg.type === 'buddy_builder_result') {
              return <InlineBuddyBuilderResult key={i} payload={seg.json} />;
            }
            if (seg.type === 'buddy_worker_thread' || seg.type === 'retired_marker') return null;
            try {
              const data = parseAskUserQuestion(seg.json);
              return <AskUserQuestionWidget key={i} data={data} />;
            } catch {
              // Malformed JSON — render raw marker as text
              return <code key={i}>AskUserQuestion (parse error)</code>;
            }
          })
        ) : (
          // Fast path: no widgets, render as pure Markdown
          <MessageMarkdown
            content={displayContent}
            collapseTools={collapseToolActivity}
            pipeline={pipeline}
            components={mdComponents}
            markdown={markdown}
          />
        )}
        {msg.toolCall?.input !== undefined && (
          <pre aria-label="Tool input">
            <code>{msg.toolCall.input}</code>
          </pre>
        )}
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.msg.content === next.msg.content &&
      prev.msg.role === next.msg.role &&
      prev.msg.toolCall?.name === next.msg.toolCall?.name &&
      prev.msg.toolCall?.input === next.msg.toolCall?.input &&
      prev.collapseTools === next.collapseTools &&
      prev.workingDirectory === next.workingDirectory &&
      prev.markdown === next.markdown
    );
  }
);

const ROLE_LABEL: Record<Message['role'], string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'system',
};

function StandaloneMessage({
  msg,
  forwardedRef,
  workingDirectory,
  presentation,
}: {
  msg: Message;
  forwardedRef?: React.RefObject<HTMLDivElement | null>;
  workingDirectory: string;
  presentation: TranscriptPresentation;
}) {
  const Actions = ROW_ACTIONS[presentation];
  return (
    <div className={`message ${msg.role}`}>
      {msg.role !== 'system' && (
        <div className={`message-role ${msg.role}`}>{ROLE_LABEL[msg.role]}</div>
      )}
      <MessageContent
        msg={msg}
        workingDirectory={workingDirectory}
        markdown={renderMarkdownCached}
      />
      <Actions
        text={messageTranscriptContent(msg)}
        timestamp={msg.timestamp}
        forwardedRef={forwardedRef}
      />
    </div>
  );
}

function AssistantResponseBlock({
  response,
  forwardedRef,
  workingDirectory,
  isLive,
  presentation,
}: {
  response: AssistantResponse;
  forwardedRef?: React.RefObject<HTMLDivElement | null>;
  workingDirectory: string;
  /** The turn that owns this response is still active. Shows a working
      affordance when the response has no renderable parts yet — otherwise a
      silent provider phase leaves a blank "Assistant" bubble (the server
      creates the empty placeholder at turn.started, before any output). */
  isLive: boolean;
  presentation: TranscriptPresentation;
}) {
  const showWorking = isLive && response.parts.length === 0;
  const Actions = ROW_ACTIONS[presentation];
  return (
    <article className="message assistant chat-assistant-response" aria-label="Assistant response">
      <div className="message-role assistant">Assistant</div>
      <div className="chat-response-parts">
        {showWorking && (
          <div className="chat-response-working" aria-live="polite">
            <span>Thinking…</span>
            <span className="typing-dot" aria-hidden="true" />
            <span className="typing-dot" aria-hidden="true" />
            <span className="typing-dot" aria-hidden="true" />
          </div>
        )}
        {response.parts.map((part, partIndex) => {
          // Streaming text only ever grows the response's last part.
          const markdown =
            isLive && partIndex === response.parts.length - 1
              ? renderMarkdownLive
              : renderMarkdownCached;
          return part.type === 'tool_calls' ? (
            <ChatActivity
              key={part.key}
              label={
                part.count
                  ? `${part.count} tool ${part.count === 1 ? 'call' : 'calls'}`
                  : 'Work launched'
              }
              workerThreads={part.workerThreads}
            >
              {part.messages.map((msg, index) => (
                <MessageContent
                  key={index}
                  msg={msg}
                  collapseTools={false}
                  workingDirectory={workingDirectory}
                  markdown={markdown}
                />
              ))}
            </ChatActivity>
          ) : (
            <MessageContent
              key={part.key}
              msg={part.message}
              workingDirectory={workingDirectory}
              markdown={markdown}
            />
          );
        })}
      </div>
      <Actions
        text={response.copyText}
        timestamp={response.messages[0].timestamp}
        forwardedRef={forwardedRef}
      />
    </article>
  );
}

interface TranscriptGroupProps {
  group: MessageGroup;
  isLastGroup: boolean;
  lastMessageRef: React.RefObject<HTMLDivElement | null>;
  /** Conversation working directory — resolves relative file paths in previews. */
  workingDirectory: string;
  /** Owning turn still active — only the last group can be the live one. */
  isLiveTurn?: boolean;
  presentation: TranscriptPresentation;
}

/**
 * Memoised on group identity: the tail regroup (atoms/conversations.ts) keeps
 * every settled group the SAME object on a streaming frame, so only the last
 * row re-renders. Guarded by chat-message-groups.test.tsx.
 */
export const TranscriptGroup = memo(
  function TranscriptGroup({
    group,
    isLastGroup,
    lastMessageRef,
    workingDirectory,
    isLiveTurn,
    presentation,
  }: TranscriptGroupProps) {
    if (group.type === 'assistant') {
      return (
        <AssistantResponseBlock
          response={group}
          forwardedRef={isLastGroup ? lastMessageRef : undefined}
          workingDirectory={workingDirectory}
          isLive={isLiveTurn === true && isLastGroup}
          presentation={presentation}
        />
      );
    }

    return (
      <>
        {group.messages.map((msg, mi) => (
          <StandaloneMessage
            key={mi}
            msg={msg}
            forwardedRef={
              isLastGroup && mi === group.messages.length - 1 ? lastMessageRef : undefined
            }
            workingDirectory={workingDirectory}
            presentation={presentation}
          />
        ))}
      </>
    );
  },
  (prev, next) =>
    prev.group === next.group &&
    prev.isLastGroup === next.isLastGroup &&
    prev.workingDirectory === next.workingDirectory &&
    prev.isLiveTurn === next.isLiveTurn &&
    prev.presentation === next.presentation
);
