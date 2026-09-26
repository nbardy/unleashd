import { CLAUDE_SUBAGENT_TOOL_NAMES } from '@nbardy/agent-cli';
import type { Provider, SubAgentStatus } from '@unleashd/shared';

const GEMINI_LOCAL_AGENT_LABELS: Record<string, string> = {
  generalist: 'Generalist Agent',
  browser_agent: 'Browser Agent',
  codebase_investigator: 'Codebase Investigator Agent',
  cli_help: 'CLI Help Agent',
};

// Codex native sub-agent collab tools. Emitted with an `_phase` marker
// ('started' | 'completed') carrying the full collab payload (prompt,
// receiver thread ids, per-child agent states).
const CODEX_COLLAB_TOOL_NAMES = new Set(['spawn_agent', 'wait', 'send_input']);

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export interface CodexCollabAgentState {
  status?: string;
  message?: string | null;
}

function normalizeCodexAgentState(value: unknown): CodexCollabAgentState | null {
  const record = asRecord(value);
  if (!record) return null;
  const out: CodexCollabAgentState = {};
  if (typeof record.status === 'string') out.status = record.status;
  if (typeof record.message === 'string' || record.message === null) {
    out.message = record.message as string | null;
  }
  return out;
}

// Claude's spawn tool is `Agent` since Claude Code 2.1 and `Task` before; matching only `Task`
// hid every 2.1 sub-agent. The harness owns the name set (agent-cli CLAUDE_SUBAGENT_TOOL_NAMES).
// Guard: conversation-runtime.test.ts "a recorded Claude 2.1 Agent launch becomes a sub-agent".
export function isSubagentSpawnTool(provider: Provider, toolName: string): boolean {
  return (
    CLAUDE_SUBAGENT_TOOL_NAMES.has(toolName) ||
    (provider === 'gemini' && toolName in GEMINI_LOCAL_AGENT_LABELS) ||
    (provider === 'codex' && toolName === 'spawn_agent')
  );
}

export function getSubagentDescription(
  provider: Provider,
  toolName: string,
  input: Record<string, unknown>
): string {
  if (CLAUDE_SUBAGENT_TOOL_NAMES.has(toolName)) {
    const description = firstString(input.description) ?? 'Running sub-agent task...';
    const subagentType = firstString(input.subagent_type);
    return subagentType ? `[${subagentType}] ${description}` : description;
  }

  if (provider === 'gemini' && toolName in GEMINI_LOCAL_AGENT_LABELS) {
    const label = GEMINI_LOCAL_AGENT_LABELS[toolName] ?? toolName;
    const request = firstString(input.request, input.task, input.objective, input.question);
    return request ? `[${label}] ${request}` : `Running ${label}...`;
  }

  if (provider === 'codex' && toolName === 'spawn_agent') {
    const request = firstString(input.prompt, input.task, input.description, input.objective);
    return request ? `[Codex Agent] ${request}` : 'Running Codex sub-agent...';
  }

  return `Running ${toolName}...`;
}

// Tool events carry `_phase` of 'started' or 'completed'. Anything else is
// rejected so callers can treat undefined as "no phase info".
export function getToolUsePhase(
  input: Record<string, unknown>
): 'started' | 'completed' | undefined {
  const phase = input._phase;
  return phase === 'started' || phase === 'completed' ? phase : undefined;
}

export function isCodexCollabToolName(toolName: string): boolean {
  return CODEX_COLLAB_TOOL_NAMES.has(toolName);
}

export interface CodexCollabToolInput {
  phase: 'started' | 'completed' | undefined;
  senderThreadId: string | undefined;
  receiverThreadIds: string[];
  prompt: string | undefined;
  status: string | undefined;
  agentStates: Record<string, CodexCollabAgentState>;
}

export function extractCodexCollabToolInput(input: Record<string, unknown>): CodexCollabToolInput {
  const agentStates: Record<string, CodexCollabAgentState> = {};
  const rawAgentStates = asRecord(input.agents_states);
  if (rawAgentStates) {
    for (const [threadId, value] of Object.entries(rawAgentStates)) {
      const normalized = normalizeCodexAgentState(value);
      if (normalized) {
        agentStates[threadId] = normalized;
      }
    }
  }
  return {
    phase: getToolUsePhase(input),
    senderThreadId: firstString(input.sender_thread_id),
    receiverThreadIds: asStringArray(input.receiver_thread_ids),
    prompt: firstString(input.prompt),
    status: firstString(input.status),
    agentStates,
  };
}

// Observed codex per-child statuses (from manual_tests captures):
//   pending_init | in_progress | completed
// Error-ish tokens (failed, errored, cancelled) fold into 'error' so the UI
// can show a terminal red state. Anything else → fallback.
export function normalizeCodexSubagentStatus(
  rawStatus: string | undefined | null,
  fallback: SubAgentStatus
): SubAgentStatus {
  if (!rawStatus) return fallback;
  switch (rawStatus) {
    case 'pending_init':
      return 'pending';
    case 'completed':
      return 'completed';
    case 'in_progress':
    case 'running':
      return 'running';
    default:
      break;
  }
  const lower = rawStatus.toLowerCase();
  if (lower.includes('error') || lower.includes('fail') || lower.includes('cancel')) {
    return 'error';
  }
  if (lower.includes('pending')) return 'pending';
  if (lower.includes('run') || lower.includes('progress')) return 'running';
  return fallback;
}

export function isTerminalSubagentStatus(status: SubAgentStatus): boolean {
  return status === 'completed' || status === 'error';
}

function formatCodexCollabToolAction(toolName: string): string | undefined {
  switch (toolName) {
    case 'spawn_agent':
      return 'Starting';
    case 'wait':
      return 'Waiting';
    case 'send_input':
      return 'Sending follow-up';
    default:
      return undefined;
  }
}

export function getCodexSubagentCurrentAction(
  toolName: string,
  rawStatus: string | undefined | null,
  message: string | null | undefined
): string | undefined {
  const normalizedMessage = firstString(message);
  if (normalizedMessage) return normalizedMessage;
  if (rawStatus === 'pending_init') return 'Pending initialization';

  const lower = rawStatus?.toLowerCase();
  if (lower) {
    if (lower.includes('error') || lower.includes('fail') || lower.includes('cancel')) {
      return 'Error';
    }
    if (lower.includes('pending')) return 'Pending';
  }

  if (rawStatus === 'in_progress' || rawStatus === 'running') {
    return formatCodexCollabToolAction(toolName) ?? 'Running';
  }

  return undefined;
}
