//! Pattern: parse-dont-validate (docs/patterns.md#parse-dont-validate)
//!
//! The Zod refinements serde's shape cannot express (`min(1)`, `nonnegative`, `.datetime()`,
//! `max(64000)`, a non-empty operations list). Run once per record at the only write path
//! (`store::put`), so the importer and every API write refuse exactly what
//! `PersistedConversationConfigRecordSchema.safeParse` refuses — a stored row is always one the
//! TS schema accepts.

use super::types::*;
use regex::Regex;
use std::sync::LazyLock;

/// `z.string().datetime()` with its defaults: UTC `Z`, any fractional precision, no offset.
static DATETIME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$").unwrap());

/// Epoch milliseconds of a stored `.datetime()` string (JS `Date.parse`).
pub fn parse_ms(s: &str) -> Option<i64> {
    DATETIME.is_match(s).then(|| chrono::DateTime::parse_from_rfc3339(s).ok().map(|t| t.timestamp_millis())).flatten()
}

/// `new Date(ms).toISOString()`.
pub fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms).expect("time in range").format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

struct Issues(Vec<String>);

impl Issues {
    fn text(&mut self, path: &str, s: &str) {
        if s.is_empty() {
            self.0.push(format!("{path}: empty string"));
        }
    }
    fn opt_text(&mut self, path: &str, s: &Option<String>) {
        if let Some(s) = s {
            self.text(path, s);
        }
    }
    fn nullish_text(&mut self, path: &str, s: &Option<Option<String>>) {
        if let Some(Some(s)) = s {
            self.text(path, s);
        }
    }
    fn time(&mut self, path: &str, s: &str) {
        if parse_ms(s).is_none() {
            self.0.push(format!("{path}: not an ISO datetime: {s:?}"));
        }
    }
    fn opt_time(&mut self, path: &str, s: &Option<String>) {
        if let Some(s) = s {
            self.time(path, s);
        }
    }
    fn non_negative(&mut self, path: &str, n: i64) {
        if n < 0 {
            self.0.push(format!("{path}: negative"));
        }
    }
    fn js_max(&mut self, path: &str, s: &str, max: usize) {
        // Zod's max() counts UTF-16 code units (JS string length).
        if s.encode_utf16().count() > max {
            self.0.push(format!("{path}: longer than {max}"));
        }
    }

    fn scope(&mut self, path: &str, scope: &KnowledgeScope) {
        match scope {
            KnowledgeScope::OwnerThread { conversation_id } => self.text(&format!("{path}.conversationId"), conversation_id),
            KnowledgeScope::Project { project_id } => self.text(&format!("{path}.projectId"), project_id),
            KnowledgeScope::Workspace { workspace_id } => self.text(&format!("{path}.workspaceId"), workspace_id),
        }
    }

    fn usage(&mut self, path: &str, u: &ProviderTurnUsage) {
        self.non_negative(&format!("{path}.contextTokens"), u.context_tokens);
        self.non_negative(&format!("{path}.outputTokens"), u.output_tokens);
        if let Some(n) = u.cached_input_tokens {
            self.non_negative(&format!("{path}.cachedInputTokens"), n);
        }
        if let Some(n) = u.cache_write_tokens {
            self.non_negative(&format!("{path}.cacheWriteTokens"), n);
        }
        if let Some(n) = u.context_window
            && n <= 0
        {
            self.0.push(format!("{path}.contextWindow: not positive"));
        }
        self.time(&format!("{path}.observedAt"), &u.observed_at);
    }

    fn binding(&mut self, path: &str, b: &SessionBinding) {
        self.text(&format!("{path}.sessionId"), &b.session_id);
        self.opt_text(&format!("{path}.buddyAudienceKey"), &b.buddy_audience_key);
        if let Some(u) = &b.latest_usage {
            self.usage(&format!("{path}.latestUsage"), u);
        }
    }

    fn config(&mut self, path: &str, c: &ConversationConfig) {
        if let ModelSelection::Explicit { model_id } = &c.model {
            self.text(&format!("{path}.model.modelId"), model_id);
        }
        if let ReasoningSelection::Explicit { effort } = &c.reasoning {
            self.text(&format!("{path}.reasoning.effort"), effort);
        }
    }

    fn buddy(&mut self, path: &str, b: &BuddyContext) {
        if let Some(scope) = &b.knowledge_scope {
            self.scope(&format!("{path}.knowledgeScope"), scope);
        }
        self.nullish_text(&format!("{path}.coordinationRunId"), &b.coordination_run_id);
        self.text(&format!("{path}.buddyId"), &b.buddy_id);
        self.text(&format!("{path}.workspaceId"), &b.workspace_id);
        self.nullish_text(&format!("{path}.buddyProjectId"), &b.buddy_project_id);
        self.nullish_text(&format!("{path}.legacyWorkItemId"), &b.legacy_work_item_id);
        self.nullish_text(&format!("{path}.automationRunId"), &b.automation_run_id);
        self.nullish_text(&format!("{path}.delegatedByBuddyId"), &b.delegated_by_buddy_id);
        self.nullish_text(&format!("{path}.parentBuddyConversationId"), &b.parent_buddy_conversation_id);
        if let Some(ops) = &b.allowed_buddy_operations {
            if ops.is_empty() {
                self.0.push(format!("{path}.allowedBuddyOperations: empty"));
            }
            for op in ops {
                self.text(&format!("{path}.allowedBuddyOperations[]"), op);
            }
        }
    }

    fn creation(&mut self, c: &ConversationCreation) {
        if let Some(b) = &c.branch {
            self.text("creation.branch.sourceConversationId", &b.source_conversation_id);
            self.text("creation.branch.throughMessageId", &b.through_message_id);
            self.scope("creation.branch.audience", &b.audience);
            self.js_max("creation.branch.handoff", &b.handoff, 64_000);
            for handoff in b.launches.iter().flat_map(|l| l.values()) {
                self.js_max("creation.branch.launches[]", handoff, 64_000);
            }
        }
        self.opt_text("creation.commandId", &c.command_id);
        self.opt_text("creation.fingerprint", &c.fingerprint);
        self.opt_text("creation.initialMessage", &c.initial_message);
        self.opt_time("creation.initialMessageDispatchClaimedAt", &c.initial_message_dispatch_claimed_at);
        self.opt_text("creation.initialMessageDispatchClaimToken", &c.initial_message_dispatch_claim_token);
        self.opt_time("creation.initialMessageDispatchedAt", &c.initial_message_dispatched_at);
        self.opt_text("creation.resumedFromConversationId", &c.resumed_from_conversation_id);
    }
}

/// Every refinement the record violates; empty = the Zod schema accepts it.
pub fn record(r: &ConversationRecord) -> Vec<String> {
    let mut issues = Issues(Vec::new());
    issues.text("conversationId", &r.conversation_id);
    match &r.kind {
        ConversationKind::Buddy { context, .. } => issues.buddy("kind.context", context),
        ConversationKind::Chat | ConversationKind::Builder | ConversationKind::Worker { .. } => {}
    }
    for b in &r.session_bindings {
        issues.binding("sessionBindings[]", b);
    }
    if let Some(b) = &r.current_session {
        issues.binding("currentSession", b);
    }
    issues.opt_text("workingDirectory", &r.working_directory);
    if let Some(c) = &r.creation {
        issues.creation(c);
    }
    issues.opt_time("deletedAt", &r.deleted_at);
    issues.config("config", &r.config);
    issues.non_negative("recordRevision", r.record_revision);
    issues.non_negative("configRevision", r.config_revision);
    if let Some(l) = &r.last_resolved_config {
        issues.text("lastResolvedConfig.modelId", &l.model_id);
        issues.opt_text("lastResolvedConfig.reasoningEffort", &l.reasoning_effort);
    }
    issues.time("createdAt", &r.created_at);
    issues.time("updatedAt", &r.updated_at);
    issues.0
}
