import type { ConversationRow } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useId } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { listField } from '../../atoms/conversations';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { shortenHomePath } from '../../utils/directories';
import { ContextBadge, ContextSection } from './ContextSection';
import './ResumeSource.css';

/**
 * The thread this one was forked from (Chat "Fork" soft handoff,
 * `resumedFrom`). It does NOT mean the CLI inherited a provider session — that
 * only happens when source and target share a FORK_CAPABLE_PROVIDERS provider.
 *
 * `icon` (desktop header): a fork glyph with a hover/focus tooltip.
 * `card` (mobile pane): a "Resumed from" card that opens the source.
 * Both link only when the source is still in the client's list (AGENTS.md:
 * every "open this conversation" affordance is availability-checked).
 */
export interface ResumeSourceProps {
  presentation: 'icon' | 'card';
  sourceConversationId: string;
  sourceConversation: ConversationRow | null;
}

interface ResumeSourceFacts {
  sourceConversationId: string;
  displayId: string;
  available: boolean;
  provider: string | null;
  folder: string | null;
}

export function ResumeSource({
  presentation,
  sourceConversationId,
  sourceConversation,
}: ResumeSourceProps) {
  const facts: ResumeSourceFacts = {
    sourceConversationId,
    displayId: sourceConversationId.substring(0, 8),
    available: useAtomValue(listField('idSet')).has(sourceConversationId),
    provider: sourceConversation?.provider ?? null,
    folder: sourceConversation ? shortenHomePath(sourceConversation.cwd) : null,
  };
  return presentation === 'icon' ? <ResumeIcon facts={facts} /> : <ResumeCard facts={facts} />;
}

function ResumeCard({ facts }: { facts: ResumeSourceFacts }) {
  const location = useLocation();
  const card = (
    <div className="ui-surface ui-card ui-row context-card">
      <span className="resume-card__icon" aria-hidden="true">
        ↩
      </span>
      <div className="context-card__body">
        <div className="context-card__title">
          {facts.displayId}
          {facts.provider ? (
            <ContextBadge tone="neutral" className="resume-card__provider">
              {facts.provider}
            </ContextBadge>
          ) : null}
        </div>
        {facts.folder ? <div className="context-card__meta ui-truncate">{facts.folder}</div> : null}
      </div>
      <span className="resume-card__open" aria-hidden="true">
        {facts.available ? 'Open ›' : 'Unavailable'}
      </span>
    </div>
  );
  return (
    <ContextSection title="Resumed from">
      {facts.available ? (
        <Link
          className="resume-card__link"
          to={`/chat/${facts.sourceConversationId}`}
          state={mobileConversationRouteState(location)}
        >
          {card}
        </Link>
      ) : (
        card
      )}
    </ContextSection>
  );
}

function ResumeIcon({ facts }: { facts: ResumeSourceFacts }) {
  const tooltipId = useId();
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
      {facts.available ? (
        <Link
          className="resume-thread-widget__trigger ui-control ui-inline-row ui-muted"
          to={`/chat/${facts.sourceConversationId}`}
          aria-label={`Forked from ${facts.displayId}. Open source thread`}
          aria-describedby={tooltipId}
        >
          {icon}
        </Link>
      ) : (
        <button
          type="button"
          className="resume-thread-widget__trigger ui-control ui-inline-row ui-muted"
          aria-label={`Forked from ${facts.displayId}. Source thread unavailable`}
          aria-describedby={tooltipId}
        >
          {icon}
        </button>
      )}
      <span className="resume-thread-widget__tooltip" id={tooltipId} role="tooltip">
        <strong>Forked from {facts.displayId}</strong>
        {facts.provider ? <span>{facts.provider}</span> : null}
        {facts.folder ? <span>{facts.folder}</span> : null}
        <span>{facts.available ? 'Click to open source thread' : 'Source thread unavailable'}</span>
      </span>
    </span>
  );
}
