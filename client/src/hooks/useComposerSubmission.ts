/**
 * useComposerSubmission — the one send path for desktop Chat.tsx and mobile
 * ComposerMobile.tsx. Do not reintroduce per-shell send/restore handlers.
 *
 * A submission is a VALUE addressed to the conversation it came FROM. It is not
 * re-derived from whatever composer state happens to be on screen when the
 * server finally answers. Two 2026-09-20 defects came from the older shape and
 * are unrepresentable against this type:
 *
 *  - Taking a submission clears text AND attachments together, so the composer
 *    is genuinely `empty` afterwards. Previously only the text was cleared, so
 *    `pendingFiles.length > 0` kept both the empty-guard false and the Send
 *    button enabled: an attachment with no text was queued twice by clicking
 *    again before the ack. A submit latch would also hide this; making the take
 *    total removes the second submission instead of racing it.
 *
 *  - A rejection returns the submission to `submission.conversationId`.
 *    Previously it called the live draft setter, which writes through to
 *    whichever conversation the composer is bound to NOW — and `/chat/:id`
 *    renders one <Chat /> across param changes (App.tsx), so a reconnect after
 *    the user moved on pasted the old thread's text into the new thread and
 *    overwrote its draft. `rejectPendingMessageCommands` (atoms/actions.ts)
 *    settles every in-flight command at once, so this is the common path on a
 *    reconnect, not a corner case.
 */
import { useCallback, useState } from 'react';
import type { UseConversationDraftReturn } from './useConversationDraft';
import type { PendingFile, UsePendingAttachmentsReturn } from './usePendingAttachments';
import { buildAttachedContent } from './usePendingAttachments';

export interface FilledSubmission {
  kind: 'filled';
  /** The conversation this text was typed into — the address a rejection returns to. */
  conversationId: string;
  text: string;
  files: PendingFile[];
}

/** `empty` is a state with its own handler, not an absence the caller must test for. */
export type ComposerSubmission = { kind: 'empty' } | FilledSubmission;

export type SubmitOutcome =
  | { kind: 'idle' }
  | { kind: 'sent' }
  | { kind: 'rejected'; message: string };

const EMPTY_SUBMISSION: ComposerSubmission = { kind: 'empty' };
const IDLE: SubmitOutcome = { kind: 'idle' };
const SENT: SubmitOutcome = { kind: 'sent' };

/** Canonicalise composer state into the submission domain. The only place that decides "is there anything to send". */
export function takeComposerSubmission(
  conversationId: string | null | undefined,
  text: string,
  files: PendingFile[]
): ComposerSubmission {
  if (!conversationId) return EMPTY_SUBMISSION;
  const trimmed = text.trim();
  if (!trimmed && files.length === 0) return EMPTY_SUBMISSION;
  return { kind: 'filled', conversationId, text: trimmed, files };
}

export interface ComposerEffects {
  /** Clears text and attachments together, in the view and in storage. */
  clear(): void;
  deliver(conversationId: string, content: string): Promise<void>;
  /** Returns the submission to ITS conversation, regardless of what is on screen. */
  restore(submission: FilledSubmission): void;
}

/**
 * Pure send sequence — no React, so the regression tests exercise the real
 * ordering rather than a rendered composer. See client/test/composer-submission.test.ts.
 */
export async function runComposerSubmission(
  submission: ComposerSubmission,
  effects: ComposerEffects
): Promise<SubmitOutcome> {
  if (submission.kind === 'empty') return IDLE;
  effects.clear();
  try {
    await effects.deliver(
      submission.conversationId,
      buildAttachedContent(submission.text, submission.files)
    );
    return SENT;
  } catch (error) {
    effects.restore(submission);
    return { kind: 'rejected', message: error instanceof Error ? error.message : String(error) };
  }
}

export type ComposerDeliver = (conversationId: string, content: string) => Promise<void>;

export interface UseComposerSubmissionReturn {
  submit: (deliver: ComposerDeliver) => Promise<void>;
  /** Last rejection, or null. Both shells render this. */
  error: string | null;
  setError: (message: string | null) => void;
}

export function useComposerSubmission(
  conversationId: string | null | undefined,
  draft: UseConversationDraftReturn,
  attachments: UsePendingAttachmentsReturn
): UseComposerSubmissionReturn {
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (deliver: ComposerDeliver) => {
      const submission = takeComposerSubmission(
        conversationId,
        draft.getDraft(),
        attachments.pendingFiles
      );
      setError(null);
      const outcome = await runComposerSubmission(submission, {
        clear: () => {
          draft.clear();
          attachments.clearFiles();
        },
        deliver,
        restore: (filled) => {
          draft.restoreDraft(filled.conversationId, filled.text);
          attachments.restoreFiles(filled.conversationId, filled.files);
        },
      });
      if (outcome.kind === 'rejected') setError(outcome.message);
    },
    [conversationId, draft, attachments]
  );

  return { submit, error, setError };
}
