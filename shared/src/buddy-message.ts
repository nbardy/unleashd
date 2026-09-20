import { z } from 'zod';
import { BuddyMessageExecutionSchema } from './buddy-access.js';
import { TeamConfigurationSchema } from './buddy-team-configuration.js';

export const TeamConfigurationProposalSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    configuration: TeamConfigurationSchema,
  })
  .strict();
export type TeamConfigurationProposal = z.infer<typeof TeamConfigurationProposalSchema>;

const TEAM_PROPOSAL_MARKER = '\n<!--buddy_team_proposal:';

/**
 * A typed attachment in an ordinary message, never an authorization credential.
 * Mail/authority boundary: ../../product/buddies/CORE_DESIGN.md#composition-rules
 */
export function formatTeamConfigurationProposal(
  body: string,
  proposal: TeamConfigurationProposal
): string {
  return (
    body +
    TEAM_PROPOSAL_MARKER +
    encodeURIComponent(JSON.stringify(TeamConfigurationProposalSchema.parse(proposal))) +
    '-->'
  );
}

export function parseTeamConfigurationProposal(
  body: string
): { body: string; proposal: TeamConfigurationProposal } | null {
  const start = body.lastIndexOf(TEAM_PROPOSAL_MARKER);
  if (start < 0 || !body.endsWith('-->')) return null;
  try {
    const proposal = TeamConfigurationProposalSchema.parse(
      JSON.parse(decodeURIComponent(body.slice(start + TEAM_PROPOSAL_MARKER.length, -3)))
    );
    return { body: body.slice(0, start), proposal };
  } catch {
    return null;
  }
}

export const BuddyMessageSchema = z.object({
  team_configuration: TeamConfigurationProposalSchema.optional(),
  source_workspace_id: z.string().nullable().optional(),
  source_project_id: z.string().nullable().optional(),
  visibility: z.enum(['participants', 'project']).optional(),
  execution: BuddyMessageExecutionSchema.optional(),
  approval: z
    .object({
      id: z.string(),
      operation: z.string(),
      arguments: z.record(z.unknown()),
      expires_at: z.string(),
      status: z.enum(['pending', 'approved', 'rejected']),
      consumed_by_run_id: z.string().nullable(),
    })
    .nullable()
    .optional(),
  expects_reply: z.number().int().optional(),
  root_message_id: z.string().nullable().optional(),
  superseded_by_message_id: z.string().nullable().optional(),
  id: z.string(),
  from_buddy_id: z.string(),
  to_buddy_id: z.string().nullable(),
  workspace_id: z.string(),
  buddy_project_id: z.string().nullable(),
  purpose: z.string(),
  body: z.string(),
  evidence: z.array(z.string()),
  parent_conversation_id: z.string().nullable(),
  child_conversation_id: z.string().nullable(),
  status: z.enum(['pending', 'active', 'replied', 'failed', 'cancelled']),
  outcome: z.string().nullable(),
  reply_body: z.string().nullable(),
  reply_evidence: z.array(z.string()),
  replied_by: z.string().nullable(),
  wait_until: z.string().nullable(),
  wait_status: z.enum(['none', 'waiting', 'replied', 'timed_out', 'cancelled']),
  created_at: z.string(),
  updated_at: z.string(),
  replied_at: z.string().nullable(),
});

export type BuddyMessage = z.infer<typeof BuddyMessageSchema>;

export const BuddyMessageReplySchema = z
  .object({
    outcome: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(32_000),
    evidence: z.array(z.string().trim().min(1).max(4_000)).min(1).max(32),
  })
  .strict();
