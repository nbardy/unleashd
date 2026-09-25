//! Conversation records: one-time import of config-store.ts's JSON directory, its verification,
//! and the latency benchmark. Reads the source directory only; run it on a COPY.
//!
//!   records-tool import <conversation-config/v1 dir> <new.sqlite>   → <new.sqlite>.import.json
//!   records-tool verify <conversation-config/v1 dir> <db.sqlite>    → <db.sqlite>.verify.json
//!   records-tool bench <db.sqlite> <cas-iterations>                 (works on a scratch copy)

use std::path::{Path, PathBuf};
use std::time::Instant;
use unleashd_ingest::records::import::{import, verify};
use unleashd_ingest::records::{Records, SetConfig, SetConfigOutcome};

fn write_report<T: serde::Serialize>(db: &Path, suffix: &str, report: &T) -> PathBuf {
    let path = PathBuf::from(format!("{}.{suffix}.json", db.display()));
    std::fs::write(&path, serde_json::to_string_pretty(report).expect("report serializes")).expect("write report");
    path
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() as f64 - 1.0) * p).round() as usize]
}

fn bench(db: &Path, iterations: usize) {
    let scratch = std::env::temp_dir().join(format!("records-bench-{}.sqlite", std::process::id()));
    let _ = std::fs::remove_file(&scratch);
    rusqlite::Connection::open(db)
        .and_then(|c| c.execute("VACUUM INTO ?1", [scratch.display().to_string()]))
        .expect("copy database for the benchmark");

    let mut records = Records::open(&scratch).expect("open scratch copy");
    let mut list_ms = Vec::new();
    let mut summaries = Vec::new();
    for _ in 0..7 {
        let t = Instant::now();
        summaries = records.list_summaries().expect("list");
        list_ms.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let t = Instant::now();
    let full: Vec<_> = summaries.iter().map(|s| records.get(&s.conversation_id).expect("get").expect("present")).collect();
    let get_all_ms = t.elapsed().as_secs_f64() * 1000.0;

    let target = full
        .iter()
        .find(|r| r.status == unleashd_ingest::records::RecordStatus::Active && r.last_resolved_config.is_some())
        .expect("an active, resolved record")
        .clone();
    let resolved = target.last_resolved_config.clone().expect("filtered above");
    let mut cas_ms = Vec::new();
    let mut revision = target.config_revision;
    for i in 0..iterations {
        let t = Instant::now();
        let outcome = records
            .set_config(
                SetConfig {
                    conversation_id: target.conversation_id.clone(),
                    expected_config_revision: revision,
                    config: target.config.clone(),
                    last_resolved_config: resolved.clone(),
                },
                1_790_000_000_000 + i as i64,
            )
            .expect("set_config");
        cas_ms.push(t.elapsed().as_secs_f64() * 1000.0);
        match outcome {
            SetConfigOutcome::Committed { record } => revision = record.config_revision,
            other => panic!("unexpected {other:?}"),
        }
    }
    list_ms.sort_by(f64::total_cmp);
    cas_ms.sort_by(f64::total_cmp);
    let report = serde_json::json!({
        "db": db.display().to_string(),
        "records": summaries.len(),
        "listSummariesMs": { "min": list_ms[0], "median": percentile(&list_ms, 0.5), "runs": list_ms },
        "getEveryRecordMs": get_all_ms,
        "casIterations": iterations,
        "casMs": { "p50": percentile(&cas_ms, 0.5), "p90": percentile(&cas_ms, 0.9), "p99": percentile(&cas_ms, 0.99), "max": cas_ms[cas_ms.len() - 1] },
        "synchronous": "FULL",
    });
    println!("{}", serde_json::to_string_pretty(&report).expect("report serializes"));
    drop(records);
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", scratch.display()));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        [_, "import", source, db] => {
            let report = import(Path::new(source), Path::new(db)).unwrap_or_else(|e| panic!("import failed: {e}"));
            let path = write_report(Path::new(db), "import", &report);
            println!(
                "imported {} of {} record files, {} rejected, {} ms → {}",
                report.imported,
                report.record_files,
                report.rejected.len(),
                report.ms.round(),
                path.display()
            );
        }
        [_, "verify", source, db] => {
            let report = verify(Path::new(source), Path::new(db)).unwrap_or_else(|e| panic!("verify failed: {e}"));
            let path = write_report(Path::new(db), "verify", &report);
            println!(
                "ok={} records {}/{} hash-equal, rejects {}/{} byte-equal, index {}/{} rows, {} ms → {}",
                report.ok,
                report.record_hash_matches,
                report.records_compared,
                report.reject_bytes_equal,
                report.rejects_compared,
                report.index_rows,
                report.index_rows_expected,
                report.ms.round(),
                path.display()
            );
            if !report.ok {
                std::process::exit(1);
            }
        }
        [_, "bench", db, iterations] => bench(Path::new(db), iterations.parse().expect("iterations is a number")),
        _ => {
            eprintln!("usage: records-tool import|verify <conversation-config/v1> <db.sqlite> | bench <db.sqlite> <n>");
            std::process::exit(2);
        }
    }
}
