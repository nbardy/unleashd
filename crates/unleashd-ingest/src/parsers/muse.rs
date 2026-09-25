//! Muse: `~/.local/share/muse/sessions/YYYY/MM/DD/<id>/session.jsonl` (plus the other `.json`
//! files the TS discovery also reads there). Port of `parseMuseSessionFile` + session-context.ts
//! `parseMuseLines` (the context meter: `muse exec --json` omits token counts, so the durable log
//! is the only source).
//!
//! Messages are sorted by `recorded_at` before duplicates are dropped, so an append whose time is
//! earlier than the last message's forces a full re-read (`Rebuild::Reordered`).

use super::{Ctx, Facts, Fold, Line, Previous, Sink, finite, normalize_dir, parse_time, widen};
use crate::markers::{Hints, Rebuild, buddy_context_from_value, durable_kind_from_value};
use crate::model::{Compaction, ContextReading, Cwd, Provider, Role};
use crate::text::{format_buddy_receipt, format_tool_use, js_trim};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;

static SOFT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"soft=([0-9.]+)").unwrap());
static UUID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Raw {
    role: Role,
    content: String,
    at: Option<f64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct MuseFold {
    messages: u64,
    stream_id: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    span: Option<(f64, f64)>,
    prev: Previous,
    last_at: Option<f64>,
    any_raw: bool,
    buffering: bool,
    buffer: Vec<Raw>,
    /// The last `model_completed` input (cached tokens are a subset of it), the window recovered
    /// from the compaction strategy, and compactions that actually succeeded.
    context_tokens: Option<f64>,
    context_window: Option<f64>,
    compactions: u32,
    compaction_trigger: Option<String>,
}

/// JS `parseFloat` of a `[0-9.]+` capture: the longest prefix that is a number.
fn parse_float_prefix(s: &str) -> Option<f64> {
    let end = s.char_indices().filter(|(_, c)| *c == '.').nth(1).map_or(s.len(), |(i, _)| i);
    s[..end].parse::<f64>().ok()
}

/// Muse reports thresholds, not a window: the soft threshold `target_budget_tokens` and, in
/// `config_fingerprint`, the fraction it is. The window is target / soft (`museWindowFrom`).
fn window_from(strategy: Option<&Value>) -> Option<f64> {
    let strategy = strategy?;
    let target = finite(strategy.get("target_budget_tokens")).filter(|t| *t > 0.0)?;
    let fingerprint = strategy.get("config_fingerprint").and_then(Value::as_str).unwrap_or("");
    let soft = parse_float_prefix(SOFT.captures(fingerprint)?.get(1)?.as_str()).filter(|s| *s > 0.0 && *s <= 1.0)?;
    Some((target / soft + 0.5).floor())
}

/// `recorded_at` is epoch microseconds.
fn recorded_at(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64().and_then(|us| super::js_time(us / 1000.0)),
        other => parse_time(Some(other)),
    }
}

fn trimmed(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(js_trim).filter(|s| !s.is_empty()).map(str::to_string)
}

impl MuseFold {
    fn context_event(&mut self, event: &Value) {
        match event.get("kind").and_then(Value::as_str) {
            Some("model_completed") => {
                if let Some(input) = finite(event.pointer("/usage/input_tokens")) {
                    self.context_tokens = Some(input);
                }
            }
            Some("context_compaction_candidate") => {
                self.context_window = window_from(event.get("strategy")).or(self.context_window);
                // Only a finished compaction dropped history; `running` and `failed` did not.
                if event.get("status").and_then(Value::as_str) == Some("succeeded") {
                    self.compactions += 1;
                    if let Some(trigger) = event.get("trigger").and_then(Value::as_str) {
                        self.compaction_trigger = Some(trigger.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    fn raw(&mut self, sink: &mut Sink, raw: Raw) -> Result<(), Rebuild> {
        if self.buffering {
            self.buffer.push(raw);
            return Ok(());
        }
        let key = raw.at.unwrap_or(f64::INFINITY);
        if self.any_raw && key < self.last_at.unwrap_or(f64::INFINITY) {
            return Err(Rebuild::Reordered);
        }
        self.any_raw = true;
        self.last_at = raw.at;
        self.fold(sink, raw)
    }

    /// Dedupe against the previous kept message; a reply starts when the message before it did.
    fn fold(&mut self, sink: &mut Sink, raw: Raw) -> Result<(), Rebuild> {
        if self.prev.is_duplicate(raw.role, &raw.content) {
            return Ok(());
        }
        let (at, completed) = match raw.role {
            Role::Assistant => (if self.prev.exists() { self.prev.at } else { raw.at }, raw.at),
            _ => (raw.at, None),
        };
        self.prev.set(raw.role, &raw.content, at);
        self.messages += 1;
        sink.push(raw.role, at, completed, raw.content, None)
    }

    fn durable(&mut self, sink: &mut Sink, payload_type: &str, payload: &Value) -> Result<(), Rebuild> {
        let durable = &mut sink.visible.durable;
        if payload_type == "record.creation" || payload_type == "record.creation.observed" {
            let record = payload.get("record").filter(|r| r.is_object()).unwrap_or(payload);
            if let Some(kind) = record.get("kind").filter(|k| crate::text::truthy(Some(k))).and_then(durable_kind_from_value) {
                durable.kind = Some(kind);
            }
            if let Some(context) = record.get("buddyContext").filter(|b| b.is_object()).and_then(buddy_context_from_value) {
                durable.buddy = Some(context);
            }
            if let Some(prefix) = record.get("swarmDebugPrefix").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                durable.swarm_prefix = Some(prefix.to_string());
            }
            if let Some(resumed) = record.get("resumedFromConversationId").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                durable.resumed_from = Some(resumed.to_string());
            }
            if let Some(purpose) = record.get("purpose").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                durable.builder_purpose = purpose == "buddy_builder";
            }
        }
        if durable.buddy.is_none()
            && let Some(context) = payload.get("buddyContext").filter(|b| b.is_object()).and_then(buddy_context_from_value)
        {
            durable.buddy = Some(context);
        }
        sink.visible.check()
    }
}

impl Fold for MuseFold {
    fn begin_full(&mut self, _hints: Hints) {
        self.buffering = true;
    }

    fn line(&mut self, text: &str, sink: &mut Sink) -> Result<Line, Rebuild> {
        if text.contains("omitted_live_only") {
            return Ok(Line::Skipped);
        }
        let Ok(obj) = serde_json::from_str::<Value>(text) else { return Ok(Line::Malformed) };
        if self.stream_id.is_none() {
            let stream = obj.get("stream");
            if let (Some(id), Some("session")) = (
                stream.and_then(|s| s.get("id")).and_then(Value::as_str).filter(|s| !s.is_empty()),
                stream.and_then(|s| s.get("kind")).and_then(Value::as_str),
            ) {
                self.stream_id = Some(id.to_string());
            }
        }
        let at = recorded_at(obj.get("recorded_at"));
        if let Some(at) = at {
            widen(&mut self.span, at);
        }
        let payload_type = obj.get("payload_type").and_then(Value::as_str).unwrap_or("");
        let Some(payload) = obj.get("payload").filter(|p| p.is_object()) else { return Ok(Line::Used) };
        match payload_type {
            "runtime.session.route_facts" => {
                if self.cwd.is_none() {
                    self.cwd = payload.pointer("/record/cwd").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
                }
            }
            "run.model.configured" => {
                if let Some(model) = payload.pointer("/record/model_id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    self.model = Some(model.to_string());
                }
            }
            _ => {}
        }
        self.durable(sink, payload_type, payload)?;
        if payload_type != "runtime.session" {
            return Ok(Line::Used);
        }
        if let Some(event) = payload.get("event").filter(|e| e.is_object()) {
            self.context_event(event);
        }
        if !matches!(payload.get("kind").and_then(Value::as_str), Some("run" | "task" | "agent_tree_initialized")) {
            return Ok(Line::Used);
        }
        let Some(event) = payload.get("event").filter(|e| e.is_object()) else { return Ok(Line::Used) };
        let raw = |role, content| Raw { role, content, at };
        match event.get("kind").and_then(Value::as_str) {
            Some("started" | "user_prompt_display") => {
                if let Some(prompt) = trimmed(event.get("prompt")) {
                    self.raw(sink, raw(Role::User, prompt))?;
                }
            }
            Some("assistant_message_committed" | "reasoning_committed") => {
                if let Some(t) = trimmed(event.get("text")) {
                    self.raw(sink, raw(Role::Assistant, t))?;
                }
            }
            Some("assistant_tool_calls_committed") => {
                let calls = event.get("tool_calls").and_then(Value::as_array).cloned().unwrap_or_default();
                let lines: Vec<String> = calls
                    .iter()
                    .map(|call| {
                        let name = call.get("name").and_then(Value::as_str).unwrap_or("tool");
                        let args = call.get("args").and_then(Value::as_str).and_then(|a| serde_json::from_str::<Value>(a).ok());
                        format_tool_use(name, args.as_ref())
                    })
                    .collect();
                if !lines.is_empty() {
                    self.raw(sink, raw(Role::Assistant, lines.join("\n")))?;
                }
            }
            Some("tool_result_batch_committed") => {
                if let Some(results) = event.get("results").and_then(Value::as_array) {
                    for output in results {
                        if let Some(receipt) = format_buddy_receipt(output.get("text").filter(|_| output.is_object())) {
                            self.raw(sink, raw(Role::Assistant, receipt))?;
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(Line::Used)
    }

    fn end_full(&mut self, sink: &mut Sink) -> Result<(), Rebuild> {
        self.buffering = false;
        let mut raws = std::mem::take(&mut self.buffer);
        raws.sort_by(|a, b| a.at.unwrap_or(f64::INFINITY).total_cmp(&b.at.unwrap_or(f64::INFINITY)));
        for raw in raws {
            self.any_raw = true;
            self.last_at = raw.at;
            self.fold(sink, raw)?;
        }
        Ok(())
    }

    fn facts(&self, ctx: &Ctx) -> Option<Facts> {
        if self.messages == 0 {
            return None;
        }
        let parent = ctx.parent_name();
        let stem = ctx.path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let session_id = self.stream_id.clone().unwrap_or_else(|| if UUID.is_match(&parent) { parent } else { stem });
        let cwd = match &self.cwd {
            Some(path) => Cwd::Transcript { path: normalize_dir(path) },
            None => Cwd::Unknown,
        };
        Some(Facts {
            session_id,
            provider: Provider::Muse,
            cwd,
            model: self.model.clone(),
            title: None,
            span: self.span,
            parent_session_id: None,
            usage: None,
            sub_agents: Vec::new(),
            context: self.context_tokens.map(|context_tokens| ContextReading {
                context_tokens,
                context_window: self.context_window,
                compaction: (self.compactions > 0).then(|| Compaction {
                    count: self.compactions,
                    pre_tokens: None,
                    post_tokens: None,
                    trigger: self.compaction_trigger.clone(),
                }),
            }),
            rate_limits: None,
        })
    }
}
