/**
 * client/src/utils/swarmConvoParsers.ts
 *
 * Pure parsers extracted from SwarmConvoPrefix.tsx:10-71.
 * No React, no CSS side-effect imports — safe for mobile `utils/` path.
 *
 * Mobile (SwarmDetailMobile / SwarmsMobile) imports from here;
 * desktop SwarmConvoPrefix re-exports from here and stays thin.
 */

export interface SwarmPrefixStats {
  project: string | null;
  completed: string | null;
  iterations: string | null;
  merges: string | null;
  rejections: string | null;
  errors: string | null;
  started: string | null;
  runsDir: string | null;
  generatedAt: string | null;
  primaryConfig: string | null;
  oompaConfigSummary: string | null;
}

export interface SwarmWorkerTable {
  headers: string[];
  rows: string[][];
}

/** Parse key stats from the prefix text for the collapsed summary line. */
export function parseStatsFromPrefix(prefix: string): SwarmPrefixStats {
  const get = (label: string): string | null => {
    const match = prefix.match(new RegExp(`^- ${label}:\\s*(.+)$`, 'm'));
    return match?.[1]?.trim() ?? null;
  };
  const runsMatch = prefix.match(/^Oompa run files are saved to:\s*(.+)$/m);
  return {
    project: get('Project'),
    completed: get('Completed'),
    iterations: get('Total Iterations'),
    merges: get('Merges'),
    rejections: get('Rejections'),
    errors: get('Errors'),
    started: get('Started'),
    runsDir: runsMatch?.[1]?.trim() ?? null,
    generatedAt: get('Generated At'),
    primaryConfig: get('Primary Config'),
    oompaConfigSummary: get('Oompa Config Summary'),
  };
}

/** Parse the worker table from the prefix text. */
export function parseWorkerTable(prefix: string): SwarmWorkerTable | null {
  const sectionMatch = prefix.match(/## Worker Status\n([\s\S]*?)(?=\n##|\n\nGiven|$)/);
  if (!sectionMatch) return null;

  const lines = sectionMatch[1]
    .trim()
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('---'));
  if (lines.length < 2) return null;

  const headers = lines[0].split('|').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => line.split('|').map((c) => c.trim()));
  return { headers, rows };
}

/** Parse available config files from prefix text. */
export function parseAvailableConfigs(prefix: string): string[] {
  const sectionMatch = prefix.match(/## Available Oompa Config Files\n([\s\S]*?)(?=\n##|\n\n|$)/);
  if (!sectionMatch) return [];

  return sectionMatch[1]
    .split('\n')
    .map((line) => line.trim().replace(/^- /, ''))
    .filter((line) => line.length > 0 && line !== '(none found)');
}
