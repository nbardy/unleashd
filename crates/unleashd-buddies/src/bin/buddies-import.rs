//! buddies-import: v33 → lean schema, then zero-loss verification.
//!
//!   buddies-import import --from <v33.sqlite> --to <new.sqlite> --report <import.json>
//!   buddies-import verify --from <v33.sqlite> --to <new.sqlite> --import-report <import.json> --out <verify.json>
//!
//! Both read the v33 file read-only. `import` refuses an existing target. `verify` exits 1 on any
//! mismatch. Neither writes a soul file.

use std::path::PathBuf;
use std::process::ExitCode;
use unleashd_buddies::import::{ImportReport, SoulFile, import};
use unleashd_buddies::verify::verify;

fn arg(args: &[String], name: &str) -> Result<PathBuf, String> {
    args.windows(2).find(|w| w[0] == name).map(|w| PathBuf::from(&w[1])).ok_or(format!("missing {name}"))
}

fn write_json(path: &PathBuf, value: &impl serde::Serialize) -> Result<(), String> {
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| format!("{}: {e}", path.display()))
}

fn run(args: &[String]) -> Result<bool, String> {
    let (from, to) = (arg(args, "--from")?, arg(args, "--to")?);
    match args.first().map(String::as_str) {
        Some("import") => {
            let report: ImportReport = import(&from, &to).map_err(|e| format!("[{}] {e}", e.code()))?;
            write_json(&arg(args, "--report")?, &report)?;
            for (mapping, old, new) in &report.counts {
                println!("{mapping:<20} {old:>7} → {new:>7}");
            }
            Ok(true)
        }
        Some("verify") => {
            let baseline_path = arg(args, "--import-report")?;
            let text = std::fs::read_to_string(&baseline_path).map_err(|e| format!("{}: {e}", baseline_path.display()))?;
            let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let baseline: Vec<SoulFile> = serde_json::from_value(value["soul_files"].clone()).map_err(|e| e.to_string())?;
            let report = verify(&from, &to, &baseline).map_err(|e| format!("[{}] {e}", e.code()))?;
            write_json(&arg(args, "--out")?, &report)?;
            for c in &report.classes {
                println!("{:<42} {:>6} rows  {:>4}/{:<4} groups match  {}", c.class, c.rows_new, c.hash_matches, c.groups, ok(c.ok));
            }
            let chains = &report.revision_chains;
            println!("{:<42} {:>6} revs  {:>4} docs  {}", "revision_chains", chains.revisions, chains.docs, ok(chains.ok));
            println!("{:<42} {:?}  unchanged {}  {}", "soul_files", report.soul.split, report.soul.files_unchanged, ok(report.soul.ok));
            Ok(report.ok)
        }
        _ => Err("usage: buddies-import import|verify --from <v33> --to <new> ...".into()),
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
