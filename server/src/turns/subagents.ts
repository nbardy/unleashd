import type { UnifiedAgentEvent } from '@nbardy/agent-cli';
import type { Provider, ServerMessage, SubAgent } from '@unleashd/shared';
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

export interface SubAgentHost {
  readonly conversationId: string;
  /** The conversation's live list; folds mutate it in place. */
  readonly agents: SubAgent[];
  broadcast(message: ServerMessage): void;
  newId(): string;
}

/** Whether the tool still renders as a transcript line after the sub-agent fold saw it. */
export type ToolLine = 'show' | 'hide';

export interface SubAgentFold {
  toolUse(host: SubAgentHost, event: ToolUseEvent): ToolLine;
  /** The parent turn completed: settle the agents this harness only infers. */
  parentCompleted(host: SubAgentHost, completedAt: Date): void;
}

function genericFold(provider: Provider): SubAgentFold {
  return {
    toolUse(host, event) {
      if (isSubagentSpawnTool(provider, event.name)) {
        spawnGenericAgent(host, provider, event);
        return 'hide';
      }
      noteActiveAgentTool(host, event);
      return 'show';
    },
    parentCompleted(host, completedAt) {
      completeRunning(host, completedAt, () => true);
    },
  };
}

function spawnGenericAgent(host: SubAgentHost, provider: Provider, event: ToolUseEvent): void {
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
  host.broadcast({ type: 'subagent_start', conversationId: host.conversationId, subAgent });
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
  host.broadcast({
    type: 'subagent_update',
    conversationId: host.conversationId,
    subAgentId: activeAgent.id,
    toolUses: activeAgent.toolUses,
    currentAction: activeAgent.currentAction,
  });
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
    host.broadcast({
      type: 'subagent_complete',
      conversationId: host.conversationId,
      subAgentId: agent.id,
      status: 'completed',
      completedAt,
    });
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

const codexGeneric = genericFold('codex');

const codexFold: SubAgentFold = {
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
    host.broadcast({
      type: 'subagent_start',
      conversationId: host.conversationId,
      subAgent: agent,
    });
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
    host.broadcast({
      type: 'subagent_complete',
      conversationId: host.conversationId,
      subAgentId: agent.id,
      status,
      completedAt: agent.completedAt,
    });
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
  host.broadcast({
    type: 'subagent_update',
    conversationId: host.conversationId,
    subAgentId: agent.id,
    toolUses: agent.toolUses,
    tokens: agent.tokens,
    currentAction: agent.currentAction,
    status: agent.status,
    rawStatus: agent.rawStatus,
    statusSource: agent.statusSource,
  });
}

// Pattern: table-driven (docs/patterns.md#table-driven)
/** Harness capability table: which sub-agent protocol each harness speaks. */
const SUB_AGENT_FOLDS: Record<Provider, SubAgentFold> = {
  claude: genericFold('claude'),
  codex: codexFold,
  gemini: genericFold('gemini'),
  opencode: genericFold('opencode'),
  cursor: genericFold('cursor'),
  muse: genericFold('muse'),
};

export function subAgentFoldFor(provider: Provider): SubAgentFold {
  return SUB_AGENT_FOLDS[provider];
}
