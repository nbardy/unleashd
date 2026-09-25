# Ingest benchmark: JS vs the Rust crate (2026-09-25)

Setup: the same 891 MB Codex rollout (42,150 lines), an APFS clone, each contender in its own process, run twice.
The machine was under load (load average 50–65), so absolute times are rough and the ratios are what matters.

| Approach | Full parse | Peak RSS | New line appended |
|---|---:|---:|---:|
| Current app parser (`parseCodexJsonlFile`, re-run on every change) | 9.1 s | 404 MB | 9.1 s (full re-parse) |
| JS append-only, parse + discard | 15.8–18.2 s | 749–1,144 MB | 0.3 ms (no watcher) |
| JS append-only, keep objects | 9.1–11.5 s | 1,026–1,550 MB | 0.4–1 ms (no watcher) |
| JS + `fs.watch` on one file (kqueue), write → parsed | – | – | **0.5 ms** |
| JS + recursive dir watch (FSEvents), write → parsed | – | – | **~12 ms** |
| Rust crate (parse + extract + SQLite commit) | **2.3–4.1 s** | **~150 MB** | ~70 ms: FSEvents + 50 ms settle + commit |

Conclusions:
- Reading only appended bytes is the big win, and JS gets it fully.
- The crate is 2–4× faster than JS on a full parse and uses 7–10× less memory. `JSON.parse` must materialize every field as a GC'd heap object; serde skips unneeded fields and borrows from the buffer.
- The crate's reaction latency comes from its own design choices (the settle window and recursive-only watching), not from Rust.

Crate fixes for T13:
1. Shorten the settle window to about 5–10 ms, or settle only while a burst is still in progress.
2. Add a direct per-file watch (kqueue) on files that are actively growing.
3. A Codex file flipping into event mode (`Rebuild::EventMode`, read.rs) triggers a one-off FULL re-read of the file: 1.7–3.5 s on 890 MB. Persist the detected mode, or handle the flip without re-reading from byte 0.
