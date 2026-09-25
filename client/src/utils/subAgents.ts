import type { ConversationRow, SubAgent } from '@unleashd/shared';
import { getProviderMetadata } from '@unleashd/shared';
import { isRowRunning } from './conversation-row';

// Child sessions are list rows (protocol v3): their label and activity time
// describe them; bodies are not loaded for a header summary.
function projectChildConversationToSubAgent(child: ConversationRow): SubAgent {
  const startedAt = new Date(child.createdAt);
  const running = isRowRunning(child);
  const roleLabel = getProviderMetadata(child.provider).label;
  return {
    id: `session:${child.id}`,
    description: `[${roleLabel}] ${child.label}`,
    status: running ? 'running' : 'completed',
    toolUses: 0,
    tokens: 0,
    currentAction: running ? 'Running...' : 'Done',
    startedAt,
    completedAt: running ? undefined : new Date(child.activityAt),
  };
}

function mergeNativeSubAgentWithChild(nativeAgent: SubAgent, child: ConversationRow): SubAgent {
  const running = isRowRunning(child);
  return {
    ...nativeAgent,
    description:
      nativeAgent.description && !nativeAgent.description.startsWith('Running ')
        ? nativeAgent.description
        : `[${getProviderMetadata(child.provider).label}] ${child.label}`,
    currentAction: nativeAgent.currentAction ?? (running ? 'Running...' : undefined),
    completedAt: nativeAgent.completedAt ?? (running ? undefined : new Date(child.activityAt)),
  };
}

/**
 * Build one unified sub-agent list for header display.
 * Includes native provider sub-agents (Task tool stream) + Codex spawned child sessions.
 */
export function buildUnifiedSubAgents(
  nativeAgents: readonly SubAgent[],
  children: Iterable<ConversationRow>
): SubAgent[] {
  const merged: SubAgent[] = nativeAgents.map((agent) => ({ ...agent }));
  const nativeByThreadId = new Map<string, SubAgent>();

  for (const agent of merged) {
    nativeByThreadId.set(agent.providerThreadId ?? agent.id, agent);
  }

  for (const candidate of children) {
    const existing = nativeByThreadId.get(candidate.id);
    if (existing) {
      Object.assign(existing, mergeNativeSubAgentWithChild(existing, candidate));
      continue;
    }
    merged.push(projectChildConversationToSubAgent(candidate));
  }

  merged.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  return merged;
}
