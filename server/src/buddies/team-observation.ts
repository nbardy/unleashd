import {
  BuddyWorkProjectSchema,
  BuddyTeamObservationInputSchema,
  BuddyTeamObservationSchema,
  type BuddyMessage,
} from '@unleashd/shared';
import type { BuddiesStorePort } from './contract';
import { coordinationStore, type PrivateBuddyRun } from './coordination-store';

/** One metadata projection for native observers and the authenticated owner UI. */
export function observeBuddyTeam(
  source: BuddiesStorePort,
  context: {
    buddyId: string;
    workspaceId: string;
    owner?: boolean;
    messageInAudience?: (message: BuddyMessage) => boolean;
    projectInAudience?: (id: string | null) => boolean;
  },
  input: unknown
) {
  const parsed = BuddyTeamObservationInputSchema.parse(input);
  const store = coordinationStore(source);
  if (!store.getCoordinationMembership(context.buddyId, context.workspaceId))
    throw new Error('Workspace membership is required');
  const messageFor = (run: PrivateBuddyRun) => {
    const origin = run.input_kind === 'failure_notice' ? store.getBuddyRun(run.input_id) : run;
    return origin ? store.getMessage(origin.input_id) : null;
  };
  const accept = (run: PrivateBuddyRun) => {
    if (run.input_kind === 'chat' || (parsed.runId && parsed.runId !== run.id)) return false;
    const message = messageFor(run);
    if (!message) return false;
    if (context.owner) return true;
    const root = run.root_message_id ? store.getMessage(run.root_message_id) : null;
    const direct =
      message.from_buddy_id === context.buddyId || message.to_buddy_id === context.buddyId;
    const causal = root?.from_buddy_id === context.buddyId;
    const supervised =
      !!run.project_id && store.canReadCoordinationProject(context.buddyId, run.project_id);
    return (
      (direct || causal || supervised) &&
      !!context.messageInAudience?.(message) &&
      !!context.projectInAudience?.(run.project_id)
    );
  };
  const runs = store.listBuddyRuns({
    workspaceId: context.workspaceId,
    ...(parsed.targetBuddyId ? { buddyId: parsed.targetBuddyId } : {}),
    ...(parsed.rootMessageId ? { rootMessageId: parsed.rootMessageId } : {}),
    order: 'newest',
    accept,
    limit: parsed.limit + 1,
    offset: parsed.offset,
  });
  return BuddyTeamObservationSchema.parse({
    observedAt: new Date().toISOString(),
    nextOffset: runs.length > parsed.limit ? parsed.offset + parsed.limit : null,
    limitations: [
      'Running is a durable claim; an independent process heartbeat is unavailable.',
      'Checkpoints are producer attestations. Current file availability is not automatically verified.',
      'GPU reservations are not host leases. Resource lease integration is unavailable.',
      'Per-assignment model overrides and metered token/cost enforcement are unavailable. Execution settings show the admitted snapshot.',
      'Current project revisions are authoritative for work status; older memory and attempt history may describe earlier states.',
    ],
    items: runs.slice(0, parsed.limit).map((run) => {
      const message = messageFor(run)!;
      const direct =
        context.owner ||
        message.from_buddy_id === context.buddyId ||
        message.to_buddy_id === context.buddyId;
      const project = run.project_id
        ? BuddyWorkProjectSchema.parse(store.getBuddyProject(run.project_id))
        : null;
      const membership = store.getCoordinationMembership(run.buddy_id, run.workspace_id);
      const visibleCheckpoints = store
        .listRunCheckpoints(run.id)
        .filter((c) => direct || c.visibility === 'team')
        .reverse();
      const checkpoints = visibleCheckpoints.slice(
        parsed.checkpointOffset,
        parsed.checkpointOffset + parsed.checkpointLimit
      );
      const recovery = store.getBuddyRunRecovery(run.id, context.owner ? 'owner' : context.buddyId);
      recovery.checkpointIds = checkpoints.map((c) => c.id);
      const deliveries = store.getMessageDeliveries(message.id).reverse();
      const deliveryPage = deliveries.slice(
        parsed.deliveryOffset,
        parsed.deliveryOffset + parsed.deliveryLimit
      );
      return {
        runId: run.id,
        buddyId: run.buddy_id,
        buddyName: store.getBuddy(run.buddy_id)?.name ?? run.buddy_id,
        inputKind: run.input_kind,
        messageId: message.id,
        rootMessageId: run.root_message_id,
        conversationId: direct ? run.conversation_id : null,
        attempt: run.attempt,
        state: run.status === 'queued' && run.error ? 'held' : run.status,
        createdAt: run.created_at,
        startedAt: run.started_at,
        acknowledgedAt: run.acknowledged_at ?? null,
        endedAt: run.ended_at,
        deadline: run.deadline,
        errorCode: run.error_code,
        error: direct ? run.error : null,
        project: project
          ? {
              id: project.id,
              revision: project.revision,
              status: project.status,
              updatedAt: project.updated_at,
              evidenceCount: (typeof project.completion_evidence === 'string'
                ? JSON.parse(project.completion_evidence)
                : (project.completion_evidence ?? [])
              ).length,
            }
          : null,
        reply: {
          persistedAt: message.replied_at,
          outcome: direct ? message.outcome : null,
          evidenceCount: message.reply_evidence.length,
          deliveryStates: deliveryPage.map((d) => `${d.kind}: ${d.state}`),
          deliveries: deliveryPage.map((d) => ({ ...d, error: direct ? d.error : null })),
          deliveryCount: deliveries.length,
          deliveryNextOffset:
            deliveries.length > parsed.deliveryOffset + parsed.deliveryLimit
              ? parsed.deliveryOffset + parsed.deliveryLimit
              : null,
        },
        checkpoints,
        checkpointCount: visibleCheckpoints.length,
        checkpointNextOffset:
          visibleCheckpoints.length > parsed.checkpointOffset + parsed.checkpointLimit
            ? parsed.checkpointOffset + parsed.checkpointLimit
            : null,
        recovery,
        execution: run.execution_snapshot ?? null,
        limits: {
          turnCapSeconds:
            run.execution_snapshot?.turnCapSeconds ??
            Math.min(3600, Number(run.policy.max_runtime_seconds) || 600),
          maxActiveRuns: membership?.max_active_runs ?? null,
          backgroundEnabled: !!membership?.background_enabled,
          pausedReason: direct ? (membership?.background_paused_reason ?? null) : null,
        },
      };
    }),
  });
}
