import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type BuddyBuilderResult,
  type BuddySummary,
  type BuddyWorkspaceSummary,
  ProviderSchema,
  defaultReasoningEffortForProvider,
  isEffortValidForProvider,
  isModelIdValidForProvider,
  normalizeModelId,
} from '@unleashd/shared';
import { z } from 'zod';
import { assertBuddyProviderSupportsMcp } from './provider-capability';

/**
 * Owner-side bound for a Builder-drafted soul. Mirrors BUDDY_SOUL_MAX_CHARACTERS
 * in integration.ts, which truncates the staged soul when composing briefings.
 */
export const BUDDY_BUILDER_SOUL_MAX_CHARACTERS = 10_000;

export const CreateBuddyInputSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    workspaceName: z.string().min(1).max(120).optional(),
    additionalWorkspacePaths: z.array(z.string().min(1)).max(16).optional(),
    name: z.string().min(1).max(120),
    role: z.string().min(1).max(240),
    soul: z.string().min(1).max(BUDDY_BUILDER_SOUL_MAX_CHARACTERS).optional(),
    provider: ProviderSchema.optional(),
    model: z.string().min(1).optional(),
    reasoningEffort: z.string().min(1).optional(),
  })
  .strict();

export type CreateBuddyInput = z.infer<typeof CreateBuddyInputSchema>;

export type BuddyBuilderRecord = BuddySummary;
export type BuddyBuilderWorkspace = BuddyWorkspaceSummary;

interface StoredBuilderResult {
  buddy: BuddyBuilderRecord;
  homeWorkspace: BuddyBuilderWorkspace;
  workspaces: BuddyBuilderWorkspace[];
  requestFingerprint: string;
  replayed: boolean;
}

export interface BuddyBuilderStore {
  listWorkspaces(): BuddyBuilderWorkspace[];
  listBuddies(workspace?: string): BuddyBuilderRecord[];
  createWorkspace(input: {
    name: string;
    rootPath: string;
    slug?: string;
  }): BuddyBuilderWorkspace;
  createBuddyFromBuilder(input: {
    conversationId: string;
    requestFingerprint: string;
    project: string;
    additionalWorkspaces?: string[];
    slug: string;
    name: string;
    role: string;
    soul?: string;
    status: 'active';
    provider: string;
    model?: string;
    reasoningEffort?: string;
  }): StoredBuilderResult;
  getBuddyBuilderResult(conversationId: string): StoredBuilderResult | null;
  /**
   * Soul-path staging for stores whose createBuddyFromBuilder does not yet
   * accept soul text. The canonical store stages the soul file owner-side
   * itself; this service only falls back when the created record has no
   * soul_path yet. Optional so minimal fakes keep working.
   */
  updateBuddy?(id: string, changes: { soulPath?: string | null }): BuddyBuilderRecord;
}

/**
 * Workspace-relative soul path, mirroring the direct-report convention
 * (`profiles/<slug>/BUDDY_SOUL.md`). The store resolves it against the
 * Buddy's home workspace root via its contained-path helper.
 */
export function buddySoulRelativePath(slug: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
    throw new Error(`Cannot stage a soul for an unexpected Buddy slug: ${slug}`);
  }
  return `profiles/${slug}/BUDDY_SOUL.md`;
}

/**
 * Write soul text owner-side under the home workspace root and return the
 * workspace-relative path to hand to the store. Never called with
 * Builder-supplied paths: the slug is server-generated and validated above,
 * so the join cannot escape the workspace.
 */
export function stageBuddySoulFile(workspaceRoot: string, slug: string, soul: string): string {
  const relative = buddySoulRelativePath(slug);
  const absolute = path.join(workspaceRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, soul, 'utf8');
  return relative;
}

function creationSlug(conversationId: string): string {
  const suffix = crypto.createHash('sha256').update(conversationId).digest('hex').slice(0, 16);
  return `builder-${suffix}`;
}

function resolveDirectory(input: string): string {
  const expanded =
    input === '~' || input.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), input.slice(2))
      : input;
  if (!path.isAbsolute(expanded)) {
    throw new Error(`Workspace path must be absolute: ${input}`);
  }
  const resolved = fs.realpathSync(expanded);
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Workspace path is not a directory: ${input}`);
  }
  if (resolved === path.parse(resolved).root) {
    throw new Error('The filesystem root cannot be used as a Buddy workspace');
  }
  return resolved;
}

function workspaceName(rootPath: string, requested?: string): string {
  return requested?.trim() || path.basename(rootPath);
}

function followUpQuestionsForRole(role: string): string[] {
  const words = role.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 6 || role.trim().length >= 52) return [];
  return [
    'What should this Buddy own first, and what would a successful first week look like?',
    'Which decisions should this Buddy make independently versus bring back to you?',
  ];
}

function canonicalResult(conversationId: string, result: StoredBuilderResult): BuddyBuilderResult {
  return {
    conversationId,
    buddy: result.buddy,
    homeWorkspace: result.homeWorkspace,
    workspaces: result.workspaces,
    followUpQuestions: followUpQuestionsForRole(result.buddy.role),
  };
}

/**
 * Application boundary for the Buddy Builder. The model receives three narrow
 * tools; this service owns validation and delegates the one durable mutation to
 * the store. Keep the result server-readable: the UI must never depend on the
 * model copying a special marker into prose.
 */
export class BuddyBuilderService {
  constructor(
    private readonly store: BuddyBuilderStore,
    private readonly conversationId: string
  ) {}

  listWorkspaces(): BuddyBuilderWorkspace[] {
    return this.store.listWorkspaces();
  }

  listBuddies(workspaceId?: string): BuddyBuilderRecord[] {
    if (
      workspaceId &&
      !this.store.listWorkspaces().some((workspace) => workspace.id === workspaceId)
    ) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return this.store.listBuddies(workspaceId);
  }

  getResult(): BuddyBuilderResult | null {
    const result = this.store.getBuddyBuilderResult(this.conversationId);
    return result ? canonicalResult(this.conversationId, result) : null;
  }

  private resolveWorkspace(input: {
    workspaceId?: string;
    workspacePath?: string;
    workspaceName?: string;
  }): BuddyBuilderWorkspace {
    if (Boolean(input.workspaceId) === Boolean(input.workspacePath)) {
      throw new Error('Provide exactly one of workspaceId or workspacePath');
    }
    if (input.workspaceId) {
      const existing = this.store
        .listWorkspaces()
        .find((workspace) => workspace.id === input.workspaceId);
      if (!existing) throw new Error(`Workspace not found: ${input.workspaceId}`);
      return existing;
    }

    const rootPath = resolveDirectory(input.workspacePath as string);
    const existing = this.store.listWorkspaces().find((workspace) => {
      try {
        return fs.realpathSync(workspace.root_path) === rootPath;
      } catch {
        return path.resolve(workspace.root_path) === rootPath;
      }
    });
    return (
      existing ??
      this.store.createWorkspace({
        name: workspaceName(rootPath, input.workspaceName),
        rootPath,
      })
    );
  }

  createBuddy(input: unknown): BuddyBuilderResult {
    const parsed = CreateBuddyInputSchema.parse(input);

    const provider = parsed.provider ?? 'codex';
    assertBuddyProviderSupportsMcp(provider);
    const requestedModel = parsed.model ?? (provider === 'codex' ? 'gpt-5.6-luna' : undefined);
    const model = normalizeModelId(provider, requestedModel);
    const reasoningEffort =
      parsed.reasoningEffort ??
      (provider === 'codex' ? 'high' : defaultReasoningEffortForProvider(provider, model));
    if (!isModelIdValidForProvider(provider, model)) {
      throw new Error(`Invalid ${provider} model: ${requestedModel}`);
    }
    if (!isEffortValidForProvider(provider, reasoningEffort)) {
      throw new Error(`Invalid ${provider} reasoning effort: ${reasoningEffort}`);
    }

    const homeReference = parsed.workspaceId
      ? { id: parsed.workspaceId }
      : { path: resolveDirectory(parsed.workspacePath as string) };
    const additionalPaths = [
      ...new Set((parsed.additionalWorkspacePaths ?? []).map(resolveDirectory)),
    ].sort();
    const soul = parsed.soul?.trim() ? parsed.soul.trim() : undefined;
    const requested = {
      name: parsed.name.trim(),
      role: parsed.role.trim(),
      soul: soul ?? null,
      provider,
      model: model ?? null,
      reasoningEffort: reasoningEffort ?? null,
      homeWorkspace: homeReference,
      additionalWorkspacePaths: additionalPaths,
    };
    const requestFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify(requested))
      .digest('hex');
    const slug = creationSlug(this.conversationId);
    const existing = this.store.getBuddyBuilderResult(this.conversationId);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new Error('This Buddy Builder conversation already created a different Buddy');
      }
      return canonicalResult(this.conversationId, this.ensureBuilderSoul(existing, slug, soul));
    }

    const workspace = this.resolveWorkspace(parsed);
    const additionalWorkspaces = additionalPaths.map((workspacePath) =>
      this.resolveWorkspace({ workspacePath })
    );
    return canonicalResult(
      this.conversationId,
      this.ensureBuilderSoul(
        this.store.createBuddyFromBuilder({
          conversationId: this.conversationId,
          requestFingerprint,
          project: workspace.id,
          additionalWorkspaces: additionalWorkspaces.map((candidate) => candidate.id),
          slug,
          name: requested.name,
          role: requested.role,
          ...(soul !== undefined ? { soul } : {}),
          status: 'active',
          provider,
          model: model ?? undefined,
          reasoningEffort: reasoningEffort ?? undefined,
        }),
        slug,
        soul
      )
    );
  }

  /**
   * Persist a Builder-drafted soul when the store did not stage one itself.
   * Stores with soul-text support set soul_path during createBuddyFromBuilder
   * and skip this path; older stores get the owner-side file plus an
   * updateBuddy soulPath pointer, so creation-time souls persist either way.
   */
  private ensureBuilderSoul(
    result: StoredBuilderResult,
    slug: string,
    soul: string | undefined
  ): StoredBuilderResult {
    if (soul === undefined) return result;
    const staged = (result.buddy as unknown as { soul_path?: unknown }).soul_path;
    if (typeof staged === 'string' && staged) return result;
    if (typeof this.store.updateBuddy !== 'function') return result;
    const buddy = this.store.updateBuddy(result.buddy.id, {
      soulPath: stageBuddySoulFile(result.homeWorkspace.root_path, slug, soul),
    });
    return { ...result, buddy };
  }
}

export const BUDDY_BUILDER_BRIEFING = [
  'You are the Unleashd Buddy Builder. Help the user hire one durable Buddy through conversation.',
  'Use only the native list_workspaces, list_buddies, and create_buddy tools for Buddy state.',
  'Inspect available workspaces and existing Buddies before proposing a hire.',
  'A workspace is durable context, not an approval allowlist. If the requested home folder exists but is not registered, pass its absolute path as workspacePath and the server will register it.',
  'Use additionalWorkspacePaths only for other existing folders the user explicitly placed in scope.',
  'Infer a concise name and role. Ask only when the home folder or intended role is materially ambiguous.',
  'Creation includes identity, one home workspace, explicit additional workspace assignments, an execution profile, and a soul only.',
  'Draft the soul from the name/role conversation — a short behavior and authority contract for the new Buddy — and pass it as soul.',
  'Do not create managers, automations, files, skills, projects, permissions, sends, or production changes. Passing the soul string is allowed; writing soul files is not.',
  'The server defaults new Buddies to Codex, gpt-5.6-luna, high. Omit profile fields unless the user requests an exception.',
  'After create_buddy succeeds, briefly confirm the hire. If the result includes followUpQuestions, ask those questions next so the user can sharpen the brief without creating a second Buddy. The application renders the canonical Buddy card separately.',
].join('\n');
