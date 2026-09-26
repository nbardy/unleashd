import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './SwarmPage.css';

/**
 * The device variant of every swarm view. The route table in App.tsx picks it
 * (desktop tree → 'wide', mobile tree → 'narrow'); a view never calls
 * useDeviceKind. Where a view differs by device it looks the variant up in a
 * `Record<SwarmLayout, …>`, so a new layout is a type error at every site.
 */
export type SwarmLayout = 'wide' | 'narrow';

export interface SwarmBack {
  to: string;
  label: string;
}

/** Page frame shared by the three swarm screens: back link, title, actions. */
export function SwarmPage({
  layout,
  back,
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  layout: SwarmLayout;
  back: SwarmBack | null;
  title: ReactNode;
  subtitle: ReactNode;
  actions: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <div className={`swarm-page ui-stack ${className}`} data-layout={layout}>
      <header className="swarm-page-header ui-row">
        {back && (
          <Link className="swarm-page-back ui-control ui-inline-row" to={back.to}>
            ← {back.label}
          </Link>
        )}
        <div className="swarm-page-title ui-stack">
          <h2 className="ui-truncate">{title}</h2>
          {subtitle && <span className="swarm-page-subtitle ui-muted ui-truncate">{subtitle}</span>}
        </div>
        <div className="swarm-page-actions ui-row">{actions}</div>
      </header>
      <div className="swarm-page-body ui-stack">{children}</div>
    </div>
  );
}
