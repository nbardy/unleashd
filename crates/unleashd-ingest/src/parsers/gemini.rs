//! Gemini CLI: `<root>/<project>/chats/session-*.json`, one JSON document rewritten per turn.
//! Port of `parseGeminiSessionFile`. There is no append order, so a change re-reads the file.

use super::{Ctx, Doc, DocMessage, Facts, normalize_dir, parse_time};
use crate::model::{Cwd, Provider, Role};
use crate::subagents::SubAgentFold;
use crate::text::{format_tool_use, js_trim};
use serde_json::Value;
use std::path::Path;

pub fn read(path: &Path, ctx: &Ctx) -> std::io::Result<Option<Doc>> {
    let bytes = std::fs::read(path)?;
    // A malformed or half-written document is an empty session, as in the TS reader.
    let Ok(Value::Object(data)) = serde_json::from_slice::<Value>(&bytes) else { return Ok(None) };
    let start = parse_time(data.get("startTime"));
    let last = parse_time(data.get("lastUpdated")).or(start);
    let mut model: Option<String> = None;
    let mut messages = Vec::new();
    let mut sub_agents = SubAgentFold::default();
    for m in data.get("messages").and_then(Value::as_array).into_iter().flatten() {
        let at = match m.get("timestamp") {
            Some(t) if crate::text::truthy(Some(t)) => parse_time(Some(t)),
            _ => start,
        };
        match m.get("type").and_then(Value::as_str) {
            Some("user") => {
                let text: String = m
                    .get("content")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .map(|b| b.get("text").and_then(Value::as_str).unwrap_or(""))
                    .collect();
                let text = js_trim(&text);
                if !text.is_empty() {
                    messages.push(DocMessage { role: Role::User, at, completed_at: None, content: text.to_string() });
                }
            }
            Some("gemini") => {
                if model.is_none() {
                    model = m.get("model").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
                }
                let mut parts: Vec<String> = Vec::new();
                if let Some(c) = m.get("content").and_then(Value::as_str).filter(|c| !c.is_empty()) {
                    parts.push(c.to_string());
                }
                for call in m.get("toolCalls").and_then(Value::as_array).into_iter().flatten() {
                    let name = call.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let args = call.get("args");
                    parts.push(format_tool_use(name, args));
                    let id = call
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{name}-{}", at.unwrap_or(0.0)));
                    sub_agents.tool_use(Provider::Gemini, &id, name, args.unwrap_or(&Value::Null), at);
                }
                let full = parts.join("\n");
                let full = js_trim(&full);
                if !full.is_empty() {
                    messages.push(DocMessage { role: Role::Assistant, at, completed_at: None, content: full.to_string() });
                }
            }
            _ => {}
        }
    }
    if messages.is_empty() {
        return Ok(None);
    }
    let project_dir = path.parent().and_then(Path::parent);
    let cwd = project_dir
        .and_then(|dir| std::fs::read_to_string(dir.join(".project_root")).ok())
        .map(|root| Cwd::Transcript { path: normalize_dir(js_trim(&root)) })
        .unwrap_or(Cwd::Unknown);
    let session_id = data.get("sessionId").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| ctx.stem(".json"));
    Ok(Some(Doc {
        facts: Facts {
            session_id,
            provider: Provider::Gemini,
            cwd,
            model,
            title: None,
            span: start.map(|s| (s, last.unwrap_or(s))),
            parent_session_id: None,
            usage: None,
            sub_agents: sub_agents.finished(),
        },
        messages,
    }))
}
