//! Historical sub-agent runs reconstructed from spawn tool calls (subagent-tools.ts,
//! `subAgentsFromToolUses`). Every run is `completed`; a run ends where the next one starts.

use crate::model::{Provider, SubAgent};
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn gemini_label(name: &str) -> Option<&'static str> {
    match name {
        "generalist" => Some("Generalist Agent"),
        "browser_agent" => Some("Browser Agent"),
        "codebase_investigator" => Some("Codebase Investigator Agent"),
        "cli_help" => Some("CLI Help Agent"),
        _ => None,
    }
}

/// Claude's sub-agent spawn tool: `Agent` since Claude Code 2.1, `Task` before. Transcripts on
/// disk carry both. Mirrors agent-cli's CLAUDE_SUBAGENT_TOOL_NAMES; matching only `Task` hid
/// every 2.1 sub-agent.
pub const CLAUDE_SPAWN_TOOLS: &[&str] = &["Agent", "Task"];

pub fn is_claude_spawn_tool(name: &str) -> bool {
    CLAUDE_SPAWN_TOOLS.contains(&name)
}

pub fn is_spawn_tool(provider: Provider, name: &str) -> bool {
    is_claude_spawn_tool(name)
        || (provider == Provider::Gemini && gemini_label(name).is_some())
        || (provider == Provider::Codex && name == "spawn_agent")
}

fn first_string(input: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| input.get(*k).and_then(Value::as_str).map(crate::text::js_trim).filter(|s| !s.is_empty()).map(str::to_string))
}

fn description(provider: Provider, name: &str, input: &Value) -> String {
    if is_claude_spawn_tool(name) {
        let description = first_string(input, &["description"]).unwrap_or_else(|| "Running sub-agent task...".into());
        return match first_string(input, &["subagent_type"]) {
            Some(kind) => format!("[{kind}] {description}"),
            None => description,
        };
    }
    if let (Provider::Gemini, Some(label)) = (provider, gemini_label(name)) {
        return match first_string(input, &["request", "task", "objective", "question"]) {
            Some(request) => format!("[{label}] {request}"),
            None => format!("Running {label}..."),
        };
    }
    if provider == Provider::Codex && name == "spawn_agent" {
        return match first_string(input, &["prompt", "task", "description", "objective"]) {
            Some(request) => format!("[Codex Agent] {request}"),
            None => "Running Codex sub-agent...".into(),
        };
    }
    format!("Running {name}...")
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SubAgentFold {
    current: Option<SubAgent>,
    done: Vec<SubAgent>,
}

impl SubAgentFold {
    pub fn tool_use(&mut self, provider: Provider, id: &str, name: &str, input: &Value, at: Option<f64>) {
        if is_spawn_tool(provider, name) {
            if let Some(mut previous) = self.current.take() {
                previous.completed_at = at;
                self.done.push(previous);
            }
            self.current = Some(SubAgent {
                id: id.to_string(),
                description: description(provider, name, input),
                tool_uses: 0,
                current_action: None,
                started_at: at,
                completed_at: None,
            });
        } else if let Some(current) = self.current.as_mut() {
            current.tool_uses += 1;
            current.current_action = Some(name.to_string());
        }
    }

    pub fn finished(&self) -> Vec<SubAgent> {
        let mut all = self.done.clone();
        if let Some(mut last) = self.current.clone() {
            last.completed_at = last.started_at;
            all.push(last);
        }
        all
    }
}
