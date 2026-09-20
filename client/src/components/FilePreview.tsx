/**
 * FilePreview — inline file path preview for images, HTML, video, and markdown in chat messages.
 *
 * Detects file paths (in inline code) ending in previewable extensions and renders
 * them as: icon + clickable link + hover popup preview.
 *
 * Supports both absolute paths (`/data/runs/.../00000.png`) and relative paths
 * (`test_outputs/ssim_debug/render_00000.png`). Relative paths require at least
 * one `/` directory separator to avoid false-matching bare filenames in prose.
 * When a `workingDirectory` prop is provided, relative paths are resolved against
 * it for the API URL while the original relative path is displayed as link text.
 *
 * The popup renders via React Portal to document.body so it escapes parent
 * overflow:hidden / overflow:auto containers (e.g. .messages-container).
 *
 * Wired into react-markdown via the `code` component override in
 * VirtualizedMessageList.tsx.
 */

import type { ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { resource, usePolledFetch } from '../hooks/usePolledFetch';
import './FilePreview.css';

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp)$/i;
const HTML_EXTENSIONS = /\.(html|htm)$/i;
const MARKDOWN_EXTENSIONS = /\.(md|markdown)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm)$/i;
const POSIX_ABSOLUTE_FILE_RE = /^\/(?:Users|home|private|var|tmp|mnt)\//;
const WINDOWS_ABSOLUTE_FILE_RE = /^\/[A-Za-z]:\//;

export type PreviewableFileType = 'image' | 'html' | 'video' | 'markdown';

/**
 * Returns 'image' | 'html' | 'video' | 'markdown' | null for a given text string.
 * Matches absolute paths (`/foo/bar.png`) and relative paths with at least one
 * directory separator (`test_outputs/render.png`). Bare filenames like `foo.png`
 * are rejected to avoid false-matching inline code in prose.
 *
 * IMPORTANT: This function handles SINGLE-LINE text only. Multi-line code blocks
 * must go through classifyPathBlock() in VirtualizedMessageList.tsx, which calls
 * getPreviewType per-line. Do NOT remove the newline guard below — it is defense
 * in depth against a bug where a multi-line code block like:
 *
 *   ```
 *   /path/to/img1.png
 *   /path/to/img2.png
 *   ...
 *   /path/to/img3.png
 *   ```
 *
 * was passed as ONE string to this function. Since the string has no spaces,
 * contains "/", and ends with ".png", it matched — rendering the entire block
 * as a single FilePreview (all paths collapsed into one line, no hover).
 */
export function getPreviewType(text: string): PreviewableFileType | null {
  // DO NOT REMOVE: Rejects multi-line and whitespace text. See docstring above.
  if (text.includes(' ') || text.includes('\n')) return null;
  // Must contain at least one `/` (absolute or relative with directory)
  if (!text.includes('/')) return null;
  if (IMAGE_EXTENSIONS.test(text)) return 'image';
  if (VIDEO_EXTENSIONS.test(text)) return 'video';
  if (HTML_EXTENSIONS.test(text)) return 'html';
  if (MARKDOWN_EXTENSIONS.test(text)) return 'markdown';
  return null;
}

function isLoopbackLikeHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

function looksLikeAbsoluteFilePath(pathname: string): boolean {
  return POSIX_ABSOLUTE_FILE_RE.test(pathname) || WINDOWS_ABSOLUTE_FILE_RE.test(pathname);
}

/**
 * Recognizes previewable local-file links that were rendered as ordinary anchors,
 * such as:
 * - http://localhost:7489/Users/nick/project/output.png
 * - /api/files?path=/Users/nick/project/output.png
 * - /api/serve/Users/nick/project/report.html
 */
export function getPreviewableLocalHref(
  href: string
): { path: string; type: PreviewableFileType } | null {
  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(href, baseOrigin);

    let pathFromHref: string | null = null;
    if (url.pathname === '/api/files') {
      pathFromHref = url.searchParams.get('path');
    } else if (url.pathname.startsWith('/api/serve/')) {
      pathFromHref = decodeURIComponent(url.pathname.slice('/api/serve'.length));
    } else if (isLoopbackLikeHostname(url.hostname)) {
      const decodedPath = decodeURIComponent(url.pathname);
      if (looksLikeAbsoluteFilePath(decodedPath)) {
        pathFromHref = decodedPath;
      }
    }

    if (!pathFromHref) return null;
    const type = getPreviewType(pathFromHref);
    return type ? { path: pathFromHref, type } : null;
  } catch {
    return null;
  }
}

interface FilePreviewProps {
  path: string;
  type: PreviewableFileType;
  /** When set, relative paths are resolved against this directory for the API URL. */
  workingDirectory?: string;
  /** Optional custom text/content for the clickable link. */
  linkLabel?: ReactNode;
}

const TYPE_ICONS = { image: '🖼', html: '🌐', video: '🎬', markdown: '📝' } as const;

/** Gap in px between the trigger element and the popup */
const POPUP_GAP = 8;

/** Minimum margin from viewport edges */
const VIEWPORT_MARGIN = 12;

interface PopupPosition {
  top: number;
  left: number;
  placement: 'above' | 'below';
}

export function FilePreview({ path, type, workingDirectory, linkLabel }: FilePreviewProps) {
  // Resolve relative paths against workingDirectory for the API URL.
  // Display text stays as the original `path` the user wrote.
  const resolvedPath = path.startsWith('/') ? path : `${workingDirectory}/${path}`;
  // HTML files use path-based /api/serve/ so relative assets (videos, images, CSS)
  // resolve naturally from the file's directory. The query-param /api/files proxy
  // breaks relative paths since the browser sees the URL as /api/files, not the
  // file's actual directory.
  const fileUrl =
    type === 'html'
      ? `/api/serve${resolvedPath}`
      : `/api/files?path=${encodeURIComponent(resolvedPath)}`;
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const markdownSource = useMemo(
    () =>
      resource(`text:${fileUrl}`, async (signal: AbortSignal) => {
        const response = await fetch(fileUrl, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      }),
    [fileUrl]
  );
  const markdown = usePolledFetch<string>(markdownSource, 0, hovered && type === 'markdown');
  const markdownContent = markdown.data;
  const markdownError = markdown.error?.message ?? null;

  const handleMouseEnter = () => {
    const rect = triggerRef.current!.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;

    // Default: place above the trigger. If too close to top, place below.
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placement = spaceAbove > spaceBelow ? 'above' : 'below';

    setPosition({
      top: placement === 'above' ? rect.top - POPUP_GAP : rect.bottom + POPUP_GAP,
      left: Math.max(VIEWPORT_MARGIN, Math.min(centerX, window.innerWidth - VIEWPORT_MARGIN)),
      placement,
    });
    setHovered(true);
  };

  const handleMouseLeave = () => {
    setHovered(false);
  };

  const popup =
    hovered &&
    position &&
    createPortal(
      <div
        className="file-preview-popup"
        style={{
          // 'above': popup bottom edge aligns to `position.top` (above trigger)
          // 'below': popup top edge aligns to `position.top` (below trigger)
          ...(position.placement === 'above'
            ? { bottom: `${window.innerHeight - position.top}px` }
            : { top: `${position.top}px` }),
          left: `${position.left}px`,
        }}
      >
        {type === 'image' && <img className="file-preview-image" src={fileUrl} alt={path} />}
        {type === 'video' && (
          <video className="file-preview-video" src={fileUrl} autoPlay loop muted playsInline />
        )}
        {type === 'html' && (
          <iframe className="file-preview-iframe" src={fileUrl} sandbox="" title={path} />
        )}
        {type === 'markdown' && (
          <div className="file-preview-markdown">
            {markdownError ? (
              <div className="file-preview-markdown-status">{markdownError}</div>
            ) : markdownContent === null ? (
              <div className="file-preview-markdown-status">Loading preview...</div>
            ) : (
              <Markdown remarkPlugins={[remarkGfm]}>{markdownContent}</Markdown>
            )}
          </div>
        )}
        <span className="file-preview-path">{path}</span>
      </div>,
      document.body
    );

  return (
    <span
      className="file-preview"
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span className="file-preview-icon">{TYPE_ICONS[type]}</span>
      <a className="file-preview-link" href={fileUrl} target="_blank" rel="noreferrer">
        {linkLabel ?? path}
      </a>
      {popup}
    </span>
  );
}
