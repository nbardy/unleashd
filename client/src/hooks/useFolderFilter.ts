/**
 * useFolderFilter - Hook for managing folder filter computation
 *
 * Design:
 * - Caller owns the state (selected + setSelected) — this hook is pure computation
 * - Empty selection = all items pass filter
 * - Non-empty selection = only items in selected folders pass
 * - toggle() adds/removes folder from selection
 * - clear() resets selection to empty
 */

import { useCallback, useMemo } from 'react';

interface UseFolderFilterOptions<T> {
  items: readonly T[];
  getFolder: (item: T) => string;
  /** Currently selected folders — caller owns this state */
  selected: Set<string>;
  /** Setter for selected folders — caller owns this state */
  setSelected: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
}

interface UseFolderFilterResult<T> {
  /** All unique folders extracted from items */
  folders: string[];
  /** Currently selected folders (empty = all) */
  selected: Set<string>;
  /** Toggle a folder in/out of selection */
  toggle: (folder: string) => void;
  /** Clear all selections */
  clear: () => void;
  /** Items filtered by selection */
  filtered: readonly T[];
}

export function useFolderFilter<T>({
  items,
  getFolder,
  selected,
  setSelected,
}: UseFolderFilterOptions<T>): UseFolderFilterResult<T> {
  // Extract unique folders, sorted alphabetically
  const folders = useMemo(() => {
    const uniqueFolders = new Set<string>();
    items.forEach((item) => {
      uniqueFolders.add(getFolder(item));
    });
    return Array.from(uniqueFolders).sort();
  }, [items, getFolder]);

  // Toggle a folder in/out of selection
  const toggle = useCallback(
    (folder: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(folder)) {
          next.delete(folder);
        } else {
          next.add(folder);
        }
        return next;
      });
    },
    [setSelected]
  );

  // Clear all selections
  const clear = useCallback(() => {
    setSelected(new Set());
  }, [setSelected]);

  // Filter items by selection (empty = all pass)
  const filtered = useMemo(() => {
    if (selected.size === 0) {
      return items;
    }
    return items.filter((item) => selected.has(getFolder(item)));
  }, [items, selected, getFolder]);

  return { folders, selected, toggle, clear, filtered };
}
