import { CLAUDE_SUBAGENT_TOOL_NAMES } from '@nbardy/agent-cli';

const TOOL_SUMMARY_MAX_LEN = 100;
const MAX_SHELL_PARSE_DEPTH = 3;
const SHELL_TOOL_NAMES = new Set(['Bash', 'run_shell_command', 'shell']);
const SHELL_WRAPPER_NAMES = new Set(['bash', 'sh', 'zsh', 'fish']);
const OOMPA_SUBCOMMANDS = new Set(['run', 'swarm']);
const OOMPA_NON_LAUNCH_FLAGS = ['--dry-run', '--help', '-h'];
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=.*/;

function isLikelyOompaConfigArg(arg: string): boolean {
  if (!arg || arg.startsWith('-')) return false;
  const lower = arg.toLowerCase();
  return lower.endsWith('.json');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return null;
}

function basenameLower(token: string): string {
  return token.split('/').pop()?.toLowerCase() ?? token.toLowerCase();
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen - 3)}...`;
}

function splitShellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\' && i + 1 < command.length) {
        i += 1;
        current += command[i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '\\' && i + 1 < command.length) {
      i += 1;
      current += command[i];
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) words.push(current);
  return words;
}

function splitCommandChain(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    const next = i + 1 < command.length ? command[i + 1] : '';

    if (quote === "'") {
      current += char;
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      current += char;
      if (char === '\\' && i + 1 < command.length) {
        i += 1;
        current += command[i];
        continue;
      }
      if (char === '"') quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === '\\' && i + 1 < command.length) {
      current += char;
      i += 1;
      current += command[i];
      continue;
    }

    const isChainSep =
      char === '\n' ||
      char === ';' ||
      (char === '&' && next === '&') ||
      (char === '|' && next === '|');
    if (isChainSep) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      if ((char === '&' || char === '|') && next === char) {
        i += 1;
      }
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

function isEnvAssignmentToken(token: string): boolean {
  return ENV_ASSIGNMENT_RE.test(token);
}

function stripLeadingAssignments(tokens: string[]): string[] {
  let idx = 0;
  while (idx < tokens.length && isEnvAssignmentToken(tokens[idx])) idx += 1;
  return tokens.slice(idx);
}

function stripEnvPrefix(tokens: string[]): string[] {
  const withoutAssignments = stripLeadingAssignments(tokens);
  if (withoutAssignments.length === 0) return withoutAssignments;
  if (basenameLower(withoutAssignments[0]) !== 'env') return withoutAssignments;

  let idx = 1;
  while (idx < withoutAssignments.length) {
    const token = withoutAssignments[idx];
    if (token === '--') {
      idx += 1;
      break;
    }
    if (isEnvAssignmentToken(token)) {
      idx += 1;
      continue;
    }
    if (token === '-u' || token === '--unset') {
      idx += 2;
      continue;
    }
    if (token.startsWith('-')) {
      idx += 1;
      continue;
    }
    break;
  }

  return stripLeadingAssignments(withoutAssignments.slice(idx));
}

function findShellInlineCommand(tokens: string[]): string | null {
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '-c' || token === '-lc' || token === '--command') {
      return tokens[i + 1] ?? null;
    }
    if (token.startsWith('--command=')) {
      return token.slice('--command='.length);
    }
  }
  return null;
}

function isNonLaunchOompaInvocation(args: string[]): boolean {
  for (const rawToken of args) {
    const token = rawToken.toLowerCase();
    if (token === '--') break;
    if (OOMPA_NON_LAUNCH_FLAGS.includes(token)) return true;
    if (token.startsWith('--dry-run=')) return true;
  }
  return false;
}

function detectOompaSubcommand(command: string, depth = 0): 'run' | 'swarm' | null {
  if (depth > MAX_SHELL_PARSE_DEPTH) return null;
  const segments = splitCommandChain(command);
  for (const segment of segments) {
    const tokens = splitShellWords(segment);
    if (tokens.length === 0) continue;

    const normalized = stripEnvPrefix(tokens);
    if (normalized.length === 0) continue;

    const commandName = basenameLower(normalized[0]);
    const subcommand = normalized[1]?.toLowerCase();
    const args = normalized.slice(1);
    if (commandName === 'oompa' && subcommand && OOMPA_SUBCOMMANDS.has(subcommand)) {
      if (isNonLaunchOompaInvocation(args)) continue;
      return subcommand as 'run' | 'swarm';
    }
    if (commandName === 'oompa' && isLikelyOompaConfigArg(normalized[1] ?? '')) {
      if (isNonLaunchOompaInvocation(args)) continue;
      return 'run';
    }

    if (SHELL_WRAPPER_NAMES.has(commandName)) {
      const inlineCommand = findShellInlineCommand(normalized);
      if (!inlineCommand) continue;
      const nested = detectOompaSubcommand(inlineCommand, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function commandFromDisplayText(name: string, displayText?: string): string | null {
  if (typeof displayText !== 'string') return null;
  const text = normalizeLine(displayText);
  if (!text) return null;

  const lower = text.toLowerCase();
  const nameLower = name.toLowerCase();
  if (lower === nameLower || lower === `${nameLower}:`) return null;
  if (lower.startsWith(`${nameLower}:`)) {
    const suffix = text.slice(name.length + 1).trim();
    return suffix || null;
  }
  return text;
}

// Claude Code names and the other harnesses' names for the same tools.
const TOOL_EMOJI = new Map<string, string>([
  ...['Bash', 'shell', 'run_shell_command'].map((n) => [n, '⚡'] as const),
  ...['Read', 'read_file'].map((n) => [n, '📖'] as const),
  ...['Write', 'write_file'].map((n) => [n, '✍️'] as const),
  ...['Edit', 'replace'].map((n) => [n, '✏️'] as const),
  ...['Glob', 'glob', 'list_directory'].map((n) => [n, '📂'] as const),
  ...['Grep', 'WebSearch', 'grep_search'].map((n) => [n, '🔍'] as const),
  ...['WebFetch', 'web_fetch'].map((n) => [n, '🌐'] as const),
  ...[...CLAUDE_SUBAGENT_TOOL_NAMES].map((n) => [n, '▶️'] as const),
  ...['NotebookRead', 'NotebookEdit', 'code_execution'].map((n) => [n, '📓'] as const),
  ['TodoWrite', '📝'],
  ['patch', '🔀'],
]);

// The input field that summarizes a tool: its own field first, then the generic ones in order.
const NAMED_ARG = new Map<string, string>([
  ...[...CLAUDE_SUBAGENT_TOOL_NAMES].map((n) => [n, 'description'] as const),
  ['WebFetch', 'url'],
  ['WebSearch', 'query'],
]);
const GENERIC_ARGS = ['file_path', 'notebook_path', 'pattern', 'path', 'dir_path', 'query'];

function shellSummary(command: string): string {
  const subcommand = detectOompaSubcommand(command);
  const oneLine = normalizeLine(command);
  return subcommand ? `oompa ${subcommand} :: ${oneLine}` : oneLine;
}

function argSummaryOf(name: string, record: Record<string, unknown>): string {
  const command =
    (typeof record.command === 'string' && record.command) ||
    (typeof record.cmd === 'string' && record.cmd) ||
    null;
  if (SHELL_TOOL_NAMES.has(name) && command) return shellSummary(command);
  const named = NAMED_ARG.get(name);
  for (const field of named ? [named, ...GENERIC_ARGS] : GENERIC_ARGS) {
    const value = record[field];
    if (typeof value === 'string') return value;
  }
  return '';
}

/**
 * Codex emits two shell tool_use events:
 * - start: command string (keep)
 * - completion: exit_code only/no displayText (suppress duplicate line)
 */
export function isCompletionOnlyToolUse(
  name: string,
  input?: unknown,
  displayText?: string
): boolean {
  if (name !== 'shell') return false;
  if (typeof displayText === 'string' && displayText.trim().length > 0) return false;
  const record = asRecord(input);
  if (!record) return false;
  return typeof record.exit_code === 'number';
}

export function formatToolUse(name: string, input?: unknown, displayText?: string): string {
  if (name === 'AskUserQuestion') {
    // Interactive widget, not a standard text line
    return `<!--ask_user_question:${JSON.stringify(input || {})}-->`;
  }

  const emoji = TOOL_EMOJI.get(name) ?? '🔧';
  const record = asRecord(input);
  let argSummary = record ? argSummaryOf(name, record) : '';
  if (!argSummary && SHELL_TOOL_NAMES.has(name)) {
    const fallbackCommand = commandFromDisplayText(name, displayText);
    if (fallbackCommand) argSummary = shellSummary(fallbackCommand);
  }

  if (argSummary) {
    argSummary = truncate(argSummary, TOOL_SUMMARY_MAX_LEN);
  }

  return `${emoji} ${name}${argSummary ? ` ${argSummary}` : ''}`;
}
