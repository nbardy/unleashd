import { useEffect, useRef, useState } from 'react';
import type { SavedPrompt } from '../hooks/useSavedPrompts';
import './PromptPalette.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  prompts: SavedPrompt[];
  fuzzySearch: (query: string) => SavedPrompt[];
  incrementUsage: (id: string) => void;
  deletePrompt: (id: string) => void;
}

export function PromptPalette({
  isOpen,
  onClose,
  onSelect,
  prompts,
  fuzzySearch,
  incrementUsage,
  deletePrompt,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = fuzzySearch(query);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: We want to reset selection when results count changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (results[selectedIndex]) {
          incrementUsage(results[selectedIndex].id);
          onSelect(results[selectedIndex].content);
          onClose();
        }
        break;
      case 'Escape':
        onClose();
        break;
      case 'Backspace':
        if (e.metaKey || e.ctrlKey) {
          // Cmd/Ctrl+Backspace to delete
          e.preventDefault();
          if (results[selectedIndex]) {
            deletePrompt(results[selectedIndex].id);
          }
        }
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="prompt-palette-overlay" onClick={onClose}>
      <div className="prompt-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="prompt-palette-input"
          placeholder="Search saved prompts... (Cmd+Backspace to delete)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="prompt-palette-results">
          {results.length > 0 ? (
            results.map((prompt, i) => (
              <div
                key={prompt.id}
                className={`prompt-palette-item ${i === selectedIndex ? 'selected' : ''}`}
                onClick={() => {
                  incrementUsage(prompt.id);
                  onSelect(prompt.content);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="prompt-item-header ui-row">
                  <span className="prompt-name">{prompt.name}</span>
                  <div className="prompt-item-actions ui-row">
                    <span className="prompt-usage ui-muted">used {prompt.usageCount}x</span>
                    <button
                      type="button"
                      className="prompt-delete-btn ui-control"
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePrompt(prompt.id);
                      }}
                      title="Delete prompt"
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <div className="prompt-preview ui-truncate">
                  {prompt.content.length > 100
                    ? `${prompt.content.substring(0, 100)}...`
                    : prompt.content}
                </div>
              </div>
            ))
          ) : (
            <div className="prompt-palette-empty ui-muted">
              {prompts.length === 0
                ? 'No saved prompts yet. Click the star to save one!'
                : 'No prompts match your search'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
