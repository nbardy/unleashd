import { useCallback, useEffect, useRef, useState } from 'react';
import { useBuddyOverview } from '../hooks/useBuddyData';
import { formatTimeAgo } from '../utils/time';
import type { BuddyOverview } from './buddies/types';
import { directoryEntries, filterDirectoryEntries } from './buddies/ui-contract';
import './SearchPalette.css';

interface SearchResult {
  conversationId: string;
  messageIndex: number;
  role: string;
  snippet: string;
  workingDirectory: string;
  timestamp: Date;
}

interface SearchResultResponse {
  conversationId: string;
  messageIndex: number;
  role: string;
  snippet: string;
  workingDirectory: string;
  timestamp: string;
}

interface SearchApiResponse {
  results: SearchResultResponse[];
  query: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (id: string) => void;
  onSelectBuddy: (id: string) => void;
  /** When set, only search conversations whose workingDirectory starts with this path */
  filterDirectory?: string;
}

const MAX_RESULTS = 50;
const MIN_SEARCH_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 150;

function SearchResultIcon({ kind }: { kind: 'buddy' | 'chat' }) {
  if (kind === 'buddy') {
    return (
      <svg
        aria-hidden="true"
        className="search-result-icon search-result-icon--buddy"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
      >
        <circle cx="8" cy="5" r="2.25" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M3.5 13c.55-2.2 2.05-3.3 4.5-3.3s3.95 1.1 4.5 3.3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="search-result-icon search-result-icon--chat"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M3 3.25h10a1 1 0 0 1 1 1v6.1a1 1 0 0 1-1 1H8l-2.8 1.9v-1.9H3a1 1 0 0 1-1-1v-6.1a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <path d="M5 6.5h6M5 8.75h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function highlightMatch(snippet: string, query: string): React.ReactNode[] {
  if (!query) return [snippet];

  const lowerSnippet = snippet.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  let searchFrom = 0;
  while (searchFrom < lowerSnippet.length) {
    const matchIndex = lowerSnippet.indexOf(lowerQuery, searchFrom);
    if (matchIndex === -1) break;

    if (matchIndex > lastIndex) {
      parts.push(snippet.substring(lastIndex, matchIndex));
    }
    parts.push(
      <mark key={matchIndex} className="search-highlight">
        {snippet.substring(matchIndex, matchIndex + query.length)}
      </mark>
    );
    lastIndex = matchIndex + query.length;
    searchFrom = lastIndex;
  }

  if (lastIndex < snippet.length) {
    parts.push(snippet.substring(lastIndex));
  }

  return parts;
}

const NO_BUDDIES: BuddyOverview = [];

export function SearchPalette({
  isOpen,
  onClose,
  onSelectConversation,
  onSelectBuddy,
  filterDirectory,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Debounce query by 150ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Reset on open
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setDebouncedQuery('');
    setResults([]);
    setSelectedIndex(0);
    setSearchError(null);
    setIsSearching(false);
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  // Buddy names and roles are a small directory projection, filtered locally
  // alongside deep chat search. Same cache key the Sidebar polls, so opening
  // the palette reads what is already in memory.
  const overview = useBuddyOverview(0, isOpen && !filterDirectory);
  const buddyDirectory = overview.data ?? NO_BUDDIES;

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const params = new URLSearchParams({
      q: trimmed,
      limit: String(MAX_RESULTS),
    });
    if (filterDirectory) {
      params.set('filterDirectory', filterDirectory);
    }

    const controller = new AbortController();
    setIsSearching(true);
    setSearchError(null);
    setResults([]);

    const runSearch = async () => {
      try {
        const response = await fetch(`/api/search?${params.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          const message = data?.error ?? `Search failed with status ${response.status}`;
          throw new Error(message);
        }

        const data = (await response.json().catch(() => null)) as SearchApiResponse | null;
        const apiResults = Array.isArray(data?.results) ? data.results : [];
        const normalizedResults = apiResults.map((result: SearchResultResponse) => ({
          ...result,
          timestamp: new Date(result.timestamp),
        }));
        setResults(normalizedResults);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setSearchError(error instanceof Error ? error.message : 'Search failed');
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    runSearch();
    return () => {
      controller.abort();
    };
  }, [debouncedQuery, filterDirectory]);

  const buddyResults =
    filterDirectory || debouncedQuery.trim().length < MIN_SEARCH_QUERY_LENGTH
      ? []
      : filterDirectoryEntries(directoryEntries(buddyDirectory), debouncedQuery);

  // Reset selection when results change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on result count change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length, buddyResults.length]);

  // Scroll selected item into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const selected = container.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          if (!buddyResults.length && !results.length) return;
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, buddyResults.length + results.length - 1));
          break;
        case 'ArrowUp':
          if (!buddyResults.length && !results.length) return;
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (buddyResults[selectedIndex]) {
            onSelectBuddy(buddyResults[selectedIndex].buddy.id);
            onClose();
          } else if (results[selectedIndex - buddyResults.length]) {
            onSelectConversation(results[selectedIndex - buddyResults.length].conversationId);
            onClose();
          }
          break;
        case 'Escape':
          onClose();
          break;
      }
    },
    [buddyResults, results, selectedIndex, onSelectBuddy, onSelectConversation, onClose]
  );

  if (!isOpen) return null;

  const folderName = (dir: string) => dir.split('/').filter(Boolean).pop() ?? dir;

  return (
    <div className="search-palette-overlay" onClick={onClose}>
      <div className="search-palette" onClick={(e) => e.stopPropagation()}>
        <div className="search-palette-input-row">
          <svg
            role="img"
            aria-label="Search"
            className="search-palette-icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <line
              x1="11"
              y1="11"
              x2="14.5"
              y2="14.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-palette-input"
            placeholder={
              filterDirectory
                ? `Search in ${filterDirectory.split('/').filter(Boolean).pop()}...`
                : 'Search Buddies and conversations...'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <kbd className="search-palette-shortcut">esc</kbd>
        </div>
        <div className="search-palette-results" ref={resultsRef}>
          {isSearching && buddyResults.length === 0 && results.length === 0 ? (
            <div className="search-palette-empty">Searching…</div>
          ) : searchError && buddyResults.length === 0 && results.length === 0 ? (
            <div className="search-palette-empty">{searchError}</div>
          ) : buddyResults.length > 0 || results.length > 0 ? (
            <>
              {buddyResults.map((employee, i) => (
                <div
                  key={`buddy-${employee.buddy.id}`}
                  className={`search-result-item search-result-item--buddy ${i === selectedIndex ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectBuddy(employee.buddy.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <SearchResultIcon kind="buddy" />
                  <div className="search-result-content">
                    <div className="search-result-header">
                      <span className="search-result-kind">Buddy</span>
                      <span className="search-result-folder">{employee.buddy.name}</span>
                      <span className="search-result-time">{employee.buddy.status}</span>
                    </div>
                    <div className="search-result-snippet">
                      {highlightMatch(employee.buddy.role, debouncedQuery.trim())}
                    </div>
                  </div>
                </div>
              ))}
              {results.map((result, i) => (
                <div
                  key={`${result.conversationId}-${result.messageIndex}`}
                  className={`search-result-item search-result-item--chat ${i + buddyResults.length === selectedIndex ? 'selected' : ''}`}
                  onClick={() => {
                    onSelectConversation(result.conversationId);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(i + buddyResults.length)}
                >
                  <SearchResultIcon kind="chat" />
                  <div className="search-result-content">
                    <div className="search-result-header">
                      <span className="search-result-kind">Chat</span>
                      <span className="search-result-folder">
                        {folderName(result.workingDirectory)}
                      </span>
                      <span className={`search-result-role search-result-role--${result.role}`}>
                        {result.role}
                      </span>
                      <span className="search-result-time">{formatTimeAgo(result.timestamp)}</span>
                    </div>
                    <div className="search-result-snippet">
                      {highlightMatch(result.snippet, debouncedQuery.trim())}
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : debouncedQuery.trim().length >= MIN_SEARCH_QUERY_LENGTH ? (
            <div className="search-palette-empty">No matches found</div>
          ) : (
            <div className="search-palette-empty">
              Type at least {MIN_SEARCH_QUERY_LENGTH} characters to search
            </div>
          )}
        </div>
        {results.length >= MAX_RESULTS && (
          <div className="search-palette-footer">
            Showing first {MAX_RESULTS} results — refine your query for more
          </div>
        )}
      </div>
    </div>
  );
}
