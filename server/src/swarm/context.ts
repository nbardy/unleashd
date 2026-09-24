import fs from 'node:fs';
import path from 'node:path';
import type { OompaContextCommand } from './commands';

const MAX_COMMAND_OUTPUT_CHARS = 8_000;
const MAX_DOCUMENT_CHARS = 3_000;
const MAX_DOCUMENT_FILES = 6;

export interface SwarmContextDependencies {
  captureCommand(command: OompaContextCommand, cwd: string): Promise<string>;
  now(): Date;
}

export async function buildSwarmContext(
  projectRoot: string,
  dependencies: SwarmContextDependencies
): Promise<string> {
  // Both commands are independent and each may take up to its timeout; run them
  // together so the wait is the slower one, not the sum.
  const [statusOutput, infoOutput] = await Promise.all([
    dependencies.captureCommand('status', projectRoot),
    dependencies.captureCommand('info', projectRoot),
  ]);
  const availableConfigs = listAvailableConfigFiles(projectRoot);
  const primaryConfigPath = path.join(projectRoot, 'oompa.json');
  const documentation = findDocumentation(projectRoot).map((absolutePath) =>
    readDocumentation(projectRoot, absolutePath)
  );
  return [
    'You are helping create and run a NEW oompa swarm configuration.',
    'Use this context before writing or editing swarm config files.',
    '',
    '## Project Context',
    `- Project: ${projectRoot}`,
    `- Generated At: ${dependencies.now().toISOString()}`,
    `- Primary Config: ${fs.existsSync(primaryConfigPath) ? primaryConfigPath : 'not found'}`,
    `- Oompa Config Summary: ${summarizeOompaConfig(primaryConfigPath)}`,
    '',
    '## Available Oompa Config Files',
    ...(availableConfigs.length > 0
      ? availableConfigs.map((file) => `- ${file}`)
      : ['- (none found)']),
    '',
    '## Command Output: oompa status',
    '```',
    clip(statusOutput, MAX_COMMAND_OUTPUT_CHARS) || '(no output)',
    '```',
    '',
    '## Command Output: oompa info',
    '```',
    clip(infoOutput, MAX_COMMAND_OUTPUT_CHARS) || '(no output)',
    '```',
    '',
    '## Docs To Follow For Good Oompa Agents',
    ...(documentation.length > 0
      ? documentation.flatMap((block) => ['```markdown', block, '```'])
      : ['No docs discovered (look for README.md, AGENTS.md, and docs/*.md).']),
    '',
    'When the user asks for a new swarm config, follow these docs and command outputs exactly.',
    'Prefer editing or creating oompa config files and explain why each worker/planner/reviewer setting exists.',
  ].join('\n');
}

export function listAvailableConfigFiles(projectRoot: string): string[] {
  const files = new Set<string>();
  collectConfigFiles(projectRoot, files);
  const oompaDirectory = path.join(projectRoot, 'oompa');
  if (fs.existsSync(oompaDirectory)) collectConfigFiles(oompaDirectory, files);
  return Array.from(files).sort((left, right) => left.localeCompare(right));
}

function collectConfigFiles(directory: string, result: Set<string>): void {
  try {
    for (const file of fs.readdirSync(directory)) {
      if (file.toLowerCase().startsWith('oompa') && file.toLowerCase().endsWith('.json')) {
        result.add(path.join(directory, file));
      }
    }
  } catch {
    // A context response remains useful when one optional directory is unreadable.
  }
}

function summarizeOompaConfig(configPath: string): string {
  if (!fs.existsSync(configPath)) return 'No oompa.json found';
  try {
    const value = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const workers = Array.isArray(value.workers)
      ? (value.workers as Array<Record<string, unknown>>)
      : [];
    const workerSummary =
      workers.length === 0
        ? 'workers=0'
        : `workers=${workers.length} (${workers
            .map((worker, index) => {
              const harness = typeof worker.harness === 'string' ? worker.harness : 'default';
              const model = typeof worker.model === 'string' ? worker.model : 'default';
              const count = typeof worker.count === 'number' ? `x${worker.count}` : '';
              return `w${index}:${harness}:${model}${count}`;
            })
            .join(', ')})`;
    return `${workerSummary}; reviewer=${isObject(value.reviewer) ? 'yes' : 'no'}; planner=${
      isObject(value.planner) ? 'yes' : 'no'
    }`;
  } catch (error) {
    return `Failed to parse oompa.json: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function findDocumentation(projectRoot: string): string[] {
  const candidates = [
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    'docs/agent_client_spec.md',
    'docs/README.md',
    'docs/SWARM_GUIDE.md',
    'docs/OOMPA.md',
    'docs/JSON_TICKETS.md',
  ].map((relativePath) => path.join(projectRoot, relativePath));
  const docsDirectory = path.join(projectRoot, 'docs');
  try {
    candidates.push(
      ...fs
        .readdirSync(docsDirectory)
        .filter((file) => file.toLowerCase().endsWith('.md'))
        .sort((left, right) => left.localeCompare(right))
        .map((file) => path.join(docsDirectory, file))
    );
  } catch {
    // The fixed candidate list still applies when docs/ is absent.
  }
  return Array.from(new Set(candidates))
    .filter((candidate) => fs.existsSync(candidate))
    .slice(0, MAX_DOCUMENT_FILES);
}

function readDocumentation(projectRoot: string, absolutePath: string): string {
  const relativePath = path.relative(projectRoot, absolutePath) || path.basename(absolutePath);
  try {
    return `### ${relativePath}\n${clip(
      fs.readFileSync(absolutePath, 'utf-8'),
      MAX_DOCUMENT_CHARS
    )}`;
  } catch (error) {
    return `### ${relativePath}\nFailed to read file: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

function clip(value: string, maximumCharacters: number): string {
  return value.length <= maximumCharacters
    ? value
    : `${value.slice(0, maximumCharacters)}\n...<truncated>`;
}

function isObject(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}
