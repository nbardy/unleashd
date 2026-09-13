import { z } from 'zod';
import { BuddyExecutionSnapshotSchema } from './buddy-observation.js';

export const BuddyRunSchema = z.object({
  acknowledged_at: z.string().nullable().optional(),
  execution_snapshot: BuddyExecutionSnapshotSchema.nullable().optional(),
  id: z.string(),
  input_key: z.string(),
  input_kind: z.string(),
  input_id: z.string(),
  attempt: z.number().int(),
  buddy_id: z.string(),
  workspace_id: z.string(),
  conversation_id: z.string().nullable(),
  project_id: z.string().nullable(),
  root_message_id: z.string().nullable(),
  ready_at: z.string(),
  after_run_id: z.string().nullable(),
  status: z.enum([
    'queued',
    'claimed',
    'running',
    'cancel_requested',
    'complete',
    'failed',
    'cancelled',
  ]),
  deadline: z.string().nullable(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  created_at: z.string(),
  outcome: z.string().nullable(),
  error: z.string().nullable(),
  error_code: z.string().nullable(),
  retry_of_run_id: z.string().nullable(),
  policy: z.object({ allowed_operations: z.array(z.string()) }).passthrough(),
});
export type BuddyRun = z.infer<typeof BuddyRunSchema>;

export const BuddyMembershipSettingsSchema = z
  .object({
    read_all_work: z.boolean().optional(),
    dispatch: z.boolean().optional(),
    background_enabled: z.boolean().optional(),
    max_active_runs: z.number().int().min(1).max(100).optional(),
    max_background_runs_per_hour: z.number().int().min(1).max(10000).optional(),
    max_sends_per_hour: z.number().int().min(1).max(10000).optional(),
    max_pending_runs: z.number().int().min(1).max(10000).optional(),
    background_paused_reason: z.string().nullable().optional(),
  })
  .strict();
