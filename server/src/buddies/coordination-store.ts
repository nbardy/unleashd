import type { BuddyCheckpoint, BuddyRecovery, BuddyTeamObservation } from '@unleashd/shared';
import type { BuddyMessage, BuddyMessageExecution, BuddyRun } from '@unleashd/shared';
import type { BuddyTaskComment, BuddyTaskCommentsPage } from '@unleashd/shared';
import type { BuddiesStorePort } from './contract';

export type PrivateBuddyRun = BuddyRun & {
  claim_token: string | null;
  claim_expires_at: string | null;
};
export interface CoordinationStore extends BuddiesStorePort {
  appendTaskComment(
    input: { projectId: string; key: string; body: string; evidence?: string[] },
    authority: { actor: string; workspaceId: string; runId?: string }
  ): BuddyTaskComment;
  listTaskComments(
    input: { projectId: string; limit?: number; cursor?: string },
    authority: { actor: string; workspaceId: string; runId?: string }
  ): BuddyTaskCommentsPage;
  recordRunExecution(
    id: string,
    token: string,
    snapshot: NonNullable<BuddyTeamObservation['items'][number]['execution']>
  ): void;
  checkpointBuddyRun(id: string, input: Record<string, unknown>): BuddyCheckpoint;
  listRunCheckpoints(id: string): BuddyCheckpoint[];
  getBuddyRunRecovery(id: string, actor: string): BuddyRecovery;
  getMessageDeliveries(
    id: string
  ): NonNullable<import('@unleashd/shared').BuddyMessageExecution['delivery']>;
  retryUndeliveredInputs(): void;
  getCoordinatedMessageByKey?(actor: string, workspaceId: string, key: string): BuddyMessage | null;
  previewCoordinatedMessage(
    input: Record<string, unknown>,
    authority: Record<string, unknown>
  ): unknown;
  sendCoordinatedMessage(
    input: Record<string, unknown>,
    authority: Record<string, unknown>
  ): BuddyMessage;
  reconcileBackgroundWork?(messageId?: string): BuddyMessageExecution[];
  getProjectBackgroundExecution(
    projectId: string
  ): { message: BuddyMessage; runs: PrivateBuddyRun[] } | null;
  getBuddyRun(id: string): PrivateBuddyRun | null;
  listBuddyRuns(filter?: Record<string, unknown>): PrivateBuddyRun[];
  enqueueBuddyRun(input: Record<string, unknown>): PrivateBuddyRun;
  inspectBuddyAdmission(input: {
    buddyId: string;
    workspaceId: string;
    runId?: string;
    conversationId?: string;
  }): {
    allowed: boolean;
    blockers: Array<{
      path: string;
      code: string;
      reason: string;
      remedy: string;
      resolvableBy: 'owner' | 'lead' | 'runtime';
    }>;
  };
  claimBuddyRun(id: string, input: Record<string, unknown>): PrivateBuddyRun | null;
  startBuddyRun(id: string, token: string): PrivateBuddyRun;
  finishBuddyRun(id: string, input: Record<string, unknown>): PrivateBuddyRun;
  cancelBuddyRun(id: string): PrivateBuddyRun | null;
  withBuddyRunAuthority<T>(id: string, token: string, operation: string, callback: () => T): T;
  getCoordinationMembership(buddyId: string, workspaceId: string): Record<string, unknown> | null;
  setCoordinationMembership(
    buddyId: string,
    workspaceId: string,
    patch: Record<string, unknown>
  ): unknown;
  createCoordinatedProject(
    input: Record<string, unknown>,
    authority: { actor: string; key: string }
  ): unknown;
  updateCoordinatedProject(
    id: string,
    changes: Record<string, unknown>,
    authority: { actor: string; key: string; runId?: string }
  ): unknown;
  projectAncestors(id: string): Array<{ id: string }>;
  canReadCoordinationProject(buddyId: string, projectId: string): boolean;
  canManageCoordinationProject(buddyId: string, projectId: string): boolean;
  beginBuddyChatRun(input: Record<string, unknown>): PrivateBuddyRun;
  reparentBuddy(buddyId: string, input: { managerId: string; key: string }): unknown;
  holdBuddyRun(id: string, reason: string): void;
  recoverBuddyRuns(input: { confirmedDrainedIds: string[] }): PrivateBuddyRun[];
  repairBuddyRun(id: string, input: { key: string; conversationId: string }): PrivateBuddyRun;
  retryBuddyRun(
    id: string,
    input: {
      key: string;
      conversationId?: string;
      actor?: string;
      reason?: string;
      checkpointId?: string;
    }
  ): PrivateBuddyRun;
  finishProjectHandoffs(): string[];
  coordinationCommand<T>(
    input: { actor: string; workspaceId: string; key: string; payload: unknown },
    callback: () => T
  ): T;
  coordinationTransaction<T>(callback: () => T): T;
  stopBuddyMessageRoot(id: string): PrivateBuddyRun[];
}

export function coordinationStore(store: BuddiesStorePort): CoordinationStore {
  if (typeof (store as Partial<CoordinationStore>).getBuddyRun !== 'function') {
    throw new Error('Installed Buddies package does not support durable coordination');
  }
  return store as CoordinationStore;
}
