# ACP AgentRunner

Real `AgentRunner` over `@agentclientprotocol/sdk` (1.8.0) driving
`@agentclientprotocol/claude-agent-acp` (0.89.0) and
`@agentclientprotocol/codex-acp` (2.2.2) as stdio subprocesses.
Code lives in `packages/service/src/agent/acp/` — the ONLY place ACP may be
imported (enforced by `no-restricted-imports` in `eslint.config.mjs` plus
`packages/service/test/acp-isolation.test.ts`). Everything else uses the
`AgentRunner` interface from `@unvibe/shared` (factory:
`packages/service/src/agent/acp-runner.ts` → `createAcpRunner()`).

Service dependencies (so a global npm install brings the adapters along):

```json
"@agentclientprotocol/sdk": "1.8.0",
"@agentclientprotocol/claude-agent-acp": "0.89.0",
"@agentclientprotocol/codex-acp": "2.2.2"
```

## Configuration

- **User's installed CLIs via login-shell PATH (no bundled binaries).**
  Each adapter is pointed at the user's `claude`/`codex` through the
  mechanism it really supports (verified against the adapter sources in
  `node_modules`):
  - Claude (`claude-agent-acp` 0.89.0 → SDK 0.3.293): `CLAUDE_CODE_EXECUTABLE`
    env → SDK `pathToClaudeCodeExecutable` ("Path to the Claude Code
    executable. Uses the built-in executable if not specified.").
  - Codex (`codex-acp` 2.2.2 → `@openai/codex` 0.160.1): `CODEX_PATH` env →
    `codex app-server` (README: "Set CODEX_PATH only when you want the
    adapter to run a different Codex binary").
  The service resolves `PATH` from a login shell (`src/exec/shell-path.ts`,
  PRD §14 macOS gotcha) and sets both vars on the adapter subprocess env —
  never hard-coded install paths (works on macOS and Linux).
  Overrides for unusual installs: `UNVIBE_CLAUDE_BIN` / `UNVIBE_CODEX_BIN`
  (else the adapter-native vars when pre-set). `NO_BROWSER=1` is always set
  (safe: stored ChatGPT OAuth login is still used, no browser, no new
  credentials).
- **No agent platform binaries, bundled adapters.** The adapters
  (`@agentclientprotocol/claude-agent-acp` 0.89.0,
  `@agentclientprotocol/codex-acp` 2.2.2) are bundled as plain JS into the
  service build (`dist/adapters/claude.js`, `dist/adapters/codex.js`,
  spawned as stdio subprocesses as before) together with their JS
  dependencies (ACP SDK, Claude Agent SDK JS, zod, diff). Their
  `optionalDependencies` (`@openai/codex-<platform>` 427 MB,
  `@anthropic-ai/claude-agent-sdk-<platform>` 242 MB) are never installed:
  the release tree does not depend on `@openai/codex` or
  `@anthropic-ai/claude-agent-sdk` at all, and the adapter code paths that
  would resolve the bundled binaries are never reached (the service always
  sets `CLAUDE_CODE_EXECUTABLE`/`CODEX_PATH`, and throws a clear install
  hint when the user's CLI is missing). Source checkouts keep npm
  `overrides` (`stubs/empty-platform`) so dev installs stay lean. Final
  install ~66 MB (was ~736 MB). Minimum versions: Codex ≥ 0.160.1, Claude
  Code ≥ 2.1.293; readiness/doctor enforce them with update hints. MCP
  `server/discover` (newer CLIs) is answered with Method Not Found so the
  CLI falls back to `initialize`.
- **One subprocess per provider**, started lazily on first `start()` /
  `listModels()`, multiplexing all sessions for that provider. Crash: the
  transport drops, in-flight prompts fail as **retryable** errors, and the
  next call transparently restarts (sessions persist in the adapters, so
  prompts work right after a restart). `dispose()` kills both processes.
- **Client capabilities** advertise no filesystem and no terminal
  (`fs.read/writeTextFile: false`). `fs/*` and `terminal/create` requests
  from the agent are rejected outright.
- **Debug:** `UNVIBE_ACP_DEBUG=1` logs every permission decision to stderr;
  `=2` additionally logs full permission request payloads.

## Per-adapter quirks handled

| # | Quirk | Handling |
|---|---|---|
| 1 | Claude 0.89.0 fork needs `session/resume` before first prompt (`Session not found`) | `fork()` resumes automatically; `prompt()` retries resume once on that exact error and asks the caller to retry (retryable error) |
| 2 | Codex silently ignores `_meta.systemPrompt` (spike 1a FAIL) | Codex instructions go as AIR custom instructions (`_meta.jetbrains.air.customInstructions`), forwarded by codex-acp as `developerInstructions` on thread start. Verified live: codename `QUOKKA-X7` recalled. String passed byte-stable across sessions so prefix caching works |
| 3 | `usage.inputTokens` excludes cached tokens on both adapters | Never compute hit rate as cached/input; read share = `cachedRead/(in+cachedRead+cachedWrite)` (`cacheReadShare`) |
| 4 | **Claude counters are session-cumulative** (`"Total … across all turns"`; verified: turn2 total 21254 > turn1 total 19259) while **Codex counters are per-turn** (verified: 237-input turn after a 5338-input turn) | Runner delta-izes Claude per session (`deltaTurnUsage` + per-session baseline) and passes Codex through, so consumers can sum `usage` events. Unit test pins the delta math |
| 5 | Turn-level `usage` omits background sub-calls (e.g. session titling) | Always aggregate `_meta.quota.model_usage` when present (`aggregateTurnUsage`); handles both provider field namings (`cachedInputTokens`/`cachedReadTokens`, `cacheWriteInputTokens`/`cachedWriteTokens`) and folds thought/reasoning tokens into output |
| 6 | Codex `read-only` mode refuses MCP tool calls ("I can't access that tool" without attempting) | Restricted Codex sessions use `workspace-write` mode instead (see permission policy) |
| 7 | Codex `agent` mode runs edits/shell with no permission round-trip (Guardian auto-approves) | Never use `agent` mode for restricted sessions; `workspace-write` prompts on every edit/shell/network action |
| 8 | Codex workspace-write MCP approvals arrive with an **empty toolCall** (no title/name) | Correlate by `toolCallId` against the preceding `tool_call` update (the adapter always emits it first); `_meta.is_mcp_tool_approval` kept as supporting evidence. Unit test covers the correlation |
| 9 | `load` replays history as `session/update` notifications | Drain the replay (≈300 ms) before resolving `load()` so stale chunks never leak into the next turn |
| 10 | ACP errors are generic `-32603 Internal error` | Reason is in the message/details (`Session not found`, rate limit, …); `isRetryableError` classifies accordingly |

## Permission policy

Deny-by-default (`src/agent/acp/permissions.ts`):

- **Allow** (answering `allow_once`, never `allow_always`):
  - our MCP servers' tools — Claude spelling `mcp__<server>__<tool>`,
    Codex spelling `mcp.<server>.<tool>` (separator-normalized), or
    correlated by `toolCallId` when the approval is empty;
  - read-only file tools (`Read`, `Glob`, `Grep` and close variants).
- **Deny** everything else (edits, shell, network, subagents, terminals,
  other servers' MCP tools): prefer an explicit reject option, else answer
  `cancelled`. Codex MCP approvals that cannot be attributed to our servers
  are denied even with `is_mcp_tool_approval` set.

Tightest working configuration per adapter (proven by live tests):

- **Claude:** `_meta.systemPrompt` + `_meta.claudeCode.options.tools =
  ["Read","Glob","Grep"]` with dangerous tools in `disallowedTools`, default
  (Manual) permission mode, deny-by-default handler. MCP unaffected (separate
  channel).
- **Codex:** `workspace-write` session mode (set after `session/new`;
  `INITIAL_AGENT_MODE` is process-wide and cannot multiplex) + sandbox
  defaults (workspace-bounded writes, no network) + deny-by-default handler
  with toolCallId correlation. `read-only` mode and `agent` mode are both
  unusable (see quirks 6–7).

## Models and thinking

`listModels(provider)` reads the `model` config option from a throwaway
session (cached 5 min). Observed 2026-10-10:

- Claude (13): `default` (= Opus 5.5), `opus`, `fable`, `sonnet`, `haiku`,
  plus dated pins (`claude-opus-4-6` … `claude-fable-5`, …).
- Codex (7): `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`,
  `gpt-5.6-sol`, `gpt-5.6-terra` (default), `gpt-5.6-luna`.

`listThinking(provider)`: Claude `effort` (default `high`; `default/low/
medium/high/xhigh/max`), Codex `reasoning_effort` (default `medium`;
`low/medium/high/xhigh/max/ultra`). `setModel(session, id)` and
`setThinking(session, value)` map to `session/set_config_option`;
`setMode(session, modeId)` maps to `session/set_mode` (fallback: config
option `mode`). Model selection also runs at `start()`.

## Background noise (session titling)

Both adapters fire a background titling call after the first turn (Claude:
Haiku via `generateSessionTitle`; Codex: `gpt-5.6-luna` ephemeral thread,
 input capped at 4000 chars). There is **no supported disable flag** on
either adapter (Claude titles whenever the SDK offers generation; Codex
`TitleGenerator` runs for every new session without an explicit title, and
`_session/rename` is an AIR-index extension, not a general client API), so
it cannot be turned off. It IS counted: `aggregateTurnUsage` sums
`model_usage` across models (verified live — a `claude-haiku-5-5` entry
appeared in turn 2's `model_usage` while top-level `usage` only showed the
main model), and the per-model split is preserved in `TurnUsage.models`.
Cost is one small-model call per session — negligible next to review packs.

## Running the tests

```sh
mise run check      # lint + typecheck + unit tests (live tests excluded)
mise run build      # shared → service → web
mise run test:live  # live adapter tests (UNVIBE_LIVE=1)
```

`test:live` needs the `claude` and `codex` CLIs logged in on the machine
(work logins). Spend is small: a ~2k-token pack plus short prompts per
provider (~1 min for Claude, ~1 min for Codex; 12 tests total).

- `UNVIBE_LIVE_PROVIDERS=claude|codex` selects providers (default: both).
- Unit tests (`test/acp-runner.test.ts`, 14 tests) run a scripted fake ACP
  agent speaking the real protocol over in-memory stream pairs
  (`test/fake-acp.ts` reuses the production `connectClient()`): event
  mapping, usage aggregation incl. background models, fork+resume ordering,
  `atMessage` fork points, load replay drain, cancel, crash/restart,
  permission allow/deny + toolCallId correlation, error classification,
  model listing.
