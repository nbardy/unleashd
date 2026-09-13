import { createHash } from 'node:crypto';
import {
  BUDDY_RESOURCE_CONTRACT_VERSION,
  type BuddyDocumentRef,
  GetBuddyDocumentSchema,
  GetBuddyInboxResourceSchema,
  UpdateBuddyDocumentSchema,
  inboxPageInput,
} from '@unleashd/shared';
import type { BuddyOperationName } from './operations';
import type { inspectTeamReadiness } from './team-readiness';

type Execute = (operation: BuddyOperationName, input: unknown) => unknown;
type Envelope = { data: Record<string, unknown>; audit?: { id: string } };
const unpack = (value: unknown) => value as Envelope;

/** Tokens bind a document and version; callers must not do arithmetic on them. */
export function documentRevision(ref: BuddyDocumentRef, version: number): string {
  const identity = createHash('sha256')
    .update(JSON.stringify([ref.targetBuddyId, ref.kind, ref.scope ?? null, ref.name ?? null]))
    .digest('hex')
    .slice(0, 24);
  return `doc:${identity}:${version}`;
}
export function documentVersion(ref: BuddyDocumentRef, revision: string): number {
  const version = Number(revision.split(':').at(-1));
  if (!Number.isSafeInteger(version) || version < 0 || documentRevision(ref, version) !== revision)
    throw Object.assign(new Error('Revision belongs to a different document or is invalid.'), {
      code: 'INVALID_REVISION',
    });
  return version;
}

/** Transport projections call the established operation policy and ledger. */
export function executeDocumentResource(
  name: 'get_document' | 'update_document',
  input: unknown,
  execute: Execute
) {
  const parsed =
    name === 'get_document'
      ? GetBuddyDocumentSchema.parse(input)
      : UpdateBuddyDocumentSchema.parse(input);
  let ref = parsed.ref;
  const target = {
    targetBuddyId: ref.targetBuddyId,
    ...(ref.kind === 'soul' ? {} : { doc: ref.kind === 'long_term' ? 'long_term' : 'working' }),
    knowledgeRef: ref,
  };
  if (!ref.scope && ['shared', 'note'].includes(ref.kind))
    throw new Error('Shared documents and notes require an explicit audience');
  const read = () =>
    unpack(execute(ref.kind === 'soul' ? 'buddy.get_soul' : 'buddy.get_memory', target));
  let result: Envelope;
  if (name === 'update_document') {
    const parsed = UpdateBuddyDocumentSchema.parse(input);
    if (!ref.scope) ref = (read().data.ref as BuddyDocumentRef | undefined) ?? ref;
    result = unpack(
      execute(ref.kind === 'soul' ? 'buddy.update_soul' : 'buddy.update_memory', {
        ...target,
        key: parsed.key,
        baseVersion: documentVersion(ref, parsed.revision),
        content: parsed.content,
        reasoning: parsed.reason,
        preview: parsed.preview,
      })
    );
    return {
      ok: true,
      contractVersion: BUDDY_RESOURCE_CONTRACT_VERSION,
      data: {
        ref,
        preview: parsed.preview,
        diff: result.data.diff ?? null,
        revision: parsed.preview
          ? parsed.revision
          : documentRevision(ref, Number(result.data.revision ?? result.data.version)),
      },
      auditId: result.audit?.id ?? result.data.auditId ?? null,
    };
  }
  result = read();
  ref = (result.data.ref as BuddyDocumentRef | undefined) ?? ref;
  return {
    ok: true,
    contractVersion: BUDDY_RESOURCE_CONTRACT_VERSION,
    data: {
      ref,
      content: result.data.content ?? result.data.body,
      revision: documentRevision(ref, Number(result.data.revision)),
    },
    auditId: result.audit?.id ?? result.data.auditId ?? null,
  };
}

export function compactCapabilities(value: unknown) {
  const result = unpack(value);
  const data = result.data as ReturnType<typeof inspectTeamReadiness>;
  return {
    ok: true,
    contractVersion: BUDDY_RESOURCE_CONTRACT_VERSION,
    auditId: result.audit?.id ?? result.data.auditId ?? null,
    data: {
      workspaceId: data.workspaceId,
      ownerControls: data.ownerControls,
      // These are policy labels, not additional native tools. Keep kind-specific
      // decisions intact; the resource boundary also checks the exact audience.
      documentOperationMapping: {
        get_document: {
          soul: 'get_soul',
          working: 'get_memory',
          long_term: 'get_memory',
          shared: 'get_memory',
          note: 'get_memory',
        },
        update_document: {
          soul: 'update_soul',
          working: 'update_memory',
          long_term: 'update_memory',
          shared: 'update_memory',
          note: 'update_memory',
        },
      },
      targets: (data.targets ?? []).map((t) => ({
        targetBuddyId: t.targetBuddyId,
        execution: t.execution,
        relationships: t.relationships,
        allowedOperations: Object.entries(t.operations ?? {})
          .filter(([, d]) => (d as { allowed: boolean }).allowed)
          .map(([name]) => name),
        deniedOperations: Object.fromEntries(
          Object.entries(t.operations ?? {})
            .filter(([, d]) => !d.allowed)
            .map(([name, d]) => [name, { code: d.code, reason: d.reason, remedy: d.remedy }])
        ),
      })),
      readiness:
        data.readiness?.intent || data.readiness?.messages?.length
          ? data.readiness
          : { state: 'not_evaluated' },
    },
  };
}

/** Compact only the authorized operation result. Full messages remain expandable by ID. */
export function compactInbox(value: unknown, input: unknown) {
  const result = unpack(value);
  const { limit } = GetBuddyInboxResourceSchema.parse(input);
  const { offset } = inboxPageInput(input);
  let hasMore = false;
  const data: Record<string, unknown> = {};
  const preview = (value: unknown) => (typeof value === 'string' ? value.slice(0, 240) : null);
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  for (const [section, entries] of Object.entries(result.data)) {
    if (!Array.isArray(entries)) continue;
    // Messages are filtered and paginated by the store, before execution joins.
    const page = section === 'messages' ? entries : entries.slice(offset, offset + limit + 1);
    hasMore ||= page.length > limit;
    data[section] = page.slice(0, limit).map((entry: Record<string, unknown>) => {
      if (section === 'messages') {
        const execution = entry.execution as Record<string, unknown> | undefined;
        return {
          id: entry.id,
          from_buddy_id: entry.from_buddy_id,
          to_buddy_id: entry.to_buddy_id,
          buddy_project_id: entry.buddy_project_id,
          purpose: entry.purpose,
          status: entry.status,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          bodyPreview: preview(entry.body),
          evidenceCount: count(entry.evidence),
          replied_at: entry.replied_at,
          outcome: entry.outcome,
          replyPreview: preview(entry.reply_body),
          replyEvidenceCount: count(entry.reply_evidence),
          execution: execution
            ? {
                runId: execution.runId,
                state: execution.state,
                code: execution.code,
                reason: preview(execution.reason),
                remedy: preview(execution.remedy),
                acknowledgedAt: execution.acknowledgedAt,
                projectSnapshot: execution.projectSnapshot,
              }
            : null,
        };
      }
      // Historical queues and blockers retain IDs/status, without policy, document
      // bodies, nested audits or repeatedly copied project evidence.
      const summary: Record<string, unknown> = {};
      for (const key of [
        'id',
        'title',
        'name',
        'status',
        'revision',
        'buddy_id',
        'project_id',
        'buddy_project_id',
        'from_buddy_id',
        'to_buddy_id',
        'reviewer_buddy_id',
        'subject_buddy_id',
        'created_at',
        'updated_at',
        'blocked_reason',
        'next_action',
      ]) {
        if (key in entry)
          summary[key] =
            typeof entry[key] === 'string' ? String(entry[key]).slice(0, 240) : entry[key];
      }
      if (section === 'failedAutomations') {
        const automation = entry.automation as Record<string, unknown>;
        const run = entry.latestRun as Record<string, unknown>;
        Object.assign(summary, {
          automationId: automation.id,
          name: automation.name,
          runId: run.id,
          status: run.status,
          error: preview(run.error),
        });
      }
      return summary;
    });
  }
  return {
    ok: true,
    contractVersion: BUDDY_RESOURCE_CONTRACT_VERSION,
    auditId: result.audit?.id ?? null,
    data: {
      ...data,
      observedAt: new Date().toISOString(),
      nextCursor: hasMore ? `inbox:${offset + limit}` : null,
      expansion: { message: 'get_message({messageId})', project: 'get_current_work({projectId})' },
    },
  };
}
