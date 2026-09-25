CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
CREATE TABLE buddies (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
          soul_path TEXT,
          memory_path TEXT,
          provider TEXT,
          model TEXT,
          reasoning_effort TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, hire_quota INTEGER NOT NULL DEFAULT 0 CHECK (hire_quota >= 0), profile_revision INTEGER NOT NULL DEFAULT 1, employment_mode TEXT NOT NULL DEFAULT 'standing' CHECK(employment_mode IN ('standing','worker')),
          UNIQUE(project_id, slug)
        ) STRICT;
CREATE TABLE buddy_projects (
          buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          assignment_role TEXT,
          created_at TEXT NOT NULL, read_all_work INTEGER NOT NULL DEFAULT 0, dispatch INTEGER NOT NULL DEFAULT 1, background_enabled INTEGER NOT NULL DEFAULT 0, max_active_runs INTEGER NOT NULL DEFAULT 2, max_background_runs_per_hour INTEGER NOT NULL DEFAULT 30, max_sends_per_hour INTEGER NOT NULL DEFAULT 100, max_pending_runs INTEGER NOT NULL DEFAULT 100, background_paused_reason TEXT,
          PRIMARY KEY (buddy_id, project_id)
        ) STRICT;
CREATE TABLE sprints (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          goal TEXT,
          status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
          starts_at TEXT,
          ends_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
CREATE UNIQUE INDEX one_active_sprint_per_project
          ON sprints(project_id) WHERE status = 'active';
CREATE TABLE work_items (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
          buddy_id TEXT REFERENCES buddies(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'task',
          external_key TEXT,
          source_path TEXT,
          objective TEXT,
          definition_of_done TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled')
          ),
          priority INTEGER NOT NULL DEFAULT 0,
          next_action TEXT,
          blocked_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        ) STRICT;
CREATE UNIQUE INDEX work_items_by_external_key
          ON work_items(project_id, external_key)
          WHERE external_key IS NOT NULL;
CREATE INDEX work_items_by_project_status
          ON work_items(project_id, status, priority DESC, created_at);
CREATE INDEX work_items_by_buddy_status
          ON work_items(buddy_id, status, priority DESC, created_at);
CREATE TABLE conversation_links (
          id TEXT PRIMARY KEY,
          buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
          provider TEXT NOT NULL,
          provider_session_id TEXT,
          unleashd_conversation_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'complete', 'failed', 'cancelled')),
          started_at TEXT NOT NULL,
          last_active_at TEXT NOT NULL,
          ended_at TEXT, buddy_project_id TEXT REFERENCES owned_projects(id) ON DELETE SET NULL, workspace_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          CHECK (provider_session_id IS NOT NULL OR unleashd_conversation_id IS NOT NULL)
        ) STRICT;
CREATE UNIQUE INDEX conversation_links_by_unleashd_id
          ON conversation_links(unleashd_conversation_id)
          WHERE unleashd_conversation_id IS NOT NULL;
CREATE TABLE owned_projects (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          objective TEXT,
          definition_of_done TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('backlog', 'ready', 'in_progress', 'blocked', 'review', 'done', 'cancelled')
          ),
          priority INTEGER NOT NULL DEFAULT 0,
          next_action TEXT,
          blocked_reason TEXT,
          source_path TEXT,
          external_key TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        , parent_project_id TEXT REFERENCES owned_projects(id), revision INTEGER NOT NULL DEFAULT 1, execution_state TEXT NOT NULL DEFAULT 'enabled' CHECK(execution_state IN ('enabled','paused','draining','cancelled')), execution_epoch INTEGER NOT NULL DEFAULT 1, pending_owner_id TEXT REFERENCES buddies(id), completion_evidence TEXT NOT NULL DEFAULT '[]', accepted_by TEXT REFERENCES buddies(id), accepted_at TEXT) STRICT;
CREATE UNIQUE INDEX owned_projects_by_external_key
          ON owned_projects(workspace_id, external_key)
          WHERE external_key IS NOT NULL;
CREATE INDEX owned_projects_by_buddy_status
          ON owned_projects(buddy_id, status, priority DESC, created_at);
CREATE TABLE buddy_todos (
          id TEXT PRIMARY KEY,
          buddy_project_id TEXT NOT NULL REFERENCES owned_projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')
          ),
          position INTEGER NOT NULL,
          definition_of_done TEXT,
          next_action TEXT,
          blocked_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        , completion_evidence TEXT NOT NULL DEFAULT '[]') STRICT;
CREATE INDEX buddy_todos_by_project_position
          ON buddy_todos(buddy_project_id, position, created_at);
CREATE TABLE buddy_automations (
          id TEXT PRIMARY KEY,
          buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          workspace_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          buddy_project_id TEXT REFERENCES owned_projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('cron', 'interval')),
          schedule_expression TEXT NOT NULL,
          timezone TEXT NOT NULL,
          job_kind TEXT NOT NULL CHECK (job_kind IN ('prompt', 'sequence', 'loop')),
          job_payload TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          next_run_at TEXT,
          last_run_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        , archived_at TEXT) STRICT;
CREATE INDEX buddy_automations_due
          ON buddy_automations(enabled, next_run_at);
CREATE TABLE buddy_relationships (
          id TEXT PRIMARY KEY,
          from_buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          to_buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (
            kind IN ('manager', 'reports_to', 'consults', 'reviews')
          ),
          created_at TEXT NOT NULL,
          UNIQUE(from_buddy_id, to_buddy_id, kind),
          CHECK(from_buddy_id != to_buddy_id)
        ) STRICT;
CREATE TABLE buddy_skills (
          id TEXT PRIMARY KEY,
          buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          instruction_path TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('always', 'on_demand')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(buddy_id, name)
        ) STRICT;
CREATE TABLE buddy_delegations (
          id TEXT PRIMARY KEY,
          from_buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          to_buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          buddy_project_id TEXT REFERENCES owned_projects(id) ON DELETE SET NULL,
          purpose TEXT NOT NULL,
          parent_conversation_id TEXT,
          child_conversation_id TEXT,
          status TEXT NOT NULL CHECK (
            status IN ('pending', 'active', 'complete', 'failed', 'cancelled')
          ),
          outcome TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT, dispatch_token TEXT, dispatch_expires_at TEXT,
          CHECK(from_buddy_id != to_buddy_id)
        ) STRICT;
CREATE TABLE buddy_reviews (
          id TEXT PRIMARY KEY,
          reviewer_buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          subject_buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          buddy_project_id TEXT REFERENCES owned_projects(id) ON DELETE SET NULL,
          conversation_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('draft', 'complete', 'cancelled')),
          verdict TEXT CHECK (verdict IN ('needs_work', 'pass', 'fail')),
          score REAL,
          summary TEXT,
          evidence TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        ) STRICT;
CREATE TRIGGER conversation_links_workspace_required_insert
        BEFORE INSERT ON conversation_links
        WHEN NEW.workspace_id IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'conversation workspace is required');
        END;
CREATE TRIGGER conversation_links_workspace_required_update
        BEFORE UPDATE OF workspace_id ON conversation_links
        WHEN NEW.workspace_id IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'conversation workspace is required');
        END;
CREATE TRIGGER buddy_automations_workspace_required_insert
        BEFORE INSERT ON buddy_automations
        WHEN NEW.workspace_id IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'automation workspace is required');
        END;
CREATE TRIGGER buddy_automations_workspace_required_update
        BEFORE UPDATE OF workspace_id ON buddy_automations
        WHEN NEW.workspace_id IS NULL
        BEGIN
          SELECT RAISE(ABORT, 'automation workspace is required');
        END;
CREATE TABLE buddy_audit_events (
          id TEXT PRIMARY KEY,
          buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          buddy_project_id TEXT REFERENCES owned_projects(id) ON DELETE SET NULL,
          operation TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
CREATE INDEX buddy_audit_events_by_buddy
          ON buddy_audit_events(buddy_id, created_at DESC);
CREATE INDEX buddy_audit_events_by_project
          ON buddy_audit_events(buddy_project_id, created_at DESC);
CREATE TABLE buddy_automation_policies (
          automation_id TEXT PRIMARY KEY
            REFERENCES buddy_automations(id) ON DELETE CASCADE,
          max_runtime_seconds INTEGER NOT NULL CHECK (max_runtime_seconds > 0),
          max_iterations INTEGER NOT NULL CHECK (max_iterations > 0),
          max_tokens INTEGER NOT NULL CHECK (max_tokens > 0),
          max_cost_usd REAL NOT NULL CHECK (max_cost_usd > 0),
          allowed_operations TEXT NOT NULL CHECK (
            json_valid(allowed_operations) AND json_type(allowed_operations) = 'array'
          ),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
CREATE TABLE buddy_automation_run_policies (
          run_id TEXT PRIMARY KEY
            REFERENCES buddy_automation_runs(id) ON DELETE CASCADE,
          max_runtime_seconds INTEGER NOT NULL CHECK (max_runtime_seconds > 0),
          max_iterations INTEGER NOT NULL CHECK (max_iterations > 0),
          max_tokens INTEGER NOT NULL CHECK (max_tokens > 0),
          max_cost_usd REAL NOT NULL CHECK (max_cost_usd > 0),
          allowed_operations TEXT NOT NULL CHECK (
            json_valid(allowed_operations) AND json_type(allowed_operations) = 'array'
          ),
          tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
          cost_usd REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0)
        ) STRICT;
CREATE TABLE buddy_approval_requests (
          id TEXT PRIMARY KEY,
          buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          buddy_project_id TEXT REFERENCES owned_projects(id) ON DELETE SET NULL,
          automation_run_id TEXT REFERENCES buddy_automation_runs(id) ON DELETE SET NULL,
          conversation_id TEXT,
          action TEXT NOT NULL,
          reason TEXT NOT NULL,
          risk TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
          resolved_by TEXT,
          resolution_note TEXT,
          requested_at TEXT NOT NULL,
          resolved_at TEXT, message_id TEXT REFERENCES buddy_messages(id), operation TEXT, arguments_json TEXT, arguments_hash TEXT, project_revision INTEGER, expires_at TEXT, consumed_by_run_id TEXT REFERENCES buddy_runs(id),
          CHECK (
            (status = 'pending' AND resolved_by IS NULL AND resolved_at IS NULL)
            OR
            (status IN ('approved', 'rejected') AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
          )
        ) STRICT;
CREATE INDEX buddy_approval_requests_by_buddy
          ON buddy_approval_requests(buddy_id, status, requested_at DESC);
CREATE INDEX buddy_approval_requests_by_workspace
          ON buddy_approval_requests(workspace_id, status, requested_at DESC);
CREATE INDEX buddy_delegations_by_dispatch_expiry
            ON buddy_delegations(status, dispatch_expires_at);
CREATE TABLE buddy_builder_creations (
          conversation_id TEXT PRIMARY KEY,
          buddy_id TEXT NOT NULL UNIQUE REFERENCES buddies(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          request_fingerprint TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;
CREATE UNIQUE INDEX buddy_one_manager_fwd
            ON buddy_relationships(to_buddy_id) WHERE kind = 'manager';
CREATE UNIQUE INDEX buddy_one_manager_rev
            ON buddy_relationships(from_buddy_id) WHERE kind = 'reports_to';
CREATE TABLE IF NOT EXISTS "buddy_automation_runs" (
            id TEXT PRIMARY KEY,
            automation_id TEXT NOT NULL REFERENCES buddy_automations(id) ON DELETE CASCADE,
            scheduled_for TEXT NOT NULL,
            idempotency_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL CHECK (
              status IN (
                'claimed', 'running', 'cancel_requested',
                'complete', 'failed', 'cancelled'
              )
            ),
            conversation_id TEXT,
            iteration INTEGER NOT NULL DEFAULT 0,
            outcome TEXT,
            error TEXT,
            claimed_at TEXT NOT NULL,
            started_at TEXT,
            ended_at TEXT,
            claim_token TEXT,
            claim_expires_at TEXT
          ) STRICT;
CREATE INDEX buddy_automation_runs_by_automation
            ON buddy_automation_runs(automation_id, claimed_at DESC);
CREATE INDEX buddy_automation_runs_by_claim_expiry
            ON buddy_automation_runs(status, claim_expires_at);
CREATE TABLE IF NOT EXISTS "buddy_memory_revisions" (
            id TEXT PRIMARY KEY,
            buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
            document_kind TEXT NOT NULL CHECK (document_kind IN ('working', 'long_term', 'soul')),
            revision INTEGER NOT NULL CHECK (revision > 0),
            base_revision_id TEXT REFERENCES "buddy_memory_revisions"(id),
            body TEXT NOT NULL,
            reasoning TEXT NOT NULL,
            author_kind TEXT NOT NULL,
            requested_by TEXT,
            provenance_json TEXT NOT NULL DEFAULT '{}',
            sha256 TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(buddy_id, document_kind, revision)
          ) STRICT;
CREATE INDEX buddy_memory_revisions_v17_by_buddy_document
            ON "buddy_memory_revisions"(buddy_id, document_kind, revision DESC);
CREATE TABLE IF NOT EXISTS "buddy_memory_heads" (
            buddy_id TEXT NOT NULL REFERENCES buddies(id) ON DELETE CASCADE,
            document_kind TEXT NOT NULL CHECK (document_kind IN ('working', 'long_term', 'soul')),
            revision_id TEXT NOT NULL REFERENCES buddy_memory_revisions(id),
            generation INTEGER NOT NULL CHECK (generation > 0),
            updated_at TEXT NOT NULL,
            PRIMARY KEY (buddy_id, document_kind)
          ) STRICT;
CREATE TABLE buddy_builder_hires (
            conversation_id TEXT NOT NULL,
            creation_key TEXT NOT NULL DEFAULT 'default',
            buddy_id TEXT NOT NULL UNIQUE REFERENCES buddies(id) ON DELETE CASCADE,
            workspace_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            request_fingerprint TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (conversation_id, creation_key)
          ) STRICT;
CREATE TABLE IF NOT EXISTS "buddy_messages" (
      id TEXT PRIMARY KEY, from_buddy_id TEXT NOT NULL REFERENCES buddies(id),
      to_buddy_id TEXT REFERENCES buddies(id), workspace_id TEXT NOT NULL REFERENCES projects(id),
      buddy_project_id TEXT REFERENCES owned_projects(id), purpose TEXT NOT NULL,
      body TEXT NOT NULL, evidence TEXT NOT NULL, parent_conversation_id TEXT,
      child_conversation_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending','active','replied','failed','cancelled')),
      outcome TEXT, reply_body TEXT, reply_evidence TEXT NOT NULL DEFAULT '[]', replied_by TEXT,
      wait_until TEXT, wait_status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, replied_at TEXT,
      notification_pending INTEGER NOT NULL DEFAULT 0,
      expects_reply INTEGER NOT NULL DEFAULT 1 CHECK(expects_reply IN (0,1)),
      source_project_id TEXT REFERENCES owned_projects(id), source_workspace_id TEXT REFERENCES projects(id),
      root_message_id TEXT, caused_by_run_id TEXT, not_before TEXT, after_run_id TEXT,
      continue_from_message_id TEXT, in_reply_to_id TEXT, superseded_by_message_id TEXT,
      root_stopped_at TEXT, command_key TEXT, payload_hash TEXT
    , return_policy TEXT NOT NULL DEFAULT '{}', visibility TEXT NOT NULL DEFAULT 'participants' CHECK(visibility IN ('participants','project')));
CREATE INDEX buddy_messages_sender ON buddy_messages(from_buddy_id, workspace_id, created_at DESC);
CREATE INDEX buddy_messages_recipient ON buddy_messages(to_buddy_id, workspace_id, created_at DESC);
CREATE INDEX buddy_messages_waits ON buddy_messages(wait_status, wait_until);
CREATE UNIQUE INDEX buddy_message_command ON buddy_messages(from_buddy_id,workspace_id,command_key) WHERE command_key IS NOT NULL;
CREATE TABLE buddy_runs (
        id TEXT PRIMARY KEY, input_key TEXT NOT NULL, input_kind TEXT NOT NULL,
        input_id TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
        buddy_id TEXT NOT NULL REFERENCES buddies(id), workspace_id TEXT NOT NULL REFERENCES projects(id),
        conversation_id TEXT, project_id TEXT REFERENCES owned_projects(id), root_message_id TEXT,
        ready_at TEXT NOT NULL, after_run_id TEXT REFERENCES buddy_runs(id),
        status TEXT NOT NULL CHECK(status IN ('queued','claimed','running','cancel_requested','complete','failed','cancelled')),
        claim_token TEXT, claim_expires_at TEXT, deadline TEXT, policy TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, outcome TEXT, error TEXT,
        error_code TEXT, retry_of_run_id TEXT REFERENCES buddy_runs(id), project_epochs TEXT NOT NULL DEFAULT '[]', acknowledged_at TEXT, execution_snapshot TEXT,
        UNIQUE(input_key,attempt)
      ) STRICT;
CREATE UNIQUE INDEX buddy_run_live_input ON buddy_runs(input_key)
        WHERE status IN ('queued','claimed','running','cancel_requested');
CREATE UNIQUE INDEX buddy_run_conversation_slot ON buddy_runs(conversation_id)
        WHERE conversation_id IS NOT NULL AND status IN ('claimed','running','cancel_requested');
CREATE INDEX buddy_runs_ready ON buddy_runs(status,ready_at);
CREATE TABLE buddy_command_receipts (
        actor TEXT NOT NULL, workspace_id TEXT NOT NULL, command_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(actor,workspace_id,command_key)
      ) STRICT;
CREATE UNIQUE INDEX buddy_approval_message ON buddy_approval_requests(message_id) WHERE message_id IS NOT NULL;
CREATE TABLE buddy_access_grants (
      grantee_id TEXT NOT NULL REFERENCES buddies(id), workspace_id TEXT NOT NULL REFERENCES projects(id),
      target_id TEXT NOT NULL, capabilities TEXT NOT NULL, revision INTEGER NOT NULL,
      expires_at TEXT, reason TEXT NOT NULL, updated_at TEXT NOT NULL, created_buddy_incoming INTEGER NOT NULL DEFAULT 0 CHECK(created_buddy_incoming IN (0,1)),
      PRIMARY KEY(grantee_id,workspace_id,target_id)
    ) STRICT;
CREATE TABLE buddy_knowledge (
    id TEXT PRIMARY KEY, buddy_id TEXT NOT NULL REFERENCES buddies(id), workspace_id TEXT NOT NULL REFERENCES projects(id),
    scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
    revision INTEGER NOT NULL, content TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(buddy_id,workspace_id,scope_kind,scope_id,kind,name)
  ) STRICT;
CREATE TABLE buddy_knowledge_revisions (
    document_id TEXT NOT NULL REFERENCES buddy_knowledge(id), revision INTEGER NOT NULL, content TEXT NOT NULL,
    reason TEXT NOT NULL, author TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL,
    PRIMARY KEY(document_id,revision)
  ) STRICT;
CREATE TABLE buddy_mail_effects (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES projects(id), actor_id TEXT NOT NULL REFERENCES buddies(id),
    account_id TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
    authorized INTEGER NOT NULL DEFAULT 0, provider_receipt TEXT, updated_at TEXT NOT NULL
  ) STRICT;
CREATE TABLE buddy_mail_inbound (
    account_id TEXT NOT NULL, event_id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES projects(id),
    payload TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(account_id,event_id)
  ) STRICT;
CREATE TABLE buddy_checkpoints (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES buddy_runs(id),
        buddy_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT,
        message_id TEXT, root_message_id TEXT, created_at TEXT NOT NULL,
        artifacts TEXT NOT NULL, effects TEXT NOT NULL, resume TEXT NOT NULL, visibility TEXT NOT NULL
      ) STRICT;
CREATE INDEX checkpoints_run ON buddy_checkpoints(run_id,created_at);
CREATE INDEX run_recovery_origin ON buddy_runs(json_extract(policy,'$.recovery_origin_message_id'));
CREATE INDEX run_recovery_message ON buddy_runs(json_extract(policy,'$.recovery_of_message_id'));
CREATE TRIGGER worker_mode_parent_delete BEFORE DELETE ON buddy_relationships
    WHEN OLD.kind='manager' AND EXISTS(SELECT 1 FROM buddies WHERE id=OLD.to_buddy_id AND employment_mode='worker')
    BEGIN SELECT RAISE(ABORT,'Worker parent is fixed for its lifetime'); END;
CREATE TRIGGER worker_mode_parent_update BEFORE UPDATE ON buddy_relationships
    WHEN OLD.kind='manager' AND EXISTS(SELECT 1 FROM buddies WHERE id=OLD.to_buddy_id AND employment_mode='worker')
    BEGIN SELECT RAISE(ABORT,'Worker parent is fixed for its lifetime'); END;
CREATE TRIGGER worker_mode_parent_insert BEFORE INSERT ON buddy_relationships
    WHEN NEW.kind='manager' AND EXISTS(SELECT 1 FROM buddies WHERE id=NEW.to_buddy_id AND employment_mode='worker')
      AND NOT EXISTS(SELECT 1 FROM buddy_relationships WHERE kind='manager' AND to_buddy_id=NEW.to_buddy_id AND from_buddy_id=NEW.from_buddy_id)
    BEGIN SELECT RAISE(ABORT,'Worker parent is fixed for its lifetime'); END;
CREATE TABLE buddy_task_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES owned_projects(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    ) STRICT;
CREATE INDEX buddy_task_comments_project_order
      ON buddy_task_comments(project_id, created_at DESC, id DESC);
CREATE TABLE buddy_list_reads (
      buddy_id TEXT NOT NULL REFERENCES buddies(id),
      list_id TEXT NOT NULL REFERENCES buddy_lists(id),
      last_post_id TEXT NOT NULL, last_post_created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(buddy_id, list_id)
    ) STRICT;
CREATE TABLE IF NOT EXISTS "buddy_lists" (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES projects(id),
          name TEXT NOT NULL, purpose TEXT NOT NULL,
          created_by_kind TEXT NOT NULL CHECK(created_by_kind IN ('buddy','owner')),
          created_by_buddy_id TEXT REFERENCES buddies(id),
          created_at TEXT NOT NULL,
          CHECK((created_by_kind = 'buddy') = (created_by_buddy_id IS NOT NULL))
        ) STRICT;
CREATE UNIQUE INDEX buddy_lists_name ON buddy_lists(workspace_id, lower(name));
CREATE TABLE IF NOT EXISTS "buddy_list_posts" (
          id TEXT PRIMARY KEY,
          list_id TEXT NOT NULL REFERENCES buddy_lists(id),
          workspace_id TEXT NOT NULL REFERENCES projects(id),
          author_kind TEXT NOT NULL CHECK(author_kind IN ('buddy','owner')),
          from_buddy_id TEXT REFERENCES buddies(id),
          thread_root_id TEXT REFERENCES buddy_list_posts(id),
          purpose TEXT NOT NULL, body TEXT NOT NULL, evidence TEXT NOT NULL,
          buddy_project_id TEXT REFERENCES owned_projects(id),
          sender_conversation_id TEXT,
          sender_run_id TEXT,
          created_at TEXT NOT NULL,
          CHECK((author_kind = 'buddy') = (from_buddy_id IS NOT NULL))
        ) STRICT;
CREATE INDEX buddy_list_posts_feed ON buddy_list_posts(list_id, created_at DESC, id DESC);
CREATE INDEX buddy_list_posts_project_feed
          ON buddy_list_posts(workspace_id, buddy_project_id, created_at DESC, id DESC);
CREATE INDEX buddy_list_posts_thread ON buddy_list_posts(thread_root_id, created_at, id)
          WHERE thread_root_id IS NOT NULL;
