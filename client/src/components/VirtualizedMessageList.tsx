import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '@unleashd/shared';
import type { Break, Root, Text } from 'mdast';
import type { ComponentPropsWithoutRef } from 'react';
import {
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Plugin } from 'unified';
import type { BuddyContext } from '../atoms/pending-creations';
import { parseBuddyReviewRequest, parseBuddyReviewResult } from '../utils/buddy-review-message';
import { copyText } from '../utils/clipboard';
import { useLazyMarkdownPlugins } from '../utils/lazyMarkdownPlugins';
import {
  OOMPA_RUN_TOOL_FRAGMENT_RE,
  splitStructuredMessageContent,
} from '../utils/structured-message-segments';
import { AskUserQuestionWidget, parseAskUserQuestion } from './AskUserQuestion';
import { BuddyConvoHeader } from './BuddyConvoHeader';
import { BuddyReviewRequestCard, BuddyReviewResultCard } from './BuddyReviewMessage';
import { FilePreview, getPreviewType, getPreviewableLocalHref } from './FilePreview';
import { InlineSwarmRunWidget } from './InlineSwarmRunWidget';
import { SwarmConvoPrefix } from './SwarmConvoPrefix';
import { effectiveSwarmDebugPrefix } from './buddies/ui-contract';

// =============================================================================
// remarkBreaks — inline remark plugin (replaces the `remark-breaks` npm package)
//
// Standard Markdown collapses single newlines into spaces within a paragraph.
// This means plain-text output (e.g. file path lists NOT in code fences) renders
// as one long run-on line. This plugin converts soft newlines to <br> hard breaks
// in the mdast, matching chat-UI expectations where each \n is a visual line break.
//
// SCOPE: Only affects text nodes inside paragraphs/lists/blockquotes. Does NOT
// affect code blocks — those are `code` nodes in mdast with a `value` string
// (no children), so this visitor skips them. Code block whitespace is preserved
// by the <pre> element's `white-space: pre` CSS.
//
// WHY INLINE: The `remark-breaks` npm package does the same thing, but pnpm
// workspace install was broken by an unrelated server dependency. This is ~20
// lines and has zero external deps.
// =============================================================================
const remarkBreaks: Plugin<[], Root> = () => (tree) => {
  const visit = (node: Root | Root['children'][number]) => {
    if (!('children' in node)) return;
    const next: Root['children'] = [];
    for (const child of node.children) {
      if (child.type === 'text') {
        const lines = (child as Text).value.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) next.push({ type: 'break' } as Break);
          if (lines[i]) next.push({ type: 'text', value: lines[i] } as Text);
        }
      } else {
        visit(child as Root['children'][number]);
        next.push(child);
      }
    }
    node.children = next as typeof node.children;
  };
  visit(tree);
};

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
// Tool Line Collapsing
//
// Tool use lines from providers arrive as emoji + filename text chunks embedded
// in the assistant message content (e.g. "📖 train.py\n✏️ objectives.py\n").
// When there are many consecutive tool lines, they create an ugly "brick" of
// noise. This preprocessor detects runs of 3+ consecutive tool lines and
// collapses them into a single summary line like "🔧 8 tool uses".
//
// The collapsed summary preserves the full list as a tooltip (title attribute)
// via a custom markdown paragraph component.
// =============================================================================

// Matches lines that are tool-emoji labels from our providers.
// Pattern: emoji (possibly with variation selector) + space + text
const TOOL_LINE_RE = /^(?:📖|✍️|✏️|⚡|💻|📂|🔍|🌐|📓|📝|🔧|▶️|📦|🔀|📁|🔒|🗑️|❌)\s+\S/;

/** Minimum consecutive tool lines before collapsing */
const COLLAPSE_THRESHOLD = 3;

/**
 * Pre-process message content to collapse long runs of tool-use lines.
 * Runs of COLLAPSE_THRESHOLD+ consecutive tool lines are replaced with
 * a summary. Shorter runs are left as-is.
 */
function collapseToolLines(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let toolRun: string[] = [];

  const flushRun = () => {
    if (toolRun.length >= COLLAPSE_THRESHOLD) {
      // Count by emoji type for a richer summary
      const counts = new Map<string, number>();
      for (const line of toolRun) {
        // Extract first emoji (may be multi-codepoint)
        const emojiMatch = line.match(/^(\S+)\s/);
        const emoji = emojiMatch?.[1] ?? '🔧';
        counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
      }
      const parts: string[] = [];
      for (const [emoji, count] of counts) {
        parts.push(`${emoji}×${count}`);
      }
      result.push(`\`${parts.join(' ')}\` ${toolRun.length} tool uses`);
    } else {
      result.push(...toolRun);
    }
    toolRun = [];
  };

  for (const line of lines) {
    // Keep oompa run widget trigger lines visible (not collapsed into summaries).
    const isOompaRun = OOMPA_RUN_TOOL_FRAGMENT_RE.test(line);

    if (!isOompaRun && TOOL_LINE_RE.test(line)) {
      toolRun.push(line);
    } else {
      flushRun();
      result.push(line);
    }
  }
  flushRun();

  return result.join('\n');
}

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

function CodeBlockFrame({
  children,
  rawCode,
  ...preProps
}: ComponentPropsWithoutRef<'pre'> & { rawCode: string | null }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!rawCode) return;

    // copyText falls back to execCommand when navigator.clipboard is absent
    // (non-secure context, e.g. the dev server over a LAN IP).
    const copied = await copyText(rawCode);
    if (!copied) {
      console.warn('[VirtualizedMessageList] Failed to copy code block');
      return;
    }
    setCopied(true);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [rawCode]);

  return (
    <div className="message-code-block">
      {rawCode && (
        <button
          type="button"
          className={`message-code-copy-btn${copied ? ' copied' : ''}`}
          onClick={handleCopy}
          title={copied ? 'Copied' : 'Copy code'}
          aria-label={copied ? 'Code copied' : 'Copy code'}
        >
          {copied ? (
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
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
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
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      )}
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
                    <span className="path-block-text-line">{entry.text}</span>
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

// =============================================================================
// Memoized Message Rendering
// =============================================================================

interface MemoizedMessageProps {
  msg: Message;
  className: string;
  forwardedRef?: React.RefObject<HTMLDivElement | null>;
  workingDirectory: string;
}

const MemoizedMessage = memo(
  function MemoizedMessage({
    msg,
    className,
    forwardedRef,
    workingDirectory,
  }: MemoizedMessageProps) {
    // katex + highlight.js arrive asynchronously; markdown renders immediately
    // with the remark plugins and re-renders once the chunk lands.
    const rehypePlugins = useLazyMarkdownPlugins();

    // Collapse consecutive tool-emoji lines in assistant messages to reduce noise.
    // User/system messages pass through unchanged.
    const displayContent = useMemo(() => {
      const content =
        msg.role === 'assistant' ? collapseToolLines(msg.content || '...') : msg.content || '...';
      return normalizeLatexDelimiters(content);
    }, [msg.content, msg.role]);

    const reviewRequest = useMemo(
      () => (msg.role === 'user' ? parseBuddyReviewRequest(displayContent) : null),
      [displayContent, msg.role]
    );

    // Split content into text + AskUserQuestion widget segments
    const segments = useMemo(
      () => (reviewRequest ? [] : splitStructuredMessageContent(displayContent)),
      [displayContent, reviewRequest]
    );
    const hasWidget = segments.some((s) => s.type !== 'text');
    const hasReviewResult = segments.some((s) => s.type === 'buddy_review_result');
    const roleLabel = reviewRequest
      ? 'review request'
      : hasReviewResult && segments.every((segment) => segment.type === 'buddy_review_result')
        ? 'review response'
        : msg.role;

    // Memoize markdown components keyed on workingDirectory so react-markdown
    // gets a stable reference and doesn't re-mount its component tree.
    const mdComponents = useMemo(
      () => makeMarkdownComponents(workingDirectory),
      [workingDirectory]
    );

    return (
      <div className={className} ref={forwardedRef}>
        {msg.role !== 'system' && <div className={`message-role ${msg.role}`}>{roleLabel}</div>}
        <div className="message-content">
          {reviewRequest ? (
            <BuddyReviewRequestCard request={reviewRequest} />
          ) : hasWidget ? (
            // Mixed content: interleave Markdown and interactive widgets
            segments.map((seg, i) => {
              if (seg.type === 'text') {
                const trimmed = seg.content.trim();
                if (!trimmed) return null;
                return (
                  <Markdown
                    key={i}
                    remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                    rehypePlugins={rehypePlugins}
                    components={mdComponents}
                  >
                    {trimmed}
                  </Markdown>
                );
              }
              if (seg.type === 'oompa_run') {
                return <InlineSwarmRunWidget key={i} workingDirectory={workingDirectory} />;
              }
              if (seg.type === 'buddy_review_result') {
                const result = parseBuddyReviewResult(seg.json);
                return result ? (
                  <BuddyReviewResultCard key={i} result={result} />
                ) : (
                  <code key={i}>Buddy review result (parse error)</code>
                );
              }
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
            <Markdown
              remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
              rehypePlugins={rehypePlugins}
              components={mdComponents}
            >
              {displayContent}
            </Markdown>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.msg.content === next.msg.content &&
      prev.msg.role === next.msg.role &&
      prev.className === next.className &&
      prev.forwardedRef === next.forwardedRef &&
      prev.workingDirectory === next.workingDirectory
    );
  }
);

// =============================================================================
// Message Group Types
// =============================================================================

export type MessageGroup =
  | { type: 'single'; messages: Message[] }
  /** Two or more consecutive assistant messages that are purely tool-call lines */
  | { type: 'tool_calls'; messages: Message[] };

/**
 * Returns true if the message is an assistant turn consisting entirely of
 * tool-emoji lines (no explanatory prose). Used to group consecutive tool-only
 * turns into a single collapsible block. Oompa launch lines are excluded so
 * the inline swarm widget stays visible instead of disappearing into the
 * generic "N tool calls" accordion.
 */
export function isToolCallOnlyMessage(msg: Message): boolean {
  if (msg.role !== 'assistant') return false;
  const content = msg.content?.trim() ?? '';
  if (!content) return false;
  if (OOMPA_RUN_TOOL_FRAGMENT_RE.test(content)) return false;
  return content
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .every((l) => TOOL_LINE_RE.test(l.trim()));
}

interface VirtualizedMessageListProps {
  messageGroups: MessageGroup[];
  isRunning: boolean;
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
  if (group.type === 'tool_calls') return 36; // collapsed button height

  let totalHeight = 0;
  for (const msg of group.messages) {
    const contentLength = msg.content?.length ?? 0;
    // Rough estimate: ~50px base + 20px per 100 chars
    const estimatedHeight = 80 + Math.ceil(contentLength / 100) * 20;
    totalHeight += Math.min(estimatedHeight, 600); // Cap at reasonable max
  }
  return Math.max(totalHeight, 60);
}

export function VirtualizedMessageList({
  messageGroups,
  isRunning,
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

  const visibleSwarmDebugPrefix = effectiveSwarmDebugPrefix(buddyContext, swarmDebugPrefix);
  const contextItemCount = (buddyContext ? 1 : 0) + (visibleSwarmDebugPrefix ? 1 : 0);
  const totalItems = messageGroups.length + contextItemCount;
  const estimatedInitialOffset = useMemo(() => {
    let total = 0;
    if (buddyContext) total += 88;
    if (visibleSwarmDebugPrefix) total += 80;
    for (const group of messageGroups) total += estimateGroupSize(group);
    return total;
  }, [buddyContext, messageGroups, visibleSwarmDebugPrefix]);

  const virtualizer = useVirtualizer({
    count: totalItems,
    getScrollElement: () => parentRef.current,
    // Conversations open at the newest message. Starting the virtualizer at
    // offset zero briefly rendered the oldest item before the layout effect
    // scrolled down; a large first prompt could spend hundreds of milliseconds
    // in Markdown parsing even though the user never saw it.
    initialOffset: () => estimatedInitialOffset,
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
          className="virtual-list-inner"
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
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// CollapsedToolCallsGroup: Shows N tool-only assistant messages as a single
// collapsible row. Collapsed by default to reduce noise.
// =============================================================================

interface CollapsedToolCallsGroupProps {
  messages: Message[];
  isLastGroup: boolean;
  lastMessageRef: React.RefObject<HTMLDivElement | null>;
  workingDirectory: string;
}

function CollapsedToolCallsGroup({
  messages,
  isLastGroup,
  lastMessageRef,
  workingDirectory,
}: CollapsedToolCallsGroupProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-calls-group">
      <button
        type="button"
        className={`tool-calls-toggle-btn${expanded ? ' expanded' : ''}`}
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="tool-calls-icon">⚡</span>
        <span className="tool-calls-count">{messages.length} tool calls</span>
        <span className="tool-calls-chevron">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="tool-calls-expanded">
          {messages.map((msg, mi) => {
            const isLastMessage = isLastGroup && mi === messages.length - 1;
            return (
              <MemoizedMessage
                key={mi}
                msg={msg}
                className={`message ${msg.role}`}
                forwardedRef={isLastMessage ? lastMessageRef : undefined}
                workingDirectory={workingDirectory}
              />
            );
          })}
        </div>
      )}
    </div>
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
}

const VirtualizedGroup = memo(
  function VirtualizedGroup({
    group,
    isLastGroup,
    lastMessageRef,
    workingDirectory,
  }: VirtualizedGroupProps) {
    if (group.type === 'tool_calls') {
      return (
        <CollapsedToolCallsGroup
          messages={group.messages}
          isLastGroup={isLastGroup}
          lastMessageRef={lastMessageRef}
          workingDirectory={workingDirectory}
        />
      );
    }

    return (
      <>
        {group.messages.map((msg, mi) => {
          const isLastMessage = isLastGroup && mi === group.messages.length - 1;
          return (
            <MemoizedMessage
              key={mi}
              msg={msg}
              className={`message ${msg.role}`}
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
    return true;
  }
);
