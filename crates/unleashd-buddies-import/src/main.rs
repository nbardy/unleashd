//! buddies-import: v33 → lean schema, then zero-loss verification.
//!
//!   buddies-import import --from <v33.sqlite> --to <new.sqlite> --report <import.json> [--owner-reads <json>] [--keep-direct-unread]
//!   buddies-import verify --from <v33.sqlite> --to <new.sqlite> --import-report <import.json> --out <verify.json>
//!   buddies-import export-notes --from <v33.sqlite> [--write]
//!
//! `export-notes` prints where each note file would go; `--write` writes them into each
//! workspace's agent_notes/buddy-notes/ (refusing if any already exists). Notes are not imported.
//!
//! Both read the v33 file read-only. `import` refuses an existing target. `verify` exits 1 on any
//! mismatch. Neither writes a soul file. `--owner-reads` defaults to the server's
//! `$UNLEASHD_DATA_DIR/owner-channel-reads.json` (else `~/.agent-viewer/…`); it is only read, and
//! a missing file is recorded in the report as `absent`.

use std::path::PathBuf;
use std::process::ExitCode;
use unleashd_buddies_import::import::{DirectReads, ImportOptions, ImportReport, OwnerReads, SoulFile, import};
use unleashd_buddies_import::notes;
use unleashd_buddies_import::verify::verify;

fn arg(args: &[String], name: &str) -> Result<PathBuf, String> {
    args.windows(2).find(|w| w[0] == name).map(|w| PathBuf::from(&w[1])).ok_or(format!("missing {name}"))
}

/// Where `server/src/app-data.ts` keeps owner-channel-reads.json.
fn default_owner_reads() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = std::env::var("UNLEASHD_DATA_DIR").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(home).join(".agent-viewer"));
    dir.join("owner-channel-reads.json")
}

fn write_json(path: &PathBuf, value: &impl serde::Serialize) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}

fn run(args: &[String]) -> Result<bool, String> {
    let from = arg(args, "--from")?;
    match args.first().map(String::as_str) {
        Some("export-notes") => {
            let files = notes::plan(&from).map_err(|e| format!("[{}] {e}", e.code()))?;
            for file in &files {
                println!("{:>4} notes  {}", file.notes, file.path.display());
            }
            if args.iter().any(|a| a == "--write") {
                notes::write(&files).map_err(|e| format!("[{}] {e}", e.code()))?;
                println!("wrote {} files", files.len());
            }
            Ok(true)
        }
        Some("import") => {
            let to = arg(args, "--to")?;
            let owner_reads = arg(args, "--owner-reads").unwrap_or_else(|_| default_owner_reads());
            // Imported DMs are marked read by default; --keep-direct-unread leaves them all unread.
            let options = ImportOptions { mark_direct_read: !args.iter().any(|a| a == "--keep-direct-unread") };
            let report: ImportReport = import(&from, &to, &owner_reads, options).map_err(|e| format!("[{}] {e}", e.code()))?;
            write_json(&arg(args, "--report")?, &report)?;
            for (mapping, old, new) in &report.counts {
                println!("{mapping:<20} {old:>7} → {new:>7}");
            }
            Ok(true)
        }
        Some("verify") => {
            let to = arg(args, "--to")?;
            let baseline_path = arg(args, "--import-report")?;
            let text = std::fs::read_to_string(&baseline_path).map_err(|e| format!("{}: {e}", baseline_path.display()))?;
            let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let baseline: Vec<SoulFile> = serde_json::from_value(value["soul_files"].clone()).map_err(|e| e.to_string())?;
            let owner_reads: OwnerReads = serde_json::from_value(value["owner_reads"].clone()).map_err(|e| e.to_string())?;
            let direct_reads: DirectReads = serde_json::from_value(value["direct_reads"].clone()).map_err(|e| e.to_string())?;
            let report = verify(&from, &to, &baseline, &owner_reads, &direct_reads).map_err(|e| format!("[{}] {e}", e.code()))?;
            write_json(&arg(args, "--out")?, &report)?;
            for c in &report.classes {
                println!("{:<42} {:>6} rows  {:>4}/{:<4} groups match  {}", c.class, c.rows_new, c.hash_matches, c.groups, ok(c.ok));
            }
            for (name, c) in [
                ("answers", &report.answers),
                ("links", &report.links),
                ("read_cursors", &report.read_cursors),
                ("ordering", &report.ordering),
            ] {
                println!("{name:<42} {:>6} rows  {:>4} identical  {}", c.rows_new, c.identical, ok(c.ok));
            }
            let chains = &report.revision_chains;
            println!("{:<42} {:>6} revs  {:>4} docs  {}", "revision_chains", chains.revisions, chains.docs, ok(chains.ok));
            println!("{:<42} {:?}  unchanged {}  {}", "soul_files", report.soul.split, report.soul.files_unchanged, ok(report.soul.ok));
            Ok(report.ok)
        }
        _ => Err("usage: buddies-import import|verify|export-notes --from <v33> ...".into()),
    }
}

fn ok(pass: bool) -> &'static str {
    if pass { "ok" } else { "MISMATCH" }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(2)
        }
    }
}
