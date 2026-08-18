import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defaultCwdAtom, recentDirectoriesAtom, wsStatusAtom } from '../../atoms/conversations';
import { lastWorkingDirectoryAtom } from '../../atoms/ui';
import { createDefaultDraft } from '../../domain/conversation-config-draft';
import { useProviderCatalog } from '../../hooks/useProviderCatalog';
import { normalizeFolderDirectory } from '../../utils/directories';
import { type MobileCreateKind, createFromRequest } from '../atoms/create';

/**
 * NewConversationSheet — the mobile "+ New" flow for Chats and Swarms.
 *
 * Deliberately not a port of the desktop modal: typing an absolute path on a
 * phone keyboard is miserable, so recent directories are tappable rows and the
 * free-text field is the fallback, not the primary control. Provider stays at
 * the catalog default here — ChatMobile's header picker can change it before
 * the first message, which is the only point where it matters.
 *
 * Native <dialog> + showModal() rather than a div overlay: focus trapping,
 * inertness of the page behind, and Esc-to-close come from the platform.
 * Clicks on ::backdrop are dispatched with target === the dialog element,
 * which is how backdrop-dismiss is detected below.
 */

const COPY: Record<MobileCreateKind, { title: string; confirm: string; pending: string }> = {
  chat: { title: 'New chat', confirm: 'Start chat', pending: 'Starting…' },
  swarm: { title: 'New swarm', confirm: 'Start swarm', pending: 'Loading swarm context…' },
};

function displayPath(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+/, '~');
}

export function NewConversationSheet({
  kind,
  onClose,
}: {
  kind: MobileCreateKind;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const recentDirectories = useAtomValue(recentDirectoriesAtom);
  const lastWorkingDirectory = useAtomValue(lastWorkingDirectoryAtom);
  const defaultCwd = useAtomValue(defaultCwdAtom);
  const wsStatus = useAtomValue(wsStatusAtom);
  const { catalog } = useProviderCatalog();

  const initialDirectory = recentDirectories[0] ?? lastWorkingDirectory ?? defaultCwd ?? '/';
  const [directory, setDirectory] = useState(initialDirectory);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }, []);

  const matches = useMemo(() => {
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) return recentDirectories.slice(0, 12);
    return recentDirectories.filter((dir) => dir.toLowerCase().includes(trimmed)).slice(0, 12);
  }, [recentDirectories, filter]);

  const resolvedDirectory = normalizeFolderDirectory(directory);
  const canCreate = directory.trim().length > 0 && wsStatus === 'connected' && !busy;
  const copy = COPY[kind];

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const conversationId = await createFromRequest({
        kind,
        workingDirectory: resolvedDirectory,
        // Catalog-derived default; 'claude' fallback matches shared DEFAULT_PROVIDER.
        config: createDefaultDraft(
          (catalog?.providers[0]?.id ?? 'claude') as ReturnType<
            typeof createDefaultDraft
          >['provider']
        ),
      });
      onClose();
      navigate(`/chat/${conversationId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="mobile-sheet"
      aria-label={copy.title}
      onCancel={(event) => {
        // Esc while a create is in flight would strand the pending request.
        if (busy) event.preventDefault();
        else onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && !busy) onClose();
      }}
    >
      <div className="mobile-sheet__inner">
        <div className="mobile-sheet__grabber" aria-hidden="true" />
        <div className="mobile-sheet__header">
          <h2 className="mobile-sheet__title">{copy.title}</h2>
          <button
            type="button"
            className="mobile-sheet__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <label className="mobile-sheet__label" htmlFor="mobile-new-directory">
          Working directory
        </label>
        <input
          id="mobile-new-directory"
          className="mobile-sheet__input"
          value={directory}
          onChange={(event) => setDirectory(event.target.value)}
          placeholder="/Users/you/git/project"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />

        {recentDirectories.length > 0 && (
          <>
            <div className="mobile-sheet__section-title">Recent</div>
            <input
              className="mobile-sheet__input mobile-sheet__input--filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter recent folders…"
              type="search"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              aria-label="Filter recent folders"
            />
            <ul className="mobile-sheet__recents">
              {matches.map((dir) => {
                const selected = dir === resolvedDirectory;
                return (
                  <li key={dir}>
                    <button
                      type="button"
                      className={
                        selected
                          ? 'mobile-sheet__recent mobile-sheet__recent--selected'
                          : 'mobile-sheet__recent'
                      }
                      onClick={() => setDirectory(dir)}
                      aria-pressed={selected}
                    >
                      <span className="mobile-sheet__recent-name">
                        {dir.split('/').filter(Boolean).pop() ?? dir}
                      </span>
                      <span className="mobile-sheet__recent-path">{displayPath(dir)}</span>
                    </button>
                  </li>
                );
              })}
              {matches.length === 0 && (
                <li className="mobile-sheet__no-matches">No recent folder matches that filter.</li>
              )}
            </ul>
          </>
        )}

        {/* Sticky: with a dozen recent folders the list overflows the sheet, so
            the primary action must stay reachable without scrolling — and the
            error must ride with it, or a failed submit reports into dead space
            the user never scrolls back to. */}
        <div className="mobile-sheet__footer">
          {error && (
            <div className="mobile-sheet__error" role="alert">
              {error}
            </div>
          )}
          {wsStatus !== 'connected' && (
            <output className="mobile-sheet__note">
              Disconnected from the server — reconnecting.
            </output>
          )}
          <button
            type="button"
            className="mobile-sheet__confirm"
            onClick={() => void submit()}
            disabled={!canCreate}
          >
            {busy ? copy.pending : copy.confirm}
          </button>
        </div>
      </div>
    </dialog>
  );
}
