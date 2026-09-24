import { useAtomValue } from 'jotai';
import { type ReactNode, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { initials } from '../../components/buddies/ui-contract';
import { useBuddyOverview } from '../../hooks/useBuddyData';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { type BuddyDirectorySort, mobileBuddyDirectoryAtom } from '../atoms/buddies';
import { createBuddyViaBuilder } from '../atoms/create';
import { EmptyState } from '../components/EmptyState';
import { MobileHeaderAction, MobilePage } from '../components/MobileUI';

export function BuddiesMobile() {
  const navigate = useNavigate();
  const location = useLocation();
  const chatRouteState = useMemo(() => mobileConversationRouteState(location), [location]);
  const { data: overview, loading, error, refetch } = useBuddyOverview();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<BuddyDirectorySort>('project');
  const directoryAtom = useMemo(
    () => mobileBuddyDirectoryAtom(overview, query, sortKey),
    [overview, query, sortKey]
  );
  const { groups, total, matched } = useAtomValue(directoryAtom);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const openBuilder = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      navigate(`/chat/${await createBuddyViaBuilder()}`, { state: chatRouteState });
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

  if (loading && !overview) {
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
        message={error.message}
        actionLabel="Retry"
        onAction={refetch}
      />,
      'Unavailable'
    );
  }

  if (!overview || total === 0) {
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
            placeholder="Search buddies…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mobile-search__input"
            aria-label="Search buddies or projects"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="mobile-buddies__sort" aria-label="Sort buddies">
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as BuddyDirectorySort)}
            className="mobile-buddies__sort-select"
            aria-label="Group buddies"
          >
            <option value="project">Project</option>
            <option value="recent">Recent</option>
          </select>
        </label>
      </div>

      {matched === 0 ? (
        <EmptyState icon="⌕" message={`No buddies match “${query.trim()}”.`} />
      ) : (
        groups.map((group) => (
          <section className="mobile-buddies__group" key={group.id} aria-label={group.name}>
            <h2 className="mobile-buddies__group-heading">
              {group.name}
              <span>{group.employees.length}</span>
            </h2>
            <ul className="mobile-buddies__grid">
              {group.employees.map((entry) => (
                <li key={entry.buddy.id}>
                  <Link
                    className="mobile-buddy-card"
                    to={`/buddies/${encodeURIComponent(entry.buddy.id)}`}
                  >
                    <span className="mobile-buddy-card__avatar" aria-hidden="true">
                      {initials(entry.buddy.name)}
                    </span>
                    <span className="mobile-buddy-card__identity">
                      <strong className="mobile-buddy-card__name">{entry.buddy.name}</strong>
                      <span className="mobile-buddy-card__role">{entry.buddy.role}</span>
                      {(entry.currentWork.blocked > 0 ||
                        entry.currentWork.active > 0 ||
                        entry.buddy.status !== 'active') && (
                        <span
                          className="mobile-buddy-card__activity"
                          data-blocked={entry.currentWork.blocked > 0 || undefined}
                        >
                          {entry.currentWork.blocked > 0
                            ? `${entry.currentWork.blocked} blocked`
                            : entry.currentWork.active > 0
                              ? `${entry.currentWork.active} in progress`
                              : entry.buddy.status}
                        </span>
                      )}
                    </span>
                    <span className="mobile-buddy-card__chevron" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>,
    `${total} ${total === 1 ? 'buddy' : 'buddies'}`
  );
}
