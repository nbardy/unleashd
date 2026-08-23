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

export const CreateBuddyInputSchema = z
  .object({
    workspaceId: z.string().min(1).optional(),
    workspacePath: z.string().min(1).optional(),
    workspaceName: z.string().min(1).max(120).optional(),
    additionalWorkspacePaths: z.array(z.string().min(1)).max(16).optional(),
    name: z.string().min(1).max(120),
    role: z.string().min(1).max(240),
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
    status: 'active';
    provider: string;
    model?: string;
    reasoningEffort?: string;
  }): StoredBuilderResult;
  getBuddyBuilderResult(conversationId: string): StoredBuilderResult | null;
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
    const requested = {
      name: parsed.name.trim(),
      role: parsed.role.trim(),
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
    const existing = this.store.getBuddyBuilderResult(this.conversationId);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new Error('This Buddy Builder conversation already created a different Buddy');
      }
      return canonicalResult(this.conversationId, existing);
    }

    const workspace = this.resolveWorkspace(parsed);
    const additionalWorkspaces = additionalPaths.map((workspacePath) =>
      this.resolveWorkspace({ workspacePath })
    );
    const slug = creationSlug(this.conversationId);
    return canonicalResult(
      this.conversationId,
      this.store.createBuddyFromBuilder({
        conversationId: this.conversationId,
        requestFingerprint,
        project: workspace.id,
        additionalWorkspaces: additionalWorkspaces.map((candidate) => candidate.id),
        slug,
        name: requested.name,
        role: requested.role,
        status: 'active',
        provider,
        model: model ?? undefined,
        reasoningEffort: reasoningEffort ?? undefined,
      })
    );
  }
}

export const BUDDY_BUILDER_BRIEFING = [
  'You are the Unleashd Buddy Builder. Help the user hire one durable Buddy through conversation.',
  'Use only the native list_workspaces, list_buddies, and create_buddy tools for Buddy state.',
  'Inspect available workspaces and existing Buddies before proposing a hire.',
  'A workspace is durable context, not an approval allowlist. If the requested home folder exists but is not registered, pass its absolute path as workspacePath and the server will register it.',
  'Use additionalWorkspacePaths only for other existing folders the user explicitly placed in scope.',
  'Infer a concise name and role. Ask only when the home folder or intended role is materially ambiguous.',
  'Creation includes identity, one home workspace, explicit additional workspace assignments, and an execution profile only.',
  'Do not create managers, automations, files, skills, projects, permissions, sends, or production changes.',
  'The server defaults new Buddies to Codex, gpt-5.6-luna, high. Omit profile fields unless the user requests an exception.',
  'After create_buddy succeeds, briefly confirm the hire. If the result includes followUpQuestions, ask those questions next so the user can sharpen the brief without creating a second Buddy. The application renders the canonical Buddy card separately.',
].join('\n');
