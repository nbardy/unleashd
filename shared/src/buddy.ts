import { z } from 'zod';
import { ProviderSchema } from './provider-catalog.js';

export const BuddySummarySchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  status: z.string().min(1),
  provider: ProviderSchema.nullable(),
  model: z.string().min(1).nullable(),
  reasoning_effort: z.string().min(1).nullable(),
});
export type BuddySummary = z.infer<typeof BuddySummarySchema>;

export const BuddyWorkspaceSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  root_path: z.string().min(1),
  assignment_role: z.string().nullish(),
});
export type BuddyWorkspaceSummary = z.infer<typeof BuddyWorkspaceSummarySchema>;

export const BuddyBuilderResultSchema = z.object({
  conversationId: z.string().min(1),
  buddy: BuddySummarySchema,
  homeWorkspace: BuddyWorkspaceSummarySchema,
  workspaces: z.array(BuddyWorkspaceSummarySchema),
  followUpQuestions: z.array(z.string().min(1)).default([]),
});
export type BuddyBuilderResult = z.infer<typeof BuddyBuilderResultSchema>;
