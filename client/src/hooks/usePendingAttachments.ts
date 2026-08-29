/**
 * usePendingAttachments — canonical attachment lifecycle shared by desktop
 * Chat.tsx and mobile ComposerMobile.tsx. Do not duplicate inline attach state.
 *
 * Owns the refs-only persistence (pending:{conversationId}) + debounce/flush
 * discipline and revokeObjectURL on remove/clear/unmount, so future readers
 * don't reintroduce preview leaks or duplicate upload framing. Pair with
 * useConversationDraft.ts (pagehide / visibilitychange / HMR flush).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PENDING_FILES_KEY_PREFIX } from '../atoms/ui';

// ---------------------------------------------------------------------------
// PendingFile — canonical attachment type shared by desktop Chat.tsx and
// mobile ComposerMobile.tsx. One definition, one upload path, one framing.
// ---------------------------------------------------------------------------

export interface PendingFile {
  originalName: string;
  absolutePath: string;
  mimeType: string;
  size: number;
  previewUrl: string | null;
}

export const EMPTY_PENDING: PendingFile[] = [];

// ---------------------------------------------------------------------------
// Pure helpers — no React, so both trees plus any future surface can reuse
// the same message framing and clipboard extraction without reaching into
// component internals.
// ---------------------------------------------------------------------------

/** Builds the provider payload: "[Attached files]\n<paths>\n\n<text>". */
export function buildAttachedContent(textContent: string, pendingFiles: PendingFile[]): string {
  if (pendingFiles.length === 0) return textContent;
  let content = '[Attached files]\n';
  for (const file of pendingFiles) content += `${file.absolutePath}\n`;
  if (textContent) content += '\n';
  content += textContent;
  return content;
}

/** Extracts File objects from a DataTransfer / clipboard item list. */
export function extractFilesFromClipboardItems(
  items: DataTransferItemList | null | undefined
): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

function loadStoredPendingFiles(conversationId: string): PendingFile[] {
  const key = `${PENDING_FILES_KEY_PREFIX}${conversationId}`;
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return EMPTY_PENDING;
    const parsed = JSON.parse(stored) as Array<Omit<PendingFile, 'previewUrl'>>;
    return parsed.map((f) => ({ ...f, previewUrl: null }));
  } catch (e) {
    console.warn('[usePendingAttachments] Failed to load pending files:', e);
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return EMPTY_PENDING;
  }
}

function persistPendingFiles(conversationId: string, files: PendingFile[]): void {
  const key = `${PENDING_FILES_KEY_PREFIX}${conversationId}`;
  try {
    if (files.length === 0) localStorage.removeItem(key);
    else {
      const toStore = files.map(({ previewUrl: _previewUrl, ...f }) => f);
      localStorage.setItem(key, JSON.stringify(toStore));
    }
  } catch {
    // quota / private-mode — in-memory state still updates
  }
}

// ---------------------------------------------------------------------------
// Upload transport — retries the dev hot-reload drain window.
// ---------------------------------------------------------------------------

export interface UploadedFileDescriptor {
  originalName: string;
  absolutePath: string;
  mimeType: string;
  size: number;
}

/**
 * Backoff schedule for a retryable upload rejection, in ms.
 *
 * Sized against a real dev restart, not a reconnect blip: the server refuses
 * every non-GET with 503 `server_draining` while `state === 'reloading'`
 * (server.ts), then the replacement process refuses with `server_starting`
 * until it finishes rehydrating persisted conversations. A single ~1s retry
 * lands squarely inside that second window and fails anyway; ~7s of total
 * patience covers a normal restart.
 */
export const UPLOAD_RETRY_BACKOFF_MS = [750, 1500, 2500, 4000, 6000, 8000, 10000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A rejection is retryable when the server says so. Both drain codes carry
 * `retryable: true`; the bare 503 check covers a proxy that swallows the body.
 */
function isRetryableUploadRejection(
  status: number,
  payload: { error?: string; retryable?: boolean }
): boolean {
  return (
    payload.retryable === true ||
    payload.error === 'server_draining' ||
    payload.error === 'server_starting' ||
    status === 503
  );
}

/**
 * POST the attachments, retrying only while the server reports a drain.
 *
 * SUBTLE — the retry counter lives HERE and not as a defaulted second parameter
 * on the hook's callback. `handleFilesUpload` is handed straight to
 * react-dropzone as `onDrop` (Chat.tsx), and react-dropzone invokes it as
 * `onDrop(acceptedFiles, fileRejections, event)`. A `(files, attempt = 0)`
 * signature therefore receives `fileRejections` (an array) as `attempt` on every
 * drag-and-drop, so an `attempt === 0` guard is false on the first try and the
 * retry silently never runs — paste retried, drag did not. TypeScript cannot
 * catch it: the hook's public type declares one parameter, and a 1-arg function
 * is assignable to a 3-arg callback slot. Keep the public callback unary.
 *
 * `fetchImpl`/`sleepImpl` are seams for the regression test only.
 */
export async function uploadFilesWithDrainRetry(
  conversationId: string,
  acceptedFiles: File[],
  fetchImpl: typeof fetch = fetch,
  sleepImpl: (ms: number) => Promise<unknown> = sleep
): Promise<{ files: UploadedFileDescriptor[] }> {
  let lastError = '';
  for (let attempt = 0; attempt <= UPLOAD_RETRY_BACKOFF_MS.length; attempt += 1) {
    const formData = new FormData();
    formData.append('conversationId', conversationId);
    for (const file of acceptedFiles) formData.append('files', file);

    const response = await fetchImpl('/api/upload', { method: 'POST', body: formData });
    if (response.ok) return (await response.json()) as { files: UploadedFileDescriptor[] };

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      retryable?: boolean;
    };
    lastError = payload.error ?? response.statusText;
    const backoff = UPLOAD_RETRY_BACKOFF_MS[attempt];
    if (backoff === undefined || !isRetryableUploadRejection(response.status, payload)) break;
    await sleepImpl(backoff);
  }
  throw new Error(`Upload failed: ${lastError}`);
}

// ---------------------------------------------------------------------------
// Hook — stateful pending-files lifecycle shared by desktop + mobile.
// ---------------------------------------------------------------------------

export interface UsePendingAttachmentsReturn {
  pendingFiles: PendingFile[];
  isUploading: boolean;
  hasFiles: boolean;
  handleFilesUpload: (acceptedFiles: File[]) => Promise<void>;
  /**
   * Last upload failure, or null. Both shells MUST render this: a drop that
   * fails is otherwise indistinguishable from a drop that was ignored, which
   * is exactly how the 2026-08-20 hot-reload drain reported itself ("drag and
   * drop stopped working"). Cleared when the next upload starts.
   */
  uploadError: string | null;
  dismissUploadError: () => void;
  removeFile: (absolutePath: string) => void;
  clearFiles: () => void;
  buildContent: (textContent: string) => string;
  handlePaste: (e: React.ClipboardEvent) => Promise<void>;
}

export function usePendingAttachments(
  conversationId: string | null | undefined
): UsePendingAttachmentsReturn {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>(EMPTY_PENDING);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Track latest for unmount-only revocation without re-running the effect.
  const pendingFilesRef = useRef(pendingFiles);
  pendingFilesRef.current = pendingFiles;

  // Load from localStorage when conversation switches.
  useEffect(() => {
    if (!conversationId) {
      setPendingFiles(EMPTY_PENDING);
      return;
    }
    setPendingFiles(loadStoredPendingFiles(conversationId));
  }, [conversationId]);

  // Revoke object URLs only on unmount — per-file revocation happens in
  // removeFile / clearFiles. This mirrors Chat.tsx's original unmount-only
  // effect that was introduced to stop leaking URLs on every addition.
  useEffect(() => {
    return () => {
      for (const file of pendingFilesRef.current) {
        if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      }
    };
  }, []);

  // Unary by contract — this is handed straight to react-dropzone as `onDrop`,
  // which calls it with (acceptedFiles, fileRejections, event). Never add a
  // second parameter here; see uploadFilesWithDrainRetry for why.
  const handleFilesUpload = useCallback(
    async (acceptedFiles: File[]) => {
      if (!conversationId || acceptedFiles.length === 0) return;
      setIsUploading(true);
      setUploadError(null);
      try {
        const result = await uploadFilesWithDrainRetry(conversationId, acceptedFiles);
        const withPreviews: PendingFile[] = result.files.map((uploaded, i) => ({
          ...uploaded,
          previewUrl: acceptedFiles[i]?.type.startsWith('image/')
            ? URL.createObjectURL(acceptedFiles[i])
            : null,
        }));

        setPendingFiles((prev) => {
          const next = [...prev, ...withPreviews];
          persistPendingFiles(conversationId, next);
          return next;
        });
      } catch (err) {
        // Surfaced, not just logged — see the uploadError contract above.
        console.error('[usePendingAttachments] File upload failed:', err);
        const detail = err instanceof Error ? err.message : String(err);
        setUploadError(
          `${detail}. ${acceptedFiles.length === 1 ? 'The file was' : 'The files were'} not attached — try again.`
        );
      } finally {
        setIsUploading(false);
      }
    },
    [conversationId]
  );

  const removeFile = useCallback(
    (absolutePath: string) => {
      setPendingFiles((prev) => {
        const target = prev.find((f) => f.absolutePath === absolutePath);
        if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
        const next = prev.filter((f) => f.absolutePath !== absolutePath);
        if (conversationId) persistPendingFiles(conversationId, next);
        return next;
      });
    },
    [conversationId]
  );

  const dismissUploadError = useCallback(() => setUploadError(null), []);

  const clearFiles = useCallback(() => {
    setPendingFiles((prev) => {
      for (const file of prev) if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return EMPTY_PENDING;
    });
    if (conversationId) {
      try {
        localStorage.removeItem(`${PENDING_FILES_KEY_PREFIX}${conversationId}`);
      } catch {
        // ignore
      }
    }
  }, [conversationId]);

  const buildContent = useCallback(
    (textContent: string) => buildAttachedContent(textContent, pendingFiles),
    [pendingFiles]
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const files = extractFilesFromClipboardItems(e.clipboardData?.items);
      if (files.length > 0) {
        e.preventDefault();
        await handleFilesUpload(files);
      }
    },
    [handleFilesUpload]
  );

  return {
    pendingFiles,
    isUploading,
    hasFiles: pendingFiles.length > 0,
    handleFilesUpload,
    uploadError,
    dismissUploadError,
    removeFile,
    clearFiles,
    buildContent,
    handlePaste,
  };
}
