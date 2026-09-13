import { z } from 'zod';
import { BuddyDeliverySchema } from './buddy-access.js';

export const BuddyArtifactSchema = z
  .object({
    ref: z.string().trim().min(1).max(4000),
    version: z.string().trim().min(1).max(200),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
  })
  .strict();
export const BuddyCheckpointInputSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    artifacts: z.array(BuddyArtifactSchema).min(1).max(16),
    effects: z.array(z.string().trim().min(1).max(4000)).max(16),
    resume: z.string().trim().min(1).max(4000),
    visibility: z.enum(['participants', 'team']).default('participants'),
  })
  .strict();
export const BuddyCheckpointSchema = BuddyCheckpointInputSchema.omit({ key: true }).extend({
  id: z.string(),
  run_id: z.string(),
  buddy_id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  message_id: z.string().nullable(),
  root_message_id: z.string().nullable(),
  created_at: z.string(),
});
export const BuddyRecoverySchema = z.object({
  controllerBuddyIds: z.array(z.string()),
  mode: z.enum(['attempt', 'successor_request']).default('attempt'),
  successorRunId: z.string().nullable().default(null),
  canRetry: z.boolean(),
  reason: z.string().nullable(),
  remainingRuns: z.number().nullable(),
  remainingSeconds: z.number().nullable(),
  checkpointIds: z.array(z.string()),
  action: z
    .object({ operation: z.literal('retry_run'), runId: z.string(), requires: z.array(z.string()) })
    .nullable(),
});
export const BuddyExecutionSnapshotSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  reasoningEffort: z.string().nullable(),
  turnCapSeconds: z.number(),
  deadline: z.string(),
  limitingSource: z.string(),
});
export const BuddyTeamObservationInputSchema = z
  .object({
    targetBuddyId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    checkpointOffset: z.number().int().min(0).default(0),
    checkpointLimit: z.number().int().min(1).max(10).default(3),
    deliveryOffset: z.number().int().min(0).default(0),
    deliveryLimit: z.number().int().min(1).max(10).default(3),
    rootMessageId: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
  })
  .strict();
export const BuddyTeamObservationSchema = z.object({
  observedAt: z.string(),
  nextOffset: z.number().nullable(),
  limitations: z.array(z.string()),
  items: z.array(
    z.object({
      runId: z.string(),
      buddyId: z.string(),
      buddyName: z.string(),
      inputKind: z.string(),
      messageId: z.string().nullable(),
      rootMessageId: z.string().nullable(),
      conversationId: z.string().nullable(),
      attempt: z.number(),
      state: z.string(),
      createdAt: z.string(),
      startedAt: z.string().nullable(),
      acknowledgedAt: z.string().nullable(),
      endedAt: z.string().nullable(),
      deadline: z.string().nullable(),
      errorCode: z.string().nullable(),
      error: z.string().nullable(),
      project: z
        .object({
          id: z.string(),
          revision: z.number(),
          status: z.string(),
          updatedAt: z.string(),
          evidenceCount: z.number(),
        })
        .nullable(),
      reply: z
        .object({
          persistedAt: z.string().nullable(),
          outcome: z.string().nullable(),
          evidenceCount: z.number(),
          deliveryStates: z.array(z.string()),
          deliveries: z.array(BuddyDeliverySchema).default([]),
          deliveryCount: z.number().int().min(0).default(0),
          deliveryNextOffset: z.number().nullable().default(null),
        })
        .nullable(),
      checkpoints: z.array(BuddyCheckpointSchema),
      checkpointCount: z.number().default(0),
      checkpointNextOffset: z.number().nullable().default(null),
      recovery: BuddyRecoverySchema,
      execution: BuddyExecutionSnapshotSchema.nullable(),
      limits: z.object({
        turnCapSeconds: z.number(),
        maxActiveRuns: z.number().nullable(),
        backgroundEnabled: z.boolean(),
        pausedReason: z.string().nullable(),
      }),
    })
  ),
});
export type BuddyCheckpoint = z.infer<typeof BuddyCheckpointSchema>;
export type BuddyRecovery = z.infer<typeof BuddyRecoverySchema>;
export type BuddyTeamObservation = z.infer<typeof BuddyTeamObservationSchema>;
