import type { BuddyWorkerThread } from '@unleashd/shared';
import type { Message } from '@unleashd/shared';
import { Fragment, memo, useState } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { InlineBuddyBuilderResult } from '../../components/buddies/BuddyBuilderResultCard';
import { BuddyWorkerThreadBadge } from '../../components/buddies/BuddyWorkerThreadBadge';
import { COPY_LABEL, useCopyAction } from '../../hooks/useCopyAction';
import type { AssistantResponse } from '../../utils/chat-message-groups';
import { messageTranscriptContent } from '../../utils/conversation-transcript';
import { useMarkdownPipeline } from '../../utils/lazyMarkdownPlugins';
import {
  type MarkdownRenderer,
  defineMarkdownFlavor,
  renderMarkdownCached,
  renderMarkdownLive,
} from '../../utils/markdown-pipeline';
import { splitStructuredMessageContent } from '../../utils/structured-message-segments';
import { execInputPreview } from '../../utils/tool-call-preview';

/**
 * Mobile has no hover, so the desktop reveal-on-hover affordance has no
 * equivalent here — and a long-press menu would fight the browser's own
 * text-selection gesture, which is how people already copy a fragment. Instead
 * the action is permanent but quiet: a small pill on the message's footer line,
 * right-aligned opposite the timestamp, at the same 36px secondary tap size as
 * `.mobile-chat__action`.
 */
function MessageCopyButton({ content }: { content: string }) {
  const { state, copy } = useCopyAction(content);
  const label = COPY_LABEL[state];
  return (
    <button
      type="button"
      className={`mobile-message__copy ui-card ui-muted copy-btn--${state}`}
      onClick={copy}
      aria-label={label}
    >
      {label}
    </button>
  );
}

// No remark-breaks here: `.mobile-markdown` is `white-space: pre-wrap`.
const MOBILE_MARKDOWN = defineMarkdownFlavor([remarkGfm, remarkMath]);

export const MessageRow = memo(function MessageRow({
  message,
  isLast,
  lastMessageRef,
  subAgents,
}: {
  message: Message;
  isLast: boolean;
  lastMessageRef?: React.RefObject<HTMLDivElement | null>;
  subAgents?: Array<{ id: string; description?: string; status?: string; currentAction?: string }>;
}) {
  const isUser = message.role === 'user';

  return (
    <div
      ref={isLast ? lastMessageRef : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        borderRadius: 'var(--ui-radius)',
        background: isUser ? 'var(--bg-raised-1, #1e1e1e)' : 'transparent',
        border: isUser ? '1px solid var(--border-subtle, #2a2a2a)' : 'none',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: isUser ? 'var(--text-muted, #888)' : 'var(--accent, #7c5cff)',
        }}
      >
        {isUser ? 'You' : 'Assistant'}
      </div>

      <MessageRowContent message={message} markdown={renderMarkdownCached} />

      <div className="mobile-message__footer">
        {message.timestamp && (
          <span style={{ fontSize: 10, color: 'var(--text-muted, #777)' }}>
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        )}
        {/* Raw content, not the rendered markdown — copying should give back
            what the model actually wrote. */}
        {message.content.trim().length > 0 && (
          <MessageCopyButton content={messageTranscriptContent(message)} />
        )}
      </div>
      {subAgents && subAgents.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {subAgents.map((sa) => (
            <div
              key={sa.id}
              style={{
                fontSize: 11,
                padding: '6px 8px',
                borderRadius: 'var(--ui-radius)',
                border: '1px solid var(--border-subtle, #333)',
                background: 'var(--bg-raised-2, #222)',
                color: 'var(--text-muted, #999)',
              }}
            >
              <span style={{ fontWeight: 600 }}>{sa.description ?? sa.id.slice(0, 8)}</span>
              {sa.currentAction ? ` · ${sa.currentAction}` : ''} · {sa.status ?? 'running'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

const MessageRowContent = memo(function MessageRowContent({
  message,
  markdown,
}: {
  message: Message;
  markdown: MarkdownRenderer;
}) {
  // Shared lazy loader (utils/lazyMarkdownPlugins) — one loading path with desktop.
  const pipeline = useMarkdownPipeline(MOBILE_MARKDOWN);
  const segments = splitStructuredMessageContent(message.content);
  const execPreview = execInputPreview(message.toolCall);

  return (
    <>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.5,
          color: 'var(--text-primary, #e8e8e8)',
          overflowWrap: 'break-word',
          whiteSpace: 'pre-wrap',
        }}
        className="mobile-markdown"
      >
        {execPreview !== null ? (
          <p>
            🔧 exec <code>{execPreview}</code>
          </p>
        ) : (
          segments.map((seg, idx) => {
            if (seg.type === 'text') {
              if (!seg.content.trim()) return null;
              return <Fragment key={idx}>{markdown(pipeline, seg.content)}</Fragment>;
            }
            if (seg.type === 'buddy_builder_result') {
              return <InlineBuddyBuilderResult key={idx} payload={seg.json} />;
            }
            if (seg.type === 'buddy_worker_thread' || seg.type === 'retired_marker') return null;
            if (seg.type === 'ask_user_question') {
              let question: unknown = null;
              try {
                question = JSON.parse(seg.json);
              } catch {
                return null;
              }
              const q = question as { question?: string; options?: Array<{ label: string }> };
              return (
                <div
                  key={idx}
                  style={{
                    border: '1px solid var(--border-subtle, #333)',
                    borderRadius: 'var(--ui-radius)',
                    padding: 12,
                    background: 'var(--bg-raised-2, #222)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{q.question ?? 'Question'}</div>
                  {q.options?.length ? (
                    <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12 }}>
                      {q.options.map((o, i) => (
                        <li key={i}>{o.label}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              );
            }
            if (seg.type === 'oompa_run') {
              return (
                <div
                  key={idx}
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted, #888)',
                    fontStyle: 'italic',
                    borderLeft: '2px solid var(--border-subtle, #333)',
                    paddingLeft: 8,
                  }}
                >
                  Oompa run
                </div>
              );
            }
            return null;
          })
        )}
        {message.toolCall?.input !== undefined && (
          <pre aria-label="Tool input">
            <code>{message.toolCall.input}</code>
          </pre>
        )}
      </div>
    </>
  );
});

export const AssistantResponseRow = memo(function AssistantResponseRow({
  response,
  isLast,
  lastMessageRef,
  isLive,
}: {
  response: AssistantResponse;
  isLast: boolean;
  lastMessageRef?: React.RefObject<HTMLDivElement | null>;
  /** The turn that owns this response is still active. Shows a working
      affordance when the response has no renderable parts yet — otherwise a
      silent provider phase leaves a blank "Assistant" bubble (the server
      creates the empty placeholder at turn.started, before any output). */
  isLive?: boolean;
}) {
  const showWorking = isLive === true && response.parts.length === 0;
  return (
    <article className="mobile-assistant-response ui-stack" aria-label="Assistant response">
      <div className="mobile-assistant-response__role">Assistant</div>
      {showWorking && (
        <div className="mobile-chat__thinking" aria-live="polite">
          Thinking…
        </div>
      )}
      {response.parts.map((part, partIndex) => {
        // Streaming text only ever grows the response's last part.
        const markdown =
          isLive === true && partIndex === response.parts.length - 1
            ? renderMarkdownLive
            : renderMarkdownCached;
        return part.type === 'tool_calls' ? (
          <MobileToolActivity
            key={part.key}
            count={part.count}
            messages={part.messages}
            workerThreads={part.workerThreads}
            markdown={markdown}
          />
        ) : (
          <MessageRowContent key={part.key} message={part.message} markdown={markdown} />
        );
      })}
      <div className="mobile-message__footer" ref={isLast ? lastMessageRef : undefined}>
        <span>{new Date(response.messages[0].timestamp).toLocaleTimeString()}</span>
        {response.copyText.trim() && <MessageCopyButton content={response.copyText} />}
      </div>
    </article>
  );
});

function MobileToolActivity({
  count,
  messages,
  workerThreads,
  markdown,
}: {
  count: number;
  messages: Message[];
  workerThreads?: BuddyWorkerThread[];
  markdown: MarkdownRenderer;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mobile-response-activity">
      <button
        type="button"
        className="mobile-response-activity__toggle ui-inline-row ui-muted"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        {count ? `${count} tool ${count === 1 ? 'call' : 'calls'}` : 'Work launched'}
      </button>
      {workerThreads?.map((thread) => (
        <BuddyWorkerThreadBadge key={thread.conversationId} thread={thread} />
      ))}
      {expanded &&
        messages.map((message, index) => (
          <MessageRowContent key={index} message={message} markdown={markdown} />
        ))}
    </div>
  );
}
