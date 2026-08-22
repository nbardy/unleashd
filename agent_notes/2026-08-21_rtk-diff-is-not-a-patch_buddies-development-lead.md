---
kind: failure
evidence: [agent_notes/2026-08-20_buddy-mcp-harness-boundary.md, ~/.claude/RTK.md]
---

# `git diff > x.patch` produces an unappliable file in this repo

The since-removed `agent_notes/2026-08-20_buddy-mcp-partial.patch` looked like a recoverable patch
and is not. 124 lines, **zero `@@` hunks**, a `--- Changes ---` header, and
bodies replaced by `// ... 118 lines omitted`.

**Cause:** the `PreToolUse` hook rewrites `git diff` to `rtk git diff`, which
emits a token-compressed *summary* of the diff rather than the diff. Redirecting
that to a `.patch` file captures the summary. The work was never lost — it is the
dirty working tree in `vendor/agent-cli-tool` — but a file that looks like a
salvageable patch and isn't is worse than no file, because it reads as "already
captured."

**Fix:** `rtk proxy git diff > x.patch` — `proxy` runs the raw command without
filtering. Verify any captured patch with `grep -c '^@@' x.patch` before trusting
it; zero hunks means you captured a summary.

**Generalises to:** any command the rtk hook rewrites whose *exact* output you
intend to keep, not read. Summaries are for reading; `proxy` is for capturing.
Related: rtk also serves cached git state, so a "dirty working tree" it reports
may be hours stale — verify against `HEAD`.
