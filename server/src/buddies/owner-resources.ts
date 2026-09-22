import { GetBuddyWorkResourceSchema, workPage, workPageInput } from '@unleashd/shared';
import { GetBuddyDocumentSchema, UpdateBuddyDocumentSchema } from '@unleashd/shared';
import { z } from 'zod';
import { isReadOnlyBuddyOperation, notifyBuddiesChanged } from './change-feed';
import type { BuddiesStorePort } from './contract';
import { coordinationStore } from './coordination-store';
import { previewBuddyDocument } from './document-preview';
import { scopedDocumentOperation } from './knowledge';
import { BuddyOperationInputSchemas, dropEmptyEvidenceArrays } from './operations';
import type { OwnerTeamAuthority } from './owner-team-configuration';
import { executeDocumentResource } from './resources';
import { readBuddySoul, updateBuddySoul } from './soul';
import { validateProfileChange } from './team-access';
import { teamStore } from './team-access';
import { queryBuddyWork } from './work-query';

const scope = { workspaceId: z.string().min(1) };
export const OwnerResourceSchemas = {
  get_profile: BuddyOperationInputSchemas['buddy.get_profile']
    .required({ targetBuddyId: true })
    .extend(scope),
  update_profile: BuddyOperationInputSchemas['buddy.update_profile'].extend(scope),
  get_document: GetBuddyDocumentSchema.extend(scope),
  update_document: UpdateBuddyDocumentSchema.extend(scope),
  new_project: BuddyOperationInputSchemas['buddy.new_project']
    .required({ key: true, ownerId: true })
    .extend(scope)
    .strict(),
  update_project: BuddyOperationInputSchemas['buddy.update_project']
    .required({ key: true, projectId: true, baseRevision: true })
    .extend(scope)
    .strict(),
  get_current_work: GetBuddyWorkResourceSchema.extend(scope).required({ targetBuddyId: true }),
};
export type OwnerResourceName = keyof typeof OwnerResourceSchemas;

/** Called by the owner HTTP/turn adapters after authenticating; never from employee arguments. */
/** Door 2 of the change feed: owner MCP tools and the owner resource route. */
export function executeOwnerResource(
  source: BuddiesStorePort,
  name: OwnerResourceName,
  input: unknown,
  authority: OwnerTeamAuthority
) {
  const result = runOwnerResource(source, name, input, authority);
  if (!isReadOnlyBuddyOperation(name)) notifyBuddiesChanged();
  return result;
}

function runOwnerResource(
  source: BuddiesStorePort,
  name: OwnerResourceName,
  input: unknown,
  authority: OwnerTeamAuthority
) {
  const schema = OwnerResourceSchemas[name];
  if (!schema) throw new Error('Unknown owner resource operation');
  const parsed = schema.parse(input);
  const workspaceId = parsed.workspaceId;
  if (!authority.ownerInputId || !authority.workspaceIds.includes(workspaceId))
    throw Object.assign(new Error('Resource is outside this owner scope.'), {
      code: 'OWNER_SCOPE_DENIED',
    });
  const store = coordinationStore(source);
  const requireTarget = (id: string) => {
    if (!store.getCoordinationMembership(id, workspaceId))
      throw Object.assign(new Error('Target is unavailable in this workspace.'), {
        code: 'OWNER_SCOPE_DENIED',
      });
  };
  if (name === 'get_profile' || name === 'update_profile') {
    const p = (
      name === 'get_profile'
        ? OwnerResourceSchemas.get_profile
        : OwnerResourceSchemas.update_profile
    ).parse(input);
    requireTarget(p.targetBuddyId);
    const profiles = teamStore(source);
    if (name === 'get_profile') return { ok: true, data: profiles.getTeamProfile(p.targetBuddyId) };
    const update = OwnerResourceSchemas.update_profile.parse(input);
    validateProfileChange(source, update.targetBuddyId, update.changes);
    return { ok: true, data: profiles.updateTeamProfile(update, { actor: 'owner', workspaceId }) };
  }
  if (name === 'get_document' || name === 'update_document') {
    const { workspaceId: _scope, ...args } = (
      name === 'get_document'
        ? OwnerResourceSchemas.get_document
        : OwnerResourceSchemas.update_document
    ).parse(input);
    requireTarget(args.ref.targetBuddyId);
    return executeDocumentResource(name, args, (operation, raw) => {
      const params = raw as {
        targetBuddyId: string;
        doc?: 'working' | 'long_term';
        content: string;
        baseVersion: number;
        reasoning: string;
        key: string;
        preview: boolean;
      };
      if (args.ref.scope)
        return scopedDocumentOperation(source, args.ref, params, {
          actor: 'owner',
          workspaceId,
          conversationId: authority.conversationId,
          provenance: authority,
        });
      const id = params.targetBuddyId;
      const doc = params.doc ?? 'soul';
      const read = () => {
        if (doc === 'soul') {
          const head = readBuddySoul(source, id);
          return { buddyId: id, doc: 'soul' as const, content: head.body, revision: head.revision };
        }
        const memory = source.readBuddyMemory(id);
        return {
          buddyId: id,
          doc,
          content: doc === 'working' ? memory.working : memory.longTerm,
          revision: doc === 'working' ? memory.workingRevision : memory.longTermRevision,
        };
      };
      if (operation.startsWith('buddy.get_')) return { data: read() };
      const apply = () => {
        const preview = previewBuddyDocument(read(), params.content, params.baseVersion);
        if (params.preview) return { data: preview };
        const provenance = {
          source: 'owner-resource',
          conversation_id: authority.conversationId,
          owner_input_id: authority.ownerInputId,
          workspace_id: workspaceId,
        };
        if (doc === 'soul') updateBuddySoul(source, id, params, 'owner', provenance);
        else {
          if (!source.updateMemory) throw new Error('Versioned memory is unavailable');
          source.updateMemory(id, {
            documentKind: doc,
            content: params.content,
            baseVersion: params.baseVersion,
            reasoning: params.reasoning,
            requestedBy: 'owner',
            authorKind: 'owner',
            provenance,
          });
        }
        const audit = source.recordAuditEvent({
          buddy: id,
          workspace: workspaceId,
          operation: `owner.${name}`,
          payload: {
            ref: args.ref,
            baseVersion: params.baseVersion,
            reason: params.reasoning,
            ...provenance,
          },
        });
        return { data: { ...read(), diff: preview.diff }, audit };
      };
      if (params.preview) return apply();
      return (
        store as typeof store & {
          coordinationCommand<T>(input: Record<string, unknown>, apply: () => T): T;
        }
      ).coordinationCommand(
        { actor: 'owner', workspaceId, key: params.key, payload: { operation: name, ...args } },
        apply
      );
    });
  }
  if (name === 'get_current_work') {
    const p = OwnerResourceSchemas.get_current_work.parse(input);
    requireTarget(p.targetBuddyId);
    const rows = source
      .listBuddyOwnedProjects({
        buddy: p.targetBuddyId,
        workspace: workspaceId,
        includeClosed: p.includeClosed,
      })
      .filter((project) => !p.projectId || (project as { id: string }).id === p.projectId);
    const page = queryBuddyWork(rows, workPageInput(p), { owner: true, workspaceId });
    return { ok: true, data: workPage(page.items, p, page.snapshot) };
  }
  if (name === 'new_project') {
    const { key, ...p } = OwnerResourceSchemas.new_project.parse(input);
    requireTarget(p.ownerId);
    if (p.parentProjectId && store.getBuddyProject(p.parentProjectId)?.workspace_id !== workspaceId)
      throw new Error('Parent project is unavailable in this workspace');
    const saved = store.createCoordinatedProject(p, { actor: 'owner', key }) as { id: string };
    return { ok: true, data: store.getBuddyProject(saved.id) };
  }
  const projectUpdate = OwnerResourceSchemas.update_project.parse(input);
  dropEmptyEvidenceArrays(projectUpdate);
  const { key, projectId, workspaceId: _workspace, ...changes } = projectUpdate;
  const project = store.getBuddyProject(projectId);
  if (!project || project.workspace_id !== workspaceId)
    throw new Error('Project is unavailable in this workspace');
  if (changes.ownerId) requireTarget(changes.ownerId);
  return {
    ok: true,
    data: store.updateCoordinatedProject(projectId, changes, { actor: 'owner', key }),
  };
}
