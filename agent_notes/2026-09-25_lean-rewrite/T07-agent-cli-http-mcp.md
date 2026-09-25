# T07 — agent-cli HTTP MCP variant (done, not merged)

## Commits (none pushed)

| Repo | Branch | SHA |
|---|---|---|
| `vendor/agent-cli-tool` | `feat/http-mcp` (from pinned 2674d8c) | **b9c819f** |
| unleashd (worktree `.claude/worktrees/agent-aa169d7865f2bb7aa`) | `feat/agent-cli-http-mcp` (from `lean/integration` @ ab47223) | **fc69cb2** (pointer 2674d8c → b9c819f + server construction sites + docs) |

The owner must push the submodule commit first, then the outer commit. Nothing is merged into `lean/integration`.

## What changed

- **Type** (`src/types.ts`): `McpServerSpec = McpStdioServer | McpHttpServer`.
  - `{kind:'stdio', command, args, cwd?, env?, required?}`
  - `{kind:'http', url, headers?, required?}`
  - `McpEncoding` is now `{args, env, ownedPaths}`, with every field required. `CommandSpec` gains `ownedPaths`, and `runCommand` deletes those paths when the child closes or fails to spawn.
- **Dispatch** (`src/mcp-encoding.ts`): `encodeMcpServers(encoders, servers)` is the one switch on `kind`, and the one place env contributions merge. A conflicting value for the same variable throws.
  - Each harness supplies `{stdio, http}` handlers.
  - `headersViaEnv` moves each header value into the env var `AGENT_CLI_MCP_<SERVER>__<HEADER>`.
- **Server construction sites** now set `kind:'stdio'`:
  - `buddyMcpServers`, `buddyBuilderMcpServers` and `buddyOwnerMcpServers` (in `server/src/buddies/mcp-config.ts`)
  - the memory reviewer (`memory-review-runner.ts`)
  - two expectations in `server/test/buddy-mcp.test.ts`
- **B5 fixed.** Muse settings now go under `mcpServers` with `type:'stdio'` / `type:'streamable-http'` entries and an explicit `mode`.
  - A user's legacy `mcp_servers` block is folded into `mcpServers`. The legacy key is never written.
  - If both keys hold different entries for the same name, the encoder throws.
- **Docs.** `docs/architecture.md` §1.5 gains rule 8, which records the transport sum type, where each CLI's token travels, and why the probe runs on every harness.

## Per-harness HTTP config and token delivery

The example below uses server `unleashd_buddy` with header `Authorization: Bearer T`, so `ENV = AGENT_CLI_MCP_UNLEASHD_BUDDY__AUTHORIZATION`.

| Harness | Exact config | Where the token lives | Fails closed natively? |
|---|---|---|---|
| claude | `--strict-mcp-config --mcp-config '{"mcpServers":{"unleashd_buddy":{"type":"http","url":U,"headers":{"Authorization":"${ENV}"}}}}'` | process env only; argv holds the reference | **No.** Claude marks the server `status:"failed"` and runs on. The runner probe covers this. |
| codex | `-c mcp_servers.unleashd_buddy.url="U" -c …enabled=true -c …required=true -c …env_http_headers={"Authorization"="ENV"}` | process env only | Yes. `required=true` plus a 401 aborts the session before any model call. |
| cursor | plugin `.mcp.json`: `{"mcpServers":{"unleashd_buddy":{"url":U,"headers":{"Authorization":"${env:ENV}"}}}}` plus `--plugin-dir … --approve-mcps` | process env only; the file holds only the reference | Unverified for HTTP. The stdio case drops silently. The runner probe covers this. |
| muse | `$XDG_CONFIG_HOME/muse/settings.json`: `"mcpServers":{"unleashd_buddy":{"type":"streamable-http","url":U,"headers":{"Authorization":"Bearer T"},"enabled":true,"mode":"required"}}` | **literal on disk.** The dir is a per-run mkdtemp (0700), the file is 0600, and `runCommand` deletes the dir on exit | Yes. A 401 ends the run with `run.terminal.failed`. |
| opencode (bonus) | `OPENCODE_CONFIG_CONTENT={"mcp":{"unleashd_buddy":{"type":"remote","url":U,"enabled":true,"headers":{…literal}}}}` | env only | Opencode is still `inject` capability, so it cannot take required servers. |

**`${VAR}` in claude `--mcp-config`: it works.** Claude 2.1.282 expanded `${T07TOK}` inside the inline JSON, and the server received `Bearer tok123`. So no temp file is needed for claude.

## Startup probe (`src/mcp-startup.ts`)

- `probeMcpServerStartup(name, spec)` dispatches on the spec's kind.
- The HTTP probe sends three POSTs: `initialize` (protocol 2025-03-26), then `notifications/initialized`, then `tools/list`.
  - It uses the exact URL and headers the CLI will send.
  - It parses both JSON and SSE replies.
  - It carries `Mcp-Session-Id` for stateful servers and deletes that session afterwards.
  - It fails with `` MCP server `n` failed during startup: <detail> ``, e.g. "initialize returned HTTP 401", "fetch failed: connect ECONNREFUSED…", or a timeout.
- `requiresStartupProbe(config, spec)` decides whether to probe:
  - stdio: only where `probeRequiredMcpStartup` is set (cursor, as before).
  - http: on every harness. It is one round trip, and claude drops a failed HTTP server silently.
- It runs alongside the CLI as before. A failure kills the child and forces reason `error`.
- It is exported from the package index.

## Verification

**Committed trees:** both `git status --porcelain` outputs were empty when the checks ran.

- Submodule `pnpm test`: **272 pass, 0 fail**. The submodule's `tsc --noEmit` is clean.
- `pnpm typecheck`: exit 0 (shared build, server tsc, client `tsc -b`, agent-cli tsc).
- `pnpm test:server`: **494 tests, 488 pass, 0 fail, 6 skipped** (the skips are live/opt-in tests that already existed).
- New tests are in `vendor/agent-cli-tool/test/http-mcp.test.ts`:
  - Exact encoder output for claude, codex, cursor, muse and opencode. For muse this includes file modes and `ownedPaths`. Each test also asserts the token never appears in argv or in the cursor file.
  - The probe against a real `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`, stateless, behind a bearer check: correct token passes; 401 and an unreachable URL reject loudly.
  - A claude-shim turn: a required HTTP server with a revoked token gives reason `error`; a healthy one gives `success`.
  - A muse-shim run: the settings dir existed during the run and is gone afterwards.
- `mcp.test.ts` muse tests are updated to `mcpServers`, with a B5 regression assertion that no `mcp_servers` key is written. They also clean up the dirs they create.

**Live, zero-cost CLI acceptance** (2026-09-25, local stateless SDK server on 127.0.0.1 logging headers):

- Setup:
  - Everything ran through agent-cli `executeCommand`.
  - claude, codex and cursor got an invalid model id. The provider rejects it before inference; claude reported `total_cost_usd: 0`.
  - muse ran with `--provider echo`, which makes no model call.
- claude 2.1.282:
  - The server saw `initialize` / `tools/list` with `Bearer tok123`, and argv had no token.
  - With a bad token, claude's own init said `failed`, but the runner probe failed the turn with HTTP 401.
- codex-cli 0.156.1:
  - `codex mcp get -c …` shows `transport: streamable_http` with `env_http_headers`.
  - exec connected with the right bearer.
  - With a bad bearer, codex failed natively ("required MCP servers failed to initialize … HTTP 401").
- cursor agent 2026.09.23-86fc751:
  - Through the generated plugin, the server saw `initialize` with `Bearer tok123` (resolved from `${env:…}`).
  - `agent mcp list` ignores `--plugin-dir`, so it cannot be used as a static check.
- muse 1.4.0:
  - The right bearer reached `initialize` + `tools/list`.
  - With a wrong bearer, muse's native abort said "authentication failed".
  - A dead required **stdio** server under the new `mcpServers` key ended with "Required MCP server `unleashd_dead` failed during startup", which proves the B5 key is read and `mode` is honored.
  - Every live muse run's temp dir was deleted afterwards.
- opencode 1.18.18: `opencode mcp list` with the generated `remote` config reported the server `connected`, and the server saw the header.

## Not verified

- **No real model turn called a tool over HTTP on any harness.** Only connection, auth and `tools/list` were observed. Tool-call round trips need a paid turn. The opt-in live tests (`test:live:cursor-mcp`, `test:live:muse-mcp`) are still stdio-only.
- **cursor:**
  - Only `initialize` + `notifications/initialized` + GET were observed before the invalid model ended the process. `tools/list` over the plugin path was not observed.
  - Whether cursor silently drops a failed HTTP server was not tested; the runner probe covers it either way.
- **muse:** the echo provider rejected agent-cli's full turn ("provider does not support base instructions"), so HTTP loading was observed but not tool execution. The stdio-echo success case could not be shown, since the echo fixture only logs on a tool call.
- **Token exposure (by design, same as today's stdio control tokens):**
  - claude, codex and cursor: the bearer is in the CLI process env, so the agent's own shell tool can read it.
  - muse: it is readable in the settings file for the life of the run.
  - This is acceptable only because the token is per-turn and revoked at settle (T11 must do the revocation).
- **Accepted tradeoff:** the probe runs concurrently with the CLI (`executeCommand` is a sync factory), not before spawn. The CLI may start the model before a failed probe kills it; the turn still ends `error`.

## Notes for T11

- Hand the harness `{kind:'http', url:'http://127.0.0.1:<loopback port>/mcp', headers:{Authorization:`Bearer ${turnToken}`}, required:true}`.
- Run the server stateless: `new StreamableHTTPServerTransport({sessionIdGenerator: undefined})`, with one `McpServer` per request.
- The test fixture in `http-mcp.test.ts` is the minimal working shape.
- Claude also sends a `server/discover` POST before `initialize`; the SDK tolerates it.
- The lockfile adds `@modelcontextprotocol/sdk` and `zod` as submodule devDependencies. The outer `pnpm-lock.yaml` gains 6 lines. A pnpm-driven `qs` re-resolution in the express snapshot was reverted to keep the diff scoped. `pnpm install --frozen-lockfile --offline` passes.
