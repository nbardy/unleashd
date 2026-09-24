// Fixture: a foreground chat run admitted immediately (the Buddy has a free
// slot). Production turns wait in the FIFO line through chatRunAdmission.
export function startChatRun<Run>(
  store: {
    enqueueBuddyChatRun(input: Record<string, unknown>): { id: string };
    startBuddyChatRun(
      id: string,
      input: { conversationId: string; maxRuntimeSeconds: number }
    ): Run | null;
  },
  input: {
    buddyId: string;
    workspaceId: string;
    conversationId: string;
    projectId?: string;
    allowedOperations: readonly string[];
    maxRuntimeSeconds?: number;
  }
): Run {
  const { maxRuntimeSeconds = 24 * 60 * 60, ...queued } = input;
  const run = store.startBuddyChatRun(store.enqueueBuddyChatRun(queued).id, {
    conversationId: input.conversationId,
    maxRuntimeSeconds,
  });
  if (!run) throw new Error('Fixture chat run was not admitted');
  return run;
}
