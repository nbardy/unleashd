import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buddyApi } from '../../components/buddies/api';
import type { BuddyOverview } from '../../components/buddies/types';
import { buddyCardMetrics, selectDirectoryEmployees } from '../../components/buddies/ui-contract';
import { createBuddyViaBuilder } from '../atoms/create';
import { EmptyState } from '../components/EmptyState';
import { MobileCardButton, MobileHeaderAction, MobilePage } from '../components/MobileUI';

/**
 * BuddiesMobile — directory at /buddies (mobile @ /buddies).
 *
 * - Data via GET /api/buddies/overview through buddyApi (components/buddies/api.ts).
 * - Shaping via components/buddies/buddies-shaping + ui-contract:
 *   selectDirectoryEmployees owns directory membership; buddyCardMetrics owns
 *   per-card stat projection. Relationship→manager/directReports is derived
 *   inside buddies-shaping (deriveBuddyHierarchy) and already folded into
 *   EmployeeRecord for detail — directory cards surface team size via shaping.
 * - Filter/sort via shaping helpers (directory list is sorted alphabetically;
 *   active filter uses plain string match over the shaped list — no raw field
 *   branching inside the handler).
 * - Tap → /buddies/:buddyId (canonical route, no /m prefix — see §3).
 *
 * No import of desktop components or their CSS (§6, §8).
 */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

type SortKey = 'name' | 'active';

export function BuddiesMobile() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<BuddyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    buddyApi<BuddyOverview>('/api/buddies/overview', { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setOverview(payload);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const employees = useMemo(() => {
    if (!overview) return [];
    return selectDirectoryEmployees(overview);
  }, [overview]);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return employees;
    return employees.filter((entry) => {
      const haystack =
        `${entry.buddy.name} ${entry.buddy.role} ${entry.workspaces.map((w) => w.name).join(' ')}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [employees, query]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    if (sortKey === 'active') {
      // Sort by active work desc, then name asc — uses shaped currentWork metrics
      next.sort((a, b) => {
        const diff = b.currentWork.active - a.currentWork.active;
        if (diff !== 0) return diff;
        return a.buddy.name.localeCompare(b.buddy.name);
      });
    } else {
      next.sort((a, b) => a.buddy.name.localeCompare(b.buddy.name));
    }
    return next;
  }, [filtered, sortKey]);

  const openBuilder = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      navigate(`/chat/${await createBuddyViaBuilder()}`);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
      setCreating(false);
    }
  };

  // The page shell is constant across loading/error/empty/populated so the
  // "+ New" action never disappears — the empty state is precisely when a user
  // needs it, and hiding it behind an early return is what made mobile look
  // like it had no create affordance at all.
  const shell = (body: ReactNode, subtitle: string) => (
    <MobilePage
      title="Buddies"
      subtitle={subtitle}
      className="mobile-buddies"
      headerAside={
        <MobileHeaderAction
          onClick={() => void openBuilder()}
          disabled={creating}
          aria-label="New buddy"
        >
          {creating ? 'Opening…' : '+ New'}
        </MobileHeaderAction>
      }
    >
      {createError && (
        <div className="mobile-sheet__error" role="alert">
          {createError}
        </div>
      )}
      {body}
    </MobilePage>
  );

  if (loading) {
    return shell(
      <output className="mobile-buddies__status" aria-live="polite" aria-busy="true">
        <p className="mobile-empty__message">Loading buddies…</p>
      </output>,
      'Loading…'
    );
  }

  if (error) {
    return shell(
      <EmptyState
        icon="⚠"
        title="Could not load buddies"
        message={error}
        actionLabel="Retry"
        onAction={() => window.location.reload()}
      />,
      'Unavailable'
    );
  }

  if (!overview || employees.length === 0) {
    return shell(
      <EmptyState
        icon="◎"
        title="No buddies yet"
        message="Tap + New to open the Buddy Builder — it interviews you and sets one up."
        actionLabel={creating ? 'Opening…' : 'New buddy'}
        onAction={() => void openBuilder()}
      />,
      'No buddies'
    );
  }

  return shell(
    <>
      <div className="mobile-buddies__controls">
        <label className="mobile-search__field" aria-label="Filter buddies">
          <input
            type="search"
            inputMode="search"
            placeholder="Filter buddies…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mobile-search__input"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="mobile-buddies__sort" aria-label="Sort buddies">
          <span className="mobile-buddies__sort-label">Sort</span>
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className="mobile-buddies__sort-select"
          >
            <option value="name">Name</option>
            <option value="active">Active work</option>
          </select>
        </label>
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon="⌕" message={`No buddies match “${query.trim()}”.`} />
      ) : (
        <ul className="mobile-buddies__grid">
          {sorted.map((entry) => {
            const metrics = buddyCardMetrics(entry);
            return (
              <li key={entry.buddy.id}>
                <MobileCardButton
                  className="mobile-buddy-card"
                  onClick={() => navigate(`/buddies/${encodeURIComponent(entry.buddy.id)}`)}
                  aria-label={`Open ${entry.buddy.name}, ${entry.buddy.role}`}
                >
                  <div className="mobile-buddy-card__head">
                    <span className="mobile-buddy-card__avatar" aria-hidden="true">
                      {initials(entry.buddy.name)}
                    </span>
                    <div className="mobile-buddy-card__identity">
                      <strong className="mobile-buddy-card__name">{entry.buddy.name}</strong>
                      <span className="mobile-buddy-card__role">{entry.buddy.role}</span>
                      <span
                        className={`mobile-buddy-card__presence mobile-buddy-card__presence--${entry.buddy.status}`}
                      >
                        {entry.buddy.status}
                      </span>
                    </div>
                  </div>

                  {entry.workspaces.length > 0 && (
                    <div className="mobile-buddy-card__chips" aria-label="Workspaces">
                      {entry.workspaces.map((workspace) => (
                        <span key={workspace.id} className="mobile-buddy-card__chip">
                          {workspace.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mobile-buddy-card__stats" aria-label="Work metrics via shaping">
                    <span className="mobile-buddy-card__stat">
                      <strong>{metrics.team}</strong>
                      <span>team</span>
                    </span>
                    <span className="mobile-buddy-card__stat">
                      <strong>{metrics.open}</strong>
                      <span>open</span>
                    </span>
                    <span className="mobile-buddy-card__stat">
                      <strong>{metrics.active}</strong>
                      <span>active</span>
                    </span>
                    <span className="mobile-buddy-card__stat">
                      <strong>{metrics.blocked}</strong>
                      <span>blocked</span>
                    </span>
                  </div>
                </MobileCardButton>
              </li>
            );
          })}
        </ul>
      )}
    </>,
    `${employees.length} buddies`
  );
}
