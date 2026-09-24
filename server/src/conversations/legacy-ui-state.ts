import fs from 'node:fs';
import path from 'node:path';
import { ProviderSchema } from '@unleashd/shared';
import { z } from 'zod';
import type { ConversationConfigStore } from './config-store';

/**
 * One-time retirement of `ui-state.json`, the client-synced UI blob.
 *
 * Its `doneConversations` list keyed hides by `sessionId ?? id`. The server
 * rotates sessionId (provider session.started, reset, resume), so every
 * rotation silently un-hid a conversation, and the blob's debounced
 * whole-snapshot POST lost hides on refresh and reconnect. Done state now
 * lives on the conversation record (`record.done`); this moves the old list
 * there once, before any conversation loads.
 *
 * A key is either a conversationId or a provider session id — whichever the
 * client saw as `sessionId ?? id` when it hid the row. Session ids resolve
 * through the record's bindings INCLUDING `currentSession`: on 2026-09-24,
 * 264 of the 331 hides in effect were keyed by a sessionId that appeared only
 * as `currentSession`, never in `sessionBindings`. A dry run that searched
 * `sessionBindings` alone reported them unresolvable, and would have un-hidden
 * all 264.
 *
 * Keys that resolve to nothing are not guessed at: most point at transcripts
 * that no longer exist, a few at old transcripts never hydrated into records.
 * They are written to the report so the loss is inspectable, not silent. The
 * other blob fields (seen indexes, promoted workers, last directory) are
 * device-local in the client now; nothing here carries them over.
 *
 * Renaming the file is the commit point: a crash before it reruns the import,
 * and setDone is idempotent.
 */

const LegacyUiStateSchema = z.object({
  doneConversations: z.array(z.string()).default([]),
});

export type LegacyUiStateRetirement =
  | { kind: 'absent' }
  | { kind: 'retired'; applied: number; unresolved: number; reportPath: string };

type RetirementStore = Pick<
  ConversationConfigStore,
  'getByConversationId' | 'findBySession' | 'withSessionLookupIndex' | 'setDone'
>;

export async function retireLegacyUiState(options: {
  dataDirectory: string;
  store: RetirementStore;
  now?: () => Date;
}): Promise<LegacyUiStateRetirement> {
  const legacyPath = path.join(options.dataDirectory, 'ui-state.json');
  let raw: string;
  try {
    raw = await fs.promises.readFile(legacyPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' };
    throw error;
  }
  // A corrupt legacy file throws here and fails startup loudly rather than
  // quietly dropping every hide; the file stays in place for inspection.
  const legacy = LegacyUiStateSchema.parse(JSON.parse(raw));
  const { store } = options;

  const resolve = async (key: string): Promise<string | undefined> => {
    const direct = await store.getByConversationId(key);
    if (direct) return direct.conversationId;
    for (const provider of ProviderSchema.options) {
      const bySession = await store.findBySession(provider, key);
      if (bySession) return bySession.conversationId;
    }
    return undefined;
  };

  // The lookup index turns each session lookup from a full record scan into a
  // map hit — ~1,300 keys against ~7,700 records.
  const { applied, unresolved } = await store.withSessionLookupIndex(async () => {
    const targets = new Set<string>();
    const missing: string[] = [];
    for (const key of new Set(legacy.doneConversations)) {
      const conversationId = await resolve(key);
      if (conversationId) targets.add(conversationId);
      else missing.push(key);
    }
    for (const conversationId of targets) await store.setDone(conversationId, true);
    return { applied: targets.size, unresolved: missing };
  });

  const stamp = (options.now ?? (() => new Date()))().toISOString();
  const reportPath = path.join(options.dataDirectory, 'ui-state.retirement-report.json');
  await fs.promises.writeFile(
    reportPath,
    JSON.stringify({ retiredAt: stamp, applied, unresolved }, null, 2)
  );
  await fs.promises.rename(legacyPath, path.join(options.dataDirectory, 'ui-state.retired.json'));
  console.log(
    `[ui-state] Retired ui-state.json: ${applied} conversations marked done, ` +
      `${unresolved.length} keys named nothing (listed in ${reportPath})`
  );
  return { kind: 'retired', applied, unresolved: unresolved.length, reportPath };
}
