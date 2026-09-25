//! Recovering a working directory from a lossy project-directory name.
//!
//! `~/.claude/projects` and `~/.cursor/projects` name a directory by replacing every `/` with
//! `-` (Cursor also drops the leading `.` of dotted components). Reading every `-` back as `/`
//! invents paths that never existed: `~/git/room-runners-arena-lib/.wsf9…` came back as
//! `~/git/room/runners/arena/lib/wsf9…`, 98 fabricated folders from one repo (CLAUDE.md). So the
//! name is resolved against the filesystem, longest run of tokens first, and an unresolvable
//! name is reported as `Decoded`, never passed off as a real directory. Modern Claude
//! transcripts carry an explicit `cwd`, which always wins; this only runs as a fallback.

use crate::model::Cwd;
use std::collections::HashMap;
use std::sync::Mutex;

const MAX_ENCODED_TOKENS: usize = 40;

#[derive(Default)]
pub struct ProjectDirResolver {
    cache: Mutex<HashMap<String, Option<String>>>,
}

impl ProjectDirResolver {
    /// `resolveEncodedProjectDirectory` (jsonl.ts).
    pub fn resolve(&self, encoded: &str) -> Option<String> {
        if let Some(hit) = self.cache.lock().unwrap().get(encoded) {
            return hit.clone();
        }
        let resolved = search(encoded);
        self.cache.lock().unwrap().insert(encoded.to_string(), resolved.clone());
        resolved
    }

    /// A Claude project directory name (`-Users-me-repo`).
    pub fn claude_cwd(&self, encoded: &str) -> Cwd {
        match self.resolve(encoded) {
            Some(path) => Cwd::ProjectDir { path },
            None if encoded.starts_with('-') => Cwd::Decoded { path: encoded.replace('-', "/") },
            None => Cwd::Decoded { path: encoded.to_string() },
        }
    }

    /// A Cursor project directory name (`Users-me-repo`, no leading dash).
    pub fn cursor_cwd(&self, encoded: &str) -> Cwd {
        match self.resolve(encoded) {
            Some(path) => Cwd::ProjectDir { path },
            None if encoded.starts_with('-') => Cwd::Decoded { path: encoded.replace('-', "/") },
            None if encoded.contains('-') => Cwd::Decoded { path: format!("/{}", encoded.replace('-', "/")) },
            None => Cwd::Decoded { path: encoded.to_string() },
        }
    }
}

fn is_dir(path: &str) -> bool {
    std::fs::metadata(path).map(|m| m.is_dir()).unwrap_or(false)
}

fn search(encoded: &str) -> Option<String> {
    let tokens: Vec<&str> = encoded.split('-').filter(|t| !t.is_empty()).collect();
    if tokens.is_empty() || tokens.len() > MAX_ENCODED_TOKENS {
        return None;
    }
    fn walk(tokens: &[&str], parent: &str, index: usize) -> Option<String> {
        if index == tokens.len() {
            return Some(parent.to_string());
        }
        // Longest run first: `room-runners-arena-lib` must beat a sibling `room`.
        for end in (index + 1..=tokens.len()).rev() {
            let run = tokens[index..end].join("-");
            for name in [run.clone(), format!(".{run}")] {
                let candidate = format!("{parent}/{name}");
                if is_dir(&candidate)
                    && let Some(found) = walk(tokens, &candidate, end) {
                        return Some(found);
                    }
            }
        }
        None
    }
    walk(&tokens, "", 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyphenated_and_dotted_directories_resolve_to_what_exists() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().canonicalize().unwrap();
        std::fs::create_dir_all(base.join("room-runners-arena-lib/.wsf9-w1-i2")).unwrap();
        std::fs::create_dir_all(base.join("room")).unwrap();
        let encoded = format!("{}-room-runners-arena-lib-wsf9-w1-i2", base.to_str().unwrap().replace('/', "-"));
        let resolver = ProjectDirResolver::default();
        assert_eq!(
            resolver.cursor_cwd(encoded.trim_start_matches('-')),
            Cwd::ProjectDir { path: format!("{}/room-runners-arena-lib/.wsf9-w1-i2", base.display()) }
        );
        // Nothing on disk: reported as a guess, never as a real directory.
        assert_eq!(resolver.claude_cwd("-nope-a-b"), Cwd::Decoded { path: "/nope/a/b".into() });
    }
}
