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
// Hook — stateful pending-files lifecycle shared by desktop + mobile.
// ---------------------------------------------------------------------------

export interface UsePendingAttachmentsReturn {
  pendingFiles: PendingFile[];
  isUploading: boolean;
  hasFiles: boolean;
  handleFilesUpload: (acceptedFiles: File[]) => Promise<void>;
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

  const handleFilesUpload = useCallback(
    async (acceptedFiles: File[]) => {
      if (!conversationId || acceptedFiles.length === 0) return;
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append('conversationId', conversationId);
        for (const file of acceptedFiles) formData.append('files', file);

        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!response.ok) {
          const error = (await response.json()) as { error?: string };
          throw new Error(`Upload failed: ${error.error ?? response.statusText}`);
        }
        const result = (await response.json()) as {
          files: Array<{ originalName: string; absolutePath: string; mimeType: string; size: number }>;
        };
        const withPreviews: PendingFile[] = result.files.map((uploaded, i) => ({
          ...uploaded,
          previewUrl: acceptedFiles[i]?.type.startsWith('image/') ? URL.createObjectURL(acceptedFiles[i]) : null,
        }));

        setPendingFiles((prev) => {
          const next = [...prev, ...withPreviews];
          persistPendingFiles(conversationId, next);
          return next;
        });
      } catch (err) {
        console.error('[usePendingAttachments] File upload failed:', err);
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
    removeFile,
    clearFiles,
    buildContent,
    handlePaste,
  };
}
