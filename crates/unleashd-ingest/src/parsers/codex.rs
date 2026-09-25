//! Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, appended only. Port of
//! `parseCodexJsonlFile` + `extractMessagesFromCodexEntries` + the turn-interruption notices
//! (codex-turn-lifecycle.ts) + usage-routes.ts `codexTokenTotals`.
//!
//! Most bytes of a rollout are tool output, reasoning and world state that no message keeps, so
//! a line's first two `"type"` tags decide whether it is parsed at all (the TS filter). That
//! filter is what keeps a 934 MB rollout cheap; the tail read is what keeps it cheap on change.

use super::{Ctx, Facts, Fold, Line, Previous, Sink, normalize_dir, parse_time, widen};
use crate::markers::{Hints, Rebuild};
use crate::model::{Cwd, Provider, Role, ToolCall, Usage};
use crate::text::{format_buddy_receipt, format_tool_use, pretty_json};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

const RETAINED_EVENTS: &[&str] = &["user_message", "agent_message", "task_started", "task_complete", "turn_aborted"];

static TYPE_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""type"\s*:\s*"([^"]+)""#).unwrap());
static SESSION_ID_IN_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$").unwrap());
static PLUGINS_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^<recommended_plugins>\nHere is a list of plugins that are available but not installed\.\n\n(?:- [^\n]+\n)+</recommended_plugins>$").unwrap()
});
static AGENTS_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^# AGENTS\.md instructions for [^\n]+\n\n<INSTRUCTIONS>\n(?s:.)*\n</INSTRUCTIONS>$").unwrap());
static ENVIRONMENT_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^<environment_context>\n(?s:.)*\n</environment_context>$").unwrap());

/// The first two `"type":"…"` values of a line, without parsing it.
fn line_types(line: &str) -> (Option<&str>, Option<&str>) {
    const KEY: &str = "\"type\":\"";
    if let Some(first) = line.find(KEY) {
        let outer_start = first + KEY.len();
        let outer_end = line[outer_start..].find('"').map(|i| outer_start + i);
        let outer = outer_end.map(|end| &line[outer_start..end]);
        let search_from = outer_end.map_or(line.len(), |e| e + 1);
        let inner = line[search_from..].find(KEY).and_then(|second| {
            let start = search_from + second + KEY.len();
            line[start..].find('"').map(|len| &line[start..start + len])
        });
        return (outer, inner);
    }
    let head = crate::text::utf16_prefix(line, 1024);
    let mut tags = TYPE_TAG.captures_iter(head).map(|c| c.get(1).unwrap().as_str());
    (tags.next(), tags.next())
}

pub fn session_id_from_name(stem: &str) -> Option<String> {
    SESSION_ID_IN_NAME.captures(stem).map(|c| c[1].to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum TurnStatus {
    Running,
    Completed,
    Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Turn {
    order: u64,
    status: TurnStatus,
    started_at: f64,
    completed_at: Option<f64>,
    reason: Option<String>,
}

/// A message or notice waiting for the end of a full read, where it is sorted.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Pending {
    role: Role,
    at: Option<f64>,
    completed_at: Option<f64>,
    content: String,
    tool_call: Option<ToolCall>,
}

/// Messages sort by time; a notice sorts after messages of the same time (it was appended after
/// all of them before a stable sort). `None` sorts last: JS stamped it `new Date()`.
fn sort_key(at: Option<f64>, notice: bool) -> (f64, bool) {
    (at.unwrap_or(f64::INFINITY), notice)
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct CodexFold {
    retained: u64,
    session_id: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    parent: Option<String>,
    span: Option<(f64, f64)>,
    /// Mode: event messages exist, so response-item messages are never shown.
    has_events: bool,
    /// An event message was read in this pass. Until then response-item messages are parsed
    /// (and widen the time span) even in event mode, as the single-pass TS parser did.
    events_seen: bool,
    response_messages_shown: bool,
    seen_calls: HashSet<u64>,
    prev: Previous,
    turns: HashMap<String, Turn>,
    next_turn_order: u64,
    last_key: Option<(f64, bool)>,
    buffering: bool,
    buffer: Vec<Pending>,
    usage: Option<Usage>,
}

fn parse_epoch(v: Option<&Value>) -> Option<f64> {
    let n = v?.as_f64().filter(|f| f.is_finite())?;
    super::js_time(if n.abs() < 100_000_000_000.0 { n * 1000.0 } else { n })
}

fn classify_abort(reason: Option<&str>) -> &'static str {
    let Some(reason) = reason.filter(|r| !r.is_empty()) else { return "unknown" };
    let lower = reason.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| lower.contains(w));
    let restart = has(&["restart", "shutdown"]) || Regex::new(r"hot.?reload|server.?stop").unwrap().is_match(&lower);
    if restart {
        "restart"
    } else if has(&["error", "fail", "panic", "crash"]) {
        "error"
    } else if has(&["interrupt", "cancel", "kill", "abort", "stop"]) {
        "interrupted"
    } else {
        "unknown"
    }
}

fn interruption_message(reason: Option<&str>) -> String {
    let trimmed = reason.map(crate::text::js_trim).filter(|r| !r.is_empty());
    match (classify_abort(reason), trimmed) {
        ("restart", Some(r)) if r != "server restart" => format!("Turn interrupted by restart: {r}"),
        ("restart", _) => "Turn interrupted by server restart.".into(),
        ("error", Some(r)) => format!("Turn failed: {r}"),
        ("error", None) => "Turn failed.".into(),
        ("interrupted", Some(r)) if r != "interrupted" => format!("Turn interrupted: {r}"),
        ("interrupted", _) => "Turn interrupted.".into(),
        (_, Some(r)) => format!("Turn aborted: {r}"),
        (_, None) => "Turn aborted.".into(),
    }
}

fn content_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter(|b| matches!(b.get("type").and_then(Value::as_str), Some("input_text" | "output_text" | "text")))
            .filter_map(|b| b.get("text").and_then(Value::as_str).filter(|t| !t.is_empty()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

const SETUP_KINDS: &[&str] = &["agents_md.instructions", "environments.environment_context", "plugins.recommendations"];

/// Codex app transcripts carry setup blocks (AGENTS.md, environment, plugin lists) as user
/// content. They are removed by their provenance tags, never by matching text, so a user's own
/// pasted AGENTS.md stays visible (`extractCodexUserContent`).
fn user_content(payload: &Value, before_first_message: bool) -> String {
    let metadata = payload.get("internal_chat_message_metadata_passthrough");
    let kinds = metadata.and_then(|m| m.get("content_item_kinds"));
    let content = payload.get("content");
    if let (Some(Value::Array(blocks)), Some(Value::Array(kinds))) = (content, kinds)
        && kinds.len() == blocks.len() {
            let kept: Vec<Value> = blocks
                .iter()
                .zip(kinds)
                .filter(|(_, kind)| !kind.as_str().is_some_and(|k| SETUP_KINDS.contains(&k)))
                .map(|(block, _)| block.clone())
                .collect();
            return content_text(Some(&Value::Array(kept)));
        }
    // Codex 0.146 did not tag its startup bundle; only that exact three-block envelope is removed.
    if before_first_message && kinds.is_none() && metadata.and_then(|m| m.get("turn_id")).is_some_and(Value::is_string)
        && let Some(Value::Array(blocks)) = content
            && blocks.len() == 3 && blocks.iter().all(|b| b.get("type").and_then(Value::as_str) == Some("input_text")) {
                let texts: Vec<String> = blocks.iter().map(|b| content_text(Some(&Value::Array(vec![b.clone()])))).collect();
                if PLUGINS_BLOCK.is_match(&texts[0]) && AGENTS_BLOCK.is_match(&texts[1]) && ENVIRONMENT_BLOCK.is_match(&texts[2]) {
                    return String::new();
                }
            }
    content_text(content)
}

impl CodexFold {
    fn emit(&mut self, sink: &mut Sink, item: Pending, notice: bool) -> Result<(), Rebuild> {
        if self.buffering {
            self.buffer.push(item);
            return Ok(());
        }
        let key = sort_key(item.at, notice);
        if self.last_key.is_some_and(|last| key.partial_cmp(&last) == Some(std::cmp::Ordering::Less)) {
            return Err(Rebuild::Reordered);
        }
        self.last_key = Some(key);
        sink.push(item.role, item.at, item.completed_at, item.content, item.tool_call)
    }

    /// A message in transcript order (dedupe + reply start time), before any sort.
    fn message(&mut self, sink: &mut Sink, role: Role, content: String, at: Option<f64>) -> Result<(), Rebuild> {
        if content.is_empty() || self.prev.is_duplicate(role, &content) {
            return Ok(());
        }
        let pending = match role {
            Role::Assistant => {
                Pending { role, at: if self.prev.exists() { self.prev.at } else { at }, completed_at: at, content, tool_call: None }
            }
            _ => Pending { role, at, completed_at: None, content, tool_call: None },
        };
        self.prev.set(role, &pending.content, pending.at);
        self.emit(sink, pending, false)
    }

    fn other(&mut self, sink: &mut Sink, content: String, at: Option<f64>, tool_call: Option<ToolCall>) -> Result<(), Rebuild> {
        self.prev.set(Role::Assistant, &content, at);
        self.emit(sink, Pending { role: Role::Assistant, at, completed_at: None, content, tool_call }, false)
    }

    fn tool_call(&mut self, sink: &mut Sink, kind: &str, payload: &Value, at: Option<f64>) -> Result<(), Rebuild> {
        let Some(name) = payload.get("name").and_then(Value::as_str).filter(|n| !n.is_empty()) else { return Ok(()) };
        let call_id = payload.get("call_id").or_else(|| payload.get("id")).and_then(Value::as_str);
        if let Some(id) = call_id.filter(|id| !id.is_empty())
            && !self.seen_calls.insert(super::digest(id)) {
                return Ok(());
            }
        let raw = payload.get("arguments").filter(|v| !v.is_null()).or_else(|| payload.get("input"));
        let mut input = raw.cloned();
        let mut input_text = match raw {
            Some(Value::String(s)) => Some(s.clone()),
            Some(v) => Some(pretty_json(v)),
            None => None,
        };
        if let (true, Some(Value::String(s))) = (kind == "function_call", raw)
            && let Ok(parsed) = serde_json::from_str::<Value>(s) {
                input_text = Some(pretty_json(&parsed));
                input = Some(parsed);
            }
        // Native shell calls use function names; the live CLI stream calls them shell.
        let bare = name.strip_prefix("functions.").unwrap_or(name);
        let display = if bare == "exec_command" || bare == "shell_command" { "shell" } else { name };
        let content = format_tool_use(display, input.as_ref());
        self.other(sink, content, at, Some(ToolCall { name: name.to_string(), input: input_text }))
    }

    fn lifecycle(&mut self, sink: &mut Sink, kind: &str, payload: &Value, entry_at: Option<f64>) -> Result<(), Rebuild> {
        let Some(turn_id) = payload.get("turn_id").and_then(Value::as_str) else { return Ok(()) };
        if kind == "task_started" {
            let Some(started) = parse_epoch(payload.get("started_at")).or(entry_at) else { return Ok(()) };
            let order = self.next_turn_order;
            let turn = self.turns.entry(turn_id.to_string()).or_insert_with(|| Turn {
                order,
                status: TurnStatus::Running,
                started_at: started,
                completed_at: None,
                reason: None,
            });
            turn.started_at = started;
            if turn.order == order {
                self.next_turn_order += 1;
            }
            return Ok(());
        }
        let Some(completed) = parse_epoch(payload.get("completed_at")).or(entry_at) else { return Ok(()) };
        let started = parse_epoch(payload.get("started_at")).or_else(|| self.turns.get(turn_id).map(|t| t.started_at)).unwrap_or(completed);
        let reason = payload.get("reason").and_then(Value::as_str).map(str::to_string);
        let status = if kind == "task_complete" { TurnStatus::Completed } else { TurnStatus::Aborted };
        let was_terminal = self.turns.get(turn_id).is_some_and(|t| t.completed_at.is_some());
        let order = self.next_turn_order;
        let turn = self.turns.entry(turn_id.to_string()).or_insert_with(|| Turn {
            order,
            status,
            started_at: started,
            completed_at: None,
            reason: None,
        });
        if turn.order == order {
            self.next_turn_order += 1;
        }
        turn.status = status;
        turn.started_at = started;
        turn.completed_at = Some(completed);
        turn.reason = reason.clone();
        if self.buffering {
            return Ok(()); // notices are derived from the final turn states in end_full
        }
        if was_terminal {
            // A second terminal row rewrites a notice that may already be shown.
            return Err(Rebuild::Reordered);
        }
        if status == TurnStatus::Aborted {
            let notice = Pending {
                role: Role::System,
                at: Some(completed),
                completed_at: None,
                content: interruption_message(reason.as_deref()),
                tool_call: None,
            };
            return self.emit(sink, notice, true);
        }
        Ok(())
    }
}

impl Fold for CodexFold {
    fn begin_full(&mut self, hints: Hints) {
        self.buffering = true;
        self.has_events = hints.codex_events;
    }

    fn line(&mut self, text: &str, sink: &mut Sink) -> Result<Line, Rebuild> {
        let (outer, inner) = line_types(text);
        let is_metadata = matches!(outer, Some("session_meta" | "turn_context"));
        let is_event = outer == Some("event_msg") && inner.is_some_and(|i| RETAINED_EVENTS.contains(&i));
        let is_response_message = !self.events_seen && outer == Some("response_item") && inner == Some("message");
        let is_tool_call = outer == Some("response_item") && matches!(inner, Some("function_call" | "custom_tool_call"));
        // Typed Buddy UI receipts; other tool output rows are never expanded.
        let is_receipt = outer == Some("response_item")
            && matches!(inner, Some("function_call_output" | "custom_tool_call_output"))
            && (text.contains("buddyBuilderEvent") || text.contains("homeWorkspace") || text.contains("buddyWorkerThread"));
        let is_token_count = outer == Some("event_msg") && inner == Some("token_count");
        if !(is_metadata || is_event || is_response_message || is_tool_call || is_receipt || is_token_count) {
            return Ok(Line::Skipped);
        }
        let Ok(entry) = serde_json::from_str::<Value>(text) else { return Ok(Line::Malformed) };
        let entry_type = entry.get("type").and_then(Value::as_str);
        let payload = entry.get("payload").cloned().unwrap_or(Value::Null);
        let payload_type = payload.get("type").and_then(Value::as_str);
        if is_token_count {
            // The last cumulative total wins; cached input is a subset of input, split out.
            if let (Some("event_msg"), Some("token_count")) = (entry_type, payload_type)
                && let Some(total) = payload.get("info").and_then(|i| i.get("total_token_usage")).filter(|t| crate::text::truthy(Some(t))) {
                    let n = |k: &str| total.get(k).and_then(Value::as_f64).unwrap_or(0.0);
                    let cached = n("cached_input_tokens");
                    self.usage =
                        Some(Usage { input: n("input_tokens") - cached, output: n("output_tokens"), cache_read: cached, cache_write: 0.0 });
                }
            return Ok(Line::Used);
        }
        let at = parse_time(entry.get("timestamp"));
        if let Some(at) = at {
            widen(&mut self.span, at);
        }
        match entry_type {
            Some("session_meta") => {
                if self.session_id.is_none() {
                    self.session_id = payload.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
                }
                if self.cwd.is_none() {
                    self.cwd = payload.get("cwd").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
                }
                if self.parent.is_none() {
                    self.parent = payload
                        .pointer("/source/subagent/thread_spawn/parent_thread_id")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string);
                }
            }
            Some("turn_context") => {
                if self.cwd.is_none() {
                    self.cwd = payload.get("cwd").and_then(Value::as_str).map(str::to_string);
                }
                if let Some(model) = payload.get("model").and_then(Value::as_str).filter(|m| !m.is_empty()) {
                    self.model = Some(model.to_string());
                }
            }
            _ => {}
        }
        let event_message = entry_type == Some("event_msg") && matches!(payload_type, Some("user_message" | "agent_message"));
        let retained = event_message
            || is_event
            || is_tool_call
            || is_receipt
            || (is_response_message
                && entry_type == Some("response_item")
                && payload_type == Some("message")
                && matches!(payload.get("role").and_then(Value::as_str), Some("user" | "assistant")));
        if !retained {
            return Ok(Line::Used);
        }
        self.retained += 1;
        if event_message {
            self.events_seen = true;
            if !self.has_events {
                if self.response_messages_shown {
                    return Err(Rebuild::EventMode);
                }
                self.has_events = true;
            }
        }
        match (entry_type, payload_type) {
            (Some("response_item"), Some(kind @ ("function_call" | "custom_tool_call"))) => self.tool_call(sink, kind, &payload, at)?,
            (Some("response_item"), Some("function_call_output" | "custom_tool_call_output")) => {
                if let Some(receipt) = format_buddy_receipt(payload.get("output")) {
                    self.other(sink, receipt, at, None)?;
                }
            }
            (Some("event_msg"), Some(kind @ ("user_message" | "agent_message"))) => {
                let role = if kind == "user_message" { Role::User } else { Role::Assistant };
                let content = payload.get("message").and_then(Value::as_str).unwrap_or("").to_string();
                self.message(sink, role, content, at)?;
            }
            (Some("event_msg"), Some(kind @ ("task_started" | "task_complete" | "turn_aborted"))) => {
                self.lifecycle(sink, kind, &payload, at)?;
            }
            (Some("response_item"), Some("message")) if !self.has_events => {
                let role = if payload.get("role").and_then(Value::as_str) == Some("user") { Role::User } else { Role::Assistant };
                let content = match role {
                    Role::User => user_content(&payload, !self.prev.exists()),
                    _ => content_text(payload.get("content")),
                };
                if !content.is_empty() && !self.prev.is_duplicate(role, &content) {
                    self.response_messages_shown = true;
                }
                self.message(sink, role, content, at)?;
            }
            _ => {}
        }
        Ok(Line::Used)
    }

    fn end_full(&mut self, sink: &mut Sink) -> Result<(), Rebuild> {
        self.buffering = false;
        let mut items: Vec<(Pending, bool)> = std::mem::take(&mut self.buffer).into_iter().map(|p| (p, false)).collect();
        let mut turns: Vec<&Turn> = self.turns.values().collect();
        turns.sort_by_key(|t| t.order);
        for turn in turns.into_iter().filter(|t| t.status == TurnStatus::Aborted) {
            let content = interruption_message(turn.reason.as_deref());
            items.push((Pending { role: Role::System, at: turn.completed_at, completed_at: None, content, tool_call: None }, true));
        }
        // Stable sort by time only, as JS `Array.prototype.sort` did on the appended list.
        items.sort_by(|a, b| a.0.at.unwrap_or(f64::INFINITY).total_cmp(&b.0.at.unwrap_or(f64::INFINITY)));
        for (item, notice) in items {
            self.last_key = Some(sort_key(item.at, notice));
            sink.push(item.role, item.at, item.completed_at, item.content, item.tool_call)?;
        }
        Ok(())
    }

    fn facts(&self, ctx: &Ctx) -> Option<Facts> {
        if self.retained == 0 {
            return None;
        }
        let stem = ctx.stem(".jsonl");
        let session_id = self.session_id.clone().or_else(|| session_id_from_name(&stem)).unwrap_or(stem);
        let cwd = match self.cwd.as_deref().filter(|c| !c.is_empty()) {
            Some(path) => Cwd::Transcript { path: normalize_dir(path) },
            None => Cwd::Unknown,
        };
        Some(Facts {
            session_id,
            provider: Provider::Codex,
            cwd,
            model: self.model.clone(),
            title: None,
            span: self.span,
            parent_session_id: self.parent.clone(),
            usage: self.usage.clone(),
            sub_agents: Vec::new(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_types_reads_the_first_two_type_tags() {
        let line = r#"{"timestamp":"t","type":"response_item","payload":{"type":"function_call","name":"x"}}"#;
        assert_eq!(line_types(line), (Some("response_item"), Some("function_call")));
        let spaced = r#"{"type" : "event_msg", "payload": {"type": "user_message"}}"#;
        assert_eq!(line_types(spaced), (Some("event_msg"), Some("user_message")));
    }

    #[test]
    fn abort_reasons_become_the_ts_notice_text() {
        assert_eq!(interruption_message(Some("interrupted")), "Turn interrupted.");
        assert_eq!(interruption_message(Some("server restart")), "Turn interrupted by server restart.");
        assert_eq!(interruption_message(Some("model error")), "Turn failed: model error");
        assert_eq!(interruption_message(None), "Turn aborted.");
    }
}
