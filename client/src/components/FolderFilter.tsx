/**
 * FolderFilter - Folder filter with Ctrl+P style fuzzy search.
 *
 * - Shows most recent 8 folders by default
 * - "N older folders" expander shows the rest
 * - Fuzzy search filters folders by name (characters match in order, not contiguously)
 * - Results sorted by fuzzy match score (best match first)
 * - Matched characters highlighted in results
 * - When conversations provided, also fuzzy-matches conversation messages
 *   and shows matching conversations below folder chips
 * - Empty selection = all items shown
 *
 * Fuzzy matching follows Ctrl+P convention: typing "font" matches "font-maker"
 * because f-o-n-t appear in order. Consecutive matches and word-boundary matches
 * score higher, so exact substring matches rank above scattered matches.
 */

import type { Conversation } from '@unleashd/shared';
import { useMemo, useState } from 'react';
import { readConversation } from '../atoms/actions';
import { fuzzyMatch, highlightMatches } from '../utils/fuzzyMatch';
import './FolderFilter.css';

const VISIBLE_COUNT = 8;
const MAX_CONVERSATION_RESULTS = 5;

interface FolderFilterProps {
  /** Folders in display order (most recent first) */
  folders: string[];
  selected: Set<string>;
  onToggle: (folder: string) => void;
  onClear: () => void;
  formatFolder?: (folder: string) => string;
  /** Optional: conversations (ids) whose messages the search also fuzzy-matches */
  conversationIds?: readonly string[];
  /** Optional: callback when a conversation is selected from search results */
  onSelectConversation?: (conversationId: string) => void;
}

interface FolderMatch {
  folder: string;
  score: number;
  matches: number[];
  /** Whether matches are on the formatted name (true) or raw path (false) */
  matchedFormatted: boolean;
}

interface ConversationMatch {
  conversation: Conversation;
  score: number;
  /** Snippet of the matched message content */
  snippet: string;
  /** Match indices into the snippet */
  matches: number[];
}

export function FolderFilter({
  folders,
  selected,
  onToggle,
  onClear,
  formatFolder,
  conversationIds,
  onSelectConversation,
}: FolderFilterProps) {
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);

  const format = formatFolder ?? ((f: string) => f);
  const isSearching = search.trim().length > 0;

  // Fuzzy-match folders by search term, sorted by score
  const matchedFolders = useMemo((): FolderMatch[] => {
    if (!isSearching) {
      // No search: return all folders with no match metadata
      return folders.map((f) => ({ folder: f, score: 0, matches: [], matchedFormatted: false }));
    }
    const query = search.trim();
    const results: FolderMatch[] = [];

    for (const folder of folders) {
      // Try matching against the formatted display name first (e.g. ~/projects/foo)
      const formatted = format(folder);
      const fmtResult = fuzzyMatch(query, formatted);
      // Also try matching against the raw path (e.g. /Users/nick/projects/foo)
      const rawResult = fuzzyMatch(query, folder);

      // Pick whichever scores higher
      if (fmtResult && rawResult) {
        if (fmtResult.score >= rawResult.score) {
          results.push({
            folder,
            score: fmtResult.score,
            matches: fmtResult.matches,
            matchedFormatted: true,
          });
        } else {
          results.push({
            folder,
            score: rawResult.score,
            matches: rawResult.matches,
            matchedFormatted: false,
          });
        }
      } else if (fmtResult) {
        results.push({
          folder,
          score: fmtResult.score,
          matches: fmtResult.matches,
          matchedFormatted: true,
        });
      } else if (rawResult) {
        results.push({
          folder,
          score: rawResult.score,
          matches: rawResult.matches,
          matchedFormatted: false,
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }, [folders, search, isSearching, format]);

  // Fuzzy-match conversations by message content
  const matchedConversations = useMemo((): ConversationMatch[] => {
    if (!isSearching || !conversationIds || !onSelectConversation) return [];
    const query = search.trim();
    const results: ConversationMatch[] = [];

    // A snapshot per keystroke, not a subscription: the gallery must not
    // re-render on every conversation event just because search is possible.
    for (const id of conversationIds) {
      const conv = readConversation(id);
      if (!conv) continue;
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestSnippet = '';
      let bestMatches: number[] = [];

      // Match against working directory basename
      const dirName = conv.workingDirectory.split('/').filter(Boolean).pop() ?? '';
      const dirResult = fuzzyMatch(query, dirName);
      if (dirResult && dirResult.score > bestScore) {
        bestScore = dirResult.score;
        bestSnippet = dirName;
        bestMatches = dirResult.matches;
      }

      // Match against message content (check last 10 messages for performance)
      const recentMessages = conv.messages.slice(-10);
      for (const msg of recentMessages) {
        // Try matching against the first 200 chars of content
        const content = msg.content.substring(0, 200);
        const result = fuzzyMatch(query, content);
        if (result && result.score > bestScore) {
          bestScore = result.score;
          // Build a snippet around the first match
          const firstIdx = result.matches[0];
          const snippetStart = Math.max(0, firstIdx - 20);
          const snippetEnd = Math.min(content.length, firstIdx + 80);
          const rawSnippet = content.substring(snippetStart, snippetEnd);
          // Adjust match indices relative to snippet
          const adjustedMatches = result.matches
            .filter((i) => i >= snippetStart && i < snippetEnd)
            .map((i) => i - snippetStart);
          bestSnippet =
            (snippetStart > 0 ? '...' : '') +
            rawSnippet +
            (snippetEnd < content.length ? '...' : '');
          // Offset adjusted matches if we prepended "..."
          bestMatches = snippetStart > 0 ? adjustedMatches.map((i) => i + 3) : adjustedMatches;
        }
      }

      if (bestScore > Number.NEGATIVE_INFINITY) {
        results.push({
          conversation: conv,
          score: bestScore,
          snippet: bestSnippet,
          matches: bestMatches,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, MAX_CONVERSATION_RESULTS);
  }, [conversationIds, search, isSearching, onSelectConversation]);

  if (folders.length === 0) return null;

  // Determine what to show: search overrides truncation
  const hiddenCount = matchedFolders.length - VISIBLE_COUNT;
  const shouldTruncate = !isSearching && !showAll && hiddenCount > 0;
  const visibleFolders = shouldTruncate ? matchedFolders.slice(0, VISIBLE_COUNT) : matchedFolders;

  return (
    <div className="folder-filter ui-stack">
      <div className="folder-filter-header ui-row">
        <span className="folder-filter-label">Folders</span>
        <input
          type="text"
          className="folder-search"
          placeholder="Fuzzy search folders..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowAll(false);
          }}
        />
      </div>
      <div className="folder-filter-chips ui-row">
        {visibleFolders.map(({ folder, matches, matchedFormatted }) => {
          const isSelected = selected.has(folder);
          const isActive = selected.size === 0 || isSelected;
          const displayText = matchedFormatted ? format(folder) : folder;

          return (
            <button
              key={folder}
              type="button"
              className={`folder-chip ui-truncate ui-card ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
              onClick={() => onToggle(folder)}
              title={folder}
            >
              {isSearching && matches.length > 0
                ? renderHighlighted(displayText, matches)
                : format(folder)}
            </button>
          );
        })}
        {shouldTruncate && (
          <button
            type="button"
            className="folder-chip ui-truncate ui-card folder-chip-more"
            onClick={() => setShowAll(true)}
          >
            +{hiddenCount} older folders...
          </button>
        )}
        {showAll && !isSearching && hiddenCount > 0 && (
          <button
            type="button"
            className="folder-chip ui-truncate ui-card folder-chip-more"
            onClick={() => setShowAll(false)}
          >
            show less
          </button>
        )}
      </div>

      {/* Fuzzy-matched conversations */}
      {isSearching && matchedConversations.length > 0 && onSelectConversation && (
        <div className="folder-filter-conversations ui-stack">
          <span className="folder-filter-sublabel ui-muted">Conversations</span>
          <div className="conversation-results ui-stack">
            {matchedConversations.map(({ conversation, snippet, matches }) => (
              <button
                key={conversation.id}
                type="button"
                className="conversation-result ui-card"
                onClick={() => onSelectConversation(conversation.id)}
              >
                <span className="conversation-result-id ui-muted">
                  {conversation.id.substring(0, 8)}
                </span>
                <span className="conversation-result-snippet ui-truncate">
                  {matches.length > 0 ? renderHighlighted(snippet, matches) : snippet}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <button type="button" className="folder-filter-clear ui-control" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}

/** Render text with fuzzy-matched characters highlighted */
function renderHighlighted(text: string, matches: number[]) {
  const parts = highlightMatches(text, matches);
  return parts.map((part) => {
    if (typeof part === 'string') return part;
    return (
      <mark key={part.key} className="fuzzy-highlight">
        {part.highlighted}
      </mark>
    );
  });
}
