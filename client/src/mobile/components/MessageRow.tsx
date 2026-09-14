import { BuddyWorkerThreadBadge } from '../../components/buddies/BuddyWorkerThreadBadge';
import type { BuddyWorkerThread } from '@unleashd/shared';
import type { Message } from '@unleashd/shared';
import { memo, useState } from 'react';
import type { AssistantResponse } from '../../utils/chat-message-groups';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { InlineBuddyBuilderResult } from '../../components/buddies/BuddyBuilderResultCard';
import { InlineBuddyTeamConfiguration } from '../../components/buddies/BuddyTeamConfiguration';
import { COPY_LABEL, useCopyAction } from '../../hooks/useCopyAction';
import { parseBuddyReviewRequest, parseBuddyReviewResult } from '../../utils/buddy-review-message';
import { messageTranscriptContent } from '../../utils/conversation-transcript';
import { execInputPreview } from '../../utils/tool-call-preview';
import { useLazyMarkdownPlugins } from '../../utils/lazyMarkdownPlugins';
import { splitStructuredMessageContent } from '../../utils/structured-message-segments';

function BuddyReviewRequestCard({ content }: { content: string }) {
  const parsed = parseBuddyReviewRequest(content);
  if (!parsed) return null;
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle, #333)',
        borderRadius: 10,
        padding: 12,
        background: 'var(--bg-raised-1, #1a1a1a)',
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
        Review request · {parsed.reviewId}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted, #999)' }}>
        Subject: {parsed.subjectBuddyId} · Purpose: {parsed.purpose}
      </div>
      {parsed.evidence.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12 }}>
          {parsed.evidence.map((e, i) => (
            <li key={i}>
              <strong>{e.kind}</strong> {e.reference}: {e.observation}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BuddyReviewResultCard({ json }: { json: string }) {
  let parsed: ReturnType<typeof parseBuddyReviewResult> = null;
  try {
    parsed = parseBuddyReviewResult(json);
  } catch {
    return null;
  }
  if (!parsed) return null;
  const verdictColor =
    parsed.verdict === 'pass' ? '#22c55e' : parsed.verdict === 'fail' ? '#ef4444' : '#eab308';
  return (
    <div
      style={{
        border: `1px solid ${verdictColor}`,
        borderRadius: 10,
        padding: 12,
        background: 'var(--bg-raised-1, #1a1a1a)',
        marginBottom: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: verdictColor }}>
        Review {parsed.verdict} {parsed.score !== null ? `· ${parsed.score}` : ''}
      </div>
      <div style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{parsed.summary}</div>
    </div>
  );
}

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
      className={`mobile-message__copy copy-btn--${state}`}
      onClick={copy}
      aria-label={label}
    >
      {label}
    </button>
  );
}

function MarkdownBlock({ content, plugins }: { content: string; plugins: PluggableList }) {
  return (
    <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={plugins}>
      {content}
    </Markdown>
  );
}

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
        borderRadius: 12,
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

      <MessageRowContent message={message} />

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
                borderRadius: 8,
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

const MessageRowContent = memo(function MessageRowContent({ message }: { message: Message }) {
  // Shared lazy loader (utils/lazyMarkdownPlugins) — one loading path with desktop.
  const plugins = useLazyMarkdownPlugins();
  const isUser = message.role === 'user';
  const segments = splitStructuredMessageContent(message.content);
  const execPreview = execInputPreview(message.toolCall);

  // Detect buddy review request in user messages — rebuild JSX, don't import Chat rendering
  const reviewRequest = isUser ? parseBuddyReviewRequest(message.content) : null;

  return (
    <>
      {reviewRequest && <BuddyReviewRequestCard content={message.content} />}

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
              // Skip duplicate rendering when the whole message was a review request
              if (reviewRequest && seg.content === message.content) return null;
              if (!seg.content.trim()) return null;
              return <MarkdownBlock key={idx} content={seg.content} plugins={plugins} />;
            }
            if (seg.type === 'buddy_review_result') {
              return <BuddyReviewResultCard key={idx} json={seg.json} />;
            }
            if (seg.type === 'buddy_builder_result') {
              return <InlineBuddyBuilderResult key={idx} payload={seg.json} />;
            }
            if (seg.type === 'buddy_worker_thread') return null;
            if (seg.type === 'buddy_team_configuration') {
              return <InlineBuddyTeamConfiguration key={idx} payload={seg.json} />;
            }
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
                    borderRadius: 10,
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
}: {
  response: AssistantResponse;
  isLast: boolean;
  lastMessageRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <article className="mobile-assistant-response" aria-label="Assistant response">
      <div className="mobile-assistant-response__role">Assistant</div>
      {response.parts.map((part) =>
        part.type === 'tool_calls' ? (
          <MobileToolActivity
            key={part.key}
            count={part.count}
            messages={part.messages}
            workerThreads={part.workerThreads}
          />
        ) : (
          <MessageRowContent key={part.key} message={part.message} />
        )
      )}
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
}: { count: number; messages: Message[]; workerThreads?: BuddyWorkerThread[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mobile-response-activity">
      <button
        type="button"
        className="mobile-response-activity__toggle"
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
        messages.map((message, index) => <MessageRowContent key={index} message={message} />)}
    </div>
  );
}
