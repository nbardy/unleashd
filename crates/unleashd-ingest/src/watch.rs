//! Pattern: wake-on-write (docs/patterns.md#wake-on-write)
//!
//! The ingest thread: open the store, start the FSEvents watcher, scan, then apply events until
//! stopped. The watcher starts BEFORE the scan so a change made during the scan is not missed
//! (it is applied after; re-reading an unchanged source is a stat). FSEvents (recursive) finds
//! new and changed files; a file it reports as written is then also watched directly with kqueue
//! (`filewatch.rs`), so its next append wakes this thread on the write itself.

use crate::engine::{Engine, Report};
use crate::filewatch::FileWatch;
use crate::model::Root;
use crate::store::Committed;
use notify::{RecursiveMode, Watcher};
use std::collections::BTreeSet;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Burst settle: after an event the batch waits `QUIET` for the next one and closes when none
/// comes (or `MAX_BATCH` after its first event, so a steady stream still commits). An agent turn
/// writes several lines in quick succession, and one batch is one revision. This was one fixed
/// 50 ms window, which every append waited out: append → onChange p50 68 ms (T13a, before).
/// Guard: `tests/watch.rs` `appends_reach_on_change_within_single_digit_ms`.
pub const QUIET: Duration = Duration::from_millis(2);
pub const MAX_BATCH: Duration = Duration::from_millis(25);

/// The one slow backstop: FSEvents can coalesce away or drop events (sleep/wake, a full kernel
/// queue); without it a missed append would stay unseen until the file is written again. A scan
/// of unchanged roots is a stat per source.
const BACKSTOP: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, PartialEq)]
pub enum IngestEvent {
    Changes(Committed),
    /// A scan or batch failed as a whole (a panic or a store error). Live chat is unaffected;
    /// the next event retries.
    Failed(String),
}

enum Msg {
    Fs(notify::Result<notify::Event>),
    /// A write to a file watched directly (kqueue).
    File(PathBuf),
    Stop,
}

pub struct Started {
    pub report: Report,
    pub missing_roots: Vec<String>,
    pub rev: i64,
}

pub struct Handle {
    tx: Sender<Msg>,
    join: Option<JoinHandle<()>>,
}

impl Handle {
    pub fn stop(mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn panic_text(p: Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "panic".into())
}

/// Start ingesting. Returns once the initial scan is committed.
pub fn start(roots: Vec<Root>, db_path: PathBuf, emit: impl Fn(IngestEvent) + Send + 'static) -> Result<(Handle, Started), String> {
    let (tx, rx) = channel::<Msg>();
    let (ready_tx, ready_rx) = channel::<Result<Started, String>>();
    let watcher_tx = tx.clone();
    let join = std::thread::Builder::new()
        .name("unleashd-ingest".into())
        .spawn(move || run(roots, &db_path, watcher_tx, rx, ready_tx, emit))
        .map_err(|e| e.to_string())?;
    match ready_rx.recv() {
        Ok(Ok(started)) => Ok((Handle { tx, join: Some(join) }, started)),
        Ok(Err(e)) => {
            let _ = join.join();
            Err(e)
        }
        Err(_) => Err(join.join().err().map(panic_text).unwrap_or_else(|| "ingest thread exited".into())),
    }
}

fn run(
    roots: Vec<Root>,
    db_path: &Path,
    watcher_tx: Sender<Msg>,
    rx: Receiver<Msg>,
    ready: Sender<Result<Started, String>>,
    emit: impl Fn(IngestEvent),
) {
    let mut engine = match Engine::open(roots, db_path) {
        Ok(engine) => engine,
        Err(e) => {
            let _ = ready.send(Err(e.to_string()));
            return;
        }
    };
    let missing_roots = engine.missing_roots();
    let file_tx = watcher_tx.clone();
    let files = match FileWatch::start(move |path| {
        let _ = file_tx.send(Msg::File(path));
    }) {
        Ok(files) => files,
        Err(e) => {
            let _ = ready.send(Err(format!("kqueue: {e}")));
            return;
        }
    };
    let watcher = notify::recommended_watcher(move |event| {
        let _ = watcher_tx.send(Msg::Fs(event));
    });
    let mut watcher = match watcher {
        Ok(w) => w,
        Err(e) => {
            let _ = ready.send(Err(format!("watcher: {e}")));
            return;
        }
    };
    for root in engine.roots.iter().filter(|r| !missing_roots.contains(&r.path)) {
        if let Err(e) = watcher.watch(Path::new(&root.path), RecursiveMode::Recursive) {
            let _ = ready.send(Err(format!("watch {}: {e}", root.path)));
            return;
        }
    }
    let mut on_commit = |c: &Committed| emit(IngestEvent::Changes(c.clone()));
    let report = match catch_unwind(AssertUnwindSafe(|| engine.scan(&mut on_commit))) {
        Ok(report) => report,
        Err(p) => {
            let _ = ready.send(Err(format!("initial scan panicked: {}", panic_text(p))));
            return;
        }
    };
    let rev = crate::store::Reader::open(db_path).and_then(|r| r.rev()).unwrap_or(0);
    if ready.send(Ok(Started { report, missing_roots, rev })).is_err() {
        return;
    }
    loop {
        let first = match rx.recv_timeout(BACKSTOP) {
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(msg) => msg,
            Err(RecvTimeoutError::Timeout) => {
                Msg::Fs(Ok(notify::Event::new(notify::EventKind::Other).set_flag(notify::event::Flag::Rescan)))
            }
        };
        let opened = Instant::now();
        let mut paths = BTreeSet::new();
        let mut rescan = false;
        let mut stop = false;
        let take = |msg: Msg, paths: &mut BTreeSet<PathBuf>, rescan: &mut bool| match msg {
            Msg::Fs(Ok(event)) => {
                *rescan |= event.need_rescan();
                paths.extend(event.paths);
            }
            // A watcher error means events may be lost: re-check everything.
            Msg::Fs(Err(_)) => *rescan = true,
            Msg::File(path) => {
                paths.insert(path);
            }
            Msg::Stop => unreachable!("handled by the receive loop"),
        };
        take(first, &mut paths, &mut rescan);
        loop {
            let wait = QUIET.min(MAX_BATCH.saturating_sub(opened.elapsed()));
            match rx.recv_timeout(wait) {
                Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => {
                    stop = true;
                    break;
                }
                Ok(msg) => take(msg, &mut paths, &mut rescan),
                Err(RecvTimeoutError::Timeout) => break,
            }
        }
        if stop {
            break;
        }
        let growing = engine.appendable(&paths);
        let result =
            catch_unwind(AssertUnwindSafe(|| if rescan { engine.scan(&mut on_commit) } else { engine.changed(paths, &mut on_commit) }));
        match result {
            Ok(report) if !report.errors.is_empty() => emit(IngestEvent::Failed(report.errors.join("\n"))),
            Ok(_) => {}
            Err(p) => emit(IngestEvent::Failed(format!("ingest batch panicked: {}", panic_text(p)))),
        }
        // Watched after the read, so the first append of a file arrives through FSEvents and
        // every later one through kqueue. A file that vanished in between is left to FSEvents.
        let now = Instant::now();
        for path in growing {
            let _ = files.touch(&path, now);
        }
    }
    drop(watcher);
    files.stop();
}
