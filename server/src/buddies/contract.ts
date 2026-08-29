export type BuddyAutomationRunStatus =
  | 'claimed'
  | 'running'
  | 'cancel_requested'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type BuddyOperationName =
  | 'buddy.get_current_work'
  | 'buddy.get_inbox'
  | 'buddy.get_automations'
  | 'buddy.set_automation'
  | 'buddy.new_project'
  | 'buddy.update_project'
  | 'buddy.update_memory'
  | 'buddy.remember_note'
  | 'buddy.recall'
  | 'buddy.remember'
  | 'buddy.compact_memory'
  | 'buddy.delegate'
  | 'buddy.request_review'
  | 'buddy.complete_delegation'
  | 'buddy.complete_assignment'
  | 'buddy.submit_review'
  | 'buddy.request_human_approval';

export interface BuddyAutomationPolicy {
  max_runtime_seconds: number;
  max_iterations: number;
  max_tokens: number;
  max_cost_usd: number;
  allowed_operations: BuddyOperationName[];
}

export interface BuddyAutomation {
  id: string;
  buddy_id: string;
  workspace_id: string;
  buddy_project_id: string | null;
  name: string;
  schedule_kind: 'cron' | 'interval';
  schedule_expression: string;
  timezone: string;
  job_kind: 'prompt' | 'sequence' | 'loop';
  job_payload:
    | { prompt: string }
    | { prompts: string[] }
    | {
        prompt: string;
        termination: {
          condition: string;
          max_iterations: number;
          max_duration_seconds: number;
        };
      };
  policy: BuddyAutomationPolicy;
  enabled: boolean;
  archived_at: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuddyAutomationRun {
  id: string;
  automation_id: string;
  scheduled_for: string;
  idempotency_key: string;
  status: BuddyAutomationRunStatus;
  conversation_id: string | null;
  iteration: number;
  tokens_used: number;
  cost_usd: number;
  policy: BuddyAutomationPolicy;
  outcome: string | null;
  error: string | null;
  claimed_at: string;
  started_at: string | null;
  ended_at: string | null;
  claim_token: string | null;
  claim_expires_at: string | null;
  claim_acquired?: boolean;
}

export interface BuddyApprovalRequest {
  id: string;
  buddy_id: string;
  workspace_id: string;
  buddy_project_id: string | null;
  automation_run_id: string | null;
  conversation_id: string | null;
  action: string;
  reason: string;
  risk: string;
  status: 'pending' | 'approved' | 'rejected';
  resolved_by: string | null;
  resolution_note: string | null;
  requested_at: string;
  resolved_at: string | null;
}

interface BuddyRecord {
  id: string;
  name: string;
  role: string;
  status: string;
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
}

interface BuddyWorkspace {
  id: string;
  name: string;
  root_path: string;
}

interface BuddySkill {
  name: string;
  instruction_path: string;
  mode: string;
}

export interface BuddyDelegation {
  id: string;
  from_buddy_id: string;
  to_buddy_id: string;
  workspace_id: string;
  buddy_project_id: string | null;
  child_conversation_id: string | null;
  purpose: string;
  parent_conversation_id: string | null;
  status: string;
  outcome?: string | null;
  dispatch_token?: string | null;
  dispatch_expires_at?: string | null;
  dispatch_claim_acquired?: boolean;
}

export interface BuddyReviewRecord {
  id: string;
  reviewer_buddy_id: string;
  subject_buddy_id: string;
  workspace_id: string;
  buddy_project_id: string | null;
  conversation_id: string | null;
  status: string;
  verdict: string | null;
  score: number | null;
  summary: string | null;
  evidence: unknown[];
}

interface BuddyLegacyWorkItem {
  id: string;
  buddy_id: string | null;
  project_id: string;
}

export type BuddyMemoryDocumentKind = 'working' | 'long_term';

export interface BuddyMemoryRevision {
  buddy_id: string;
  document_kind: BuddyMemoryDocumentKind;
  revision: number;
  generation: number;
  body: string;
  reasoning: string;
  author_kind: string;
  requested_by: string | null;
  provenance: unknown;
  sha256: string;
  view_status: 'current' | 'stale';
  view_error?: string;
  updated_at: string;
}

export interface BuddyMemoryNote {
  id: string;
  path: string;
  topic: string;
  kind: string;
  buddy_id: string;
  workspace_id: string;
  evidence: unknown[];
  content: string;
  written_at: string;
}

export interface BuddyMemoryRecall {
  pattern: string;
  matches: Array<{
    path: string;
    content: string;
    created_at: string | null;
    workspace_id: string;
  }>;
  truncated: boolean;
}

/**
 * The v2 package shape. summary/recentJournal remain only as a one-release
 * read compatibility projection for the existing desktop/mobile clients and
 * the still-legacy vendored package.
 */
export interface BuddyMemory {
  working: string;
  longTerm: string;
  workingRevision: number;
  longTermRevision: number;
  generation: number;
  summary: string;
  recentJournal: Array<{ path: string; content: string }>;
}

export interface BuddyMemoryUpdateInput {
  documentKind?: BuddyMemoryDocumentKind;
  doc?: BuddyMemoryDocumentKind;
  content: string;
  reasoning: string;
  baseVersion: number;
  authorKind?: string;
  requestedBy?: string | null;
  provenance?: unknown;
}

export interface BuddyMemoryNoteInput {
  topic?: string;
  kind?: string;
  body?: string;
  content?: string;
  evidence?: unknown[];
  workspace?: string;
  scope?: 'current' | 'home' | 'all';
}

export interface BuddyMemoryRecallInput {
  pattern: string;
  workspace?: string;
  scope?: 'current' | 'home' | 'all';
  since?: string;
  limit?: number;
}

export type BuddyMemoryErrorCode =
  | 'MEMORY_UNCONFIGURED'
  | 'MEMORY_CORRUPT'
  | 'MEMORY_STALE'
  | 'MEMORY_TOO_LARGE'
  | 'MEMORY_CAPABILITY_MISSING'
  | 'BUDDY_INACTIVE'
  | 'WORKSPACE_FORBIDDEN'
  | 'RECALL_TRUNCATED'
  | 'MATERIALIZED_VIEW_STALE';

export class BuddyMemoryOperationError extends Error {
  readonly code: BuddyMemoryErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: BuddyMemoryErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BuddyMemoryOperationError';
    this.code = code;
    this.details = details;
  }
}

interface BuddyDetailContext {
  buddy: BuddyRecord;
  workspace: BuddyWorkspace | null;
  project: { id: string } | null;
  projects: unknown[];
  legacyWorkItems: unknown[];
  sprint: unknown;
  relationships: unknown[];
  skills: BuddySkill[];
  soul: string;
  memory: {
    working: string;
    longTerm: string;
    workingRevision: number;
    longTermRevision: number;
    generation: number;
    summary: string;
    recentJournal: Array<{ path: string; content: string }>;
  };
}

export interface BuddiesStorePort {
  dashboard(): unknown;
  overview(options?: { recentSince?: Date | string }): unknown;
  getBuddy(id: string): BuddyRecord | null;
  updateBuddy(
    id: string,
    changes: {
      provider?: string | null;
      model?: string | null;
      reasoningEffort?: string | null;
    }
  ): BuddyRecord;
  listBuddyWorkspaces(buddy: string): unknown[];
  listBuddyOwnedProjects(input: Record<string, unknown>): unknown[];
  getBuddyProject(id: string): {
    id: string;
    buddy_id: string;
    workspace_id: string;
    definition_of_done: string;
  } | null;
  listWorkItems(input: Record<string, unknown>): unknown[];
  listConversationLinks(buddy: string): unknown[];
  listAutomations(input: { buddy: string; includeArchived?: boolean }): BuddyAutomation[];
  listBuddyRelationships(buddy: string): unknown[];
  listBuddySkills(buddy: string): BuddySkill[];
  listDelegations(input: Record<string, unknown>): BuddyDelegation[];
  listReviews(input: Record<string, unknown>): BuddyReviewRecord[];
  getBuddyContext(
    buddy: string,
    input: { workspace?: string; project?: string }
  ): BuddyDetailContext;
  getWorkItem(id: string): BuddyLegacyWorkItem | null;
  updateConversationLink(
    id: string,
    changes: { status?: string; providerSessionId?: string }
  ): unknown;
  updateDelegation(
    id: string,
    changes: { status?: string; childConversationId?: string | null; outcome?: string | null }
  ): BuddyDelegation;
  linkConversation(input: Record<string, unknown>): unknown;
  setBuddyRelationship(input: Record<string, unknown>): unknown;
  assignBuddySkill(input: Record<string, unknown>): unknown;
  createDelegation(input: Record<string, unknown>): BuddyDelegation;
  getDelegation(id: string): BuddyDelegation | null;
  claimDelegationDispatch(
    id: string,
    input: { claimToken: string; leaseSeconds?: number }
  ): BuddyDelegation;
  bindDelegationConversation(
    id: string,
    input: { claimToken: string; childConversationId: string }
  ): BuddyDelegation;
  failDelegationDispatch(id: string, input: { claimToken: string; error: string }): BuddyDelegation;
  createReview(input: Record<string, unknown>): { id: string };
  getReview(id: string): BuddyReviewRecord | null;
  updateReview(id: string, changes: Record<string, unknown>): unknown;
  readBuddyMemory(buddy: string): BuddyMemory;
  updateMemory?(buddy: string, input: BuddyMemoryUpdateInput): BuddyMemoryRevision;
  rememberNote?(buddy: string, input: BuddyMemoryNoteInput): BuddyMemoryNote;
  recall?(buddy: string, input: BuddyMemoryRecallInput): BuddyMemoryRecall;
  /** Legacy compatibility for the pre-v2 package during the migration window. */
  remember(buddy: string, input: Record<string, unknown>): unknown;
  /** Legacy compatibility for the pre-v2 package during the migration window. */
  compactMemory(buddy: string, input: Record<string, unknown>): unknown;
  recordAuditEvent(input: Record<string, unknown>): unknown;
  listAuditEvents(input?: {
    buddy?: string;
    workspace?: string;
    project?: string;
    limit?: number;
  }): Array<{
    id: string;
    buddy_id: string;
    operation: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
  createApprovalRequest(input: {
    buddy: string;
    workspace: string;
    project?: string;
    automationRun?: string;
    conversationId?: string;
    action: string;
    reason: string;
    risk: string;
  }): BuddyApprovalRequest;
  getApprovalRequest(id: string): BuddyApprovalRequest | null;
  listApprovalRequests(input?: {
    buddy?: string;
    workspace?: string;
    project?: string;
    status?: 'pending' | 'approved' | 'rejected';
    limit?: number;
  }): BuddyApprovalRequest[];
  resolveApprovalRequest(
    id: string,
    input: {
      decision: 'approved' | 'rejected';
      resolvedBy: string;
      note?: string;
    }
  ): BuddyApprovalRequest;
  newProject(input: Record<string, unknown>): unknown;
  updateProject(id: string, changes: Record<string, unknown>): unknown;
  createAutomation(input: Record<string, unknown>): BuddyAutomation;
  getAutomation(id: string): BuddyAutomation | null;
  updateAutomation(id: string, changes: Record<string, unknown>): BuddyAutomation;
  deleteAutomation(id: string): BuddyAutomation;
  archiveAutomation(id: string): BuddyAutomation;
  listDueAutomations(at: Date): BuddyAutomation[];
  claimAutomationRun(
    id: string,
    input?: {
      scheduledFor?: string;
      idempotencyKey?: string;
      claimToken?: string;
      leaseSeconds?: number;
    }
  ): BuddyAutomationRun;
  getAutomationRun(id: string): BuddyAutomationRun | null;
  updateAutomationRun(
    id: string,
    changes: {
      status: BuddyAutomationRunStatus;
      conversationId?: string | null;
      iteration?: number;
      tokensUsed?: number;
      costUsd?: number;
      outcome?: string | null;
      error?: string | null;
      nextRunAt?: string | null;
      claimToken?: string;
    }
  ): BuddyAutomationRun;
  listAutomationRuns(id: string, options?: { limit?: number }): BuddyAutomationRun[];
  getAutomationRunByConversationId(conversationId: string): BuddyAutomationRun | null;
  listNonterminalAutomationRuns(): BuddyAutomationRun[];
  assertAutomationOperationAllowed(
    id: string,
    operation: BuddyOperationName,
    claimToken: string
  ): true;
  withAutomationRunAuthority<T>(
    id: string,
    operation: BuddyOperationName,
    claimToken: string,
    callback: () => T
  ): T;
  updateWorkItemStatus(
    id: string,
    status: string,
    options: { blockedReason?: string; nextAction?: string }
  ): unknown;
}

export interface BuddiesModule {
  BuddiesStore: new () => BuddiesStorePort;
}
