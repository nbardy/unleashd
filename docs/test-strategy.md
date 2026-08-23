# Test Strategy: Useful vs Overkill

(Moved out of AGENTS.md to keep startup context small.)

## Test Strategy: Useful vs Overkill

### Keep features lean

- Prefer one integration test through the real boundary over many tests of
  helpers, mocks, source text, CSS strings, or component structure.
- Never read TSX/CSS source in a test to assert labels, ordering, class names,
  or implementation details. Exercise the rendered/API behavior or omit the
  test.
- Do not extract trivial projection helpers merely to unit-test them.
- Wire payloads get one shared Zod schema; do not redefine matching client and
  server interfaces.
- Durable application state is authoritative. Do not ask a model to copy a
  magic marker into prose when the UI can read the canonical API/store result.
- A small feature should use the existing creation, persistence, and navigation
  paths. If it needs a parallel transport or lifecycle, simplify the design
  before adding safety wrappers and tests.

### Preserve lifecycle and hydration authority

- `server/src/lifecycle/shutdown.ts` is the only process-lifecycle and mutation
  admission authority. The dev watcher requests reloads; it never owns, adopts,
  or transfers provider processes.
- A source reload remains pending and fully available while seeking an idle
  boundary. It pauses the scheduler only at a candidate boundary, rechecks all
  active work synchronously, and resumes it if the boundary was not actually
  idle. The server that spawned each admitted turn keeps ownership until it
  drains; only explicit shutdown interrupts owned turns.
- Conversation summaries are bounded transport projections, never durable
  state or a cache. Full transcripts hydrate through the conversation-detail
  route, while the runtime/store remains authoritative.
- Do not add detached-process adoption, fallback snapshots, a second readiness
  gate, or task-specific model routing as incidental “safety.” Those are
  separate architecture decisions and require an explicit scoped design.

### Rendering a client component in a test (no DOM harness required)

The repo has no jsdom/testing-library and does not need one. `react-dom/server`
+ `MemoryRouter` render a real component to a string, which is enough to assert
on the markup contract (hrefs, presence/absence of a target) through the real
router — no mocks, and no assertions on TSX source text.

Two gotchas, both already handled by `pnpm test:client`:

- The test file must be `.tsx`, and `tsx` needs `--tsconfig client/tsconfig.app.json`
  or it transpiles JSX with the classic runtime and every component under test
  throws `ReferenceError: React is not defined`.
- Only markup that renders on first paint is visible. Anything behind local
  state (desktop `AutomationCard`'s run history sits behind a `showRuns`
  toggle) will not appear — assert against a section that renders immediately.

`client/test/buddy-conversation-links.test.tsx` is the worked example.

### High-value, low-cost
- Contract tests for builder + provider command specs (`agent-cli-tool`).
- Adapter loader/poller integration fixture test.
- WS init + create/reconcile behavior test around path normalization and visibility.

### Likely overkill now
- Per-provider exhaustive UI suites that duplicate loader + WS + provider contract coverage.
- Mock-heavy provider unit tests where real process/fs integration is the real risk.

If you want exactly three tests:
1. `agent-cli-tool` command contract regression (Gemini + Codex resume + stream flags)
2. `loadAllConversations/pollForChanges` fixture test
3. `test/api.test.js` create/reconcile path normalization test
