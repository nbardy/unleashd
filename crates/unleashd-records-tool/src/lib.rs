//! Pattern: delete-and-migrate (docs/patterns.md#delete-and-migrate)
//!
//! One-time import of config-store.ts's JSON directory (`conversation-config/v1`) into the
//! `conversation_record` table, and the verifier that proves it lost nothing. Both read the
//! directory only; run them on a COPY. Delete this file once the live swap (T23b) has run.
//!
//! Nothing is dropped silently. Every file under the directory ends in exactly one place:
//! - a `conversation_record` row (a record the Zod schema accepts), or
//! - a `conversation_record_reject` row holding the file's bytes and why it was refused
//!   (unparseable, future version, schema violation, duplicate id, stray non-record file,
//!   quarantined, or a by-session index entry that disagrees with the records), or
//! - it is a by-session index entry the records reproduce exactly (derived data).
//!
//! The verifier re-reads the directory and checks, per record, the sha256 of the source file's
//! canonical JSON (keys sorted, compact) against the same hash of the record rebuilt from its row
//! (`version: 2` put back, schema-defaulted keys the file lacked removed again).
//!
//! Source format: record v2 (T09: a stored `kind`). A v1 file has no kind, and deriving one needs
//! the transcript markers only record-migration.ts reads, so the import refuses to start while
//! any v1 file remains (an error, not a reject row: a v1 reject would pass verify and drop the
//! record). Run record-migration.ts on the same copy first.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use rayon::prelude::*;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::Instant;
use unleashd_ingest::model::Provider;
use unleashd_ingest::records::store::{Records, RecordsError, Result, put};
use unleashd_ingest::records::types::*;

/// Why a file was not imported as a record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    /// Not JSON. config-store.ts would move it to quarantine/ on first read.
    CorruptJson,
    /// `version` above 2: config-store.ts leaves it untouched and skips it; so does this.
    FutureVersion,
    /// JSON the Zod schema refuses (shape or refinement). config-store.ts would quarantine it.
    InvalidRecord,
    /// A second file claiming a conversation id already imported.
    DuplicateId,
    /// Not a `*.json` record file (a crashed write's `.tmp`, a stray file). config-store.ts ignores it.
    NotARecordFile,
    /// Already in `quarantine/`: config-store.ts refused it earlier.
    Quarantined,
    /// by-session entry whose conversation does not exist.
    OrphanSessionIndex,
    /// by-session entry pointing at a record that does not bind that session.
    StaleSessionIndex,
    /// by-session entry that is not `{version: 1, conversationId}` or whose name does not decode.
    CorruptSessionIndex,
}

impl RejectReason {
    fn as_str(self) -> &'static str {
        match self {
            RejectReason::CorruptJson => "corrupt_json",
            RejectReason::FutureVersion => "future_version",
            RejectReason::InvalidRecord => "invalid_record",
            RejectReason::DuplicateId => "duplicate_id",
            RejectReason::NotARecordFile => "not_a_record_file",
            RejectReason::Quarantined => "quarantined",
            RejectReason::OrphanSessionIndex => "orphan_session_index",
            RejectReason::StaleSessionIndex => "stale_session_index",
            RejectReason::CorruptSessionIndex => "corrupt_session_index",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reject {
    pub path: String,
    pub reason: RejectReason,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Misnamed {
    pub path: String,
    pub conversation_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedSession {
    pub provider: Provider,
    pub session_id: String,
    pub conversation_ids: Vec<String>,
    /// What the by-session file said, when there was one.
    pub indexed: Option<String>,
    /// What `find_by_session` now answers.
    pub answer: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIndexCounts {
    pub files: usize,
    /// Entries the records reproduce exactly (derived; not stored separately).
    pub consistent: usize,
    pub orphan: usize,
    pub stale: usize,
    pub corrupt: usize,
    /// Record bindings with no by-session file (config-store.ts repaired these lazily on lookup).
    pub unindexed_bindings: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub source: String,
    pub db: String,
    pub record_files: usize,
    pub imported: usize,
    /// Legacy files that lacked a key the schema defaults, per key.
    pub defaulted: BTreeMap<String, usize>,
    pub by_status: BTreeMap<String, usize>,
    pub by_provenance: BTreeMap<String, usize>,
    pub by_kind: BTreeMap<String, usize>,
    pub misnamed: Vec<Misnamed>,
    pub rejected: Vec<Reject>,
    pub session_index: SessionIndexCounts,
    /// Sessions bound by more than one record (lookup answers deterministically; see store.rs).
    pub shared_sessions: Vec<SharedSession>,
    pub index_rows: usize,
    pub ms: f64,
}

/// A file read from the source directory, classified.
enum Parsed {
    Record {
        record: Box<ConversationRecord>,
        defaults: Vec<Defaulted>,
    },
    Reject(RejectReason, String),
    /// A pre-T09 record: the whole import stops (see the module comment).
    Unmigrated,
}

/// The one record version this importer reads (`CONVERSATION_RECORD_VERSION`).
pub const SOURCE_VERSION: i64 = 2;

pub fn encode_id(id: &str) -> String {
    URL_SAFE_NO_PAD.encode(id.as_bytes())
}

fn decode_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".json")?;
    String::from_utf8(URL_SAFE_NO_PAD.decode(stem).ok()?).ok()
}

/// κ: raw file bytes → a canonical record, or a typed reason it is not one.
fn parse_record(bytes: &[u8]) -> Parsed {
    let mut value: Value = match serde_json::from_slice(bytes) {
        Ok(v) => v,
        Err(e) => return Parsed::Reject(RejectReason::CorruptJson, e.to_string()),
    };
    let Some(object) = value.as_object_mut() else {
        return Parsed::Reject(RejectReason::InvalidRecord, "not a JSON object".into());
    };
    match object.remove("version").as_ref().and_then(Value::as_i64) {
        Some(SOURCE_VERSION) => {}
        Some(1) => return Parsed::Unmigrated,
        Some(v) if v > SOURCE_VERSION => return Parsed::Reject(RejectReason::FutureVersion, format!("version {v}")),
        other => return Parsed::Reject(RejectReason::InvalidRecord, format!("version {other:?}")),
    }
    let defaults: Vec<Defaulted> = Defaulted::ALL
        .into_iter()
        .filter(|d| {
            let (key, default) = d.key_and_default();
            let absent = !object.contains_key(key);
            if absent {
                object.insert(key.to_string(), default);
            }
            absent
        })
        .collect();
    let record: ConversationRecord = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(e) => return Parsed::Reject(RejectReason::InvalidRecord, e.to_string()),
    };
    let issues = unleashd_ingest::records::validate::record(&record);
    match issues.is_empty() {
        true => Parsed::Record { record: Box::new(record), defaults },
        false => Parsed::Reject(RejectReason::InvalidRecord, issues.join("; ")),
    }
}

fn files_in(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| entries.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_file())).map(|e| e.path()).collect())
        .unwrap_or_default();
    out.sort();
    out
}

/// The record files. A missing `by-conversation` directory is an error, not zero records: a wrong
/// source path (e.g. `conversation-config` instead of `conversation-config/v1`) otherwise imported
/// nothing, verified ok=true against the same empty listing, and passed the T15 gate with an
/// empty store that the server would then boot on.
fn record_files(root: &Path) -> Result<Vec<PathBuf>> {
    let dir = root.join("by-conversation");
    match dir.is_dir() {
        true => Ok(files_in(&dir)),
        false => {
            Err(RecordsError::Corrupt(dir.display().to_string(), "no by-conversation directory; is this conversation-config/v1?".into()))
        }
    }
}

fn read(path: &Path) -> std::io::Result<Vec<u8>> {
    std::fs::read(path)
}

fn io_err(path: &Path, e: std::io::Error) -> RecordsError {
    RecordsError::Corrupt(path.display().to_string(), format!("read: {e}"))
}

/// One by-session file.
struct IndexEntry {
    path: PathBuf,
    bytes: Vec<u8>,
    /// provider, session id, conversation id — or why it could not be read.
    parsed: std::result::Result<(Provider, String, String), String>,
}

fn session_index(root: &Path) -> Result<Vec<IndexEntry>> {
    let mut out = Vec::new();
    let by_session = root.join("by-session");
    let mut providers: Vec<PathBuf> = std::fs::read_dir(&by_session)
        .map(|e| e.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()).collect())
        .unwrap_or_default();
    providers.sort();
    for dir in providers {
        let provider_name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        for path in files_in(&dir) {
            let bytes = read(&path).map_err(|e| io_err(&path, e))?;
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let parsed = (|| {
                let provider = Provider::parse(&provider_name).ok_or(format!("provider directory {provider_name}"))?;
                let session_id = decode_name(&name).ok_or(format!("file name {name} is not base64url(sessionId).json"))?;
                let v: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                match (v.get("version").and_then(Value::as_i64), v.get("conversationId").and_then(Value::as_str)) {
                    (Some(1), Some(id)) if !id.is_empty() => Ok((provider, session_id, id.to_string())),
                    _ => Err(format!("not {{version: 1, conversationId}}: {v}")),
                }
            })();
            out.push(IndexEntry { path, bytes, parsed });
        }
    }
    Ok(out)
}

/// Import `root` (a `conversation-config/v1` directory) into a new records database.
pub fn import(root: &Path, db: &Path) -> Result<ImportReport> {
    let started = Instant::now();
    let mut records = Records::open(db)?;
    let conn = records.connection();
    let existing: i64 = conn.query_row("SELECT count(*) FROM conversation_record", [], |r| r.get(0))?;
    let rejected_before: i64 = conn.query_row("SELECT count(*) FROM conversation_record_reject", [], |r| r.get(0))?;
    if existing + rejected_before > 0 {
        return Err(RecordsError::Corrupt(db.display().to_string(), "import target already holds records; use a new file".into()));
    }
    let mut report = ImportReport { source: root.display().to_string(), db: db.display().to_string(), ..Default::default() };

    let files = record_files(root)?;
    let mut parsed: Vec<(PathBuf, Vec<u8>, Parsed)> = files
        .into_par_iter()
        .map(|path| {
            let bytes = read(&path).map_err(|e| io_err(&path, e))?;
            let is_record_file = path.extension().is_some_and(|e| e == "json");
            let parsed = match is_record_file {
                true => parse_record(&bytes),
                false => Parsed::Reject(RejectReason::NotARecordFile, "not *.json; config-store.ts never reads it".into()),
            };
            Ok((path, bytes, parsed))
        })
        .collect::<Result<_>>()?;
    let unmigrated = parsed.iter().filter(|(_, _, p)| matches!(p, Parsed::Unmigrated)).count();
    if unmigrated > 0 {
        return Err(RecordsError::Corrupt(
            root.display().to_string(),
            format!("{unmigrated} record(s) are still version 1; run record-migration.ts on this copy first, then import into a new file"),
        ));
    }
    // config-store.ts read a conversation from `<base64url(id)>.json` only, so when two files claim
    // one id the canonically named file is the live record and any other is the stray copy. The
    // walk used to keep whichever sorted first, so a stray `a-copy.json` beat the real record and
    // the real one became a duplicate reject (verify still passed: its bytes were kept).
    parsed.sort_by_key(|(path, _, p)| match p {
        Parsed::Record { record, .. } => path.file_name().is_some_and(|n| *n != *format!("{}.json", encode_id(&record.conversation_id))),
        _ => true,
    });
    let quarantined: Vec<(PathBuf, Vec<u8>)> = files_in(&root.join("quarantine"))
        .into_iter()
        .map(|p| read(&p).map(|b| (p.clone(), b)).map_err(|e| io_err(&p, e)))
        .collect::<Result<_>>()?;
    let index = session_index(root)?;

    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let reject =
        |tx: &rusqlite::Transaction<'_>, report: &mut ImportReport, path: &Path, reason: RejectReason, detail: String, bytes: &[u8]| {
            tx.prepare_cached("INSERT INTO conversation_record_reject (source_path, reason, detail, content) VALUES (?1, ?2, ?3, ?4)")?
                .execute(params![path.display().to_string(), reason.as_str(), detail, bytes])?;
            report.rejected.push(Reject { path: path.display().to_string(), reason, detail });
            Ok::<_, RecordsError>(())
        };

    let mut imported: HashMap<String, ConversationRecord> = HashMap::new();
    for (path, bytes, parsed) in parsed {
        report.record_files += 1;
        match parsed {
            Parsed::Reject(reason, detail) => reject(&tx, &mut report, &path, reason, detail, &bytes)?,
            Parsed::Unmigrated => unreachable!("refused before the transaction"),
            Parsed::Record { record, .. } if imported.contains_key(&record.conversation_id) => {
                let detail = format!("conversation {} already imported from another file", record.conversation_id);
                reject(&tx, &mut report, &path, RejectReason::DuplicateId, detail, &bytes)?
            }
            Parsed::Record { record, defaults } => {
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                if name != format!("{}.json", encode_id(&record.conversation_id)) {
                    report.misnamed.push(Misnamed { path: path.display().to_string(), conversation_id: record.conversation_id.clone() });
                }
                put(&tx, &record, &defaults)?;
                for d in &defaults {
                    *report.defaulted.entry(d.key_and_default().0.to_string()).or_default() += 1;
                }
                *report.by_status.entry(record.status.as_str().to_string()).or_default() += 1;
                *report.by_provenance.entry(record.provenance.as_str().to_string()).or_default() += 1;
                *report.by_kind.entry(record.kind.tag().to_string()).or_default() += 1;
                report.imported += 1;
                imported.insert(record.conversation_id.clone(), *record);
            }
        }
    }
    for (path, bytes) in &quarantined {
        reject(&tx, &mut report, path, RejectReason::Quarantined, "in quarantine/".into(), bytes)?;
    }

    // The by-session index: every entry either agrees with the records or is kept as a reject.
    let mut indexed: HashMap<(Provider, String), String> = HashMap::new();
    for entry in &index {
        report.session_index.files += 1;
        match &entry.parsed {
            Err(detail) => {
                report.session_index.corrupt += 1;
                reject(&tx, &mut report, &entry.path, RejectReason::CorruptSessionIndex, detail.clone(), &entry.bytes)?
            }
            Ok((provider, session_id, id)) => {
                indexed.insert((*provider, session_id.clone()), id.clone());
                match imported.get(id) {
                    None => {
                        report.session_index.orphan += 1;
                        let detail = format!("{}/{session_id} → {id}: no such conversation", provider.as_str());
                        reject(&tx, &mut report, &entry.path, RejectReason::OrphanSessionIndex, detail, &entry.bytes)?
                    }
                    Some(r) if r.all_bindings().iter().any(|b| b.provider == *provider && &b.session_id == session_id) => {
                        report.session_index.consistent += 1
                    }
                    Some(_) => {
                        report.session_index.stale += 1;
                        let detail = format!("{}/{session_id} → {id}: that record does not bind the session", provider.as_str());
                        reject(&tx, &mut report, &entry.path, RejectReason::StaleSessionIndex, detail, &entry.bytes)?
                    }
                }
            }
        }
    }
    let mut claims: BTreeMap<(Provider, String), BTreeSet<String>> = BTreeMap::new();
    for r in imported.values() {
        for b in r.all_bindings() {
            claims.entry((b.provider, b.session_id.clone())).or_default().insert(r.conversation_id.clone());
            report.index_rows += 1;
            if !indexed.contains_key(&(b.provider, b.session_id.clone())) {
                report.session_index.unindexed_bindings += 1;
            }
        }
    }
    tx.commit()?;
    for ((provider, session_id), ids) in claims.into_iter().filter(|(_, ids)| ids.len() > 1) {
        let answer = records.find_by_session(provider, &session_id)?.map(|r| r.conversation_id).unwrap_or_default();
        let indexed = indexed.get(&(provider, session_id.clone())).cloned();
        report.shared_sessions.push(SharedSession { provider, session_id, conversation_ids: ids.into_iter().collect(), indexed, answer });
    }
    report.ms = started.elapsed().as_secs_f64() * 1000.0;
    Ok(report)
}

/// Keys sorted at every level, no whitespace: two JSON values with equal content serialize equal.
pub fn canonical(v: &Value) -> String {
    fn sort(v: &Value) -> Value {
        match v {
            Value::Object(m) => {
                let sorted: BTreeMap<&String, Value> = m.iter().map(|(k, v)| (k, sort(v))).collect();
                Value::Object(sorted.into_iter().map(|(k, v)| (k.clone(), v)).collect())
            }
            Value::Array(a) => Value::Array(a.iter().map(sort).collect()),
            other => other.clone(),
        }
    }
    serde_json::to_string(&sort(v)).expect("JSON serializes")
}

pub fn sha256_hex(s: &[u8]) -> String {
    Sha256::digest(s).iter().map(|b| format!("{b:02x}")).collect()
}

/// A stored record as the source file had it: `version` back, schema-filled keys removed again.
pub fn as_source_json(record: &ConversationRecord, defaults: &[Defaulted]) -> Value {
    let mut v = serde_json::to_value(record).expect("record serializes");
    let object = v.as_object_mut().expect("record is an object");
    object.insert("version".into(), Value::from(SOURCE_VERSION));
    for d in defaults {
        object.remove(d.key_and_default().0);
    }
    v
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mismatch {
    pub path: String,
    pub what: String,
    pub source_sha256: String,
    pub stored_sha256: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    pub source: String,
    pub db: String,
    pub source_files: usize,
    pub records_compared: usize,
    pub record_hash_matches: usize,
    pub rejects_compared: usize,
    pub reject_bytes_equal: usize,
    pub session_index_files: usize,
    pub session_index_derived: usize,
    pub mismatches: Vec<Mismatch>,
    /// Source files with neither a record row nor a reject row.
    pub unaccounted: Vec<String>,
    /// Record rows no source file produced.
    pub extra_rows: Vec<String>,
    pub index_rows: usize,
    pub index_rows_expected: usize,
    /// Every check passed.
    pub ok: bool,
    pub ms: f64,
}

/// Re-read the source directory and prove the database holds all of it. Independent of the
/// importer's bookkeeping: expectations are rebuilt from the raw files.
pub fn verify(root: &Path, db: &Path) -> Result<VerifyReport> {
    let started = Instant::now();
    let records = Records::open(db)?;
    let mut report = VerifyReport { source: root.display().to_string(), db: db.display().to_string(), ..Default::default() };
    let conn = rusqlite::Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let reject_of = |path: &Path| -> Result<Option<Vec<u8>>> {
        Ok(conn
            .prepare_cached("SELECT content FROM conversation_record_reject WHERE source_path = ?1")?
            .query_row([path.display().to_string()], |r| r.get(0))
            .optional()?)
    };
    let defaults_of = |id: &str| -> Result<Vec<Defaulted>> {
        let s: Option<String> = conn
            .prepare_cached("SELECT import_defaults FROM conversation_record WHERE conversation_id = ?1")?
            .query_row([id], |r| r.get(0))?;
        Ok(s.iter().flat_map(|s| s.split(',')).filter_map(Defaulted::parse).collect())
    };
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut expected_index: BTreeSet<(String, String, String)> = BTreeSet::new();

    let record_files = record_files(root)?.into_iter();
    let quarantine = files_in(&root.join("quarantine")).into_iter();
    for path in record_files.chain(quarantine) {
        report.source_files += 1;
        let bytes = read(&path).map_err(|e| io_err(&path, e))?;
        if let Some(stored) = reject_of(&path)? {
            report.rejects_compared += 1;
            match stored == bytes {
                true => report.reject_bytes_equal += 1,
                false => report.mismatches.push(Mismatch {
                    path: path.display().to_string(),
                    what: "reject bytes".into(),
                    source_sha256: sha256_hex(&bytes),
                    stored_sha256: sha256_hex(&stored),
                }),
            }
            continue;
        }
        let source: Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(_) => {
                report.unaccounted.push(path.display().to_string());
                continue;
            }
        };
        let Some(id) = source.get("conversationId").and_then(Value::as_str) else {
            report.unaccounted.push(path.display().to_string());
            continue;
        };
        let Some(record) = records.get(id)? else {
            report.unaccounted.push(path.display().to_string());
            continue;
        };
        report.records_compared += 1;
        seen.insert(id.to_string());
        // Expected index rows come from the SOURCE file's bindings, not the stored record.
        let raw_bindings = source.get("sessionBindings").and_then(Value::as_array).cloned().unwrap_or_default();
        for b in raw_bindings.iter().chain(source.get("currentSession")) {
            if let (Some(p), Some(s)) = (b.get("provider").and_then(Value::as_str), b.get("sessionId").and_then(Value::as_str)) {
                expected_index.insert((p.to_string(), s.to_string(), id.to_string()));
            }
        }
        let source_sha = sha256_hex(canonical(&source).as_bytes());
        let stored_sha = sha256_hex(canonical(&as_source_json(&record, &defaults_of(id)?)).as_bytes());
        match source_sha == stored_sha {
            true => report.record_hash_matches += 1,
            false => report.mismatches.push(Mismatch {
                path: path.display().to_string(),
                what: "record content".into(),
                source_sha256: source_sha,
                stored_sha256: stored_sha,
            }),
        }
    }

    // by-session: every file is either reproduced by the index or kept byte-for-byte.
    for entry in session_index(root)? {
        report.session_index_files += 1;
        if let Some(stored) = reject_of(&entry.path)? {
            report.rejects_compared += 1;
            match stored == entry.bytes {
                true => report.reject_bytes_equal += 1,
                false => report.mismatches.push(Mismatch {
                    path: entry.path.display().to_string(),
                    what: "reject bytes".into(),
                    source_sha256: sha256_hex(&entry.bytes),
                    stored_sha256: sha256_hex(&stored),
                }),
            }
            continue;
        }
        let derived = match &entry.parsed {
            Ok((provider, session_id, id)) => conn
                .prepare_cached("SELECT 1 FROM conversation_session WHERE provider = ?1 AND session_id = ?2 AND conversation_id = ?3")?
                .query_row(params![provider.as_str(), session_id, id], |_| Ok(()))
                .optional()?
                .is_some(),
            Err(_) => false,
        };
        match derived {
            true => report.session_index_derived += 1,
            false => report.unaccounted.push(entry.path.display().to_string()),
        }
    }

    let stored_ids: Vec<String> =
        conn.prepare("SELECT conversation_id FROM conversation_record")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    report.extra_rows = stored_ids.into_iter().filter(|id| !seen.contains(id)).collect();
    let stored_index: BTreeSet<(String, String, String)> = conn
        .prepare("SELECT provider, session_id, conversation_id FROM conversation_session")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<rusqlite::Result<_>>()?;
    report.index_rows = stored_index.len();
    report.index_rows_expected = expected_index.len();
    if stored_index != expected_index {
        report.mismatches.push(Mismatch {
            path: "conversation_session".into(),
            what: format!(
                "index rows differ: {} missing, {} extra",
                expected_index.difference(&stored_index).count(),
                stored_index.difference(&expected_index).count()
            ),
            source_sha256: String::new(),
            stored_sha256: String::new(),
        });
    }
    report.ok = report.mismatches.is_empty()
        && report.unaccounted.is_empty()
        && report.extra_rows.is_empty()
        && report.record_hash_matches == report.records_compared
        && report.reject_bytes_equal == report.rejects_compared;
    report.ms = started.elapsed().as_secs_f64() * 1000.0;
    Ok(report)
}
