//! Byte-exact line reading from an offset, and the resume check for a file seen before.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

const CHUNK: usize = 1 << 20;

/// Bytes just before a resume offset, re-read and compared before resuming. Same inode and no
/// shrink cannot see a file truncated and rewritten past its old length; the bytes a resume
/// would build on can (the rule transcript-tails.ts established).
pub const FINGERPRINT_BYTES: u64 = 64;

/// Reads `path` from `start`, calling `each(line, end, terminated)` for every line. `end` is the
/// byte offset just past the line (past its `\n` when terminated). The final unterminated
/// fragment is offered with `terminated = false`; a writer may be mid-append, so the caller
/// decides whether it is a record. Stops early when `each` returns `false`.
pub fn for_each_line(path: &Path, start: u64, mut each: impl FnMut(&[u8], u64, bool) -> bool) -> io::Result<()> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buf: Vec<u8> = Vec::with_capacity(CHUNK * 2);
    let mut base = start; // file offset of buf[0]
    let mut chunk = vec![0u8; CHUNK];
    loop {
        let read = file.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        let scan_from = buf.len();
        buf.extend_from_slice(&chunk[..read]);
        let mut line_start = 0usize;
        let mut search = scan_from;
        while let Some(pos) = memchr::memchr(b'\n', &buf[search..]) {
            let nl = search + pos;
            let end = base + nl as u64 + 1;
            if !each(&buf[line_start..nl], end, true) {
                return Ok(());
            }
            line_start = nl + 1;
            search = line_start;
        }
        buf.drain(..line_start);
        base += line_start as u64;
    }
    if !buf.is_empty() {
        let end = base + buf.len() as u64;
        each(&buf, end, false);
    }
    Ok(())
}

/// The fingerprint of `path` ending at `offset`.
pub fn fingerprint(path: &Path, offset: u64) -> io::Result<Vec<u8>> {
    let start = offset.saturating_sub(FINGERPRINT_BYTES);
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; (offset - start) as usize];
    let mut filled = 0;
    while filled < buf.len() {
        let n = file.read(&mut buf[filled..])?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    buf.truncate(filled);
    Ok(buf)
}

/// A line's text: `\r` before the newline dropped (readline did), invalid UTF-8 replaced.
pub fn line_text(bytes: &[u8]) -> std::borrow::Cow<'_, str> {
    let bytes = bytes.strip_suffix(b"\r").unwrap_or(bytes);
    String::from_utf8_lossy(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn collect(path: &Path, start: u64) -> Vec<(String, u64, bool)> {
        let mut out = Vec::new();
        for_each_line(path, start, |l, end, t| {
            out.push((String::from_utf8_lossy(l).into_owned(), end, t));
            true
        })
        .unwrap();
        out
    }

    #[test]
    fn offsets_are_byte_exact_across_chunk_boundaries_and_multibyte_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.jsonl");
        let mut f = File::create(&path).unwrap();
        // A line longer than one read chunk, with a 4-byte character straddling the boundary.
        let mut long = "x".repeat(CHUNK - 2);
        long.push('😀');
        writeln!(f, "{long}").unwrap();
        writeln!(f, "é").unwrap();
        write!(f, "tail").unwrap();
        drop(f);
        let lines = collect(&path, 0);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].0, long);
        assert_eq!(lines[0].1, long.len() as u64 + 1);
        assert_eq!(lines[1], ("é".to_string(), long.len() as u64 + 1 + 3, true));
        assert_eq!(lines[2], ("tail".to_string(), long.len() as u64 + 1 + 3 + 4, false));
        // Resuming at a recorded end yields exactly the rest.
        assert_eq!(collect(&path, lines[0].1).len(), 2);
    }
}
