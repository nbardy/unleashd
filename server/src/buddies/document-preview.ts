import { MEMORY_DOCUMENT_CAPS } from '@nbardy/buddies';
import { BuddyMemoryOperationError } from './contract';

/** A preview has the same revision contract as a write and exposes only its requested document. */
export function previewBuddyDocument(
  before: {
    buddyId: string;
    doc: keyof typeof MEMORY_DOCUMENT_CAPS | 'shared' | 'note';
    content: string;
    revision: number;
  },
  content: string,
  baseVersion: number
) {
  if (before.revision !== baseVersion)
    throw new BuddyMemoryOperationError(
      'MEMORY_STALE',
      `Document revision conflict: current ${before.revision}`
    );
  const cap =
    before.doc === 'shared' || before.doc === 'note' ? 32000 : MEMORY_DOCUMENT_CAPS[before.doc];
  if (content.length > cap)
    throw new BuddyMemoryOperationError(
      'MEMORY_TOO_LARGE',
      `${before.doc} memory exceeds ${cap} characters`
    );
  const oldLines = before.content.split('\n');
  const newLines = content.split('\n');
  let start = 0;
  let end = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start])
    start++;
  while (
    end < oldLines.length - start &&
    end < newLines.length - start &&
    oldLines[oldLines.length - 1 - end] === newLines[newLines.length - 1 - end]
  )
    end++;
  return {
    preview: true,
    targetBuddyId: before.buddyId,
    doc: before.doc,
    baseVersion,
    revision: before.revision,
    diff: {
      startLine: start + 1,
      removed: oldLines.slice(start, oldLines.length - end),
      added: newLines.slice(start, newLines.length - end),
    },
  };
}
