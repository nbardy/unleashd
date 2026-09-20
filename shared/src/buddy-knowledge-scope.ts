import { z } from 'zod';

export const BuddyKnowledgeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('owner_thread'), conversationId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('workspace'), workspaceId: z.string().min(1) }).strict(),
]);
