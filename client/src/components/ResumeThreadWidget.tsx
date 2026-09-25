import type { Conversation } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { availableConversationIdSetAtom } from '../atoms/conversations';
import './ResumeThreadWidget.css';
import { shortenHomePath } from '../utils/directories';

/**
 * UI badge for Chat "Fork" soft-handoff lineage (`resumedFromConversationId`).
 *
 * Shows which conversation this thread was forked from. It does NOT mean the
 * CLI inherited a provider session — that only happens when source and target
 * share a FORK_CAPABLE_PROVIDERS provider. Soft handoff context lives in the
 * draft / first message (historically a pasted transcript).
 */
interface ResumeThreadWidgetProps {
  sourceConversationId: string;
  sourceConversation: Conversation | null;
}

export function ResumeThreadWidget({
  sourceConversationId,
  sourceConversation,
}: ResumeThreadWidgetProps) {
  const tooltipId = useId();
  const sourceAvailable = useAtomValue(availableConversationIdSetAtom).has(sourceConversationId);
  const displayId = sourceConversationId.substring(0, 8);
  const folder = sourceConversation && shortenHomePath(sourceConversation.workingDirectory);
  const icon = (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M6 7v10M18 7v2a4 4 0 0 1-4 4H6" />
    </svg>
  );

  return (
    <span className="resume-thread-widget">
      {sourceAvailable ? (
        <Link
          className="resume-thread-widget__trigger ui-inline-row ui-muted"
          to={`/chat/${sourceConversationId}`}
          aria-label={`Forked from ${displayId}. Open source thread`}
          aria-describedby={tooltipId}
        >
          {icon}
        </Link>
      ) : (
        <button
          type="button"
          className="resume-thread-widget__trigger ui-inline-row ui-muted"
          aria-label={`Forked from ${displayId}. Source thread unavailable`}
          aria-describedby={tooltipId}
        >
          {icon}
        </button>
      )}
      <span className="resume-thread-widget__tooltip" id={tooltipId} role="tooltip">
        <strong>Forked from {displayId}</strong>
        {sourceConversation?.provider && <span>{sourceConversation.provider}</span>}
        {folder && <span>{folder}</span>}
        <span>{sourceAvailable ? 'Click to open source thread' : 'Source thread unavailable'}</span>
      </span>
    </span>
  );
}
