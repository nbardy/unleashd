//! Display text shared by every parser: tool-use one-liners (port of tool-format.ts), Buddy tool
//! receipts (port of shared/src/buddy.ts formatters) and the JavaScript string rules they depend
//! on. Lengths are UTF-16 code units because the history these strings replace was cut by JS
//! `.length`/`.slice`; counting chars instead changed every truncated emoji line.

use serde_json::{Map, Value};

pub fn utf16_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// The longest prefix of at most `units` UTF-16 code units. Where JS `slice` would cut a
/// surrogate pair in half (leaving a lone surrogate no Rust string can hold) this stops one unit
/// short instead.
pub fn utf16_prefix(s: &str, units: usize) -> &str {
    let mut used = 0;
    for (index, ch) in s.char_indices() {
        let next = used + ch.len_utf16();
        if next > units {
            return &s[..index];
        }
        used = next;
    }
    s
}

/// JS `String.prototype.trim` (Rust's `trim` misses U+FEFF, which JS treats as whitespace).
pub fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

pub fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

fn is_js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// JS truthiness of a JSON value.
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
}

/// `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')');
        if keep {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `JSON.stringify(value, null, 2)`.
pub fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("a serde_json::Value always serializes")
}

// =================================================================================================
// formatToolUse
// =================================================================================================

const TOOL_SUMMARY_MAX_LEN: usize = 100;
const MAX_SHELL_PARSE_DEPTH: usize = 3;
const SHELL_TOOL_NAMES: &[&str] = &["Bash", "run_shell_command", "shell"];
const SHELL_WRAPPER_NAMES: &[&str] = &["bash", "sh", "zsh", "fish"];
const OOMPA_NON_LAUNCH_FLAGS: &[&str] = &["--dry-run", "--help", "-h"];

fn emoji(name: &str) -> &'static str {
    match name {
        "Bash" | "shell" | "run_shell_command" => "⚡",
        "Read" | "read_file" => "📖",
        "Write" | "write_file" => "✍️",
        "Edit" | "replace" => "✏️",
        "Glob" | "list_directory" | "glob" => "📂",
        "Grep" | "WebSearch" | "grep_search" => "🔍",
        "WebFetch" | "web_fetch" => "🌐",
        "Agent" | "Task" => "▶️",
        "TodoWrite" => "📝",
        "NotebookRead" | "NotebookEdit" | "code_execution" => "📓",
        "patch" => "🔀",
        _ => "🔧",
    }
}

fn normalize_line(s: &str) -> String {
    s.split(is_js_space).filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" ")
}

fn truncate(s: &str, max: usize) -> String {
    if utf16_len(s) <= max {
        return s.to_string();
    }
    format!("{}...", utf16_prefix(s, max - 3))
}

fn split_shell_words(command: &str) -> Vec<String> {
    let chars: Vec<char> = command.chars().collect();
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match quote {
            Some('\'') => {
                if c == '\'' {
                    quote = None;
                } else {
                    current.push(c);
                }
            }
            Some(_) => {
                if c == '"' {
                    quote = None;
                } else if c == '\\' && i + 1 < chars.len() {
                    i += 1;
                    current.push(chars[i]);
                } else {
                    current.push(c);
                }
            }
            None => {
                if c == '\'' || c == '"' {
                    quote = Some(c);
                } else if c == '\\' && i + 1 < chars.len() {
                    i += 1;
                    current.push(chars[i]);
                } else if is_js_space(c) {
                    if !current.is_empty() {
                        words.push(std::mem::take(&mut current));
                    }
                } else {
                    current.push(c);
                }
            }
        }
        i += 1;
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn split_command_chain(command: &str) -> Vec<String> {
    let chars: Vec<char> = command.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut i = 0;
    let flush = |current: &mut String, parts: &mut Vec<String>| {
        let trimmed = js_trim(current).to_string();
        if !trimmed.is_empty() {
            parts.push(trimmed);
        }
        current.clear();
    };
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        match quote {
            Some('\'') => {
                current.push(c);
                if c == '\'' {
                    quote = None;
                }
            }
            Some(_) => {
                current.push(c);
                if c == '\\' && i + 1 < chars.len() {
                    i += 1;
                    current.push(chars[i]);
                } else if c == '"' {
                    quote = None;
                }
            }
            None => {
                if c == '\'' || c == '"' {
                    quote = Some(c);
                    current.push(c);
                } else if c == '\\' && i + 1 < chars.len() {
                    current.push(c);
                    i += 1;
                    current.push(chars[i]);
                } else if c == '\n' || c == ';' || (c == '&' && next == Some('&')) || (c == '|' && next == Some('|')) {
                    flush(&mut current, &mut parts);
                    if (c == '&' || c == '|') && next == Some(c) {
                        i += 1;
                    }
                } else {
                    current.push(c);
                }
            }
        }
        i += 1;
    }
    flush(&mut current, &mut parts);
    parts
}

fn is_env_assignment(token: &str) -> bool {
    let mut chars = token.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    if !first_ok {
        return false;
    }
    for c in chars {
        if c == '=' {
            return true;
        }
        if !(c.is_ascii_alphanumeric() || c == '_') {
            return false;
        }
    }
    false
}

fn basename_lower(token: &str) -> String {
    token.rsplit('/').next().unwrap_or(token).to_lowercase()
}

fn strip_leading_assignments(tokens: &[String]) -> &[String] {
    let idx = tokens.iter().take_while(|t| is_env_assignment(t)).count();
    &tokens[idx..]
}

fn strip_env_prefix(tokens: &[String]) -> &[String] {
    let rest = strip_leading_assignments(tokens);
    if rest.is_empty() || basename_lower(&rest[0]) != "env" {
        return rest;
    }
    let mut idx = 1;
    while idx < rest.len() {
        let token = rest[idx].as_str();
        if token == "--" {
            idx += 1;
            break;
        }
        if is_env_assignment(token) {
            idx += 1;
        } else if token == "-u" || token == "--unset" {
            idx += 2;
        } else if token.starts_with('-') {
            idx += 1;
        } else {
            break;
        }
    }
    strip_leading_assignments(&rest[idx.min(rest.len())..])
}

fn find_shell_inline_command(tokens: &[String]) -> Option<String> {
    for i in 1..tokens.len() {
        let token = tokens[i].as_str();
        if token == "-c" || token == "-lc" || token == "--command" {
            return tokens.get(i + 1).cloned();
        }
        if let Some(rest) = token.strip_prefix("--command=") {
            return Some(rest.to_string());
        }
    }
    None
}

fn is_non_launch_oompa(args: &[String]) -> bool {
    for raw in args {
        let token = raw.to_lowercase();
        if token == "--" {
            break;
        }
        if OOMPA_NON_LAUNCH_FLAGS.contains(&token.as_str()) || token.starts_with("--dry-run=") {
            return true;
        }
    }
    false
}

fn detect_oompa_subcommand(command: &str, depth: usize) -> Option<&'static str> {
    if depth > MAX_SHELL_PARSE_DEPTH {
        return None;
    }
    for segment in split_command_chain(command) {
        let tokens = split_shell_words(&segment);
        if tokens.is_empty() {
            continue;
        }
        let normalized = strip_env_prefix(&tokens);
        if normalized.is_empty() {
            continue;
        }
        let command_name = basename_lower(&normalized[0]);
        let subcommand = normalized.get(1).map(|s| s.to_lowercase());
        let args = &normalized[1..];
        if command_name == "oompa" {
            if let Some(sub) = subcommand.as_deref()
                && (sub == "run" || sub == "swarm")
            {
                if is_non_launch_oompa(args) {
                    continue;
                }
                return Some(if sub == "run" { "run" } else { "swarm" });
            }
            let first = normalized.get(1).map(String::as_str).unwrap_or("");
            if !first.is_empty() && !first.starts_with('-') && first.to_lowercase().ends_with(".json") {
                if is_non_launch_oompa(args) {
                    continue;
                }
                return Some("run");
            }
        }
        if SHELL_WRAPPER_NAMES.contains(&command_name.as_str())
            && let Some(inline) = find_shell_inline_command(normalized)
            && let Some(nested) = detect_oompa_subcommand(&inline, depth + 1)
        {
            return Some(nested);
        }
    }
    None
}

fn non_empty_str<'a>(record: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    record.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn any_str<'a>(record: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    record.get(key).and_then(Value::as_str)
}

/// One display line for a tool call: `<emoji> <name> <argument summary>`.
pub fn format_tool_use(name: &str, input: Option<&Value>) -> String {
    if name == "AskUserQuestion" {
        // `JSON.stringify(input || {})`: a falsy input becomes `{}`.
        let shown = match input {
            Some(value) if truthy(Some(value)) => serde_json::to_string(value).expect("value serializes"),
            _ => "{}".to_string(),
        };
        return format!("<!--ask_user_question:{shown}-->");
    }
    let mut summary = String::new();
    if let Some(Value::Object(record)) = input {
        let command = non_empty_str(record, "command").or_else(|| non_empty_str(record, "cmd"));
        summary = if let (true, Some(command)) = (SHELL_TOOL_NAMES.contains(&name), command) {
            let one_line = normalize_line(command);
            match detect_oompa_subcommand(command, 0) {
                Some(sub) => format!("oompa {sub} :: {one_line}"),
                None => one_line,
            }
        } else if let (true, Some(d)) = (name == "Agent" || name == "Task", any_str(record, "description")) {
            d.to_string()
        } else if let (true, Some(u)) = (name == "WebFetch", any_str(record, "url")) {
            u.to_string()
        } else if let (true, Some(q)) = (name == "WebSearch", any_str(record, "query")) {
            q.to_string()
        } else {
            ["file_path", "notebook_path", "pattern", "path", "dir_path", "query"]
                .iter()
                .find_map(|key| any_str(record, key))
                .unwrap_or("")
                .to_string()
        };
    }
    if summary.is_empty() {
        return format!("{} {name}", emoji(name));
    }
    format!("{} {name} {}", emoji(name), truncate(&summary, TOOL_SUMMARY_MAX_LEN))
}

// =================================================================================================
// Buddy tool receipts (shared/src/buddy.ts)
// =================================================================================================

fn nonempty_field(record: &Map<String, Value>, key: &str) -> Option<String> {
    record.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Launch receipts for Buddy worker threads, as `<!--buddy_worker_thread:…-->` lines.
pub fn format_buddy_worker_result(output: Option<&Value>) -> Option<String> {
    // Insertion-ordered by first conversation id; a later receipt for the same id replaces the
    // value in place, like the JS Map it ports.
    let mut threads: Vec<(String, String, String)> = Vec::new();
    fn visit(value: &Value, depth: usize, threads: &mut Vec<(String, String, String)>) {
        if depth > 10 {
            return;
        }
        match value {
            Value::String(s) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                    visit(&parsed, depth + 1, threads);
                }
            }
            Value::Array(items) => items.iter().for_each(|item| visit(item, depth + 1, threads)),
            Value::Object(record) => {
                if ["isError", "is_error", "error", "preview"].iter().any(|k| truthy(record.get(*k))) {
                    return;
                }
                if let Some(Value::Object(thread)) = record.get("buddyWorkerThread")
                    && let (Some(c), Some(b), Some(l)) =
                        (nonempty_field(thread, "conversationId"), nonempty_field(thread, "buddyId"), nonempty_field(thread, "label"))
                {
                    match threads.iter_mut().find(|t| t.0 == c) {
                        Some(slot) => *slot = (c, b, l),
                        None => threads.push((c, b, l)),
                    }
                }
                for key in ["structuredContent", "content", "text", "result", "data"] {
                    if let Some(nested) = record.get(key) {
                        visit(nested, depth + 1, threads);
                    }
                }
            }
            _ => {}
        }
    }
    visit(output?, 0, &mut threads);
    if threads.is_empty() {
        return None;
    }
    let lines: Vec<String> = threads
        .into_iter()
        .map(|(c, b, l)| {
            let json = serde_json::json!({ "conversationId": c, "buddyId": b, "label": l });
            format!("<!--buddy_worker_thread:{}-->", encode_uri_component(&json.to_string()))
        })
        .collect();
    Some(lines.join("\n"))
}

fn is_str_nonempty(v: Option<&Value>) -> bool {
    v.and_then(Value::as_str).is_some_and(|s| !s.is_empty())
}

fn is_nullable_str(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Null)) || v.and_then(Value::as_str).is_some()
}

fn valid_workspace(v: &Value) -> bool {
    let Value::Object(w) = v else { return false };
    ["id", "slug", "name", "root_path"].iter().all(|k| is_str_nonempty(w.get(*k)))
}

/// The required shape of `BuddyBuilderResultSchema`. The receipt is emitted as recorded; the
/// client's `BuddyBuilderEventSchema.parse` is the full validation and normalization.
fn valid_builder_result(v: &Value) -> bool {
    let Value::Object(r) = v else { return false };
    let buddy_ok = matches!(r.get("buddy"), Some(Value::Object(b))
        if ["id", "project_id", "slug", "name", "role", "status"].iter().all(|k| is_str_nonempty(b.get(*k)))
            && ["provider", "model", "reasoning_effort"].iter().all(|k| is_nullable_str(b.get(*k))));
    is_str_nonempty(r.get("conversationId"))
        && buddy_ok
        && r.get("homeWorkspace").is_some_and(valid_workspace)
        && matches!(r.get("workspaces"), Some(Value::Array(ws)) if ws.iter().all(valid_workspace))
}

fn valid_builder_event(v: &Value) -> bool {
    let Value::Object(e) = v else { return false };
    let result_ok = e.get("result").is_some_and(valid_builder_result);
    match e.get("action").and_then(Value::as_str) {
        Some("created") => result_ok,
        Some("updated") => result_ok && e.get("revision").and_then(Value::as_u64).is_some(),
        Some("work_created") => result_ok && matches!(e.get("project"), Some(Value::Object(_))),
        _ => false,
    }
}

fn parse_builder_event(value: &Value, depth: usize) -> Option<Value> {
    if depth > 6 {
        return None;
    }
    match value {
        Value::String(s) => serde_json::from_str::<Value>(s).ok().and_then(|v| parse_builder_event(&v, depth + 1)),
        Value::Array(items) => items.iter().find_map(|item| parse_builder_event(item, depth + 1)),
        Value::Object(record) => {
            if ["isError", "is_error", "error"].iter().any(|k| truthy(record.get(*k))) {
                return None;
            }
            if let Some(event) = record.get("buddyBuilderEvent") {
                return valid_builder_event(event).then(|| event.clone());
            }
            if valid_builder_result(value) {
                return Some(serde_json::json!({ "action": "created", "result": value }));
            }
            ["structuredContent", "content", "text", "result"]
                .iter()
                .find_map(|key| record.get(*key).and_then(|nested| parse_builder_event(nested, depth + 1)))
        }
        _ => None,
    }
}

/// A Buddy Builder mutation receipt, as `<!--buddy_builder_result:…-->`.
pub fn format_buddy_builder_result(output: Option<&Value>) -> Option<String> {
    let event = parse_builder_event(output?, 0)?;
    Some(format!("<!--buddy_builder_result:{}-->", encode_uri_component(&event.to_string())))
}

/// `formatBuddyWorkerToolResult(x) ?? formatBuddyBuilderToolResult(x)`: the order every parser uses.
pub fn format_buddy_receipt(output: Option<&Value>) -> Option<String> {
    format_buddy_worker_result(output).or_else(|| format_buddy_builder_result(output))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tool_lines_match_the_ts_formatter() {
        assert_eq!(format_tool_use("Read", Some(&json!({"file_path": "/a/b.rs"}))), "📖 Read /a/b.rs");
        assert_eq!(format_tool_use("mcp__x", None), "🔧 mcp__x");
        // Oompa launches are recognised through env prefixes and shell wrappers.
        assert_eq!(
            format_tool_use("Bash", Some(&json!({"command": "FOO=1 bash -lc 'oompa swarm cfg.json'"}))),
            "⚡ Bash oompa swarm :: FOO=1 bash -lc 'oompa swarm cfg.json'"
        );
        assert_eq!(format_tool_use("Bash", Some(&json!({"command": "oompa run --dry-run"}))), "⚡ Bash oompa run --dry-run");
    }

    #[test]
    fn truncation_counts_utf16_units_like_js() {
        // 60 emoji = 120 UTF-16 units: JS keeps 97 units, i.e. 48 emoji plus half of one. The
        // half pair cannot exist in a Rust string, so the cut lands one unit earlier.
        let long = "😀".repeat(60);
        let line = format_tool_use("Grep", Some(&json!({"pattern": long})));
        assert_eq!(line, format!("🔍 Grep {}...", "😀".repeat(48)));
    }

    #[test]
    fn worker_receipts_unwrap_mcp_envelopes_and_skip_errors() {
        let receipt = json!({"buddyWorkerThread": {"conversationId": "c1", "buddyId": "b", "label": "L", "extra": 1}});
        let wrapped = json!([{"type": "text", "text": receipt.to_string()}]);
        let line = format_buddy_receipt(Some(&wrapped)).unwrap();
        assert_eq!(
            line,
            "<!--buddy_worker_thread:%7B%22conversationId%22%3A%22c1%22%2C%22buddyId%22%3A%22b%22%2C%22label%22%3A%22L%22%7D-->"
        );
        let failed = json!({"is_error": true, "content": receipt});
        assert_eq!(format_buddy_receipt(Some(&failed)), None);
    }
}
