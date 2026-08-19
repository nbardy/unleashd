import { useEffect, useRef, useState } from 'react';
import type { SavedPrompt } from '../../hooks/useSavedPrompts';

/**
 * PromptPaletteMobile — mobile bottom-sheet variant of desktop PromptPalette.
 *
 * Thin wrapper: logic lives in `useSavedPrompts` (hooks/*, already shared).
 * This component only renders search + selection. It deliberately does NOT
 * import from `components/*` so Gate G3 stays green — it duplicates the
 * 40-line UI rather than coupling the two view trees (see docs/mobile-view-tree.md:
 * "either move PromptPalette to a shared location or duplicate thin wrapper").
 *
 * Desktop uses a centered overlay; mobile uses a bottom sheet (dialog[modal])
 * with safe-area padding so it works above the home indicator and keyboard.
 */
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  prompts: SavedPrompt[];
  fuzzySearch: (query: string) => SavedPrompt[];
  incrementUsage: (id: string) => void;
  deletePrompt: (id: string) => void;
}

export function PromptPaletteMobile({
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  const results = fuzzySearch(query);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // dialog.showModal() is called in separate effect so open/close is idempotent
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  // Manage <dialog> modal state from isOpen prop (mirrors ModelSheetMobile pattern)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // showModal throws if already open or not in DOM — ignore
      }
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

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
          e.preventDefault();
          if (results[selectedIndex]) {
            deletePrompt(results[selectedIndex].id);
          }
        }
        break;
    }
  };

  // Prevent dialog click from bubbling to backdrop close when clicking inside
  const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="mobile-sheet mobile-sheet--prompt-palette"
      aria-label="Saved prompts"
      onCancel={onClose}
      onClick={handleDialogClick}
      onClose={onClose}
    >
      <div className="mobile-sheet__inner">
        <div className="mobile-sheet__grabber" aria-hidden="true" />
        <div className="mobile-sheet__header">
          <h2 className="mobile-sheet__title">Prompts</h2>
          <button type="button" className="mobile-sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <input
          ref={inputRef}
          type="text"
          className="mobile-sheet__input mobile-sheet__input--filter"
          placeholder="Search saved prompts… (⌘⌫ to delete)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="prompt-palette-mobile__results" role="listbox" aria-label="Prompt results">
          {results.length > 0 ? (
            results.map((prompt, i) => (
              <button
                key={prompt.id}
                type="button"
                role="option"
                aria-selected={i === selectedIndex}
                className={`mobile-sheet__recent ${i === selectedIndex ? 'mobile-sheet__recent--selected' : ''} prompt-palette-mobile__item`}
                onClick={() => {
                  incrementUsage(prompt.id);
                  onSelect(prompt.content);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="mobile-sheet__recent-name prompt-palette-mobile__name">{prompt.name}</span>
                <span className="mobile-sheet__recent-path prompt-palette-mobile__preview">
                  {prompt.content.length > 100 ? `${prompt.content.substring(0, 100)}…` : prompt.content}
                </span>
                <span className="prompt-palette-mobile__meta">
                  <span className="prompt-palette-mobile__usage">used {prompt.usageCount}×</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    className="prompt-palette-mobile__delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePrompt(prompt.id);
                    }}
                    aria-label={`Delete ${prompt.name}`}
                    title="Delete prompt"
                  >
                    ×
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="prompt-palette-mobile__empty">
              {prompts.length === 0 ? 'No saved prompts yet. Use the bookmark button to save one!' : 'No prompts match your search'}
            </div>
          )}
        </div>

        <p className="prompt-palette-mobile__hint">Ctrl+P / ⌘P to open · ↑↓ to navigate · Enter to insert</p>
      </div>
    </dialog>
  );
}
