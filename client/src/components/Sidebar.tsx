import type { Conversation, ConversationConfig } from '@unleashd/shared';
import {
  createDefaultConversationConfig,
  isBuddyBuilderConversation,
  isBuddyConversation,
} from '@unleashd/shared';
import { useAtom, useAtomValue } from 'jotai';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createConversation, readConversation, setConversationDone } from '../atoms/actions';
import {
  type BuddySidebarItemData,
  buddyBuilderConversationsAtom,
  buddySidebarChannelsAtom,
  buddySidebarCountAtom,
  buddySidebarGroupsAtom,
  buddySidebarOverviewAtom,
  sidebarFolderViewAtom,
  sidebarRunningCountByFolderAtom,
} from '../atoms/buddy-sidebar';
import {
  activeConversationIdAtom,
  allPendingCreationsAtom,
  conversationAtomFamily,
  defaultCwdAtom,
  latestWorkingDirectoryAtom,
  recentDirectoriesAtom,
  wsStatusAtom,
} from '../atoms/conversations';
import {
  galleryCollapsedProjectsAtom,
  hasUnseenAfter,
  lastSeenMessageIndexAtomFamily,
  lastWorkingDirectoryAtom,
  setLastWorkingDirectory,
  toggleGalleryCollapsed,
} from '../atoms/ui';
import { useBuddyOverview } from '../hooks/useBuddyData';
import { useProviderCatalog } from '../hooks/useProviderCatalog';
import { normalizeFolderDirectory, shortenHomePath } from '../utils/directories';
import { getProjectColor } from '../utils/projectColors';
import { formatTimeAgo, getConversationLastActivity, getMinutesElapsed } from '../utils/time';
import { ConversationConfigPicker } from './ConversationConfigPicker';
import { PathAutocomplete } from './PathAutocomplete';
import { SearchPalette } from './SearchPalette';
import { DmIcon, WakeIcon, WakeIndicator } from './buddies/WakeIndicator';
import { useBuddyDirectActions } from './buddies/buddy-direct-actions';
import { buddyTabPath } from './buddies/buddy-tabs';
import { ownerUnreadTotal, useOwnerInboxes } from './buddies/channel-data';
import { createBuddyViaBuilder } from './buddies/create-buddy-builder';
import { getConversationTitle } from './conversation-title';
import './Sidebar.css';
import { useTimeTick } from '../hooks/useTimeTick';

function SidebarFolderIcon() {
  return (
    <svg
      className="sidebar-folder-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7V5h6l2 2h10v12H3Z" />
    </svg>
  );
}

function SidebarBuddyIcon() {
  return (
    <svg
      className="sidebar-buddy-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </svg>
  );
}

/**
 * Exponential decay for time-ago text brightness.
 * Recent ("just now") = near-white, older = fades toward muted grey.
 *
 * Uses color-mix to blend between --text-bright (near-white) and --text-muted (grey).
 * The mix percentage decays exponentially: 100% bright at 0min, ~40% at 30min, ~15% at 60min.
 * Decay constant 0.03 gives a natural half-life of ~23 minutes.
 */
function timeAgoColor(minutesElapsed: number): string {
  const brightPct = Math.round(100 * Math.exp(-0.03 * minutesElapsed));
  return `color-mix(in oklch, var(--text-bright) ${brightPct}%, var(--text-muted))`;
}

export function Sidebar() {
  const latestWorkingDirectory = useAtomValue(latestWorkingDirectoryAtom);
  const { recent: recentGroups, olderIds } = useAtomValue(sidebarFolderViewAtom);
  const pendingCreations = useAtomValue(allPendingCreationsAtom);
  const activeConversationId = useAtomValue(activeConversationIdAtom);
  const defaultCwd = useAtomValue(defaultCwdAtom);
  const wsStatus = useAtomValue(wsStatusAtom);

  const lastWorkingDirectory = useAtomValue(lastWorkingDirectoryAtom);
  const galleryCollapsedProjects = useAtomValue(galleryCollapsedProjectsAtom);

  const builderConversations = useAtomValue(buddyBuilderConversationsAtom);
  const collapsedSet = useMemo(() => new Set(galleryCollapsedProjects), [galleryCollapsedProjects]);

  // Deduplicated working directories from all conversations — fed to PathAutocomplete for fuzzy
  // matching. Derived atom (not a local useMemo) so the mobile create sheet reads the same list.
  const recentDirectories = useAtomValue(recentDirectoriesAtom);

  const [showSearch, setShowSearch] = useState(false);
  const [searchFilterDir, setSearchFilterDir] = useState<string | undefined>(undefined);
  const [showPicker, setShowPicker] = useState(false);
  const [directory, setDirectory] = useState('');
  const [hasPendingDefault, setHasPendingDefault] = useState(false);
  const [isDirectoryValid, setIsDirectoryValid] = useState(true);
  const { catalog, error: catalogError, retry: retryCatalog } = useProviderCatalog();
  // Default provider is catalog-derived; fallback 'claude' matches
  // shared/src/provider-catalog.ts DEFAULT_PROVIDER and shared/src/conversation-config.ts
  // createDefaultConversationConfig(). Catalog is authoritative once loaded.
  const defaultProvider = (catalog?.providers[0]?.id ?? 'claude') as ConversationConfig['provider'];
  const [configDraft, setConfigDraft] = useState<ConversationConfig>(() =>
    createDefaultConversationConfig(defaultProvider)
  );
  const [isCreatingSwarm, setIsCreatingSwarm] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [isOpeningBuddyBuilder, setIsOpeningBuddyBuilder] = useState(false);
  const [buddyBuilderError, setBuddyBuilderError] = useState<string | null>(null);
  const { data: buddyOverview } = useBuddyOverview(30_000);
  const [, setBuddyOverview] = useAtom(buddySidebarOverviewAtom);
  useEffect(() => {
    if (buddyOverview) setBuddyOverview(buddyOverview);
  }, [buddyOverview, setBuddyOverview]);
  const buddySidebarGroups = useAtomValue(buddySidebarGroupsAtom);
  const buddyCount = useAtomValue(buddySidebarCountAtom);
  const channelsWorkspaces = useAtomValue(buddySidebarChannelsAtom);
  const ownerUnread = useOwnerInboxes().data;
  const runningCountByFolder = useAtomValue(sidebarRunningCountByFolderAtom);
  const [expandedBuddies, setExpandedBuddies] = useState<Set<string>>(() => new Set());
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const navigate = useNavigate();
  const location = useLocation();

  const handleNewConversation = useCallback(() => {
    // Default to the most recently active conversation's working directory,
    // then lastWorkingDirectory fallback, then server cwd.
    const lastDir = latestWorkingDirectory ?? lastWorkingDirectory ?? defaultCwd ?? '/';
    setDirectory(lastDir);
    setHasPendingDefault(true);
    setModalError(null);
    // Provider default is catalog-derived; fallback 'claude' matches shared DEFAULT_PROVIDER.
    setConfigDraft(createDefaultConversationConfig(defaultProvider));
    setShowPicker(true);
  }, [latestWorkingDirectory, lastWorkingDirectory, defaultCwd, defaultProvider]);

  const handleNewBuddyBuilder = useCallback(async () => {
    setIsOpeningBuddyBuilder(true);
    setBuddyBuilderError(null);
    try {
      const conversationId = await createBuddyViaBuilder();
      navigate(`/chat/${conversationId}?helper=buddies`);
    } catch (cause) {
      setBuddyBuilderError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsOpeningBuddyBuilder(false);
    }
  }, [navigate]);

  const handleNewBuddyConversation = useCallback(
    (item: BuddySidebarItemData) => {
      // Reuse existing new-conversation flow but seed buddyContext so the
      // new thread is owned by that buddy — mirrors BuddiesDashboard talk().
      const latestConversation = item.latestConversation
        ? readConversation(item.latestConversation.id)
        : null;
      const workingDirectory =
        latestConversation?.workingDirectory ??
        item.pendingCreation?.workingDirectory ??
        item.workingDirectory;
      // Seed the harness from this buddy's latest thread so a provider/model
      // picked there sticks for the next thread. Falls back to the global
      // new-conversation draft only when the buddy has no prior thread.
      // (The dashboard talk() path seeds from the saved Execution profile
      // instead; the sidebar has last-used config locally, so it uses that.)
      const seedConfig = latestConversation?.config ?? configDraft;
      // Direct create — reuses pending-creations createConversation + buddyContext shape
      const id = createConversation({
        workingDirectory,
        config: seedConfig,
        buddyContext: {
          buddyId: item.buddyId,
          workspaceId: item.workspaceId,
          buddyProjectId: null,
        },
      });
      navigate(`/chat/${id}`);
    },
    [configDraft, navigate]
  );

  // Shift+Space global shortcut to open "New Conversation" dialog.
  // Skipped when focus is in an input/textarea so it doesn't hijack typing.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.code !== 'Space') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      handleNewConversation();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewConversation]);

  // Cmd/Ctrl+P (and the legacy Cmd/Ctrl+K alias) opens the global search palette.
  // Skipped when focus is in an input/textarea so it doesn't hijack typing.
  useEffect(() => {
    const handleSearchShortcut = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !['k', 'p'].includes(e.key.toLowerCase())) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      setSearchFilterDir(undefined);
      setShowSearch(true);
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!directory.trim()) return;
    setModalError(null);
    setLastWorkingDirectory(directory);
    const newId = createConversation({ workingDirectory: directory, config: configDraft });
    setShowPicker(false);
    navigate(`/chat/${newId}`);
  }, [directory, configDraft, navigate]);

  const handleCreateNewSwarm = useCallback(async () => {
    if (!directory.trim()) return;
    setModalError(null);
    setIsCreatingSwarm(true);
    try {
      const response = await fetch(`/api/oompa-swarm-context?dir=${encodeURIComponent(directory)}`);
      const payload = (await response.json().catch(() => ({}))) as {
        prefix?: string;
        error?: string;
      };
      if (!response.ok || !payload.prefix) {
        throw new Error(payload.error ?? `Failed to load swarm context (HTTP ${response.status})`);
      }

      setLastWorkingDirectory(directory);
      const newId = createConversation({
        workingDirectory: directory,
        config: configDraft,
        swarmDebugPrefix: payload.prefix,
      });
      setShowPicker(false);
      navigate(`/chat/${newId}`);
    } catch (error) {
      setModalError((error as Error).message);
    } finally {
      setIsCreatingSwarm(false);
    }
  }, [directory, configDraft, navigate]);

  const handleCancel = () => {
    if (isCreatingSwarm) return;
    setShowPicker(false);
    setModalError(null);
  };

  // Stable callbacks: rows are memoized per id, so a new function identity
  // here would re-render every row on every Sidebar render.
  const handleSelectConversation = useCallback(
    (conv: Conversation) => navigate(`/chat/${conv.id}`),
    [navigate]
  );

  const pathname = location.pathname;
  const handleDone = useCallback(
    (conv: Conversation, e: React.MouseEvent) => {
      e.stopPropagation();
      setConversationDone(conv.id, true);
      if (pathname.includes(conv.id)) {
        navigate('/');
      }
    },
    [navigate, pathname]
  );
  const onDone = wsStatus === 'connected' ? handleDone : null;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-actions" aria-label="Quick actions">
          <button
            type="button"
            className="sidebar-search-field"
            aria-label="Search Buddies and conversations"
            onClick={() => {
              setSearchFilterDir(undefined);
              setShowSearch(true);
            }}
            title="Search Buddies and conversations (Cmd/Ctrl+P)"
          >
            <svg
              role="img"
              aria-hidden="true"
              className="sidebar-search-field-icon"
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" />
              <line
                x1="11"
                y1="11"
                x2="14.5"
                y2="14.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="sidebar-search-field-label">search</span>
            <span className="sidebar-search-field-shortcut">⌘P</span>
          </button>
          <button
            type="button"
            className="sidebar-new-btn"
            onClick={handleNewConversation}
            aria-label="New conversation"
            title="New conversation (Shift+Space)"
          >
            <span>new</span>
            <span className="sidebar-new-btn-plus">+</span>
          </button>
        </div>

        {showPicker && (
          <div className="new-conv-overlay" onClick={handleCancel}>
            <div className="new-conv-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="new-conv-title">New Conversation</h3>
              <div className="new-conv-label">Working Directory</div>
              <PathAutocomplete
                value={directory}
                onChange={setDirectory}
                recentDirectories={recentDirectories}
                placeholder="Search recent or type a path..."
                className="directory-input"
                hasPendingDefault={hasPendingDefault}
                onClearDefault={() => setHasPendingDefault(false)}
                onConfirm={handleConfirm}
                onValidationChange={setIsDirectoryValid}
                autoFocus
              />
              {catalog ? (
                <ConversationConfigPicker
                  value={configDraft}
                  onChange={setConfigDraft}
                  catalog={catalog}
                />
              ) : (
                <div className="config-picker-status" role={catalogError ? 'alert' : 'status'}>
                  {catalogError ? (
                    <>
                      Unable to load providers.{' '}
                      <button type="button" onClick={retryCatalog}>
                        Retry
                      </button>
                    </>
                  ) : (
                    'Loading providers…'
                  )}
                </div>
              )}
              <div className="directory-actions">
                <button
                  type="button"
                  className="dir-action-btn dir-confirm-btn"
                  onClick={handleConfirm}
                  disabled={
                    wsStatus !== 'connected' || !isDirectoryValid || isCreatingSwarm || !catalog
                  }
                  title={
                    wsStatus !== 'connected'
                      ? 'Server disconnected'
                      : !isDirectoryValid
                        ? 'Invalid directory'
                        : isCreatingSwarm
                          ? 'Creating swarm context...'
                          : 'Create conversation (Shift+Enter)'
                  }
                >
                  Create
                  <kbd className="btn-shortcut">⇧↵</kbd>
                </button>
                <button
                  type="button"
                  className="dir-action-btn dir-swarm-btn"
                  onClick={() => {
                    void handleCreateNewSwarm();
                  }}
                  disabled={wsStatus !== 'connected' || !isDirectoryValid || isCreatingSwarm}
                  title={
                    wsStatus !== 'connected'
                      ? 'Server disconnected'
                      : !isDirectoryValid
                        ? 'Invalid directory'
                        : 'Create conversation with swarm context prefix'
                  }
                >
                  {isCreatingSwarm ? 'Preparing...' : 'New Swarm'}
                </button>
              </div>
              {modalError && <div className="new-conv-error">{modalError}</div>}
            </div>
          </div>
        )}

        <SearchPalette
          isOpen={showSearch}
          onClose={() => setShowSearch(false)}
          onSelectConversation={(id) => {
            navigate(`/chat/${id}`);
          }}
          onSelectBuddy={(id) => {
            navigate(`/buddies/${id}`);
          }}
          filterDirectory={searchFilterDir}
        />
      </div>

      <div className="conversations-list">
        {pendingCreations
          .filter((creation) => !isBuddyConversation(creation as unknown as Conversation))
          .map((creation) => (
            <button
              type="button"
              key={creation.conversationId}
              className={`conversation-item pending-creation ${
                creation.conversationId === activeConversationId ? 'active' : ''
              }`}
              onClick={() => navigate(`/chat/${creation.conversationId}`)}
            >
              <div className="conversation-row">
                <span className="folder-badge">
                  {creation.workingDirectory.split('/').filter(Boolean).pop() ?? '/'}
                </span>
                <span className="conversation-title">
                  {creation.error
                    ? `Failed: ${creation.error}`
                    : `Starting ${creation.config.provider}…`}
                </span>
                <span className="status-indicator pending" />
              </div>
            </button>
          ))}
        <div className="sidebar-section">
          <div className="folder-group folder-group--buddies">
            <div
              className="folder-group-header"
              style={{ borderLeftColor: 'var(--ai)' }}
              onClick={() => toggleGalleryCollapsed('__buddies__')}
            >
              <button
                type="button"
                className="folder-group-name folder-group-name-button"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate('/buddies');
                }}
              >
                Buddies
              </button>
              <button
                type="button"
                className="folder-group-add-btn folder-group-add-btn--section"
                aria-label="Create a new Buddy"
                title="Create a new Buddy"
                disabled={isOpeningBuddyBuilder}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleNewBuddyBuilder();
                }}
              >
                +
              </button>
              <span className="folder-group-count">{buddyCount || ''}</span>
            </div>
            {buddyBuilderError && (
              <div className="sidebar-buddy-error" role="alert">
                {buddyBuilderError}
              </div>
            )}
            {!collapsedSet.has('__buddies__') && buddyCount === 0 && (
              <div className="folder-group-all-done">No Buddies yet</div>
            )}
            {!collapsedSet.has('__buddies__') &&
              buddySidebarGroups.map((group) => {
                if (group.kind === 'builder')
                  return (
                    <div key={group.key} className="folder-group folder-group--builder">
                      <div
                        className="folder-group-header"
                        style={{ borderLeftColor: 'var(--ai)' }}
                        onClick={() => toggleGalleryCollapsed('__builder__')}
                      >
                        <span className="folder-group-name" title="Buddy Builder conversations">
                          Buddy Builder
                        </span>
                        <button
                          type="button"
                          className="folder-group-add-btn folder-group-add-btn--section"
                          aria-label="Start a new Buddy Builder conversation"
                          title="Start a new Buddy Builder conversation"
                          disabled={isOpeningBuddyBuilder}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleNewBuddyBuilder();
                          }}
                        >
                          +
                        </button>
                        <span className="folder-group-count">
                          {builderConversations.filter((entry) => !entry.done).length || ''}
                        </span>
                      </div>
                      {!collapsedSet.has('__builder__') &&
                        (() => {
                          const builderActive = builderConversations.filter((entry) => !entry.done);
                          if (builderActive.length === 0) return null;
                          const isBuilderExpanded = expandedDirectories.has('__builder__');
                          const visibleBuilder = isBuilderExpanded
                            ? builderActive
                            : builderActive.slice(0, 3);
                          const remainingBuilder = builderActive.length - visibleBuilder.length;
                          return (
                            <>
                              {visibleBuilder.map((entry) => (
                                <SidebarConversationRow
                                  key={entry.id}
                                  id={entry.id}
                                  isActive={entry.id === activeConversationId}
                                  showFolderBadge={false}
                                  onSelect={handleSelectConversation}
                                  onDone={onDone}
                                />
                              ))}
                              {builderActive.length > 3 && (
                                <button
                                  type="button"
                                  className="show-more-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedDirectories((prev) => {
                                      const next = new Set(prev);
                                      if (next.has('__builder__')) next.delete('__builder__');
                                      else next.add('__builder__');
                                      return next;
                                    });
                                  }}
                                >
                                  {isBuilderExpanded
                                    ? 'show less'
                                    : `show ${remainingBuilder} more`}
                                </button>
                              )}
                            </>
                          );
                        })()}
                    </div>
                  );
                const project = group.project;
                const projectKey = `buddy-project:${project.workspaceId}`;
                const isProjectCollapsed = collapsedSet.has(projectKey);
                return (
                  <div key={project.workspaceId} className="sidebar-buddy-project">
                    <div className="folder-group-header sidebar-buddy-project-header sidebar-project-divider">
                      <Link
                        className="sidebar-project-link"
                        to={`/buddies/workspaces/${encodeURIComponent(project.workspaceId)}`}
                        title={`Open ${project.name} workspace activity`}
                      >
                        <SidebarFolderIcon />
                        <span className="folder-group-name">{project.name}</span>
                      </Link>
                      <button
                        type="button"
                        className="sidebar-project-toggle"
                        aria-label={`${isProjectCollapsed ? 'Expand' : 'Collapse'} ${project.name}`}
                        aria-expanded={!isProjectCollapsed}
                        onClick={() => toggleGalleryCollapsed(projectKey)}
                      >
                        <span className="sidebar-project-rule" aria-hidden="true" />
                        <FolderRunningStatus count={project.runningCount} />
                        <span className="folder-group-count">{project.items.length}</span>
                        <span className="sidebar-project-chevron" aria-hidden="true">
                          {isProjectCollapsed ? '›' : '⌄'}
                        </span>
                      </button>
                    </div>
                    {!isProjectCollapsed &&
                      project.items.map((item) => {
                        const buddyKey = `buddy:${project.workspaceId}:${item.buddyId}`;
                        const isExpanded = expandedBuddies.has(buddyKey);
                        const convs = item.conversations;
                        const visibleConvs = isExpanded ? convs : convs.slice(0, 3);
                        const remaining = convs.length - visibleConvs.length;
                        const buddyPath = `/buddies/${encodeURIComponent(item.buddyId)}`;
                        const isBuddyActive =
                          location.pathname === buddyPath ||
                          location.pathname.startsWith(`${buddyPath}/`);
                        return (
                          <div key={item.buddyId} className="buddy-subgroup">
                            <div
                              className={`folder-group-header folder-group-header--buddy ${isBuddyActive ? 'active' : ''}`}
                            >
                              <Link
                                className="sidebar-buddy-row-link"
                                to={buddyPath}
                                aria-label={`Open ${item.buddyName}`}
                                aria-current={isBuddyActive ? 'page' : undefined}
                              />
                              <button
                                type="button"
                                className="folder-group-add-btn"
                                aria-label={`New conversation with ${item.buddyName}`}
                                title={`New conversation with ${item.buddyName}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNewBuddyConversation(item);
                                }}
                              >
                                +
                              </button>
                              <SidebarBuddyIcon />
                              <span
                                className="folder-group-name sidebar-buddy-link"
                                title={item.buddyName}
                              >
                                {item.buddyName}
                              </span>
                              <BuddyRunningStatus item={item} />
                              <SidebarBuddyActions item={item} />
                            </div>
                            <>
                              {visibleConvs.length > 0 ? (
                                visibleConvs.map((entry) => (
                                  <SidebarConversationRow
                                    key={entry.id}
                                    id={entry.id}
                                    isActive={entry.id === activeConversationId}
                                    showFolderBadge={false}
                                    onSelect={handleSelectConversation}
                                    onDone={onDone}
                                  />
                                ))
                              ) : item.pendingCreation ? (
                                <div className="conversation-item pending-creation">
                                  <div className="conversation-row">
                                    <span className="conversation-title">
                                      {item.pendingCreation.error
                                        ? `Failed: ${item.pendingCreation.error}`
                                        : `Starting ${item.pendingCreation.config.provider}…`}
                                    </span>
                                    <span className="status-indicator pending" />
                                  </div>
                                </div>
                              ) : item.backgroundConversationCount === 0 ? (
                                <div className="folder-group-all-done">No conversations yet</div>
                              ) : null}
                              {convs.length > 3 && (
                                <button
                                  type="button"
                                  className="show-more-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedBuddies((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(buddyKey)) next.delete(buddyKey);
                                      else next.add(buddyKey);
                                      return next;
                                    });
                                  }}
                                >
                                  {isExpanded ? 'show less' : `show ${remaining} more`}
                                </button>
                              )}
                            </>
                          </div>
                        );
                      })}
                  </div>
                );
              })}
          </div>
        </div>
        {channelsWorkspaces.length > 0 && (
          <div className="sidebar-section">
            <div className="folder-group">
              <div
                className="folder-group-header"
                onClick={() => toggleGalleryCollapsed('__channels__')}
              >
                <button
                  type="button"
                  className="folder-group-name folder-group-name-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(
                      `/buddies/workspaces/${encodeURIComponent(channelsWorkspaces[0].workspaceId)}/channels`
                    );
                  }}
                >
                  Channels
                </button>
                <span className="folder-group-count">{channelsWorkspaces.length || ''}</span>
              </div>
              {!collapsedSet.has('__channels__') &&
                channelsWorkspaces.map((project) => {
                  const path = `/buddies/workspaces/${encodeURIComponent(project.workspaceId)}/channels`;
                  const isActive = location.pathname === path;
                  const unread = ownerUnreadTotal(ownerUnread, project.workspaceId);
                  return (
                    <div
                      key={project.workspaceId}
                      className={`folder-group-header sidebar-channels-row ${isActive ? 'active' : ''}`}
                    >
                      <Link
                        className="folder-group-name sidebar-project-link"
                        to={path}
                        aria-current={isActive ? 'page' : undefined}
                        data-unread={unread.unreadChannels > 0 || undefined}
                        title={`${project.name} channels`}
                      >
                        <span className="folder-group-name"># {project.name}</span>
                      </Link>
                      {unread.requests > 0 && (
                        <span
                          className="sidebar-channels-badge"
                          aria-label={`${unread.requests} requests waiting on you`}
                        >
                          {unread.requests}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
        {
          <>
            {recentGroups.length > 0 && (
              <div className="sidebar-section">
                {recentGroups.map((group) => {
                  const isCollapsed = collapsedSet.has(group.directory);
                  const dirDisplay = shortenHomePath(group.directory);
                  const projectColor = getProjectColor(group.directory);
                  const runningCount = runningCountByFolder.get(group.directory) ?? 0;
                  // Done rows are already out; the group keeps its position.
                  const activeConvs = group.activeIds;

                  return (
                    <div key={group.directory} className="folder-group">
                      <div
                        className="folder-group-header sidebar-project-divider"
                        onClick={() => toggleGalleryCollapsed(group.directory)}
                        style={{ borderLeftColor: projectColor }}
                      >
                        <SidebarFolderIcon />
                        <span className="folder-group-name" title={group.directory}>
                          {dirDisplay}
                        </span>
                        <span className="sidebar-project-rule" aria-hidden="true" />
                        <button
                          type="button"
                          className="folder-group-add-btn"
                          aria-label={`Search in ${dirDisplay}`}
                          title={`Search in ${dirDisplay}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearchFilterDir(group.directory);
                            setShowSearch(true);
                          }}
                        >
                          <svg
                            role="img"
                            aria-hidden="true"
                            width="10"
                            height="10"
                            viewBox="0 0 16 16"
                            fill="none"
                          >
                            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="2" />
                            <line
                              x1="11"
                              y1="11"
                              x2="14.5"
                              y2="14.5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="folder-group-add-btn"
                          title={`New conversation in ${dirDisplay}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDirectory(group.directory);
                            setHasPendingDefault(false);
                            setModalError(null);
                            setShowPicker(true);
                          }}
                        >
                          +
                        </button>
                        <FolderRunningStatus count={runningCount} />
                        <span className="folder-group-count">{activeConvs.length || ''}</span>
                      </div>
                      {!isCollapsed &&
                        (() => {
                          const isExpanded = expandedDirectories.has(group.directory);
                          const visibleConvs = isExpanded ? activeConvs : activeConvs.slice(0, 3);
                          const remaining = activeConvs.length - visibleConvs.length;
                          return activeConvs.length > 0 ? (
                            <>
                              {visibleConvs.map((id) => (
                                <SidebarConversationRow
                                  key={id}
                                  id={id}
                                  isActive={id === activeConversationId}
                                  showFolderBadge={false}
                                  onSelect={handleSelectConversation}
                                  onDone={onDone}
                                />
                              ))}
                              {activeConvs.length > 3 && (
                                <button
                                  type="button"
                                  className="show-more-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedDirectories((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(group.directory)) next.delete(group.directory);
                                      else next.add(group.directory);
                                      return next;
                                    });
                                  }}
                                >
                                  {isExpanded ? 'show less' : `show ${remaining} more`}
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="folder-group-all-done">
                              All conversations marked done
                            </div>
                          );
                        })()}
                    </div>
                  );
                })}
              </div>
            )}

            {(() => {
              const olderActive = olderIds;
              if (olderActive.length === 0) return null;
              const isOlderExpanded = expandedDirectories.has('__older__');
              const visibleOlder = isOlderExpanded ? olderActive : olderActive.slice(0, 3);
              const remainingOlder = olderActive.length - visibleOlder.length;
              return (
                <div className="sidebar-section">
                  <div className="sidebar-section-header">Older</div>
                  {visibleOlder.map((id) => (
                    <SidebarConversationRow
                      key={id}
                      id={id}
                      isActive={id === activeConversationId}
                      showFolderBadge
                      onSelect={handleSelectConversation}
                      onDone={onDone}
                    />
                  ))}
                  {olderActive.length > 3 && (
                    <button
                      type="button"
                      className="show-more-btn"
                      onClick={() => {
                        setExpandedDirectories((prev) => {
                          const next = new Set(prev);
                          if (next.has('__older__')) next.delete('__older__');
                          else next.add('__older__');
                          return next;
                        });
                      }}
                    >
                      {isOlderExpanded ? 'show less' : `show ${remainingOlder} more`}
                    </button>
                  )}
                </div>
              );
            })()}
          </>
        }
      </div>
    </div>
  );
}

// DM + Wake on hover, after the running counts so those links stay clickable.
// DM opens the ongoing owner chat with this Buddy (history kept); Wake has it
// catch up on the workspace channels inside that chat (buddy-direct-actions.ts).
function SidebarBuddyActions({ item }: { item: BuddySidebarItemData }) {
  const navigate = useNavigate();
  const direct = useBuddyDirectActions(item.buddyId);
  const { action } = direct;
  return (
    <>
      {direct.woken && (
        <WakeIndicator
          key={direct.woken.attempt}
          conversationId={direct.woken.conversationId}
          name={item.buddyName}
          className="sidebar-buddy-wake"
          doneClassName="sidebar-buddy-wake-done"
        />
      )}
      <span
        className="sidebar-buddy-actions"
        data-failed={action.kind === 'failed' || undefined}
        title={action.kind === 'failed' ? action.message : undefined}
      >
        <button
          type="button"
          aria-label={`Message ${item.buddyName}`}
          title={`Message ${item.buddyName}`}
          disabled={action.kind === 'pending'}
          onClick={(event) => {
            event.stopPropagation();
            direct.openDm((conversationId) =>
              navigate(`/chat/${encodeURIComponent(conversationId)}`)
            );
          }}
        >
          <DmIcon />
        </button>
        <button
          type="button"
          aria-label={`Wake ${item.buddyName}`}
          title={`Wake ${item.buddyName}: catch up on the channels and act`}
          disabled={action.kind === 'pending'}
          onClick={(event) => {
            event.stopPropagation();
            direct.wake();
          }}
        >
          <WakeIcon />
        </button>
      </span>
    </>
  );
}

function BuddyRunningStatus({ item }: { item: BuddySidebarItemData }) {
  const backgroundPath = buddyTabPath(item.buddyId, 'background');
  return (
    <span className="sidebar-buddy-running">
      <Link
        to={buddyTabPath(item.buddyId, 'conversations')}
        className={item.foregroundRunningCount ? 'sidebar-buddy-running-active' : ''}
        aria-label={`${item.foregroundRunningCount} foreground conversations running for ${item.buddyName}`}
        title={`${item.foregroundRunningCount} foreground conversations running`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4 4h16v12H9l-5 4V4Z" />
        </svg>
        {item.foregroundRunningCount}
      </Link>
      <span aria-hidden="true">/</span>
      <Link
        to={backgroundPath}
        className={item.backgroundRunningCount ? 'sidebar-buddy-running-active' : ''}
        aria-label={`${item.backgroundRunningCount} background tasks running for ${item.buddyName}`}
        title={`${item.backgroundRunningCount} background tasks running · View background conversations`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4 16H2V2h14v2M7 7h15v15H7Z" />
        </svg>
        {item.backgroundRunningCount}
      </Link>
    </span>
  );
}

function FolderRunningStatus({ count }: { count: number }) {
  if (count === 0) return null;
  const label = `${count} running`;
  return (
    <span className="folder-group-running" aria-label={`${label} in this project`} title={label}>
      <span className="status-indicator running" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/** Re-exported pure (CSS-free, unit-tested) for external callers. */
export { getConversationTitle };

function conversationMessageCount(conversation: Conversation): number {
  return conversation.messageCount ?? conversation.messages.length;
}

/**
 * One sidebar row. Subscribes to its own conversation and seen index, and is
 * memoized, so an event for another conversation re-renders nothing here.
 * It subscribes to the shared 30 s tick for its time-ago label.
 */
const SidebarConversationRow = memo(function SidebarConversationRow({
  id,
  isActive,
  showFolderBadge,
  onSelect,
  onDone,
}: {
  id: string;
  isActive: boolean;
  showFolderBadge: boolean;
  onSelect: (conv: Conversation) => void;
  /** Null while disconnected: the command would be dropped, so the button is disabled. */
  onDone: ((conv: Conversation, e: React.MouseEvent) => void) | null;
}) {
  const conv = useAtomValue(conversationAtomFamily(id));
  useTimeTick();
  const lastSeen = useAtomValue(lastSeenMessageIndexAtomFamily(id));
  if (!conv) return null;
  return (
    <ConversationItem
      conv={conv}
      isActive={isActive}
      hasUnseen={hasUnseenAfter(lastSeen, conversationMessageCount(conv))}
      showFolderBadge={showFolderBadge}
      onSelect={onSelect}
      onDone={onDone}
    />
  );
});

/**
 * Extracted conversation item — avoids duplicating JSX across list/grouped modes.
 * showFolderBadge=false in grouped mode since the folder header already shows the path.
 */
function ConversationItem({
  conv,
  isActive,
  hasUnseen,
  showFolderBadge,
  onSelect,
  onDone,
}: {
  conv: Conversation;
  isActive: boolean;
  hasUnseen: boolean;
  showFolderBadge: boolean;
  onSelect: (conv: Conversation) => void;
  /** Null while disconnected: the command would be dropped, so the button is disabled. */
  onDone: ((conv: Conversation, e: React.MouseEvent) => void) | null;
}) {
  const workingDirectory = normalizeFolderDirectory(conv.workingDirectory);
  const projectColor = getProjectColor(workingDirectory);
  const dirDisplay = shortenHomePath(workingDirectory);
  const folderName = workingDirectory.split('/').filter(Boolean).pop() ?? dirDisplay;
  const title = getConversationTitle(conv);

  const lastTime = getConversationLastActivity(conv);
  const timeAgo = lastTime ? formatTimeAgo(lastTime) : null;
  const timeColor = lastTime ? timeAgoColor(getMinutesElapsed(lastTime)) : undefined;

  const itemClasses = isActive ? 'conversation-item active' : 'conversation-item';

  // ONE row shape for every conversation, buddy or not:
  //   [folder badge] title — time [status]  (+ Done on hover)
  // There used to be a second two-line branch here, kept only for non-buddy rows.
  // showFolderBadge is a display slot, not a second layout: grouped views hide the
  // badge because the group header already names the folder.
  return (
    <div
      className={itemClasses}
      onClick={() => onSelect(conv)}
      title={`${title}${timeAgo ? ` — ${timeAgo}` : ''}`}
    >
      <div className="conversation-row">
        {showFolderBadge && (
          <span className="folder-badge" style={{ color: projectColor }} title={dirDisplay}>
            {isBuddyBuilderConversation(conv)
              ? 'Builder'
              : isBuddyConversation(conv)
                ? 'Buddies'
                : folderName}
          </span>
        )}
        <span className="conversation-title" title={title}>
          {title}
        </span>
        {timeAgo && (
          <>
            <span className="conversation-row-sep" aria-hidden="true">
              —
            </span>
            <span className="conversation-time-ago" style={{ color: timeColor }}>
              {timeAgo}
            </span>
          </>
        )}
        {conv.isRunning ? (
          <span className="status-indicator running" aria-label="Conversation is running" />
        ) : (
          <span
            className={`status-indicator ${conv.queue?.length ? 'pending' : hasUnseen ? 'unread' : ''}`}
            aria-label={
              conv.queue?.length
                ? 'Conversation has queued work'
                : hasUnseen
                  ? 'Conversation finished with unread messages'
                  : 'Conversation idle'
            }
          />
        )}
      </div>
      <button
        type="button"
        className="done-btn"
        disabled={onDone === null}
        title={onDone === null ? 'Reconnecting to the server' : undefined}
        onClick={(e) => onDone?.(conv, e)}
      >
        Done
      </button>
    </div>
  );
}
