import { z } from 'zod';
import { ConversationConfigSchema } from './conversation-config.js';

export const BuddyWorkspaceActiveJobSchema = z.object({
  id: z.string(),
  buddyId: z.string(),
  kind: z.enum(['foreground', 'background']),
  source: z.enum(['conversation', 'delegation', 'automation']),
  status: z.enum(['claimed', 'running', 'cancel_requested']),
  conversationId: z.string().nullable(),
  label: z.string(),
  startedAt: z.string().nullable(),
  deadline: z.string().nullable(),
});

// What a Buddy's turn runs on when nobody picks: its profile's harness, model
// and effort. `unreported` is a backend that predates the field (the client
// hot-reloads before a deferred backend restart), so the wire default is that
// typed variant, never an invented config.
export const BuddyMemberExecutionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profile'), config: ConversationConfigSchema }),
  z.object({ kind: z.literal('unreported') }),
]);

export const BuddyWorkspaceActivitySchema = z.object({
  generatedAt: z.string(),
  workspace: z.object({
    id: z.string(),
    name: z.string(),
    rootPath: z.string().nullable(),
  }),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
      status: z.string(),
      execution: BuddyMemberExecutionSchema.default({ kind: 'unreported' }),
      jobs: z.array(BuddyWorkspaceActiveJobSchema),
    })
  ),
});

export type BuddyWorkspaceActiveJob = z.infer<typeof BuddyWorkspaceActiveJobSchema>;
export type BuddyMemberExecution = z.infer<typeof BuddyMemberExecutionSchema>;
export type BuddyWorkspaceActivity = z.infer<typeof BuddyWorkspaceActivitySchema>;
