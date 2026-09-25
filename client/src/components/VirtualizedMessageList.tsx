import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '@unleashd/shared';
import type { BuddyContext } from '@unleashd/shared';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import {
  Fragment,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { CopyState } from '../hooks/useCopyAction';
import { COPY_LABEL, useCopyAction } from '../hooks/useCopyAction';
import { ChatActivity } from '../ui/ChatActivity';
import type { AssistantResponse, MessageGroup } from '../utils/chat-message-groups';
import { messageTranscriptContent } from '../utils/conversation-transcript';
import { useMarkdownPipeline } from '../utils/lazyMarkdownPlugins';
import {
  type MarkdownPipeline,
  type MarkdownRenderer,
  defineMarkdownFlavor,
  renderMarkdownCached,
  renderMarkdownLive,
} from '../utils/markdown-pipeline';
import { remarkBreaks } from '../utils/remark-breaks';
import { splitStructuredMessageContent } from '../utils/structured-message-segments';
import { splitToolActivity } from '../utils/tool-activity-segments';
import { execInputPreview } from '../utils/tool-call-preview';
export type { MessageGroup } from '../utils/chat-message-groups';
import { AskUserQuestionWidget, parseAskUserQuestion } from './AskUserQuestion';
import { BuddyConvoHeader } from './BuddyConvoHeader';
import { FilePreview, getPreviewType, getPreviewableLocalHref } from './FilePreview';
import { InlineSwarmRunWidget, SwarmConvoPrefix } from '../swarm';
import { InlineBuddyBuilderResult } from './buddies/BuddyBuilderResultCard';

/**
 * remark-math recognizes $...$ and $$...$$, while model output commonly uses
 * LaTeX's \(...\) and \[...\] delimiters. Normalize those alternate delimiters
 * before parsing, without changing fenced or inline code.
 */
function normalizeLatexDelimiters(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: { marker: string; length: number } | null = null;

  return lines
    .map((line) => {
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const markerRun = fenceMatch[1];
        const marker = markerRun[0];
        if (!fence) {
          fence = { marker, length: markerRun.length };
        } else if (marker === fence.marker && markerRun.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      if (fence) return line;

      let result = '';
      let inlineCodeLength = 0;

      for (let i = 0; i < line.length; ) {
        if (line[i] === '`') {
          let runLength = 1;
          while (line[i + runLength] === '`') runLength++;
          if (inlineCodeLength === 0) inlineCodeLength = runLength;
          else if (inlineCodeLength === runLength) inlineCodeLength = 0;
          result += line.slice(i, i + runLength);
          i += runLength;
          continue;
        }

        const delimiter = line.slice(i, i + 2);
        const isUnescapedLatexDelimiter =
          inlineCodeLength === 0 &&
          line[i - 1] !== '\\' &&
          (delimiter === '\\(' ||
            delimiter === '\\)' ||
            delimiter === '\\[' ||
            delimiter === '\\]');

        if (isUnescapedLatexDelimiter) {
          result += delimiter === '\\(' || delimiter === '\\)' ? '$' : '$$';
          i += 2;
          continue;
        }

        result += line[i];
        i++;
      }

      return result;
    })
    .join('\n');
}

// =============================================================================
// VirtualizedMessageList: Renders large message lists efficiently using
// @tanstack/react-virtual. Virtualizes at the messageGroup level to handle
// both single messages and collapsible loop iteration groups.
//
// KEY DESIGN:
// - Virtualizes groups (not individual messages) to maintain loop iteration collapsibility
// - Uses measureElement for accurate dynamic heights after Markdown renders
// - Sticky-bottom mode: auto-scrolls during streaming when user is near bottom
// - Instant scroll on conversation mount (useLayoutEffect avoids flash)
// - overscan: 3 items for smooth scrolling without excessive DOM
// =============================================================================

// =============================================================================
// Code Content Classification
//
// react-markdown v10 calls the custom `code` component for BOTH fenced code
// blocks (`<pre><code>`) and inline code (`<code>`). There is no `inline` prop
// in v10 — the only signals are:
//   - className: present when a language tag is specified (e.g. ```python)
//   - text content: fenced blocks have newlines, inline typically doesn't
//
// We classify code content into a discriminated union (CodeContent) and dispatch
// to one handler per variant. This avoids the old fallthrough chain where a
// rejected parsePathBlock silently fell to getPreviewType, which treated entire
// multi-line blocks as a single image path (the "many lines as one line" bug).
//
// CONSTRAINT: parsePathBlock used to be all-or-nothing — if ANY line (like "...")
// wasn't a valid file path, the entire block was rejected. classifyPathBlock
// replaces it with per-line classification: valid paths → FilePreview with hover,
// non-path lines → plain text. The block qualifies as a path_block if at least
// one line is a valid file path.
//
// CONSTRAINT: getPreviewType only handles single-line text (rejects newlines).
// Multi-line text MUST go through classifyPathBlock, never getPreviewType.
// =============================================================================

// -- Types: what a single line within a multi-line code block can be -----------
type PathBlockEntry =
  | { kind: 'file_path'; path: string; type: 'image' | 'html' | 'video' | 'markdown' }
  | { kind: 'text_line'; text: string };

// -- Types: what the entire <code> element represents -------------------------
type CodeContent =
  | { kind: 'empty' }
  | { kind: 'syntax_highlighted'; className: string }
  | { kind: 'path_block'; entries: PathBlockEntry[] }
  | { kind: 'clickable_url'; url: string }
  | { kind: 'single_file_path'; path: string; type: 'image' | 'html' | 'video' | 'markdown' }
  | { kind: 'plain_code' };

// -- Canonicalization: classify each line independently -----------------------
// Replaces the old parsePathBlock which returned null if ANY line failed.
// Now every line gets a classification — valid paths become file_path entries
// (rendered as FilePreview with hover), everything else becomes text_line
// (rendered as plain monospace text).
function classifyPathBlock(text: string): PathBlockEntry[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const type = getPreviewType(line);
      if (type) return { kind: 'file_path' as const, path: line, type };
      return { kind: 'text_line' as const, text: line };
    });
}

// -- Canonicalization: single entry point for all code content ----------------
// Ordered by specificity: language-tagged > multi-line > single-line patterns.
function classifyCodeContent(text: string | null, className: string | undefined): CodeContent {
  if (!text) return { kind: 'empty' };

  // Language-tagged fenced blocks (className from rehype-highlight, e.g. "language-python").
  // These always pass through to syntax highlighting — never interpreted as paths.
  if (className) return { kind: 'syntax_highlighted', className };

  // Multi-line: fenced code block without language tag.
  if (text.includes('\n')) {
    const entries = classifyPathBlock(text);
    // Upgrade to path_block only if at least one line is a real file path.
    // A block with zero file paths is just plain code.
    if (entries.some((e) => e.kind === 'file_path')) {
      return { kind: 'path_block', entries };
    }
    return { kind: 'plain_code' };
  }

  // Single-line: bare URL in backticks (remark-gfm can't autolink inside code spans).
  if (/^https?:\/\/\S+$/.test(text)) {
    return { kind: 'clickable_url', url: text };
  }

  // Single-line: file path with previewable extension.
  const previewType = getPreviewType(text);
  if (previewType) {
    return { kind: 'single_file_path', path: text, type: previewType };
  }

  return { kind: 'plain_code' };
}

// -- Helpers ------------------------------------------------------------------

function getCodeText(children: unknown): string | null {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    const text = children.map((child) => (typeof child === 'string' ? child : '')).join('');
    return text.length > 0 ? text : null;
  }
  return null;
}

function getRawCodeText(children: unknown): string | null {
  if (Array.isArray(children)) {
    for (const child of children) {
      const rawCode = getRawCodeText(child);
      if (rawCode) return rawCode;
    }
    return null;
  }

  if (!isValidElement<Record<string, unknown>>(children)) return null;

  const rawCode = children.props['data-raw-code'];
  if (typeof rawCode === 'string' && rawCode.length > 0) return rawCode;

  return getRawCodeText(children.props.children);
}

// -- Copy button --------------------------------------------------------------

function CopyGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** One glyph per copy state — a Record so a new state is a type error, not a fallthrough. */
const COPY_GLYPH: Record<CopyState, ReactNode> = {
  idle: (
    <CopyGlyph>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </CopyGlyph>
  ),
  copied: (
    <CopyGlyph>
      <polyline points="20 6 9 17 4 12" />
    </CopyGlyph>
  ),
  failed: (
    <CopyGlyph>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </CopyGlyph>
  ),
};

/**
 * The label is always in the DOM; `.message-code-copy-btn` hides it with CSS so
 * the code-block variant stays icon-only. Keeps the JSX free of a variant prop
 * and keeps the accessible name on `aria-label` either way.
 */
function CopyButton({ text, className }: { text: string; className: string }) {
  const { state, copy } = useCopyAction(text);
  const label = COPY_LABEL[state];
  return (
    <button
      type="button"
      className={`${className} copy-btn copy-btn--${state}`}
      onClick={copy}
      title={label}
      aria-label={label}
    >
      {COPY_GLYPH[state]}
      <span className="copy-btn__label">{label}</span>
    </button>
  );
}

function CodeBlockFrame({
  children,
  rawCode,
  ...preProps
}: ComponentPropsWithoutRef<'pre'> & { rawCode: string | null }) {
  return (
    <div className="message-code-block">
      {rawCode && <CopyButton text={rawCode} className="message-code-copy-btn" />}
      <pre {...preProps}>{children}</pre>
    </div>
  );
}

// -- Markdown component overrides ---------------------------------------------
function hastText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const candidate = node as { value?: unknown; children?: unknown };
  if (typeof candidate.value === 'string') return candidate.value;
  if (!Array.isArray(candidate.children)) return '';
  return candidate.children.map(hastText).join('');
}

// Factory returns a stable Components object keyed on `workingDirectory` so
// react-markdown doesn't re-mount on every render. Relative file paths are
// resolved against workingDirectory; absolute paths pass through unchanged.
function makeMarkdownComponents(workingDirectory: string): Components {
  return {
    pre({ children, ...rest }) {
      return (
        <CodeBlockFrame rawCode={getRawCodeText(children)} {...rest}>
          {children}
        </CodeBlockFrame>
      );
    },
    a({ node, href, children, ...rest }) {
      const previewableLocalHref = href ? getPreviewableLocalHref(href) : null;
      if (previewableLocalHref) {
        return (
          <FilePreview
            path={previewableLocalHref.path}
            type={previewableLocalHref.type}
            workingDirectory={workingDirectory}
            // Use the source AST text. Rendered `children` may already contain
            // a FilePreview from the code override, which would otherwise put
            // an interactive link inside this link and violate HTML nesting.
            linkLabel={hastText(node) || previewableLocalHref.path}
          />
        );
      }

      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
        </a>
      );
    },
    // Thin dispatcher: classify once, switch exhaustively, zero work in cases.
    code({ children, className, ...rest }) {
      const rawText = getCodeText(children);
      const text = rawText?.trim() ?? null;
      const content = classifyCodeContent(text, className);

      switch (content.kind) {
        case 'empty':
        case 'plain_code':
          return (
            <code className={className} data-raw-code={rawText ?? undefined} {...rest}>
              {children}
            </code>
          );

        case 'syntax_highlighted':
          return (
            <code className={content.className} data-raw-code={rawText ?? undefined} {...rest}>
              {children}
            </code>
          );

        case 'path_block':
          // Mixed block: each line classified independently. file_path entries
          // get FilePreview (icon + hover thumbnail), text_line entries (like
          // "..." or headers) render as plain monospace text. This is the fix
          // for the "many lines as one line" bug — the old parsePathBlock was
          // all-or-nothing: if ANY line wasn't a valid path, the ENTIRE block
          // lost FilePreview functionality.
          return (
            <code className={className} data-raw-code={rawText ?? undefined} {...rest}>
              {content.entries.map((entry, i) => (
                <span key={i}>
                  {entry.kind === 'file_path' ? (
                    <FilePreview
                      path={entry.path}
                      type={entry.type}
                      workingDirectory={workingDirectory}
                    />
                  ) : (
                    <span className="path-block-text-line ui-muted">{entry.text}</span>
                  )}
                  {i < content.entries.length - 1 && <br />}
                </span>
              ))}
            </code>
          );

        case 'clickable_url':
          {
            const previewableLocalHref = getPreviewableLocalHref(content.url);
            if (previewableLocalHref) {
              return (
                <FilePreview
                  path={previewableLocalHref.path}
                  type={previewableLocalHref.type}
                  workingDirectory={workingDirectory}
                  linkLabel={<code {...rest}>{children}</code>}
                />
              );
            }
          }
          return (
            <a
              href={content.url}
              target="_blank"
              rel="noopener noreferrer"
              data-raw-code={rawText ?? undefined}
            >
              <code {...rest}>{children}</code>
            </a>
          );

        case 'single_file_path':
          return (
            <span data-raw-code={rawText ?? undefined}>
              <FilePreview
                path={content.path}
                type={content.type}
                workingDirectory={workingDirectory}
              />
            </span>
          );
      }
    },
  };
}

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

// =============================================================================
// Memoized Message Rendering
// =============================================================================

interface MessageContentProps {
  msg: Message;
  collapseTools?: boolean;
  workingDirectory: string;
  /** `renderMarkdownLive` only for the message a streaming turn is growing. */
  markdown: MarkdownRenderer;
}

const MemoizedMessageContent = memo(
  function MemoizedMessageContent({
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
    // Memoize markdown components keyed on workingDirectory so react-markdown
    // gets a stable reference and doesn't re-mount its component tree.
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
            // AskUserQuestion widget
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

function StandaloneMessage({
  msg,
  forwardedRef,
  workingDirectory,
}: {
  msg: Message;
  forwardedRef?: React.RefObject<HTMLDivElement | null>;
  workingDirectory: string;
}) {
  const roleLabel = msg.role === 'user' ? 'You' : msg.role === 'assistant' ? 'Assistant' : msg.role;
  return (
    <div className={`message ${msg.role}`} ref={forwardedRef}>
      {msg.role !== 'system' && <div className={`message-role ${msg.role}`}>{roleLabel}</div>}
      <MemoizedMessageContent
        msg={msg}
        workingDirectory={workingDirectory}
        markdown={renderMarkdownCached}
      />
      {messageTranscriptContent(msg).trim() && (
        <div className="message-actions">
          <CopyButton
            text={messageTranscriptContent(msg)}
            className="message-action-btn ui-control ui-inline-row ui-muted"
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Message Group Types
// =============================================================================

interface VirtualizedMessageListProps {
  messageGroups: MessageGroup[];
  isRunning: boolean;
  /** Owning turn still active (isRunning || isStreaming at the call site).
      Feeds the in-bubble working indicator on the live assistant response. */
  isTurnActive?: boolean;
  lastMessageRef: React.RefObject<HTMLDivElement | null>;
  onScrollStateChange: (isNearBottom: boolean, showScrollButton: boolean) => void;
  conversationId: string;
  markMessagesSeen: (id: string, lastIndex: number) => void;
  totalMessageCount: number;
  scrollToBottomRef?: React.MutableRefObject<(() => void) | null>;
  /** Conversation working directory — used to resolve relative file paths in previews. */
  workingDirectory: string;
  swarmDebugPrefix?: string | null;
  swarmId?: string | null;
  buddyContext?: BuddyContext;
}

// Estimate height based on content — rough approximation before measurement
function estimateGroupSize(group: MessageGroup): number {
  if (group.type === 'assistant') {
    return (
      48 +
      group.parts.reduce(
        (height, part) =>
          height +
          (part.type === 'tool_calls'
            ? 24
            : Math.min(40 + Math.ceil(part.message.content.length / 100) * 20, 600)),
        0
      )
    );
  }
  return group.messages.reduce(
    (height, msg) => height + Math.min(80 + Math.ceil(msg.content.length / 100) * 20, 600),
    0
  );
}

export function VirtualizedMessageList({
  messageGroups,
  isRunning,
  isTurnActive,
  lastMessageRef,
  onScrollStateChange,
  conversationId,
  markMessagesSeen,
  totalMessageCount,
  scrollToBottomRef,
  workingDirectory,
  swarmDebugPrefix,
  swarmId,
  buddyContext,
}: VirtualizedMessageListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const stickyBottomRef = useRef(true);
  // Track conversation ID to detect switches
  const prevConversationIdRef = useRef<string | null>(null);

  // The server sets a swarm prefix only on chat kinds; a Buddy thread has none.
  const visibleSwarmDebugPrefix = swarmDebugPrefix ?? null;
  const contextItemCount = (buddyContext ? 1 : 0) + (visibleSwarmDebugPrefix ? 1 : 0);
  const totalItems = messageGroups.length + contextItemCount;
  // Read once, when the virtualizer first needs a scroll offset. A memo here
  // re-summed every group on each streaming frame for a value used at mount.
  const estimateInitialOffset = () => {
    let total = 0;
    if (buddyContext) total += 88;
    if (visibleSwarmDebugPrefix) total += 80;
    for (const group of messageGroups) total += estimateGroupSize(group);
    return total;
  };

  const virtualizer = useVirtualizer({
    count: totalItems,
    getItemKey: (index) =>
      index < contextItemCount
        ? `context-${index}`
        : `message-${messageGroups[index - contextItemCount].firstMessageIndex ?? index}`,
    getScrollElement: () => parentRef.current,
    // Conversations open at the newest message. Starting the virtualizer at
    // offset zero briefly rendered the oldest item before the layout effect
    // scrolled down; a large first prompt could spend hundreds of milliseconds
    // in Markdown parsing even though the user never saw it.
    initialOffset: estimateInitialOffset,
    estimateSize: (index) => {
      if (buddyContext && index === 0) return 88;
      if (visibleSwarmDebugPrefix && index === (buddyContext ? 1 : 0)) return 80;
      const groupIndex = index - contextItemCount;
      return estimateGroupSize(messageGroups[groupIndex]);
    },
    overscan: 3,
    measureElement: (element) => {
      // Measure actual DOM height for accurate positioning
      return element.getBoundingClientRect().height;
    },
  });

  // Scroll to bottom instantly on conversation mount (before paint)
  useLayoutEffect(() => {
    const isNewConversation = prevConversationIdRef.current !== conversationId;
    prevConversationIdRef.current = conversationId;

    if (isNewConversation && totalItems > 0) {
      // Instant scroll to bottom on conversation switch
      virtualizer.scrollToIndex(totalItems - 1, { align: 'end' });
      stickyBottomRef.current = true;
    }
  }, [conversationId, totalItems, virtualizer]);

  // Auto-scroll during streaming when sticky-bottom is true
  useEffect(() => {
    if (stickyBottomRef.current && totalItems > 0) {
      virtualizer.scrollToIndex(totalItems - 1, {
        align: 'end',
        behavior: isRunning ? 'auto' : 'smooth',
      });
    }
  }, [totalItems, isRunning, virtualizer]);

  // Track scroll position for sticky-bottom mode
  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceFromBottom < 150;
    stickyBottomRef.current = isNearBottom;
    onScrollStateChange(isNearBottom, distanceFromBottom >= 200);
  }, [onScrollStateChange]);

  // IntersectionObserver for NEW badge — mark messages seen when last is visible
  useEffect(() => {
    if (totalMessageCount === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            markMessagesSeen(conversationId, totalMessageCount - 1);
          }
        }
      },
      { threshold: 0.5 }
    );

    if (lastMessageRef.current) {
      observer.observe(lastMessageRef.current);
    }

    return () => observer.disconnect();
  }, [conversationId, totalMessageCount, markMessagesSeen, lastMessageRef]);

  // Expose scrollToBottom function via ref
  // NOTE: Must use totalItems (not messageGroups.length) because when swarmDebugPrefix
  // is present, the virtualizer has messageGroups.length + 1 items. Using
  // messageGroups.length - 1 would scroll to the second-to-last item, missing the
  // final message group.
  useEffect(() => {
    if (scrollToBottomRef) {
      scrollToBottomRef.current = () => {
        if (totalItems > 0) {
          virtualizer.scrollToIndex(totalItems - 1, { align: 'end', behavior: 'smooth' });
          stickyBottomRef.current = true;
        }
      };
    }
    return () => {
      if (scrollToBottomRef) {
        scrollToBottomRef.current = null;
      }
    };
  }, [scrollToBottomRef, totalItems, virtualizer]);

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="messages-container"
      onScroll={handleScroll}
      style={{ overflowY: 'auto' }}
    >
      {totalItems === 0 ? null : (
        <div
          className="virtual-list-inner chat-reading-column"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {items.map((virtualItem) => {
            if (buddyContext && virtualItem.index === 0) {
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <BuddyConvoHeader context={buddyContext} />
                </div>
              );
            }

            if (visibleSwarmDebugPrefix && virtualItem.index === (buddyContext ? 1 : 0)) {
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div style={{ paddingBottom: '24px' }}>
                    <SwarmConvoPrefix prefix={visibleSwarmDebugPrefix} swarmId={swarmId ?? null} />
                  </div>
                </div>
              );
            }

            const groupIndex = virtualItem.index - contextItemCount;
            const group = messageGroups[groupIndex];
            const isLastGroup = groupIndex === messageGroups.length - 1;

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <VirtualizedGroup
                  group={group}
                  isLastGroup={isLastGroup}
                  lastMessageRef={lastMessageRef}
                  workingDirectory={workingDirectory}
                  // Only the last group can be live; passing the flag to every
                  // group re-rendered the whole list when a turn started or ended.
                  isLiveTurn={isTurnActive && isLastGroup}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssistantResponseBlock({
  response,
  forwardedRef,
  workingDirectory,
  isLive,
}: {
  response: AssistantResponse;
  forwardedRef?: React.RefObject<HTMLDivElement | null>;
  workingDirectory: string;
  /** The turn that owns this response is still active. Shows a working
      affordance when the response has no renderable parts yet — otherwise a
      silent provider phase leaves a blank "Assistant" bubble (the server
      creates the empty placeholder at turn.started, before any output). */
  isLive?: boolean;
}) {
  const showWorking = isLive === true && response.parts.length === 0;
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
            isLive === true && partIndex === response.parts.length - 1
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
                <MemoizedMessageContent
                  key={index}
                  msg={msg}
                  collapseTools={false}
                  workingDirectory={workingDirectory}
                  markdown={markdown}
                />
              ))}
            </ChatActivity>
          ) : (
            <MemoizedMessageContent
              key={part.key}
              msg={part.message}
              workingDirectory={workingDirectory}
              markdown={markdown}
            />
          );
        })}
      </div>
      <div className="message-actions" ref={forwardedRef}>
        {response.copyText.trim() && (
          <CopyButton
            text={response.copyText}
            className="message-action-btn ui-control ui-inline-row ui-muted"
          />
        )}
      </div>
    </article>
  );
}

// =============================================================================
// VirtualizedGroup: Renders a single message group
// =============================================================================

interface VirtualizedGroupProps {
  group: MessageGroup;
  isLastGroup: boolean;
  lastMessageRef: React.RefObject<HTMLDivElement | null>;
  workingDirectory: string;
  /** Owning turn still active — only the last group can be the live one. */
  isLiveTurn?: boolean;
}

export const VirtualizedGroup = memo(
  function VirtualizedGroup({
    group,
    isLastGroup,
    lastMessageRef,
    workingDirectory,
    isLiveTurn,
  }: VirtualizedGroupProps) {
    if (group.type === 'assistant') {
      return (
        <AssistantResponseBlock
          response={group}
          forwardedRef={isLastGroup ? lastMessageRef : undefined}
          workingDirectory={workingDirectory}
          isLive={isLiveTurn === true && isLastGroup}
        />
      );
    }

    return (
      <>
        {group.messages.map((msg, mi) => {
          const isLastMessage = isLastGroup && mi === group.messages.length - 1;
          return (
            <StandaloneMessage
              key={mi}
              msg={msg}
              forwardedRef={isLastMessage ? lastMessageRef : undefined}
              workingDirectory={workingDirectory}
            />
          );
        })}
      </>
    );
  },
  (prev, next) => {
    if (prev.group !== next.group) return false;
    if (prev.isLastGroup !== next.isLastGroup) return false;
    if (prev.workingDirectory !== next.workingDirectory) return false;
    if (prev.isLiveTurn !== next.isLiveTurn) return false;
    return true;
  }
);
