import { z } from 'zod';

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
      jobs: z.array(BuddyWorkspaceActiveJobSchema),
    })
  ),
});

export type BuddyWorkspaceActiveJob = z.infer<typeof BuddyWorkspaceActiveJobSchema>;
export type BuddyWorkspaceActivity = z.infer<typeof BuddyWorkspaceActivitySchema>;
