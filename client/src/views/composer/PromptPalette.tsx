import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { SavedPrompt } from '../../hooks/useSavedPrompts';
import './PromptPalette.css';

/**
 * The saved-prompt palette, rendered by both composers (desktop Chat.tsx and
 * mobile ComposerMobile). Prompt logic lives in hooks/useSavedPrompts; this
 * view owns search, selection and the keyboard contract, which are the same on
 * both trees: ↑/↓ move, Enter inserts, Escape closes, Cmd/Ctrl+Backspace deletes.
 *
 * `presentation` picks the frame, chosen by the caller:
 * - `popover`: a centred overlay under the top edge (pointer + keyboard).
 * - `sheet`: a bottom sheet on a modal <dialog>, whose safe-area padding keeps
 *   it above the home indicator and the soft keyboard.
 */
export type PromptPalettePresentation = 'popover' | 'sheet';

interface Props {
  presentation: PromptPalettePresentation;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  prompts: SavedPrompt[];
  fuzzySearch: (query: string) => SavedPrompt[];
  incrementUsage: (id: string) => void;
  deletePrompt: (id: string) => void;
}

interface FrameProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

function PopoverFrame({ isOpen, onClose, children }: FrameProps) {
  if (!isOpen) return null;
  return (
    <div className="prompt-palette-overlay" onClick={onClose}>
      <div className="prompt-palette prompt-palette--popover" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function SheetFrame({ isOpen, onClose, children }: FrameProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The dialog stays mounted; isOpen drives showModal/close so the pair is idempotent.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);
  return (
    <dialog
      ref={dialogRef}
      className="mobile-sheet ui-card prompt-palette prompt-palette--sheet"
      aria-label="Saved prompts"
      onCancel={onClose}
      // A click on the dialog element itself is a click on the backdrop.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      onClose={onClose}
    >
      <div className="mobile-sheet__inner ui-stack">
        <div className="mobile-sheet__grabber" aria-hidden="true" />
        <div className="mobile-sheet__header ui-row">
          <h2 className="mobile-sheet__title">Prompts</h2>
          <button
            type="button"
            className="mobile-sheet__close ui-inline-row ui-card ui-muted"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {isOpen ? children : null}
        <p className="prompt-palette__hint ui-muted">
          Ctrl+P / ⌘P to open · ↑↓ to navigate · Enter to insert
        </p>
      </div>
    </dialog>
  );
}

const FRAMES: Record<PromptPalettePresentation, (props: FrameProps) => ReactNode> = {
  popover: PopoverFrame,
  sheet: SheetFrame,
};

export function PromptPalette({
  presentation,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the result count changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [results.length]);

  const choose = (prompt: SavedPrompt) => {
    incrementUsage(prompt.id);
    onSelect(prompt.content);
    onClose();
  };

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
        if (results[selectedIndex]) choose(results[selectedIndex]);
        break;
      case 'Escape':
        onClose();
        break;
      case 'Backspace':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          if (results[selectedIndex]) deletePrompt(results[selectedIndex].id);
        }
        break;
    }
  };

  const Frame = FRAMES[presentation];
  return (
    <Frame isOpen={isOpen} onClose={onClose}>
      <input
        ref={inputRef}
        type="text"
        className="prompt-palette-input"
        placeholder="Search saved prompts… (⌘⌫ to delete)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="prompt-palette-results">
        {results.length > 0 ? (
          results.map((prompt, i) => (
            <div
              key={prompt.id}
              tabIndex={-1}
              className={`prompt-palette-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => choose(prompt)}
              onKeyDown={handleKeyDown}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <div className="prompt-item-header ui-row">
                <span className="prompt-name ui-truncate">{prompt.name}</span>
                <div className="prompt-item-actions ui-row">
                  <span className="prompt-usage ui-muted">used {prompt.usageCount}×</span>
                  <button
                    type="button"
                    className="prompt-delete-btn ui-control"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePrompt(prompt.id);
                    }}
                    aria-label={`Delete ${prompt.name}`}
                    title="Delete prompt"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="prompt-preview ui-truncate">
                {prompt.content.length > 100
                  ? `${prompt.content.substring(0, 100)}…`
                  : prompt.content}
              </div>
            </div>
          ))
        ) : (
          <div className="prompt-palette-empty ui-muted">
            {prompts.length === 0
              ? 'No saved prompts yet. Use the save button in the composer to add one.'
              : 'No prompts match your search'}
          </div>
        )}
      </div>
    </Frame>
  );
}
