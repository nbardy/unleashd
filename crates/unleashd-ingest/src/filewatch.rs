//! Pattern: wake-on-write (docs/patterns.md#wake-on-write) — a direct kqueue watch on each
//! transcript that is actively growing, next to the recursive FSEvents watch that discovers
//! files.
//!
//! Why: FSEvents delivers a change ~10–20 ms after the write (it batches in the kernel and in
//! fseventsd); a kqueue `EVFILT_VNODE` watch on the open file fires on the write itself (0.5 ms in
//! BENCH-ingest-js-vs-rust.md). One vnode watch holds one descriptor, so only files written
//! recently are watched: at most `HOT_MAX`, each dropped after `HOT_IDLE` without a write. Every
//! event still arrives through FSEvents too; the duplicate re-read is a stat (unchanged stamp).

use std::collections::HashMap;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Files watched directly at once. Agents write a handful of transcripts at a time.
pub const HOT_MAX: usize = 64;
/// A file not written for this long goes back to FSEvents only.
pub const HOT_IDLE: Duration = Duration::from_secs(300);

/// The shutdown wake-up: an `EVFILT_USER` event with this ident.
const STOP_IDENT: usize = 0;

struct Watched {
    fd: OwnedFd,
    touched: Instant,
}

#[derive(Default)]
struct Hot {
    by_path: HashMap<PathBuf, Watched>,
    by_fd: HashMap<RawFd, PathBuf>,
}

impl Hot {
    fn remove(&mut self, path: &Path) {
        if let Some(w) = self.by_path.remove(path) {
            self.by_fd.remove(&w.fd.as_raw_fd());
            // Dropping the descriptor removes its knote from the kqueue.
        }
    }
}

pub struct FileWatch {
    kq: Arc<OwnedFd>,
    hot: Arc<Mutex<Hot>>,
    join: Option<JoinHandle<()>>,
}

fn kevent(ident: usize, filter: i16, flags: u16, fflags: u32) -> libc::kevent {
    libc::kevent { ident, filter, flags, fflags, data: 0, udata: std::ptr::null_mut() }
}

fn register(kq: RawFd, change: libc::kevent) -> io::Result<()> {
    // SAFETY: one valid change record, no output buffer.
    let r = unsafe { libc::kevent(kq, &change, 1, std::ptr::null_mut(), 0, std::ptr::null()) };
    if r < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

impl FileWatch {
    /// Start the kqueue thread. `send` receives the watched path of every write, extend, delete
    /// or rename.
    pub fn start(send: impl Fn(PathBuf) + Send + 'static) -> io::Result<FileWatch> {
        // SAFETY: kqueue() returns a new descriptor or -1.
        let raw = unsafe { libc::kqueue() };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `raw` is a fresh descriptor this function owns.
        let kq = Arc::new(unsafe { OwnedFd::from_raw_fd(raw) });
        register(raw, kevent(STOP_IDENT, libc::EVFILT_USER, libc::EV_ADD | libc::EV_CLEAR, 0))?;
        let hot: Arc<Mutex<Hot>> = Arc::default();
        let (thread_kq, thread_hot) = (kq.clone(), hot.clone());
        let join = std::thread::Builder::new().name("unleashd-ingest-kqueue".into()).spawn(move || {
            let mut events = [kevent(0, 0, 0, 0); 32];
            loop {
                // SAFETY: `events` is a writable buffer of the length passed; no timeout (blocks).
                let n = unsafe {
                    libc::kevent(thread_kq.as_raw_fd(), std::ptr::null(), 0, events.as_mut_ptr(), events.len() as i32, std::ptr::null())
                };
                if n < 0 {
                    if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                        continue;
                    }
                    return;
                }
                for event in &events[..n as usize] {
                    if event.filter == libc::EVFILT_USER {
                        return;
                    }
                    let mut hot = thread_hot.lock().expect("kqueue state");
                    let Some(path) = hot.by_fd.get(&(event.ident as RawFd)).cloned() else { continue };
                    // The descriptor follows the inode; after a delete or rename the path names
                    // something else (or nothing), so FSEvents takes it back.
                    if event.fflags & (libc::NOTE_DELETE | libc::NOTE_RENAME) != 0 {
                        hot.remove(&path);
                    }
                    drop(hot);
                    send(path);
                }
            }
        })?;
        Ok(FileWatch { kq, hot, join: Some(join) })
    }

    /// Watch `path` directly (or refresh its last-write time), then drop idle and excess files.
    pub fn touch(&self, path: &Path, now: Instant) -> io::Result<()> {
        let mut hot = self.hot.lock().expect("kqueue state");
        if let Some(w) = hot.by_path.get_mut(path) {
            w.touched = now;
        } else {
            let c = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(io::Error::other)?;
            // SAFETY: a NUL-terminated path. O_EVTONLY: a watch that never blocks unmounting.
            let raw = unsafe { libc::open(c.as_ptr(), libc::O_EVTONLY | libc::O_CLOEXEC) };
            if raw < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: `raw` is a fresh descriptor this function owns.
            let fd = unsafe { OwnedFd::from_raw_fd(raw) };
            let flags = libc::NOTE_WRITE | libc::NOTE_EXTEND | libc::NOTE_DELETE | libc::NOTE_RENAME;
            register(self.kq.as_raw_fd(), kevent(raw as usize, libc::EVFILT_VNODE, libc::EV_ADD | libc::EV_CLEAR, flags))?;
            hot.by_fd.insert(raw, path.to_path_buf());
            hot.by_path.insert(path.to_path_buf(), Watched { fd, touched: now });
        }
        let idle: Vec<PathBuf> =
            hot.by_path.iter().filter(|(_, w)| now.duration_since(w.touched) > HOT_IDLE).map(|(p, _)| p.clone()).collect();
        for p in idle {
            hot.remove(&p);
        }
        while hot.by_path.len() > HOT_MAX {
            let oldest = hot.by_path.iter().min_by_key(|(_, w)| w.touched).map(|(p, _)| p.clone()).expect("non-empty");
            hot.remove(&oldest);
        }
        Ok(())
    }

    pub fn watched(&self) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = self.hot.lock().expect("kqueue state").by_path.keys().cloned().collect();
        out.sort();
        out
    }

    pub fn stop(mut self) {
        let _ = register(self.kq.as_raw_fd(), kevent(STOP_IDENT, libc::EVFILT_USER, 0, libc::NOTE_TRIGGER));
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::mpsc::channel;

    #[test]
    fn a_write_to_a_watched_file_arrives_and_a_delete_unwatches_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        std::fs::write(&path, "a\n").unwrap();
        let (tx, rx) = channel();
        let watch = FileWatch::start(move |p| {
            let _ = tx.send(p);
        })
        .unwrap();
        watch.touch(&path, Instant::now()).unwrap();
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"b\n").unwrap();
        assert_eq!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), path);
        std::fs::remove_file(&path).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !watch.watched().is_empty() {
            assert!(Instant::now() < deadline, "a deleted file stays watched");
            let _ = rx.recv_timeout(Duration::from_millis(50));
        }
        watch.stop();
    }

    #[test]
    fn idle_and_excess_files_are_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let watch = FileWatch::start(|_| {}).unwrap();
        let t0 = Instant::now();
        for i in 0..=HOT_MAX {
            let p = dir.path().join(format!("{i}.jsonl"));
            std::fs::write(&p, "").unwrap();
            watch.touch(&p, t0 + Duration::from_millis(i as u64)).unwrap();
        }
        let watched = watch.watched();
        assert_eq!(watched.len(), HOT_MAX);
        assert!(!watched.contains(&dir.path().join("0.jsonl")), "the least recently written file goes first");
        let late = dir.path().join("late.jsonl");
        std::fs::write(&late, "").unwrap();
        watch.touch(&late, t0 + HOT_IDLE + Duration::from_secs(1)).unwrap();
        assert_eq!(watch.watched(), [late]);
        watch.stop();
    }
}
