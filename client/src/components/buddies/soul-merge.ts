import { diff3Merge } from 'node-diff3';

export type SoulMergeBlock =
  | { kind: 'text'; lines: string[] }
  | { kind: 'conflict'; original: string[]; mine: string[]; saved: string[] };

/** Line arrays preserve Markdown whitespace; strings default to word splitting. */
export function mergeSoulDraft(original: string, mine: string, saved: string): SoulMergeBlock[] {
  return diff3Merge(mine.split('\n'), original.split('\n'), saved.split('\n'), {
    excludeFalseConflicts: true,
  }).map((block) => {
    if (block.ok) return { kind: 'text', lines: block.ok };
    if (block.conflict) {
      return {
        kind: 'conflict',
        original: block.conflict.o,
        mine: block.conflict.a,
        saved: block.conflict.b,
      };
    }
    throw new Error('Invalid three-way merge result');
  });
}

/** Undefined means unresolved; an empty array explicitly removes the region. */
export function resolveSoulMerge(
  blocks: SoulMergeBlock[],
  resolutions: Record<number, string[] | undefined>
): string | null {
  const lines: string[] = [];
  for (const [index, block] of blocks.entries()) {
    const resolved = block.kind === 'text' ? block.lines : resolutions[index];
    if (resolved === undefined) return null;
    lines.push(...resolved);
  }
  return lines.join('\n');
}
