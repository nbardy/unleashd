import fs from 'node:fs/promises';
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
  // All file reads are async: this route used existsSync/readFileSync over up to
  // 6 docs + configs on the event loop until 2026-09-26.
  // Guard: `swarm routes never touch synchronous fs` (swarm-routes.test.ts).
  const availableConfigs = await listAvailableConfigFiles(projectRoot);
  const primaryConfigPath = path.join(projectRoot, 'oompa.json');
  const primaryConfigExists = await pathExists(primaryConfigPath);
  const configSummary = await summarizeOompaConfig(primaryConfigPath);
  const documentation = await Promise.all(
    (await findDocumentation(projectRoot)).map((absolutePath) =>
      readDocumentation(projectRoot, absolutePath)
    )
  );
  return [
    'You are helping create and run a NEW oompa swarm configuration.',
    'Use this context before writing or editing swarm config files.',
    '',
    '## Project Context',
    `- Project: ${projectRoot}`,
    `- Generated At: ${dependencies.now().toISOString()}`,
    `- Primary Config: ${primaryConfigExists ? primaryConfigPath : 'not found'}`,
    `- Oompa Config Summary: ${configSummary}`,
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

async function listAvailableConfigFiles(projectRoot: string): Promise<string[]> {
  const files = new Set<string>();
  await collectConfigFiles(projectRoot, files);
  await collectConfigFiles(path.join(projectRoot, 'oompa'), files);
  return Array.from(files).sort((left, right) => left.localeCompare(right));
}

async function collectConfigFiles(directory: string, result: Set<string>): Promise<void> {
  try {
    for (const file of await fs.readdir(directory)) {
      if (file.toLowerCase().startsWith('oompa') && file.toLowerCase().endsWith('.json')) {
        result.add(path.join(directory, file));
      }
    }
  } catch {
    // A context response remains useful when one optional directory is unreadable.
  }
}

async function summarizeOompaConfig(configPath: string): Promise<string> {
  if (!(await pathExists(configPath))) return 'No oompa.json found';
  try {
    const value = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>;
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

async function findDocumentation(projectRoot: string): Promise<string[]> {
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
      ...(await fs.readdir(docsDirectory))
        .filter((file) => file.toLowerCase().endsWith('.md'))
        .sort((left, right) => left.localeCompare(right))
        .map((file) => path.join(docsDirectory, file))
    );
  } catch {
    // The fixed candidate list still applies when docs/ is absent.
  }
  const unique = Array.from(new Set(candidates));
  const present = await Promise.all(unique.map(pathExists));
  return unique.filter((_, index) => present[index]).slice(0, MAX_DOCUMENT_FILES);
}

async function readDocumentation(projectRoot: string, absolutePath: string): Promise<string> {
  const relativePath = path.relative(projectRoot, absolutePath) || path.basename(absolutePath);
  try {
    return `### ${relativePath}\n${clip(
      await fs.readFile(absolutePath, 'utf-8'),
      MAX_DOCUMENT_CHARS
    )}`;
  } catch (error) {
    return `### ${relativePath}\nFailed to read file: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
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
