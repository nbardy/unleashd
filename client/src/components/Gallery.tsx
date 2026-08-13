import type { Conversation, Message } from '@unleashd/shared';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { allConversationsAtom } from '../atoms/conversations';
import {
  doneConversationsAtom,
  galleryCollapsedProjectsAtom,
  galleryExpandedProjectsAtom,
  promoteWorker,
  promotedWorkersAtom,
  setShowDoneConversations,
  setShowTempSessions,
  setShowWorkerConversations,
  showDoneConversationsAtom,
  showTempSessionsAtom,
  showWorkerConversationsAtom,
  toggleGalleryCollapsed,
  toggleGalleryExpanded,
  unmarkDone,
} from '../atoms/ui';
import { useFolderFilter } from '../hooks/useFolderFilter';
import { useUrlFolderSelection } from '../hooks/useUrlFolderSelection';
import { getProjectColor } from '../utils/projectColors';
import { isWorktreeDirectory } from '../utils/swarmUtils';
import { formatTimeAgo, getLastMessageTime } from '../utils/time';
import { FolderFilter } from './FolderFilter';
import './Gallery.css';

/**
 * Detect if a working directory is a temporary/ephemeral path.
 * macOS uses /private/var/folders/ for temp directories.
 * These are legitimate sessions but clutter the Gallery.
 */
function isTempDirectory(workingDirectory: string): boolean {
  return (
    workingDirectory.includes('/private/var/folders/') ||
    workingDirectory.includes('/var/folders/') ||
    workingDirectory.includes('/tmp/') ||
    workingDirectory.includes('/temp/')
  );
}

// Project group interface for grouping conversations by working directory
interface ProjectGroup {
  directory: string;
  conversations: Conversation[];
}

// Number of conversations to show per project before "Show more" button
const CONVERSATIONS_PER_PROJECT = 10;
const EMPTY_CONVERSATIONS: Conversation[] = [];

type ProjectProjection = 'real' | 'temp' | 'worker' | 'done';

function compareConversationsByCreatedAtDesc(a: Conversation, b: Conversation): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

interface GalleryProps {
  filter?: 'done' | 'workers';
}

export function Gallery({ filter }: GalleryProps = {}) {
  const allConversations = useAtomValue(allConversationsAtom);
  const navigate = useNavigate();

  // Tick every 30s to keep time-ago displays current
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Persisted Gallery UI state via atoms/ui
  const galleryExpandedProjects = useAtomValue(galleryExpandedProjectsAtom);
  const galleryCollapsedProjects = useAtomValue(galleryCollapsedProjectsAtom);
  const showTempSessions = useAtomValue(showTempSessionsAtom);
  const showDoneConversations = useAtomValue(showDoneConversationsAtom);
  const doneConversations = useAtomValue(doneConversationsAtom);
  const promotedWorkers = useAtomValue(promotedWorkersAtom);
  const showWorkerConversations = useAtomValue(showWorkerConversationsAtom);
  const [showDoneBySection, setShowDoneBySection] = useState<Record<string, boolean>>({});

  // Derived Sets for O(1) lookup
  const expandedProjects = useMemo(
    () => new Set(galleryExpandedProjects),
    [galleryExpandedProjects]
  );
  const collapsedProjects = useMemo(
    () => new Set(galleryCollapsedProjects),
    [galleryCollapsedProjects]
  );
  const doneSet = useMemo(() => new Set(doneConversations), [doneConversations]);
  const promotedSet = useMemo(() => new Set(promotedWorkers), [promotedWorkers]);

  // Filter to top-level conversations and sort by createdAt (newest first).
  // allConversations only changes on structural events, not streaming — cheap useMemo.
  const sortedConversations = useMemo(() => {
    const byId = new Set(allConversations.map((conv) => conv.id));
    const topLevel = allConversations.filter((conv) => {
      if (conv.mergeChildMeta) return false;
      const parentId = conv.parentConversationId;
      return !(parentId && byId.has(parentId));
    });

    return topLevel.sort(compareConversationsByCreatedAtDesc);
  }, [allConversations]);

  // Get folder from conversation
  const getFolder = useCallback((conv: { workingDirectory: string }) => conv.workingDirectory, []);

  // Format folder for display (shorten home directory)
  const formatFolder = useCallback((folder: string) => {
    return folder.replace(/^\/Users\/[^/]+/, '~');
  }, []);

  // Folder selection state lives in URL query params (?folders=...)
  const [selectedFolders, setSelectedFolders] = useUrlFolderSelection();

  // Folder filter hook — pure computation, caller owns state
  const {
    folders: allFolders,
    selected,
    toggle,
    clear,
    filtered,
  } = useFolderFilter({
    items: sortedConversations,
    getFolder,
    selected: selectedFolders,
    setSelected: setSelectedFolders,
  });

  // Filter temp directories and sort folders by most recent conversation (not alphabetical)
  const folders = useMemo(() => {
    const nonTemp = allFolders.filter(
      (folder) => !isTempDirectory(folder) && !isWorktreeDirectory(folder)
    );

    // Build a map of folder -> most recent conversation date
    const folderRecency = new Map<string, number>();
    for (const conv of sortedConversations) {
      const dir = conv.workingDirectory;
      if (!folderRecency.has(dir)) {
        // First encounter is the newest since sortedConversations is newest-first
        folderRecency.set(dir, new Date(conv.createdAt).getTime());
      }
    }

    // Sort by most recent conversation descending
    return nonTemp.sort((a, b) => {
      const aTime = folderRecency.get(a) ?? 0;
      const bTime = folderRecency.get(b) ?? 0;
      return bTime - aTime;
    });
  }, [allFolders, sortedConversations]);

  // Group filtered conversations by working directory, separating done → worker → temp → real
  const {
    projectGroups,
    tempGroups,
    tempSessionCount,
    doneGroups,
    doneSessionCount,
    workerGroups,
    workerSessionCount,
    doneRealGroups,
    doneTempGroups,
    doneWorkerGroups,
  } = useMemo(() => {
    const realGroups = new Map<string, Conversation[]>();
    const tempGroupsMap = new Map<string, Conversation[]>();
    const doneGroupsMap = new Map<string, Conversation[]>();
    const workerGroupsMap = new Map<string, Conversation[]>();
    const doneRealGroupsMap = new Map<string, Conversation[]>();
    const doneTempGroupsMap = new Map<string, Conversation[]>();
    const doneWorkerGroupsMap = new Map<string, Conversation[]>();

    // Group by working directory, separating done → worker → temp → real
    for (const conv of filtered) {
      const dir = conv.workingDirectory;
      if (doneSet.has(conv.sessionId ?? conv.id)) {
        if (!doneGroupsMap.has(dir)) doneGroupsMap.set(dir, []);
        doneGroupsMap.get(dir)!.push(conv);
        if (conv.isWorker && !promotedSet.has(conv.id)) {
          if (!doneWorkerGroupsMap.has(dir)) doneWorkerGroupsMap.set(dir, []);
          doneWorkerGroupsMap.get(dir)!.push(conv);
        } else if (isTempDirectory(dir)) {
          if (!doneTempGroupsMap.has(dir)) doneTempGroupsMap.set(dir, []);
          doneTempGroupsMap.get(dir)!.push(conv);
        } else {
          if (!doneRealGroupsMap.has(dir)) doneRealGroupsMap.set(dir, []);
          doneRealGroupsMap.get(dir)!.push(conv);
        }
      } else if (conv.isWorker && !promotedSet.has(conv.id)) {
        // Worker that hasn't been promoted to main view
        if (!workerGroupsMap.has(dir)) workerGroupsMap.set(dir, []);
        workerGroupsMap.get(dir)!.push(conv);
      } else if (isTempDirectory(dir)) {
        if (!tempGroupsMap.has(dir)) tempGroupsMap.set(dir, []);
        tempGroupsMap.get(dir)!.push(conv);
      } else {
        if (!realGroups.has(dir)) realGroups.set(dir, []);
        realGroups.get(dir)!.push(conv);
      }
    }

    // Convert to array of ProjectGroup objects
    const toGroupArray = (groups: Map<string, Conversation[]>): ProjectGroup[] => {
      const groupArray: ProjectGroup[] = Array.from(groups.entries()).map(([directory, convs]) => ({
        directory,
        conversations: convs,
      }));

      // Sort groups by most recent conversation in each group (newest first)
      groupArray.sort((a, b) => {
        return compareConversationsByCreatedAtDesc(a.conversations[0], b.conversations[0]);
      });

      return groupArray;
    };

    // Count total temp sessions
    let tempCount = 0;
    for (const convs of tempGroupsMap.values()) {
      tempCount += convs.length;
    }

    // Count total done sessions
    let doneCount = 0;
    for (const convs of doneGroupsMap.values()) {
      doneCount += convs.length;
    }

    // Count total worker sessions
    let workerCount = 0;
    for (const convs of workerGroupsMap.values()) {
      workerCount += convs.length;
    }

    return {
      projectGroups: toGroupArray(realGroups),
      tempGroups: toGroupArray(tempGroupsMap),
      tempSessionCount: tempCount,
      doneGroups: toGroupArray(doneGroupsMap),
      doneSessionCount: doneCount,
      workerGroups: toGroupArray(workerGroupsMap),
      workerSessionCount: workerCount,
      doneRealGroups: doneRealGroupsMap,
      doneTempGroups: doneTempGroupsMap,
      doneWorkerGroups: doneWorkerGroupsMap,
    };
  }, [filtered, doneSet, promotedSet]);

  const isDoneView = filter === 'done';
  const isWorkersView = filter === 'workers';

  const getSectionKey = useCallback(
    (projection: Exclude<ProjectProjection, 'done'>, directory: string) =>
      `${projection}:${directory}`,
    []
  );

  const toggleSectionDoneVisibility = useCallback(
    (projection: Exclude<ProjectProjection, 'done'>, directory: string) => {
      const sectionKey = getSectionKey(projection, directory);
      setShowDoneBySection((current) => ({
        ...current,
        [sectionKey]: !current[sectionKey],
      }));
    },
    [getSectionKey]
  );

  const getDoneConversationsForSection = useCallback(
    (projection: Exclude<ProjectProjection, 'done'>, directory: string) => {
      switch (projection) {
        case 'real':
          return doneRealGroups.get(directory) ?? EMPTY_CONVERSATIONS;
        case 'temp':
          return doneTempGroups.get(directory) ?? EMPTY_CONVERSATIONS;
        case 'worker':
          return doneWorkerGroups.get(directory) ?? EMPTY_CONVERSATIONS;
      }
    },
    [doneRealGroups, doneTempGroups, doneWorkerGroups]
  );

  const renderConversationCard = useCallback(
    (conv: Conversation, showWorkerBadge = false) => {
      const conversationKey = conv.sessionId ?? conv.id;
      const isDoneConversation = doneSet.has(conversationKey);
      const state = conv.isRunning ? 'running' : 'idle';
      const accentColor = getProjectColor(conv.workingDirectory);
      const cardClassName = [
        'gallery-card',
        isDoneConversation && !isDoneView ? 'done-card' : '',
        showWorkerBadge && !isWorkersView && !isDoneConversation ? 'worker-card' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const getStateLabel = () => {
        if (state === 'running') return 'Running';
        const lastTime = getLastMessageTime(conv.messages);
        return lastTime ? `Idle · ${formatTimeAgo(lastTime)}` : 'Idle';
      };

      return (
        <div
          key={conv.id}
          className={cardClassName}
          onClick={() => navigate(`/chat/${conv.id}`)}
          style={{ borderTopColor: accentColor }}
        >
          <div className="gallery-card-header">
            <div className="gallery-card-id">
              {conv.id.substring(0, 8)}
              {showWorkerBadge ? (
                <span className="provider-badge provider-worker">worker</span>
              ) : (
                <span className={`provider-badge provider-${conv.provider || 'claude'}`}>
                  {conv.provider || 'claude'}
                </span>
              )}
            </div>
            <div className="gallery-card-status">
              {isDoneConversation ? (
                <button
                  type="button"
                  className="undo-done-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    unmarkDone(conversationKey);
                  }}
                >
                  Restore
                </button>
              ) : showWorkerBadge ? (
                <button
                  type="button"
                  className="promote-worker-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    promoteWorker(conv.id);
                  }}
                >
                  Promote
                </button>
              ) : null}
              <div className={`state-badge state-${state}`}>
                <div className="state-indicator" />
                <span className="state-label">{getStateLabel()}</span>
              </div>
            </div>
          </div>
          <div>{conv.messageCount ?? conv.messages.length} messages</div>
          <div className="gallery-messages">
            {conv.messages.length === 0 ? (
              <div className="empty-state">No messages yet</div>
            ) : (
              conv.messages.slice(-3).map((msg: Message, i: number) => (
                <div key={i} className={`gallery-message ${msg.role}`}>
                  <strong>{msg.role}:</strong> {msg.content.substring(0, 100)}
                  {msg.content.length > 100 ? '...' : ''}
                </div>
              ))
            )}
          </div>
        </div>
      );
    },
    [doneSet, isDoneView, isWorkersView, navigate]
  );

  const renderProjectSection = useCallback(
    ({
      group,
      projection,
      sectionClassName,
      pathLabel = formatFolder(group.directory),
      countLabel = 'conversation',
      showWorkerBadge = false,
    }: {
      group: ProjectGroup;
      projection: ProjectProjection;
      sectionClassName?: string;
      pathLabel?: string;
      countLabel?: string;
      showWorkerBadge?: boolean;
    }) => {
      const isCollapsed = collapsedProjects.has(group.directory);
      const isExpanded = expandedProjects.has(group.directory);
      const doneConversationsForSection =
        projection === 'done'
          ? EMPTY_CONVERSATIONS
          : getDoneConversationsForSection(projection, group.directory);
      const sectionKey = projection === 'done' ? null : getSectionKey(projection, group.directory);
      const showDoneInSection = sectionKey ? Boolean(showDoneBySection[sectionKey]) : false;
      const sectionConversations = showDoneInSection
        ? [...group.conversations, ...doneConversationsForSection].sort(
            compareConversationsByCreatedAtDesc
          )
        : group.conversations;
      const totalCount = sectionConversations.length;
      const hiddenCount = totalCount - CONVERSATIONS_PER_PROJECT;
      const showMoreButton = totalCount > CONVERSATIONS_PER_PROJECT && !isExpanded;
      const visibleConversations = isExpanded
        ? sectionConversations
        : sectionConversations.slice(0, CONVERSATIONS_PER_PROJECT);

      return (
        <div
          key={`${projection}:${group.directory}`}
          className={[
            'project-section',
            sectionClassName,
            projection !== 'done' && doneConversationsForSection.length > 0
              ? 'has-done-toggle'
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="project-header-row">
            <button
              type="button"
              className="project-header"
              onClick={() => toggleGalleryCollapsed(group.directory)}
            >
              <div className="project-header-left">
                <span className={`project-chevron ${isCollapsed ? 'collapsed' : ''}`}>&#9660;</span>
                <span className="project-path">{pathLabel}</span>
              </div>
              <span className="project-count">
                {totalCount} {countLabel}
                {totalCount !== 1 ? 's' : ''}
              </span>
            </button>

            {projection !== 'done' && doneConversationsForSection.length > 0 && (
              <button
                type="button"
                className={`project-done-toggle ${showDoneInSection ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSectionDoneVisibility(projection, group.directory);
                }}
              >
                {showDoneInSection
                  ? 'Hide done'
                  : `Show ${doneConversationsForSection.length} done`}
              </button>
            )}
          </div>

          {!isCollapsed && (
            <>
              <div className="project-grid">
                {visibleConversations.map((conv) => renderConversationCard(conv, showWorkerBadge))}
              </div>

              {showMoreButton && (
                <button
                  type="button"
                  className="show-more-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGalleryExpanded(group.directory);
                  }}
                >
                  Show more... ({hiddenCount} hidden)
                </button>
              )}

              {isExpanded && totalCount > CONVERSATIONS_PER_PROJECT && (
                <button
                  type="button"
                  className="show-more-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGalleryExpanded(group.directory);
                  }}
                >
                  Show less
                </button>
              )}
            </>
          )}
        </div>
      );
    },
    [
      collapsedProjects,
      expandedProjects,
      formatFolder,
      getDoneConversationsForSection,
      getSectionKey,
      renderConversationCard,
      showDoneBySection,
      toggleSectionDoneVisibility,
    ]
  );

  if (allConversations.length === 0) {
    return (
      <div className="gallery-view">
        <div className="empty-state">
          No conversations yet. Click "+ New Conversation" to start.
        </div>
      </div>
    );
  }

  if (isDoneView && doneSessionCount === 0) {
    return (
      <div className="gallery-view">
        <div className="gallery-done-header">
          <button type="button" className="back-to-gallery-btn" onClick={() => navigate('/')}>
            &#8592; Gallery
          </button>
          <h2>Done Conversations</h2>
        </div>
        <div className="empty-state">
          No done conversations. Mark conversations as done from the sidebar.
        </div>
      </div>
    );
  }

  if (isWorkersView && workerSessionCount === 0) {
    return (
      <div className="gallery-view">
        <div className="gallery-done-header">
          <button type="button" className="back-to-gallery-btn" onClick={() => navigate('/')}>
            &#8592; Gallery
          </button>
          <h2>Worker Conversations</h2>
        </div>
        <div className="empty-state">
          No worker conversations. Workers are detected by the [oompa] prefix in the first message.
        </div>
      </div>
    );
  }

  return (
    <div className="gallery-view">
      {isDoneView ? (
        <div className="gallery-done-header">
          <button type="button" className="back-to-gallery-btn" onClick={() => navigate('/')}>
            &#8592; Gallery
          </button>
          <h2>Done Conversations ({doneSessionCount})</h2>
        </div>
      ) : isWorkersView ? (
        <div className="gallery-done-header">
          <button type="button" className="back-to-gallery-btn" onClick={() => navigate('/')}>
            &#8592; Gallery
          </button>
          <h2>Worker Sessions ({workerSessionCount})</h2>
        </div>
      ) : (
        <FolderFilter
          folders={folders}
          selected={selected}
          onToggle={toggle}
          onClear={clear}
          formatFolder={formatFolder}
          conversations={sortedConversations}
          onSelectConversation={(id) => navigate(`/chat/${id}`)}
        />
      )}
      <div className="gallery-content">
        {/* Regular project groups — hidden in done/workers view */}
        {!isDoneView &&
          !isWorkersView &&
          projectGroups.map((group) =>
            renderProjectSection({
              group,
              projection: 'real',
            })
          )}

        {/* Temp sessions toggle and groups — hidden in done/workers view */}
        {!isDoneView && !isWorkersView && tempSessionCount > 0 && (
          <div className="temp-sessions-section">
            <button
              type="button"
              className="temp-sessions-toggle"
              onClick={() => setShowTempSessions(!showTempSessions)}
            >
              <span className={`project-chevron ${!showTempSessions ? 'collapsed' : ''}`}>
                &#9660;
              </span>
              {showTempSessions ? 'Hide' : 'Show'} {tempSessionCount} temporary session
              {tempSessionCount !== 1 ? 's' : ''}
              <span className="temp-sessions-hint">(sessions from /tmp, /var/folders, etc.)</span>
            </button>

            {showTempSessions &&
              tempGroups.map((group) =>
                renderProjectSection({
                  group,
                  projection: 'temp',
                  sectionClassName: 'temp-project',
                  pathLabel: group.directory.includes('/T/tmp')
                    ? `[Temp] ${group.directory.match(/tmp[A-Za-z0-9_-]*/)?.[0] || 'session'}`
                    : formatFolder(group.directory),
                })
              )}
          </div>
        )}

        {/* Worker conversations — shown in workers view, toggleable in main view */}
        {(isWorkersView || workerSessionCount > 0) && !isDoneView && (
          <div className="worker-sessions-section">
            {!isWorkersView && (
              <button
                type="button"
                className="worker-sessions-toggle"
                onClick={() => setShowWorkerConversations(!showWorkerConversations)}
              >
                <span className={`project-chevron ${!showWorkerConversations ? 'collapsed' : ''}`}>
                  &#9660;
                </span>
                {showWorkerConversations ? 'Hide' : 'Show'} {workerSessionCount} worker session
                {workerSessionCount !== 1 ? 's' : ''}
                <span className="worker-sessions-hint">(oompa-spawned)</span>
              </button>
            )}

            {(isWorkersView || showWorkerConversations) &&
              workerGroups.map((group) =>
                renderProjectSection({
                  group,
                  projection: 'worker',
                  sectionClassName: 'worker-project',
                  countLabel: 'worker',
                  showWorkerBadge: true,
                })
              )}
          </div>
        )}

        {/* Done conversations toggle and groups — always expanded in done view */}
        {doneSessionCount > 0 && !isWorkersView && (
          <div className="done-sessions-section">
            {!isDoneView && (
              <button
                type="button"
                className="done-sessions-toggle"
                onClick={() => setShowDoneConversations(!showDoneConversations)}
              >
                <span className={`project-chevron ${!showDoneConversations ? 'collapsed' : ''}`}>
                  &#9660;
                </span>
                {showDoneConversations ? 'Hide' : 'Show'} {doneSessionCount} done conversation
                {doneSessionCount !== 1 ? 's' : ''}
              </button>
            )}

            {(isDoneView || showDoneConversations) &&
              doneGroups.map((group) =>
                renderProjectSection({
                  group,
                  projection: 'done',
                  sectionClassName: 'done-project',
                })
              )}
          </div>
        )}
      </div>
    </div>
  );
}
