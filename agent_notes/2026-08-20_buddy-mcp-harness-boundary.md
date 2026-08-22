# Buddy MCP: move harness encoding into agent-cli

**Date:** 2026-08-20
**Status:** design settled + verified; implementation partial and uncommitted
**Repos:** `unleashd` and `vendor/agent-cli-tool` (submodule → `git@github.com:nbardy/agent-cli.git`)
**Prompted by:** a live buddy conversation on the `muse` provider that had the buddy
context header but no `unleashd_buddy` tools, and silently shelled out to the
`buddies` CLI instead. Nobody noticed until the buddy was asked why.

---

## 1. The problem

Commit `abb6696` ("feat(buddies): add MCP support for Muse and Opencode") added **10
near-duplicate functions** to `server/src/buddies/mcp-config.ts` — one per
`{buddy, builder} × {codex, claude, muse, opencode, gemini}`:

```
buddyCodexMcpArgs          buddyBuilderCodexMcpArgs
buddyClaudeMcpArgs         buddyBuilderClaudeMcpArgs
buddyMuseMcpArgs           buddyBuilderMuseMcpArgs        → return []
buddyOpencodeMcpArgs       buddyBuilderOpencodeMcpArgs    → return []
buddyGeminiMcpArgs         buddyBuilderGeminiMcpArgs
```

Three things are wrong with this:

**a. It breaks a documented invariant.** `vendor/agent-cli-tool/src/types.ts:67`, on
`HarnessConfig`: *"This is the ONLY place that encodes CLI flag syntax."* The commit put
`-c mcp_servers.X=…`, `--mcp-config`, and `--strict-mcp-config` in unleashd instead. The
10 functions exist *because* the encoding sits on the wrong side of the boundary —
unleashd had to learn five CLI dialects, so it needed one function per dialect.

**b. The title is false.** Muse and opencode both `return []`. The commit adds zero
behavior for either provider. It also injects `extraArgs: []` for them, because `[]` is
truthy in the `buddyExtraArgs ? … : …` guard.

**c. The return type caused the bug.** `(...) => string[]` cannot express "this provider
needs an env var, not a flag" or "this provider has no MCP at all." So the author did the
only thing the type permitted: returned `[]`. Unsupported got silently mapped to a
plausible-looking value. **Fixing the type is the actual fix**; the naming is a symptom.

Also in that commit, and worth undoing:

- Two unrelated explanatory comments were deleted. Recover with
  `git show abb6696^:server/src/buddies/mcp-config.ts`. One explains why `cwd` resolves
  to the Unleashd dir rather than the buddy workspace (tsx availability). The other
  explains `required=true`: *"Buddy state tools are part of the employee contract.
  Failing the turn is more truthful than silently running without the promised
  controls."* That deleted comment states exactly the principle the commit then violated.
- Two `as any` casts in `runtime.ts`, unnecessary — `extraArgs` is on the generic
  `BaseExecuteCommandRequest` (`runtime-types.ts:57`).
- `String(executionConfig.provider).startsWith('gemini')` — dead. `Provider` is a closed
  enum in `shared/src/provider-catalog.ts`: `claude|codex|opencode|gemini|cursor|muse`.
  `cursor` is unhandled everywhere and silently yields `undefined`.

---

## 2. Verified facts

These cost the most to establish. **Do not re-guess them; do re-verify if a CLI updates.**

| Provider | MCP delivery | Evidence |
|---|---|---|
| **codex** | `-c mcp_servers.<n>.*` TOML fragments | Working in production today. The only path that actually functions. |
| **claude** | `--mcp-config <json-or-file>` | `claude --help`: `--mcp-config <configs...>`, `--strict-mcp-config` |
| **opencode** | `OPENCODE_CONFIG_CONTENT` env var, **no flag, no temp file** | Empirically confirmed — see below |
| **muse** | **none — no MCP surface at all** | `muse --help`, `muse exec --help` have zero MCP options; no `mcp` key in `~/.config/muse/settings.json` |
| **gemini** | **unverified** | Binary not installed on this machine (`~/.local/bin/gemini` missing). `abb6696` guessed `--mcp-config`. Do not ship the guess. |
| **cursor** | unverified / unhandled | — |

### opencode, confirmed empirically

```
$ OPENCODE_CONFIG_CONTENT='{"mcp":{"unleashd_buddy":{"type":"local","command":["echo","hi"],"enabled":true}}}' opencode mcp list
┌  MCP Servers
●  ✗ unleashd_buddy failed
│      MCP error -32000: Connection closed
│      echo hi
└  1 server(s)
```

opencode loaded the server and dialed it — it failed only because `echo hi` isn't an MCP
server. That is the expected, correct outcome. Related env vars in the binary:
`OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG_DIR`. `opencode mcp` is
also a full subcommand (`add`/`list`/`auth`/`debug`). **opencode has always supported
MCP** — the `return []` stub was never necessary.

Note opencode's schema differs from claude's: `command` is a single **array**
(binary + args), not split `command`/`args`.

### claude: do NOT pass `--strict-mcp-config`

`abb6696` did. It makes claude *ignore all other MCP configurations*, so a buddy
conversation would lose the workspace's own MCP servers. Codex's `-c` overlay is
additive. Encoders must be additive to match.

---

## 3. Target design

Encoding lives in the harness table; callers pass a canonical, provider-agnostic spec.

```ts
// agent-cli: src/types.ts
export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Fail the turn if the server cannot start, rather than running without it. */
  readonly required?: boolean;
}

export interface McpEncoding {
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

// on HarnessConfig, beside bypassFlags.
// ABSENT = this harness has NO MCP support (not "not wired up yet").
readonly mcp?: (servers: Readonly<Record<string, McpServerSpec>>) => McpEncoding;

// src/runtime-types.ts, on BaseExecuteCommandRequest beside extraArgs
mcpServers?: Readonly<Record<string, McpServerSpec>>;

// exported from the package index
export function harnessSupportsMcp(harness: HarnessName): boolean; // = !!getHarness(h).mcp
```

`McpEncoding` needs `env` and not just `args` because opencode has no flag. This is a
second reason the encoding belongs in agent-cli: **unleashd cannot implement the opencode
case from where it sits** — setting env at spawn time is agent-cli's job. That is
precisely why `buddyOpencodeMcpArgs` is a `return []`.

An absent `mcp` field is the honest, exhaustively-checkable encoding of "unsupported",
and `harnessSupportsMcp` lets callers decide up front rather than discovering tool-less
agents at runtime.

### unleashd shrinks to two functions

```ts
export const BUDDY_MCP_SERVER_NAME = 'unleashd_buddy';
export function resolveBuddyMcpLaunch(): BuddyMcpLaunch;
export function buddyMcpServers(ctx: BuddyContext, conversationId: string, launch?): Record<string, McpServerSpec>;
export function buddyBuilderMcpServers(conversationId: string, launch?): Record<string, McpServerSpec>;
```

Buddy vs builder is a real difference in the *spec* (context args vs `--builder
--conversation <id>`), so two functions is correct. Provider is a difference in
*encoding* and disappears from unleashd entirely. `runtime.ts` selects the spec by
conversation kind (2 cases, zero provider names), passes `mcpServers` in the request, and
both 5-branch if-ladders plus both `as any` casts delete themselves. Net: ~120 lines and
9 exports out of unleashd.

---

## 4. State of the work

### Done — uncommitted, in `vendor/agent-cli-tool` working tree

An attempted `.patch` backup was an RTK compact rendering rather than an
applicable diff and was removed during the 2026-08-22 cleanup. The live
submodule and its eventual commit are the only source of implementation truth.

- `src/types.ts` — `McpServerSpec`, `McpEncoding`, `HarnessConfig.mcp`,
  `BuildOptions.mcpServers`, and `CommandSpec.env`.
- `src/harnesses/codex.ts` — `codexMcpArgs` encoder with `tomlString`/`tomlStringArray`
  moved over from unleashd.
- `src/harnesses/claude.ts` — additive `--mcp-config` encoder without
  `--strict-mcp-config`.
- `src/harnesses/opencode.ts` — `OPENCODE_CONFIG_CONTENT` environment encoder.

### Not started

- `src/harnesses/{muse,gemini,cursor}.ts` — leave `mcp` absent, add a one-line comment
  each saying *why*, so a future reader doesn't read it as an oversight.
- `src/build.ts` — call `config.mcp` when `options.mcpServers` is non-empty; push
  `encoding.args` into argv before the prompt; return `encoding.env` on `CommandSpec`.
  Also fix the stale flag-ordering doc comment: it says `prompt → extraArgs`, the code
  does extraArgs then prompt.
- `src/execute.ts` — thread `request.mcpServers` into build options; **merge** `spec.env`
  over the inherited process env, don't replace it.
- `src/process-runner.ts` — merge `CommandSpec.env` over inherited process
  environment at the actual spawn boundary.
- `src/index.ts` — export the types + `harnessSupportsMcp`.
- Tests in agent-cli (see §6).
- **All of the unleashd side.** Zero of it landed.

### Landmines in the partial work

- `codex.ts` carries a comment claiming the output shape "is pinned by test/mcp.test.ts".
  **That test does not exist yet.** Either write it or drop the claim.
- The moved codex encoder emits `required=true` only `if (spec.required)`, whereas the
  original emitted it unconditionally. Output is identical *provided* the caller passes
  `required: true` — which `buddyMcpServers` must therefore do. Don't drop it.

---

## 5. Sequencing

`vendor/agent-cli-tool` is a **git submodule** wired as `workspace:*`, so local edits take
effect with no publish — but it's two commits in two repos, in this order:

1. Land + test the agent-cli side. Commit and push to `nbardy/agent-cli`.
2. Bump the submodule pointer in unleashd.
3. Only then delete the 9 functions from unleashd.

Deleting unleashd's codex encoder before agent-cli's is live breaks **the one provider
that currently works.** Don't invert this.

Heads-up: unleashd `main` moved three commits during the session that produced this note.
Rebase before starting.

---

## 6. Test plan

Behavioral tests only — no schema mirrors, no "the field exists" assertions.

**agent-cli:**
- Codex encoder output is **byte-identical** to unleashd's current `buddyCodexMcpArgs`
  for the same input. This is *the* regression guard for the move: codex is the only
  path working in production.
- Claude `--mcp-config` value round-trips through `JSON.parse` with the spec intact.
- opencode `OPENCODE_CONFIG_CONTENT` parses, and `command` is an array in
  binary-then-args order.
- `harnessSupportsMcp('muse') === false`, and building a muse command *with* `mcpServers`
  produces no args and no env — asserting the silent drop is visible and doesn't leak
  flags or crash.

**unleashd:** `server/test/buddy-mcp.test.ts` currently imports `buddyCodexMcpArgs` and
will not compile after the change. Rewrite against `buddyMcpServers` /
`buddyBuilderMcpServers`: the canonical spec carries the right
buddy/workspace/conversation args, `required` is set, the builder variant carries
`--builder`. The codex *flag-encoding* test moves to agent-cli — don't duplicate it.

---

## 7. Open decision: what should muse do?

Muse provably cannot host the buddy MCP server. So a muse buddy conversation is
guaranteed tool-less, and today it **silently pretends otherwise** — the failure that
prompted this note.

Two options:

1. **Fail the turn at spawn**, matching the `required=true` philosophy already stated in
   the (deleted) comment: *failing is more truthful than silently running without the
   promised controls.*
2. **Degrade explicitly** — run, but append a line to the buddy context header stating
   that `unleashd_buddy` MCP tools are unavailable on this provider and the agent must
   use the `buddies` CLI instead. Find the header builder by grepping
   `unleashd:buddy-context-v2`.

The session that produced this note leaned toward (2), on the grounds that hard-failing
breaks a workflow people are actively using — but this was **not confirmed with the repo
owner** and is the one genuinely open question here. Either way, the silent case must go.

The same question generalizes: `harnessSupportsMcp` should probably gate buddy
conversation *creation* in the UI, so a buddy can't be pointed at a provider that cannot
give it its tools in the first place.
