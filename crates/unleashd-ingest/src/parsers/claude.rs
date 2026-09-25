//! Claude Code: `~/.claude/projects/<encoded cwd>/<session id>.jsonl`, one record per line,
//! appended only. Port of `foldClaudeTranscript` + usage-routes.ts `parseClaudeSession`.

use super::{Ctx, Facts, Fold, Line, Previous, Sink, normalize_dir, parse_time, provider_from_model, widen};
use crate::markers::Rebuild;
use crate::model::{Cwd, Role, Usage};
use crate::subagents::SubAgentFold;
use crate::text::{format_buddy_receipt, format_tool_use, js_trim};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Deserialize)]
struct Entry {
    #[serde(rename = "type")]
    kind: Option<String>,
    cwd: Option<Value>,
    timestamp: Option<Value>,
    message: Option<Value>,
    #[serde(rename = "aiTitle")]
    ai_title: Option<Value>,
    #[serde(rename = "customTitle")]
    custom_title: Option<Value>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ClaudeFold {
    entries: u64,
    cwd: Option<String>,
    model: Option<String>,
    span: Option<(f64, f64)>,
    ai_title: Option<String>,
    custom_title: Option<String>,
    prev: Previous,
    /// Claude Code stamps the same request usage on every content-block line of a reply;
    /// counting each line overcounted ~2.4x (usage-routes.ts, 2026-09-25). One count per id.
    #[serde(with = "super::digest_set")]
    usage_ids: HashSet<u64>,
    usage: Usage,
    sub_agents: SubAgentFold,
}

fn number(v: Option<&Value>) -> f64 {
    v.and_then(Value::as_f64).unwrap_or(0.0)
}

fn truthy_string(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|s| !s.is_empty())
}

impl ClaudeFold {
    fn observe_usage(&mut self, message: &Value) {
        let Some(usage) = message.get("usage").filter(|u| crate::text::truthy(Some(u))) else { return };
        // `countedMessages.has(entry.message.id)`: a missing id is the key "undefined".
        let id = match message.get("id") {
            Some(Value::String(s)) => s.clone(),
            Some(other) => other.to_string(),
            None => "undefined".to_string(),
        };
        if !self.usage_ids.insert(super::digest(&id)) {
            return;
        }
        self.usage.input += number(usage.get("input_tokens"));
        self.usage.output += number(usage.get("output_tokens"));
        self.usage.cache_read += number(usage.get("cache_read_input_tokens"));
        self.usage.cache_write += number(usage.get("cache_creation_input_tokens"));
    }

    fn push(&mut self, sink: &mut Sink, role: Role, content: String, at: Option<f64>, completed: Option<f64>) -> Result<(), Rebuild> {
        let duplicate = self.prev.is_duplicate(role, &content);
        self.prev.set(role, &content, at);
        if duplicate {
            return Ok(());
        }
        sink.push(role, at, completed, content, None)
    }
}

impl Fold for ClaudeFold {
    fn line(&mut self, text: &str, sink: &mut Sink) -> Result<Line, Rebuild> {
        let Ok(entry) = serde_json::from_str::<Entry>(text) else { return Ok(Line::Malformed) };
        self.entries += 1;
        let kind = entry.kind.as_deref().unwrap_or("");
        match kind {
            "ai-title" => {
                if let Some(t) = entry.ai_title.as_ref().and_then(Value::as_str).map(js_trim).filter(|t| !t.is_empty()) {
                    self.ai_title = Some(t.to_string());
                }
                return Ok(Line::Used);
            }
            "custom-title" => {
                if let Some(t) = entry.custom_title.as_ref().and_then(Value::as_str).map(js_trim).filter(|t| !t.is_empty()) {
                    self.custom_title = Some(t.to_string());
                }
                return Ok(Line::Used);
            }
            "user" | "assistant" => {}
            _ => return Ok(Line::Used),
        }
        if self.cwd.is_none() {
            self.cwd = truthy_string(entry.cwd.as_ref()).map(str::to_string);
        }
        let at = parse_time(entry.timestamp.as_ref());
        if let Some(at) = at {
            widen(&mut self.span, at);
        }
        let Some(message) = entry.message else { return Ok(Line::Used) };
        if kind == "user" {
            if let Some(Value::Array(blocks)) = message.get("content") {
                for block in blocks {
                    // Claude persists MCP results as user-role transport blocks, not user prose.
                    let is_result = block.get("type").and_then(Value::as_str) == Some("tool_result");
                    let Some(content) = block.get("content").filter(|_| is_result) else { continue };
                    if crate::text::truthy(block.get("is_error")) {
                        continue;
                    }
                    if let Some(receipt) = format_buddy_receipt(Some(content)) {
                        self.push(sink, Role::Assistant, receipt, at, None)?;
                    }
                }
            }
            // Array content only ever renders as "[Tool result: …]" lines, which are dropped; a
            // user message is string content (extractUserContent + its filter).
            if let Some(content) = message.get("content").and_then(Value::as_str)
                && !content.is_empty()
                && !content.starts_with("[Tool result:")
            {
                self.push(sink, Role::User, content.to_string(), at, None)?;
            }
            return Ok(Line::Used);
        }
        // assistant
        if self.model.as_deref().is_none_or(|m| m == "unknown")
            && let Some(model) = truthy_string(message.get("model"))
        {
            self.model = Some(model.to_string());
        }
        self.observe_usage(&message);
        let provider = provider_from_model(self.model.as_deref());
        let mut parts: Vec<String> = Vec::new();
        if let Some(Value::Array(blocks)) = message.get("content") {
            for block in blocks {
                match block.get("type").and_then(Value::as_str) {
                    Some("text") => parts.push(block.get("text").and_then(Value::as_str).unwrap_or("").to_string()),
                    Some("tool_use") => {
                        let name = block.get("name").and_then(Value::as_str).unwrap_or("undefined");
                        parts.push(format_tool_use(name, block.get("input")));
                        let id = block.get("id").and_then(Value::as_str).unwrap_or("");
                        let input = block.get("input").cloned().unwrap_or(Value::Null);
                        self.sub_agents.tool_use(provider, id, name, &input, at);
                    }
                    _ => {} // thinking blocks are internal reasoning
                }
            }
        }
        let content = parts.join("\n");
        if !content.is_empty() {
            let started = if self.prev.exists() { self.prev.at } else { at };
            self.push(sink, Role::Assistant, content, started, at)?;
        }
        Ok(Line::Used)
    }

    fn facts(&self, ctx: &Ctx) -> Option<Facts> {
        if self.entries == 0 {
            return None;
        }
        let cwd = match &self.cwd {
            Some(path) => Cwd::Transcript { path: normalize_dir(path) },
            None => ctx.resolver.claude_cwd(&ctx.parent_name()),
        };
        Some(Facts {
            session_id: ctx.stem(".jsonl"),
            provider: provider_from_model(self.model.as_deref()),
            cwd,
            model: self.model.clone(),
            title: self.custom_title.clone().or_else(|| self.ai_title.clone()),
            span: self.span,
            parent_session_id: None,
            usage: Some(self.usage.clone()),
            sub_agents: self.sub_agents.finished(),
        })
    }
}
