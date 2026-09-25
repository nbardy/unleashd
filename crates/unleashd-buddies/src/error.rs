//! Typed errors. Every failure the core can report is a variant here; the napi layer turns
//! `code()` into the JS error's `code` so callers branch on it, never on message text.

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("denied: {0}")]
    Denied(String),
    #[error("{kind} not found: {id}")]
    NotFound { kind: &'static str, id: String },
    #[error("revision conflict: expected base {expected}, current {current}")]
    RevisionConflict { expected: i64, current: i64 },
    #[error("idempotency key {0} was already used with a different payload")]
    IdempotencyConflict(String),
    #[error("invalid: {0}")]
    Invalid(String),
    #[error("lease lost for run {0}")]
    LeaseLost(String),
    #[error("conversation {0} already has a live run")]
    ConversationBusy(String),
    #[error("corrupt row: {0}")]
    Corrupt(String),
    #[error("not a buddies-core database: {0}")]
    WrongDatabase(String),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl CoreError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Denied(_) => "denied",
            Self::NotFound { .. } => "not_found",
            Self::RevisionConflict { .. } => "revision_conflict",
            Self::IdempotencyConflict(_) => "idempotency_conflict",
            Self::Invalid(_) => "invalid",
            Self::LeaseLost(_) => "lease_lost",
            Self::ConversationBusy(_) => "conversation_busy",
            Self::Corrupt(_) => "corrupt",
            Self::WrongDatabase(_) => "wrong_database",
            Self::Sqlite(_) => "sqlite",
            Self::Json(_) => "json",
            Self::Io(_) => "io",
        }
    }

    pub fn not_found(kind: &'static str, id: &str) -> Self {
        Self::NotFound { kind, id: id.to_string() }
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
