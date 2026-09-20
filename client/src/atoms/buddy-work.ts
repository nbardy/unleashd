import { atom } from 'jotai';
import type { BuddyProject } from '../components/buddies/types';

/** Keep finished projects available without mixing them into current work. */
export function buddyWorkGroupsAtom(projects: BuddyProject[]) {
  return atom(() => ({
    current: projects.filter((project) => !['done', 'cancelled'].includes(project.status)),
    completed: projects.filter((project) => ['done', 'cancelled'].includes(project.status)),
  }));
}
