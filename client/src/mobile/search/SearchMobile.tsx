import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { conversationAtomFamily } from '../../atoms/conversations';
import { mobileConversationRouteState } from '../../utils/conversation-route-state';
import { formatTimeAgo, getConversationLastActivity } from '../../utils/time';
import { mobileSearchResultsAtom, mobileSearchStateAtom } from '../atoms/search';
import {
  MobileCardLink,
  MobileEmptyPanel,
  MobilePage,
  MobileSection,
  MobileSurface,
} from '../components/MobileUI';
import '../styles/search-mobile.css';

const IDLE_RESULT_LIMIT = 20;
const SEARCH_RESULT_LIMIT = 30;
const DEEP_RESULT_LIMIT = 20;

// Server deep-search hit shape (GET /api/search?q=)
interface ServerHit {
  conversationId: string;
  messageIndex: number;
  role: string;
  snippet: string;
  workingDirectory: string;
  timestamp: string;
}

interface GroupedHit {
  conversationId: string;
  workingDirectory: string;
  hits: ServerHit[];
  latestTs: number;
}

function ClientResultRow({
  id,
  routeState,
}: {
  id: string;
  routeState: Record<string, unknown>;
}) {
  const conv = useAtomValue(conversationAtomFamily(id));
  if (!conv) return null;
  const lastMsg = conv.messages[conv.messages.length - 1];
  const preview = lastMsg ? lastMsg.content.substring(0, 180) : 'No messages yet';
  const roleBadge = lastMsg ? lastMsg.role : '—';
  const timeAgo = formatTimeAgo(getConversationLastActivity(conv));
  const shortDir = conv.workingDirectory.replace(/^\/Users\/[^/]+/, '~') || conv.id.slice(0, 8);
  return (
    <MobileCardLink
      className="mobile-search-row"
      to={`/chat/${encodeURIComponent(conv.id)}`}
      state={routeState}
    >
      <div className="mobile-search-row__top">
        <span className="mobile-search-row__dir" title={conv.workingDirectory}>
          {shortDir}
        </span>
        <span className="mobile-search-row__role">{roleBadge}</span>
        <span className="mobile-search-row__time">{timeAgo}</span>
      </div>
      <div className="mobile-search-row__snippet">{preview}</div>
    </MobileCardLink>
  );
}

function ServerGroupCard({
  group,
  routeState,
}: {
  group: GroupedHit;
  routeState: Record<string, unknown>;
}) {
  const timeAgo = formatTimeAgo(new Date(group.latestTs));
  const shortDir =
    group.workingDirectory.replace(/^\/Users\/[^/]+/, '~') || group.conversationId.slice(0, 8);
  return (
    <MobileSurface className="mobile-search-group">
      <Link
        className="mobile-search-group__header"
        to={`/chat/${encodeURIComponent(group.conversationId)}`}
        state={routeState}
      >
        <span className="mobile-search-group__dir" title={group.workingDirectory}>
          {shortDir}
        </span>
        <span className="mobile-search-group__count">
          {group.hits.length} hit{group.hits.length !== 1 ? 's' : ''}
        </span>
        <span className="mobile-search-group__time">{timeAgo}</span>
      </Link>
      <div className="mobile-search-group__hits">
        {group.hits.slice(0, 3).map((h, idx) => (
          <Link
            key={idx}
            className="mobile-search-hit"
            to={`/chat/${encodeURIComponent(h.conversationId)}`}
            state={routeState}
          >
            <span className="mobile-search-hit__role">{h.role}</span>
            <span className="mobile-search-hit__snippet">{h.snippet}</span>
          </Link>
        ))}
        {group.hits.length > 3 && (
          <span className="mobile-search-hit__more">+{group.hits.length - 3} more</span>
        )}
      </div>
    </MobileSurface>
  );
}

export function SearchMobile() {
  const [searchState, setSearchState] = useAtom(mobileSearchStateAtom);
  const clientResults = useAtomValue(mobileSearchResultsAtom);
  const location = useLocation();
  const routeState = useMemo(() => mobileConversationRouteState(location), [location]);

  const query = searchState.kind === 'searching' ? searchState.query : '';

  // Deep history via GET /api/search?q= (PLANNING §4 hybrid). Debounced 300ms.
  const [serverHits, setServerHits] = useState<ServerHit[]>([]);
  const [serverLoading, setServerLoading] = useState(false);

  useEffect(() => {
    if (searchState.kind !== 'searching' || query.trim().length < 2) {
      setServerHits([]);
      setServerLoading(false);
      return;
    }
    const q = query.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setServerLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`Search failed (${res.status})`);
          return res.json();
        })
        .then((data: { results: ServerHit[] }) => {
          setServerHits(data.results ?? []);
          setServerLoading(false);
        })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setServerHits([]);
            setServerLoading(false);
          }
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchState.kind]);

  const groupedServerHits = useMemo((): GroupedHit[] => {
    const map = new Map<string, GroupedHit>();
    for (const h of serverHits) {
      const ts = new Date(h.timestamp).getTime();
      const existing = map.get(h.conversationId);
      if (!existing) {
        map.set(h.conversationId, {
          conversationId: h.conversationId,
          workingDirectory: h.workingDirectory,
          hits: [h],
          latestTs: ts,
        });
      } else {
        existing.hits.push(h);
        if (ts > existing.latestTs) existing.latestTs = ts;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latestTs - a.latestTs);
  }, [serverHits]);

  const onInputChange = (value: string) => {
    if (value.trim().length === 0) {
      setSearchState({ kind: 'idle' });
    } else {
      setSearchState({ kind: 'searching', query: value });
    }
  };

  const visibleClientLimit = searchState.kind === 'idle' ? IDLE_RESULT_LIMIT : SEARCH_RESULT_LIMIT;
  const hiddenClientCount = Math.max(0, clientResults.length - visibleClientLimit);
  const metaLabel =
    searchState.kind === 'idle'
      ? `Showing ${Math.min(clientResults.length, IDLE_RESULT_LIMIT)} recent conversations`
      : `${clientResults.length} conversation${clientResults.length === 1 ? '' : 's'} matched`;

  return (
    <MobilePage
      title="Search"
      subtitle="Find a conversation or search message history."
      className="mobile-search"
    >
      <div className="mobile-search__header">
        <input
          type="search"
          className="mobile-search__input"
          placeholder="Search conversations…"
          value={query}
          onChange={(e) => onInputChange(e.target.value)}
          autoFocus
          aria-label="Search conversations"
          enterKeyHint="search"
        />
        {query && (
          <button
            type="button"
            className="mobile-search__clear"
            onClick={() => onInputChange('')}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div className="mobile-search__meta" aria-live="polite">
        {metaLabel}
      </div>

      {/* Client-filtered results (fuzzyMatch over workingDirectory + preview) */}
      <MobileSection
        title={searchState.kind === 'idle' ? 'Recent conversations' : 'On this device'}
      >
        {clientResults.length === 0 ? (
          <MobileEmptyPanel>No matches on this device.</MobileEmptyPanel>
        ) : (
          <div className="mobile-search__list">
            {clientResults.slice(0, visibleClientLimit).map((conv) => (
              <ClientResultRow key={conv.id} id={conv.id} routeState={routeState} />
            ))}
            {hiddenClientCount > 0 && (
              <div className="mobile-search__limit-note">
                {searchState.kind === 'idle'
                  ? `Search to browse ${clientResults.length.toLocaleString()} conversations`
                  : `${hiddenClientCount.toLocaleString()} more matches — refine your search`}
              </div>
            )}
          </div>
        )}
      </MobileSection>

      {/* Deep history via /api/search?q= — dispatcher on MobileSearchState.kind */}
      {searchState.kind === 'searching' && query.trim().length >= 2 && (
        <MobileSection
          title="Deep history"
          meta={serverLoading ? 'Searching…' : `${groupedServerHits.length} conversations`}
        >
          {serverLoading && serverHits.length === 0 ? (
            <MobileEmptyPanel>Searching history…</MobileEmptyPanel>
          ) : groupedServerHits.length === 0 ? (
            <MobileEmptyPanel>No deep-history matches.</MobileEmptyPanel>
          ) : (
            <div className="mobile-search__list">
              {groupedServerHits.slice(0, DEEP_RESULT_LIMIT).map((g) => (
                <ServerGroupCard key={g.conversationId} group={g} routeState={routeState} />
              ))}
            </div>
          )}
        </MobileSection>
      )}
      {searchState.kind === 'searching' && query.trim().length === 1 && (
        <div className="mobile-search__hint">
          Type one more character to search full message history.
        </div>
      )}
    </MobilePage>
  );
}
