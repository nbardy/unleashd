import { randomUUID } from 'node:crypto';
import { MEMORY_NOTE_MAX_BYTES } from '@nbardy/buddies';
import type { BuddyDocumentRef, BuddyKnowledgeScope } from '@unleashd/shared';
import type { BuddiesStorePort } from './contract';
import { coordinationStore } from './coordination-store';
import { previewBuddyDocument } from './document-preview';
import type { BuddyOperationContext } from './operations';

export type KnowledgeAuthority = {
  actor: string;
  workspaceId: string;
  conversationId?: string | null;
  scope?: BuddyKnowledgeScope;
  provenance?: unknown;
};
export type KnowledgeDocument = {
  id: string | null;
  ref: BuddyDocumentRef;
  revision: number;
  content: string;
};
export interface KnowledgeStore {
  checkKnowledgeDocument(
    ref: BuddyDocumentRef,
    authority: KnowledgeAuthority,
    write?: boolean
  ): void;
  readKnowledgeDocument(ref: BuddyDocumentRef, authority: KnowledgeAuthority): KnowledgeDocument;
  replaceKnowledgeDocument(
    ref: BuddyDocumentRef,
    input: { key: string; baseRevision: number; content: string; reason: string },
    authority: KnowledgeAuthority
  ): { id: string; ref: BuddyDocumentRef; revision: number; auditId: string };
  listKnowledgeDocuments(
    input: {
      targetBuddyId: string;
      scope: BuddyKnowledgeScope;
      pattern?: string;
      limit?: number;
      since?: string;
      kinds?: string[];
    },
    authority: KnowledgeAuthority
  ): KnowledgeDocument[];
  listKnowledgeScopes(targetBuddyId: string, authority: KnowledgeAuthority): BuddyKnowledgeScope[];
  knowledgeAudienceKey(authority: KnowledgeAuthority): string;
}
export function knowledgeStore(store: BuddiesStorePort): KnowledgeStore {
  if (typeof (store as unknown as KnowledgeStore).readKnowledgeDocument !== 'function')
    throw new Error('Scoped knowledge requires Buddies schema 26');
  return store as unknown as KnowledgeStore;
}
export function knowledgeAuthority(
  store: BuddiesStorePort,
  context: BuddyOperationContext
): KnowledgeAuthority {
  const run = context.coordinationRunId
    ? coordinationStore(store).getBuddyRun(context.coordinationRunId)
    : null;
  const teamTurn =
    !!context.automationRunId || !!context.delegatedByBuddyId || (run && run.input_kind !== 'chat');
  // Derive the audience from the actual run, never a requested document or prose.
  const projectId = run?.project_id ?? context.buddyProjectId;
  const scope: BuddyKnowledgeScope =
    context.knowledgeScope ??
    (teamTurn
      ? projectId
        ? { kind: 'project', projectId }
        : { kind: 'workspace', workspaceId: context.workspaceId }
      : { kind: 'owner_thread', conversationId: context.conversationId ?? 'unbound' });
  return {
    actor: context.buddyId,
    workspaceId: context.workspaceId,
    conversationId: scope.kind === 'owner_thread' ? scope.conversationId : context.conversationId,
    scope,
  };
}
export function scopedDocumentOperation(
  store: BuddiesStorePort,
  ref: BuddyDocumentRef,
  params: {
    content?: string;
    baseVersion?: number;
    reasoning?: string;
    key?: string;
    preview?: boolean;
  },
  authority: KnowledgeAuthority
) {
  const ledger = knowledgeStore(store);
  ledger.checkKnowledgeDocument(ref, authority, params.content !== undefined);
  if (params.content === undefined) return { data: ledger.readKnowledgeDocument(ref, authority) };
  if (ref.kind === 'note') validateNoteBody(params.content);
  if (!params.preview)
    return {
      data: ledger.replaceKnowledgeDocument(
        ref,
        {
          key: params.key!,
          baseRevision: params.baseVersion!,
          content: params.content,
          reason: params.reasoning!,
        },
        authority
      ),
    };
  const before = ledger.readKnowledgeDocument(ref, authority);
  return {
    data: previewBuddyDocument(
      {
        buddyId: ref.targetBuddyId,
        doc: ref.kind,
        content: before.content,
        revision: before.revision,
      },
      params.content,
      params.baseVersion!
    ),
  };
}

/** The body has one byte bound whether authored as a document or an evidence note. */
function validateNoteBody(body: string): void {
  if (Buffer.byteLength(body, 'utf8') > MEMORY_NOTE_MAX_BYTES)
    throw new Error(`Note body exceeds ${MEMORY_NOTE_MAX_BYTES} UTF-8 bytes`);
}

export function scopedNote(
  store: BuddiesStorePort,
  authority: KnowledgeAuthority,
  input: { topic?: string; body: string; evidence?: unknown[] },
  targetBuddyId = authority.actor
) {
  validateNoteBody(input.body);
  const name = `${new Date().toISOString()}:${randomUUID()}`;
  const ref: BuddyDocumentRef = {
    targetBuddyId,
    scope: authority.scope!,
    kind: 'note',
    name,
  };
  return knowledgeStore(store).replaceKnowledgeDocument(
    ref,
    {
      key: `note:${name}`,
      baseRevision: 0,
      content: JSON.stringify(input),
      reason: input.topic ?? 'Append evidence',
    },
    authority
  );
}

/** One authorized search for tools, maintenance and the owner Memory panel. */
export function recallKnowledge(
  store: BuddiesStorePort,
  authority: KnowledgeAuthority,
  input: {
    pattern: string;
    limit?: number;
    since?: string;
    scope?: 'current' | 'home' | 'all';
    regex?: boolean;
  },
  targetBuddyId = authority.actor
) {
  if (input.regex) throw new Error('Scoped knowledge search supports literal matching only');
  const limit = input.limit ?? 20;
  const documents = knowledgeStore(store).listKnowledgeDocuments(
    { ...input, targetBuddyId, scope: authority.scope!, limit: limit + 1 },
    authority
  );
  const legacy =
    authority.scope?.kind === 'owner_thread'
      ? store.recall?.(targetBuddyId, {
          pattern: input.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          workspace: authority.workspaceId,
          scope: input.scope ?? 'current',
          since: input.since,
          limit,
        })
      : undefined;
  const matches = [
    ...documents.map((doc) => ({
      ...doc,
      path: doc.ref.name ?? doc.ref.kind,
      workspace_id: authority.workspaceId,
      created_at: null,
    })),
    ...(legacy?.matches ?? []),
  ];
  return {
    pattern: input.pattern,
    matches: matches.slice(0, limit),
    truncated: matches.length > limit || !!legacy?.truncated,
  };
}
