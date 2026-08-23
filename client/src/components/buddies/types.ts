export type WorkStatus =
  | 'backlog'
  | 'ready'
  | 'in_progress'
  | 'blocked'
  | 'review'
  | 'done'
  | 'cancelled';

export type TodoStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
export type EmployeeTab = 'work' | 'conversations' | 'memory' | 'automations';

export interface Workspace {
  id: string;
  slug?: string;
  name: string;
  root_path: string;
  assignment_role?: string | null;
}

export interface Sprint {
  id: string;
  project_id?: string;
  workspace_id?: string;
  name: string;
  goal: string | null;
  status: string;
}

export interface LegacyWorkItem {
  id: string;
  project_id: string;
  buddy_id: string | null;
  title: string;
  status: WorkStatus;
  priority: number;
  next_action: string | null;
  blocked_reason: string | null;
  definition_of_done: string;
  source_path: string | null;
}

export interface BuddyTodo {
  id: string;
  title: string;
  status: TodoStatus;
  definition_of_done?: string | null;
  next_action?: string | null;
  blocked_reason?: string | null;
}

export interface BuddyProject {
  id: string;
  workspace_id: string;
  buddy_id: string;
  title: string;
  objective?: string | null;
  definition_of_done: string;
  status: WorkStatus;
  priority: number;
  next_action?: string | null;
  blocked_reason?: string | null;
  sprint_name?: string | null;
  updated_at: string;
  todos: BuddyTodo[];
}

export interface ConversationLink {
  id?: string;
  conversation_id?: string;
  unleashd_conversation_id?: string | null;
  workspace_id?: string | null;
  buddy_project_id?: string | null;
  status: string;
  last_active_at?: string | null;
  kind?: 'conversation' | 'review' | 'automation';
}

export interface BuddyMemory {
  soulPath?: string | null;
  soul?: string;
  summary: string;
  recentJournal: Array<{ path: string; content: string }>;
}

export type AutomationRun = PublicBuddyAutomationRun;

export interface BuddyAutomationPolicy {
  max_runtime_seconds: number;
  max_iterations: number;
  max_tokens: number;
  max_cost_usd: number;
  allowed_operations: string[];
}

export interface BuddyAutomation {
  id: string;
  name: string;
  workspace_id?: string | null;
  buddy_project_id?: string | null;
  schedule_kind: 'cron' | 'interval';
  schedule_expression: string;
  timezone: string;
  job_kind: 'prompt' | 'sequence' | 'loop';
  job_payload: Record<string, unknown>;
  policy: BuddyAutomationPolicy;
  enabled: boolean;
  next_run_at?: string | null;
  last_run_at?: string | null;
  runs?: AutomationRun[];
}

export interface BuddyApprovalRequest {
  id: string;
  action: string;
  reason: string;
  risk: string;
  status: 'pending' | 'approved' | 'rejected';
  resolved_by: string | null;
  resolution_note: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface Buddy {
  id: string;
  name: string;
  role: string;
  status: string;
  manager_id?: string | null;
  team_size?: number;
  soul_path: string | null;
  memory_path: string | null;
  provider: string | null;
  model?: string | null;
  reasoning_effort: string | null;
  projects?: Workspace[];
  workspaces?: Workspace[];
  conversations?: ConversationLink[];
}

export interface Dashboard {
  projects?: Workspace[];
  workspaces?: Workspace[];
  buddies: Buddy[];
  sprints?: Sprint[];
  workItems?: LegacyWorkItem[];
  legacyWorkItems?: LegacyWorkItem[];
  buddyOwnedProjects?: BuddyProject[];
}

export interface BuddyOverviewEmployee {
  buddy: Buddy;
  managerId: string | null;
  workspaces: Workspace[];
  team: Array<Pick<Buddy, 'id' | 'name' | 'role' | 'status'>>;
  currentWork: {
    open: number;
    active: number;
    blocked: number;
    review: number;
    nextActionMissing: number;
  };
}

export interface BuddyOverview {
  generatedAt: string;
  employees: BuddyOverviewEmployee[];
  topLevel: BuddyOverviewEmployee[];
  recentRuns: Array<{
    conversationId: string;
    buddyId: string;
    buddyName: string;
    workspaceId: string;
    workspaceName: string;
    status: string;
    lastActiveAt: string;
  }>;
}

export interface EmployeeRecord {
  buddy: Buddy;
  workspaces: Workspace[];
  sprints: Sprint[];
  projects: BuddyProject[];
  legacyWorkItems: LegacyWorkItem[];
  conversations: ConversationLink[];
  skills: Array<{ name: string; mode?: string; instruction_path?: string | null }>;
  manager: { id: string; name: string; role?: string } | null;
  directReports: Array<{ id: string; name: string; role?: string }>;
  reviews: Array<{
    id: string;
    subject_buddy_id: string;
    subject_buddy_name?: string;
    reviewer_role?: string;
    evidence: unknown[];
    verdict: string | null;
    summary: string | null;
    created_at?: string;
  }>;
  approvals: BuddyApprovalRequest[];
}

export type BuddyMutation = (key: string, action: () => Promise<unknown>) => Promise<void>;

export const EMPTY_MEMORY: BuddyMemory = { summary: '', recentJournal: [] };
import type { BuddyAutomationRun as PublicBuddyAutomationRun } from '@unleashd/shared';
