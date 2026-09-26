import type { ReactNode } from 'react';
import './ContextSection.css';

/**
 * The titled block a thread-context panel sits in when it is drawn as cards
 * (the mobile pane). Desktop panels are headerless strips, so only the `card`
 * presentations of the views in this folder use it.
 */
export function ContextSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <header className="ui-section__header">
        <h2 className="ui-section__title">{title}</h2>
        {meta ? <span className="ui-section__meta ui-truncate">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

export type ContextBadgeTone = 'neutral' | 'active' | 'accent';

export function ContextBadge({
  tone,
  className = '',
  children,
}: {
  tone: ContextBadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`ui-badge ui-badge--${tone} ui-inline-row ui-card ui-muted ${className}`}>
      {children}
    </span>
  );
}
