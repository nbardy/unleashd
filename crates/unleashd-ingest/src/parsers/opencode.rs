//! OpenCode file storage: `<storage>/message/<session>/*.json` for messages, `<storage>/part/
//! <message>/*.json` for their content, `<storage>/session/<project>/<session>.json` for cwd and
//! times. Port of `parseOpenCodeSessionDirectory` + usage-routes.ts `parseOpenCodeSessionUsage`.
//! A session is a directory tree, so it is re-read whole when its composite mtime moves.

use super::{Ctx, Doc, DocMessage, Facts, normalize_dir, parse_time, widen};
use crate::model::{Cwd, Provider, Role, Usage};
use crate::text::{format_buddy_receipt, format_tool_use, js_trim};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// The storage root of a session directory (`<storage>/message/<session>`).
fn storage_root(session_dir: &Path) -> Option<&Path> {
    session_dir.parent()?.parent()
}

fn json_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json") && p.is_file())
        .collect();
    files.sort();
    files
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice::<Value>(&std::fs::read(path).ok()?).ok().filter(Value::is_object)
}

fn mtime_ms(path: &Path) -> Option<f64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs_f64() * 1000.0)
}

/// Latest mtime over the session directory, its message files, their part directories and the
/// session metadata file: the change stamp of a session (`getOpenCodeSessionMtime`).
pub fn composite_mtime(session_dir: &Path) -> f64 {
    let mut latest = mtime_ms(session_dir).unwrap_or(0.0);
    let parts = storage_root(session_dir).map(|root| root.join("part"));
    for file in json_files(session_dir) {
        latest = latest.max(mtime_ms(&file).unwrap_or(0.0));
        if let (Some(parts), Some(stem)) = (&parts, file.file_stem()) {
            latest = latest.max(mtime_ms(&parts.join(stem)).unwrap_or(0.0));
        }
    }
    if let Some(meta) = metadata_file(session_dir) {
        latest = latest.max(mtime_ms(&meta).unwrap_or(0.0));
    }
    latest
}

fn metadata_file(session_dir: &Path) -> Option<PathBuf> {
    let root = storage_root(session_dir)?;
    let id = session_dir.file_name()?;
    std::fs::read_dir(root.join("session"))
        .ok()?
        .flatten()
        .map(|project| project.path().join(id).with_extension("json"))
        .find(|candidate| candidate.is_file())
}

struct Part {
    kind: String,
    text: Option<String>,
    tool: Option<String>,
    status: Option<String>,
    output: Option<Value>,
    files: usize,
    order: f64,
    id: String,
}

fn parts(root: &Path, message_id: &str) -> Vec<Part> {
    let mut parts: Vec<Part> = json_files(&root.join("part").join(message_id))
        .into_iter()
        .filter_map(|file| {
            let data = read_json(&file)?;
            let kind = data.get("type")?.as_str()?.to_string();
            let time = data.get("time");
            let order = time
                .and_then(|t| t.get("start").and_then(Value::as_f64).or_else(|| t.get("end").and_then(Value::as_f64)))
                .unwrap_or(9007199254740991.0);
            Some(Part {
                kind,
                text: data.get("text").and_then(Value::as_str).map(str::to_string),
                tool: data.get("tool").and_then(Value::as_str).map(str::to_string),
                status: data.pointer("/state/status").and_then(Value::as_str).map(str::to_string),
                output: data.pointer("/state/output").cloned(),
                files: data.get("files").and_then(Value::as_array).map_or(0, |f| f.iter().filter(|v| v.is_string()).count()),
                order,
                id: file.file_stem()?.to_str()?.to_string(),
            })
        })
        .collect();
    parts.sort_by(|a, b| a.order.total_cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
    parts
}

/// A text part may hold a JSON-encoded string; decode it when it is one.
fn decode_text(text: &str) -> String {
    let trimmed = js_trim(text);
    if trimmed.len() >= 2
        && trimmed.starts_with('"')
        && trimmed.ends_with('"')
        && let Ok(Value::String(decoded)) = serde_json::from_str::<Value>(trimmed)
    {
        return js_trim(&decoded).to_string();
    }
    trimmed.to_string()
}

fn content(role: Role, parts: &[Part], summary_title: Option<&str>) -> String {
    let assistant = role == Role::Assistant;
    let has_tools = assistant && parts.iter().any(|p| p.kind == "tool" || p.kind == "patch");
    let mut out: Vec<String> = Vec::new();
    for part in parts {
        match part.kind.as_str() {
            "text" => {
                if let Some(text) = part.text.as_deref().filter(|t| !t.is_empty()) {
                    let decoded = decode_text(text);
                    if !decoded.is_empty() {
                        out.push(decoded);
                    }
                }
            }
            "tool" if assistant => {
                let line = format_tool_use(part.tool.as_deref().unwrap_or("tool"), None);
                match part.status.as_deref() {
                    Some(status) if !status.is_empty() && status != "completed" && status != "done" => {
                        out.push(format!("{line} ({status})"))
                    }
                    _ => {
                        out.push(line);
                        if let Some(receipt) = format_buddy_receipt(part.output.as_ref()) {
                            out.push(receipt);
                        }
                    }
                }
            }
            "patch" if assistant => out.push(match part.files {
                0 => "[Patch]".to_string(),
                1 => "[Patch: 1 file]".to_string(),
                n => format!("[Patch: {n} files]"),
            }),
            _ => {}
        }
    }
    let joined = out.join(if has_tools { "\n" } else { "" });
    if !joined.is_empty() {
        return joined;
    }
    match (role, summary_title) {
        (Role::User, Some(title)) => js_trim(title).to_string(),
        _ => String::new(),
    }
}

fn model_name(provider: Option<&str>, model: Option<&str>) -> Option<String> {
    match (provider.filter(|s| !s.is_empty()), model.filter(|s| !s.is_empty())) {
        (Some(p), Some(m)) => Some(format!("{p}/{m}")),
        (None, Some(m)) => Some(m.to_string()),
        (Some(p), None) => Some(p.to_string()),
        (None, None) => None,
    }
}

pub fn read(session_dir: &Path, ctx: &Ctx) -> std::io::Result<Option<Doc>> {
    let Some(root) = storage_root(session_dir) else { return Ok(None) };
    let fallback_id = ctx.path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let mut session_id = fallback_id.clone();
    let mut cwd: Option<String> = None;
    let mut model: Option<String> = None;
    let mut span = None;
    let mut messages: Vec<DocMessage> = Vec::new();
    let mut usage = Usage::default();
    let mut has_usage = false;
    for file in json_files(session_dir) {
        let Some(data) = read_json(&file) else { continue };
        let role = match data.get("role").and_then(Value::as_str) {
            Some("user") => Role::User,
            Some("assistant") => Role::Assistant,
            _ => continue,
        };
        if let Some(id) = data.get("sessionID").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            session_id = id.to_string();
        }
        let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let message_id = data.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or(stem);
        let time = data.get("time");
        let at = parse_time(time.and_then(|t| t.get("created")))
            .or_else(|| parse_time(time.and_then(|t| t.get("completed"))))
            .or_else(|| mtime_ms(&file));
        if let Some(at) = at {
            widen(&mut span, at);
        }
        if cwd.is_none() {
            cwd = data.pointer("/path/cwd").or_else(|| data.pointer("/path/root")).and_then(Value::as_str).map(str::to_string);
        }
        if model.is_none() {
            model = match role {
                Role::Assistant => model_name(data.get("providerID").and_then(Value::as_str), data.get("modelID").and_then(Value::as_str)),
                _ => model_name(
                    data.pointer("/model/providerID").and_then(Value::as_str),
                    data.pointer("/model/modelID").and_then(Value::as_str),
                ),
            };
        }
        if role == Role::Assistant {
            let n = |p: &str| data.pointer(p).and_then(Value::as_f64).unwrap_or(0.0);
            let (i, o, r, w) = (n("/tokens/input"), n("/tokens/output"), n("/tokens/cache/read"), n("/tokens/cache/write"));
            usage.input += i;
            usage.output += o;
            usage.cache_read += r;
            usage.cache_write += w;
            has_usage |= i + o + r + w > 0.0 || n("/cost") > 0.0;
        }
        let title = data.pointer("/summary/title").and_then(Value::as_str);
        let body = js_trim(&content(role, &parts(root, &message_id), title)).to_string();
        if !body.is_empty() {
            messages.push(DocMessage { role, at, completed_at: None, content: body });
        }
    }
    if let Some(meta) = metadata_file(session_dir).as_deref().and_then(read_json) {
        if cwd.is_none() {
            cwd = meta.get("directory").and_then(Value::as_str).map(str::to_string);
        }
        for key in ["/time/created", "/time/updated"] {
            if let Some(at) = parse_time(meta.pointer(key)) {
                widen(&mut span, at);
            }
        }
    }
    if messages.is_empty() {
        return Ok(None);
    }
    messages.sort_by(|a, b| a.at.unwrap_or(f64::INFINITY).total_cmp(&b.at.unwrap_or(f64::INFINITY)));
    messages.dedup_by(|b, a| a.role == b.role && a.content == b.content);
    let cwd = match cwd.filter(|c| !c.is_empty()) {
        Some(path) => Cwd::Transcript { path: normalize_dir(&path) },
        None => Cwd::Unknown,
    };
    Ok(Some(Doc {
        facts: Facts {
            session_id,
            provider: Provider::Opencode,
            cwd,
            model,
            title: None,
            span,
            parent_session_id: None,
            usage: has_usage.then_some(usage),
            sub_agents: Vec::new(),
        },
        messages,
    }))
}
