import type { UnifiedAgentEvent } from '@nbardy/agent-cli';
import type { Provider, SubAgent } from '@unleashd/shared';
import {
  extractCodexCollabToolInput,
  getCodexSubagentCurrentAction,
  getSubagentDescription,
  isCodexCollabToolName,
  isSubagentSpawnTool,
  isTerminalSubagentStatus,
  normalizeCodexSubagentStatus,
} from '../subagent-tools';

/**
 * Sub-agent tracking for one turn's tool stream. Harnesses differ only here,
 * so the fold is chosen ONCE per turn from `SUB_AGENT_FOLDS` (a harness
 * capability table) and the turn fold never asks "which provider?" again.
 * Codex collab threads (spawn_agent / wait / send_input) are the one native
 * sub-agent protocol; every other harness uses the generic Task-style fold.
 */

type ToolUseEvent = Extract<UnifiedAgentEvent, { type: 'tool.use' }>;
type TaskStartedEvent = Extract<UnifiedAgentEvent, { type: 'task.started' }>;
type TaskFinishedEvent = Extract<UnifiedAgentEvent, { type: 'task.finished' }>;

export interface SubAgentHost {
  readonly conversationId: string;
  /** The conversation's live list; folds mutate it in place. */
  readonly agents: SubAgent[];
  /** One agent changed: its whole record goes out as a `subagent` patch. */
  changed(agent: SubAgent): void;
  newId(): string;
}

/** Whether the tool still renders as a transcript line after the sub-agent fold saw it. */
export type ToolLine = 'show' | 'hide';

export interface SubAgentFold {
  toolUse(host: SubAgentHost, event: ToolUseEvent): ToolLine;
  /** The harness started a task: bind it to the sub-agent its tool call spawned. */
  taskStarted(host: SubAgentHost, event: TaskStartedEvent): void;
  /** The harness says a task ended: that is the sub-agent's real end. */
  taskFinished(host: SubAgentHost, event: TaskFinishedEvent): void;
  /** The parent turn completed: settle the agents this harness only infers. */
  parentCompleted(host: SubAgentHost, completedAt: Date): void;
}

/**
 * A background `Agent` returns its tool_result ("Async agent launched") at once and keeps running;
 * only the harness's task events say when it ends (agent-cli `task.started` / `task.finished`,
 * Claude's task_started / task_notification). The spawn tool.use carries no tool-call id, so
 * `task.started` is bound to the spawn by the launch description it repeats verbatim, and the
 * sub-agent keeps the call id as `providerThreadId` for `task.finished`. A sub-agent whose task
 * never finishes settles by the turn-end rule (`parentCompleted` / `failRunningSubAgents`).
 * Guard: conversation-runtime.test.ts "a recorded background agent stays running until its task
 * finishes".
 */
function genericFold(provider: Provider): SubAgentFold {
  // This turn's spawns still waiting for their task.started, keyed by launch description.
  const launches: { description: unknown; agent: SubAgent }[] = [];
  return {
    toolUse(host, event) {
      if (isSubagentSpawnTool(provider, event.name)) {
        const agent = spawnGenericAgent(host, provider, event);
        launches.push({ description: event.input.description, agent });
        return 'hide';
      }
      noteActiveAgentTool(host, event);
      return 'show';
    },
    taskStarted(_host, event) {
      const index = launches.findIndex((launch) => launch.description === event.description);
      if (index < 0) return; // a task no spawn launched (a shell, a nested agent's tool)
      const [{ agent }] = launches.splice(index, 1);
      agent.providerThreadId = event.toolUseId;
    },
    taskFinished(host, event) {
      const agent = host.agents.find((a) => a.providerThreadId === event.toolUseId);
      if (!agent || agent.status !== 'running') return;
      agent.status = event.status === 'completed' ? 'completed' : 'error';
      agent.rawStatus = event.status;
      agent.statusSource = 'native';
      agent.completedAt = new Date();
      agent.currentAction = agent.status === 'completed' ? 'Done' : 'Error';
      host.changed(agent);
    },
    parentCompleted(host, completedAt) {
      completeRunning(host, completedAt, () => true);
    },
  };
}

function spawnGenericAgent(host: SubAgentHost, provider: Provider, event: ToolUseEvent): SubAgent {
  const description = getSubagentDescription(provider, event.name, event.input);
  const blockId = (event.input as { _blockId?: string })._blockId || host.newId();
  const subAgent: SubAgent = {
    id: blockId,
    description,
    status: 'running',
    toolUses: 0,
    tokens: 0,
    currentAction: undefined,
    startedAt: new Date(),
  };
  host.agents.push(subAgent);
  console.log(
    `[${host.conversationId}] Sub-agent started: ${blockId.substring(0, 8)} - "${description.substring(0, 50)}"`
  );
  host.changed(subAgent);
  return subAgent;
}

/** A non-spawn tool is attributed to the running sub-agent as its current action. */
function noteActiveAgentTool(host: SubAgentHost, event: ToolUseEvent): void {
  const activeAgent = host.agents.find((a) => a.status === 'running');
  if (!activeAgent) return;
  const input = event.input as { file_path?: string; path?: string };
  const filePath = input.file_path || input.path;
  activeAgent.toolUses += 1;
  activeAgent.currentAction = filePath
    ? `${event.name}: ${filePath.split('/').pop() || filePath}`
    : event.name;
  host.changed(activeAgent);
}

function completeRunning(
  host: SubAgentHost,
  completedAt: Date,
  inferred: (agent: SubAgent) => boolean
): void {
  for (const agent of host.agents) {
    if (agent.status !== 'running' || !inferred(agent)) continue;
    agent.status = 'completed';
    agent.completedAt = completedAt;
    if (!agent.statusSource) agent.statusSource = 'inferred_parent_completion';
    agent.currentAction = 'Done';
    console.log(`[${host.conversationId}] Sub-agent completed: ${agent.id.substring(0, 8)}`);
    host.changed(agent);
  }
}

/** A timed-out parent turn fails every sub-agent still running under it. */
export function failRunningSubAgents(agents: SubAgent[], completedAt: Date): void {
  for (const agent of agents) {
    if (agent.status !== 'running') continue;
    agent.status = 'error';
    agent.completedAt = completedAt;
    agent.currentAction = 'Parent turn timed out';
  }
}

// --- Codex native collab threads --------------------------------------------

function codexFold(): SubAgentFold {
  const codexGeneric = genericFold('codex');
  return {
    ...codexGeneric,
    toolUse(host, event) {
      if (!isCodexCollabToolName(event.name)) return codexGeneric.toolUse(host, event);
      const { phase, receiverThreadIds, prompt, agentStates } = extractCodexCollabToolInput(
        event.input
      );
      // The started phase renders as an ordinary tool line; the completed phase
      // carries the per-child states and replaces the line with agent rows.
      if (phase !== 'completed') return 'show';
      const childIds = new Set<string>([...receiverThreadIds, ...Object.keys(agentStates)]);
      for (const childId of childIds) {
        const agentState = agentStates[childId];
        applyCodexChildState(
          host,
          childId,
          event.name,
          prompt,
          agentState?.status,
          agentState?.message
        );
      }
      return 'hide';
    },
    // Native threads report their own terminal state; only inferred agents settle here.
    parentCompleted(host, completedAt) {
      completeRunning(host, completedAt, (agent) => !agent.providerThreadId);
    },
  };
}

function applyCodexChildState(
  host: SubAgentHost,
  childId: string,
  toolName: string,
  prompt: string | undefined,
  rawStatus: string | undefined,
  statusMessage: string | null | undefined
): void {
  const { agent, isNew, wasTerminal } = upsertCodexAgent(
    host,
    childId,
    toolName,
    prompt,
    rawStatus,
    statusMessage
  );
  if (toolName !== 'spawn_agent') agent.toolUses += 1;
  if (isNew) {
    console.log(
      `[${host.conversationId}] Codex sub-agent started: ${agent.id.substring(0, 8)} - "${agent.description.substring(0, 50)}"`
    );
    host.changed(agent);
  } else {
    broadcastAgentUpdate(host, agent);
  }
  if (statusMessage !== undefined && statusMessage !== null) broadcastAgentUpdate(host, agent);
  const status = agent.status;
  if (status !== 'completed' && status !== 'error') return;
  agent.completedAt ??= new Date();
  if (status === 'error') agent.currentAction = 'Error';
  else if (!agent.currentAction) agent.currentAction = 'Done';
  broadcastAgentUpdate(host, agent);
  if (!wasTerminal) {
    agent.currentAction = status === 'error' ? 'Error' : 'Done';
    host.changed(agent);
  }
}

function upsertCodexAgent(
  host: SubAgentHost,
  childThreadId: string,
  toolName: string,
  prompt: string | undefined,
  rawStatus: string | undefined,
  statusMessage: string | null | undefined
): { agent: SubAgent; isNew: boolean; wasTerminal: boolean } {
  const description = getSubagentDescription('codex', toolName, prompt ? { prompt } : {});
  const status = normalizeCodexSubagentStatus(
    rawStatus,
    toolName === 'spawn_agent' ? 'pending' : 'running'
  );
  const currentAction = getCodexSubagentCurrentAction(toolName, rawStatus, statusMessage);
  const existing = host.agents.find(
    (agent) => agent.id === childThreadId || agent.providerThreadId === childThreadId
  );
  if (!existing) {
    const agent: SubAgent = {
      id: childThreadId,
      description,
      status,
      toolUses: 0,
      tokens: 0,
      currentAction,
      startedAt: new Date(),
      providerThreadId: childThreadId,
      rawStatus,
      statusSource: 'native',
    };
    host.agents.push(agent);
    return { agent, isNew: true, wasTerminal: false };
  }
  const wasTerminal = isTerminalSubagentStatus(existing.status);
  existing.providerThreadId = childThreadId;
  if (!existing.description || existing.description.startsWith('Running ')) {
    existing.description = description;
  }
  existing.status = status;
  existing.rawStatus = rawStatus;
  existing.statusSource = 'native';
  if (currentAction) existing.currentAction = currentAction;
  else if (isTerminalSubagentStatus(status)) existing.currentAction = undefined;
  if (isTerminalSubagentStatus(status)) existing.completedAt ??= new Date();
  return { agent: existing, isNew: false, wasTerminal };
}

function broadcastAgentUpdate(host: SubAgentHost, agent: SubAgent): void {
  host.changed(agent);
}

// Pattern: table-driven (docs/patterns.md#table-driven)
/** Harness capability table: which sub-agent protocol each harness speaks. One fold per turn. */
const SUB_AGENT_FOLDS: Record<Provider, () => SubAgentFold> = {
  claude: () => genericFold('claude'),
  codex: codexFold,
  gemini: () => genericFold('gemini'),
  opencode: () => genericFold('opencode'),
  cursor: () => genericFold('cursor'),
  muse: () => genericFold('muse'),
};

/** A fresh fold for one turn of `provider`. */
export function subAgentFoldFor(provider: Provider): SubAgentFold {
  return SUB_AGENT_FOLDS[provider]();
}
