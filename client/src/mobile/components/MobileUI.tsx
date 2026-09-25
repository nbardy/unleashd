import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

type MobilePageProps = PropsWithChildren<{
  title: string;
  subtitle?: ReactNode;
  className?: string;
  headerAside?: ReactNode;
}>;

export function MobilePage({ title, subtitle, className, headerAside, children }: MobilePageProps) {
  return (
    <main className={classes('mobile-ui-page', className)}>
      <header className="mobile-ui-page__header">
        <div className="mobile-ui-page__heading">
          <h1 className="mobile-ui-page__title">{title}</h1>
          {subtitle != null ? (
            <p className="mobile-ui-page__subtitle ui-muted">{subtitle}</p>
          ) : null}
        </div>
        {headerAside != null ? <div className="mobile-ui-page__aside">{headerAside}</div> : null}
      </header>
      {children}
    </main>
  );
}

type MobileSectionProps = PropsWithChildren<{
  title?: ReactNode;
  meta?: ReactNode;
  className?: string;
}>;

export function MobileSection({ title, meta, className, children }: MobileSectionProps) {
  return (
    <section className={classes('mobile-ui-section', className)}>
      {title != null || meta != null ? (
        <header className="mobile-ui-section__header">
          {title != null ? <h2 className="mobile-ui-section__title">{title}</h2> : null}
          {meta != null ? (
            <span className="mobile-ui-section__meta ui-truncate">{meta}</span>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function MobileCardButton({
  className,
  type = 'button',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type={type}
      className={classes('mobile-ui-card ui-card', 'mobile-ui-card--button', className)}
    >
      {children}
    </button>
  );
}

export function MobileCardLink({ className, children, ...props }: LinkProps) {
  return (
    <Link
      {...props}
      className={classes('mobile-ui-card ui-card', 'mobile-ui-card--button', className)}
    >
      {children}
    </Link>
  );
}

/**
 * Primary action in a page header — the "+ New" affordance on Chats, Swarms and
 * Buddies. Sized to the 44px tap target so it stays reachable one-handed.
 */
export function MobileHeaderAction({
  className,
  type = 'button',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      type={type}
      className={classes('mobile-ui-header-action ui-control ui-inline-row', className)}
    >
      {children}
    </button>
  );
}

export function MobileSurface({
  className,
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div {...props} className={classes('mobile-ui-card ui-card', className)}>
      {children}
    </div>
  );
}

type MobileBadgeProps = PropsWithChildren<
  HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'active' | 'accent' }
>;

export function MobileBadge({ tone = 'neutral', className, children, ...props }: MobileBadgeProps) {
  return (
    <span
      {...props}
      className={classes(
        'mobile-ui-badge ui-inline-row ui-card ui-muted',
        `mobile-ui-badge--${tone}`,
        className
      )}
    >
      {children}
    </span>
  );
}

export function MobilePath({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={classes('mobile-ui-path ui-truncate ui-muted', className)}>
      {children}
    </span>
  );
}

/**
 * A background refresh failed while the page still shows what loaded before
 * (a `stale` PolledState, hooks/usePolledFetch.ts). Quiet on purpose: what is
 * on screen is still right to read, only possibly behind. A failure replaces
 * the page only when nothing ever loaded (`failed`).
 */
export function MobileRefreshNotice({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <p className="mobile-muted ui-muted">
      <output>Could not refresh: {error.message}</output>{' '}
      <button type="button" className="mobile-link ui-inline-row" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

export function MobileEmptyPanel({
  className,
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div {...props} className={classes('mobile-ui-empty-panel ui-muted', className)}>
      {children}
    </div>
  );
}
