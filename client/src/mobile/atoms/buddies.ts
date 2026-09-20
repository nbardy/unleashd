import { atom } from 'jotai';
import { archivedBuddyIdsAtom } from '../../atoms/buddy-visibility';
import type { BuddyOverview, BuddyOverviewEmployee } from '../../components/buddies/types';
import {
  filterDirectoryEmployees,
  selectDirectoryEmployees,
} from '../../components/buddies/ui-contract';

export type BuddyDirectorySort = 'project' | 'recent';
export interface MobileBuddyGroup {
  id: string;
  name: string;
  employees: BuddyOverviewEmployee[];
}

// Keep directory membership, search, counts and grouping in the same projection.
export function mobileBuddyDirectoryAtom(
  overview: BuddyOverview | null,
  query: string,
  sort: BuddyDirectorySort
) {
  return atom((get) => {
    const archived = get(archivedBuddyIdsAtom);
    const employees = selectDirectoryEmployees(overview).filter(
      (entry) => !archived.has(entry.buddy.id)
    );
    const filtered = filterDirectoryEmployees(employees, query);
    const groups = new Map<string, MobileBuddyGroup>();
    for (const entry of filtered) {
      // A Buddy assigned to several projects is reachable from each project.
      const workspaces =
        sort === 'recent'
          ? [{ id: 'recent', name: 'Recently active' }]
          : entry.workspaces.length
            ? entry.workspaces
            : [{ id: 'unassigned', name: 'No project' }];
      for (const workspace of workspaces) {
        let group = groups.get(workspace.id);
        if (!group) {
          group = { id: workspace.id, name: workspace.name, employees: [] };
          groups.set(workspace.id, group);
        }
        if (!group.employees.some((item) => item.buddy.id === entry.buddy.id))
          group.employees.push(entry);
      }
    }
    const result = [...groups.values()];
    if (sort === 'project') {
      result.sort(
        (a, b) =>
          Number(a.id === 'unassigned') - Number(b.id === 'unassigned') ||
          a.name.localeCompare(b.name)
      );
      for (const group of result)
        group.employees.sort((a, b) => a.buddy.name.localeCompare(b.buddy.name));
    }
    return { groups: result, total: employees.length, matched: filtered.length };
  });
}
