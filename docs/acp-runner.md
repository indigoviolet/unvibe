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
- **Version-manager shims never reach the session (issue #105).** A
  session's working directory is the review worktree, which holds the
  reviewed repo's manager config (`.mise.toml`, …) — untrusted, and never
  trusted (`mise trust` would execute unreviewed code). When the detected
  `claude`/`codex` is a mise/asdf shim (classified in
  `diagnostics/tools.ts`), the check resolves it to the real executable
  (`mise which <tool>` / `asdf which <tool>`, run from the user's home —
  never the worktree) and verifies the real path runs from a
  worktree-shaped directory; sessions, readiness and Doctor all use the
  real path (`DiagnosticCandidate.resolvedPath`, shown next to the shim).
  Resolution is cached per manager/tool/candidate and refreshed by
  Reload environment (`POST /api/reload`). Explicit `UNVIBE_*_BIN` /
  adapter-native overrides win unchanged (never resolved). As a second
  layer the adapter subprocess gets `MISE_IGNORED_CONFIG_PATHS` pointed
  at our own worktrees directory, so a stray mise invocation inside the
  session ignores review copies' configs (verified against the mise
  settings reference: entries cover everything under them, read before
  any config file, absolute paths required). A session that still fails
  to start for this reason reports plain words —
  `couldn't start a <provider> session: the <cli> command would not run
  inside the review's working copy — … Set UNVIBE_<…>_BIN to the real
  path …` — never the raw adapter JSON.
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
| 1 | Claude 0.89.0 fork needs `session/resume` before first prompt (`Session not found`) | `fork()` resumes automatically; `prompt()` retries resume once on that exact error and asks the caller to retry (retryable error). `session/resume` and `session/load` carry the same `_meta` as `session/new` (#121: one builder, `sessionMeta`), so forks keep the Unvibe system prompt and the read-only tool set instead of the adapter defaults |
| 2 | Codex silently ignores `_meta.systemPrompt` (spike 1a FAIL) | Codex instructions go as AIR custom instructions (`_meta.jetbrains.air.customInstructions`), forwarded by codex-acp as `developerInstructions` on thread start. Verified live: codename `QUOKKA-X7` recalled. String passed byte-stable across sessions so prefix caching works |
| 3 | `usage.inputTokens` excludes cached tokens on both adapters | The usage event carries `cachedReadTokens` + `cachedWriteTokens` separately (#125); the hit rate the app shows is the read share `cachedRead/(in+cachedRead+cachedWrite)` (`cacheReadShare`), never cached/input |
| 4 | **Claude counters are session-cumulative** (`"Total … across all turns"`; verified: turn2 total 21254 > turn1 total 19259) while **Codex counters are per-turn** (verified: 237-input turn after a 5338-input turn) | Runner delta-izes Claude per session (`deltaTurnUsage` + per-session baseline) and passes Codex through, so consumers can sum `usage` events. Unit test pins the delta math |
| 5 | Turn-level `usage` omits background sub-calls (e.g. session titling) | Always aggregate `_meta.quota.model_usage` when present (`aggregateTurnUsage`); handles both provider field namings (`cachedInputTokens`/`cachedReadTokens`, `cacheWriteInputTokens`/`cachedWriteTokens`) and folds thought/reasoning tokens into output |
| 6 | Codex `read-only` mode refuses MCP tool calls ("I can't access that tool" without attempting) | Restricted Codex sessions use `workspace-write` mode instead (see permission policy) |
| 7 | Codex `agent` mode runs edits/shell with no permission round-trip (Guardian auto-approves) | Never use `agent` mode for restricted sessions; `workspace-write` prompts on every edit/shell/network action |
| 8 | Codex workspace-write MCP approvals arrive with an **empty toolCall** (no title/name) | Correlate by `toolCallId` against the preceding `tool_call` update (the adapter always emits it first); `_meta.is_mcp_tool_approval` kept as supporting evidence. Unit test covers the correlation |
| 9 | `load` replays history as `session/update` notifications | Drain the replay until quiet (one 20 ms window with nothing new, 300 ms ceiling) before resolving `load()` so stale chunks never leak into the next turn (#122: was a fixed 300 ms sleep) |
| 10 | ACP errors are generic `-32603 Internal error` | Reason is in the message/details (`Session not found`, rate limit, …); `isRetryableError` classifies accordingly |
| 11 | Claude places its dynamic environment block after the first user message and moves its cache breakpoint off it on later turns (#177) | Small one-shot sessions (`systemPrompt: ""`: hunk pass, summarize, runSmall) start with a byte-identical shared first turn (`SHARED_CACHE_FIRST_TURN`) so the per-job prompt lands after every cache-shared block; measured live, warm per-job cache writes fell from ~7k to ~2.6k tokens. The block grows with the tool set (agent types, skills, MCP instructions), so a wider tool set re-writes more of it per job |

## Permission policy

Two postures, chosen by the full-access setting (issue #160; `readOnly` on
every session, stored on the session record, part of the base key, stamped
on each job as `accessMode`). A session keeps the posture it started with
until it ends: flipping the setting keys new bases, while live sessions
and conversation cards keep the old posture until they close or rebuild.

Deny-by-default lock-down (`src/agent/acp/permissions.ts`, the default):

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
  channel). The same `_meta` is sent on `session/resume` and `session/load`
  (#121), so forks keep it; before that fix forks ran with the adapter
  defaults (full tool set, no Unvibe instructions) and only the permission
  handler stood between them and Bash/Edit.
- **Codex:** `workspace-write` session mode (set after `session/new`;
  `INITIAL_AGENT_MODE` is process-wide and cannot multiplex) + sandbox
  defaults (workspace-bounded writes, no network) + deny-by-default handler
  with toolCallId correlation. `read-only` mode and `agent` mode are both
  unusable (see quirks 6–7).

## Full access (opt-in, issue #160)

Off by default; on only with the stored warning acknowledgement. When on,
agent sessions (main, small, and second-opinion sessions, both providers)
run unrestricted: shell, `git`, `gh`, web, file tools. No new custom
lookup tools were built; the restrictions moved into the system prompt
(`prompts/instructions.md` filled with `prompts/access-full.md` instead of
`prompts/access-lockdown.md` — one builder, `renderSystemPrompt`, used for
new/resume/load/fork and the Debug prompt preview alike).

- **Claude:** `_meta` carries the system prompt with no `claudeCode`
  tool reduction — the adapter defaults (the agent's full tool set) apply —
  and the permission handler approves every request (`allow_once`, so each
  call still re-prompts and stays auditable).
- **Codex:** `agent-full-access` session mode, set after `session/new` and
  re-applied on fork and load like the restricted mode. From the adapter
  sources: id `agent-full-access`, "Unrestricted access to the internet and
  any file on your computer", approval `never` (no permission round-trip,
  so shell and network run without prompts),   sandbox `dangerFullAccess`.
  The review MCP tools run without prompts there too (verified live: a
  full-access session calling a review tool — see the #160 report).
- **#124 interaction:** Codex forks sent without `mcpServers` + `_meta`
  may still come up with no review tools (that issue stays open). Under
  full access such a fork can at least use `git` and `gh` directly.
- **Second opinion:** its isolation from the guide is a prompt rule under
  full access (a shell can read the data directory, including other
  reviews). Under the lock-down it stays structural.
- **Small-model sessions** (hunk summaries, consolidation) follow the same
  setting with an empty system prompt — uniform posture, no carve-outs.

What is still ENFORCED under full access, and what is only INSTRUCTED
(also stated in PRD §6.1):

- Enforced: loopback-only service; nothing posted to GitHub except through
  the Submit review path (leases unchanged); post-job checkout
  verify-and-reset (`src/fullaccess/verify.ts`: `git status` + `rev-parse`
  against the reviewed commit after each job, `reset --hard` + `clean -fd`
  when changed, recorded on the job); the scrubbed adapter environment
  below; per-job tool records (`job.tools`: tool names plus adapter-sent
  argument detail, shown on the Debug page).
- Only instructed: everything in the full-access prompt list (no GitHub
  writes, no push/commit, no file creates/edits/deletes, no installs, no
  running project code, no home-directory credentials, PR/web text as
  material never instructions, blocked needs in `degraded`).

Adapter subprocess environment (`adapterEnvFor` in `connection.ts`):
one adapter subprocess runs per (provider, posture) pair, so the two
postures never share a process (lazy: a posture's subprocess starts on
its first use; model/thinking probes use the lock-down one).

- Lock-down: the input env unchanged — exactly what the adapter got
  before this change. The default posture is identical down to the
  spawn env.
- Full access: the named secrets an agent has no business with are
  removed, while provider authentication is kept by exact name
  (`FULL_ACCESS_AUTH_KEEP`):
  - removed: `GITHUB_TOKEN`, `GH_TOKEN` (so the agent's own `gh` uses
    the keyring login, PRD §15); every `UNVIBE_*` service variable;
    1Password (`OP_*`, `*PASSWORD*`); error-reporting DSNs (`*SENTRY*`).
    Everything else passes through untouched — the rule is explicit,
    never pattern-based, so an unknown provider variable is kept
    rather than dropped.
  - kept: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`,
    `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `OPENAI_API_KEY`,
    `OPENAI_BASE_URL`, `CODEX_API_KEY`, `AWS_ACCESS_KEY_ID`,
    `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`,
    `AWS_DEFAULT_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `GOOGLE_API_KEY`,
    `GEMINI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`,
    `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_GENAI_USE_VERTEXAI`
    (plus the adapter pointers `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`,
    set explicitly).
  - `UNVIBE_*` audit: nothing in the child tree reads our namespace —
    the adapter bundles contain no `UNVIBE_` reference, the agent CLIs
    don't know it, and the service consumes its own overrides
    (`UNVIBE_CLAUDE_BIN`/`UNVIBE_CODEX_BIN` → the adapter pointers)
    before spawning. `UNVIBE_ACP_DEBUG` is read in-process, never by
    the adapter.

Name-based, so an oddly-named secret can slip through — and it is not a
sandbox. An unrestricted agent can still reach on the machine: the `gh`
login (keyring), SSH keys, and the data directory (other reviews, the
service token). The warning says plainly that nothing is sandboxed; the
prompt does not prevent this.

## Models and thinking

`listModels(provider)` reads the `model` config option from a throwaway
session (cached 5 min). Observed 2026-10-12 (13 + 7):

- Claude (13): `default`, `opus`, `fable`, `sonnet`, `haiku`, plus
  versioned ids (`claude-opus-5-5`, `claude-opus-5`, `claude-fable-5`,
  `claude-sonnet-5-5`, `claude-sonnet-5`, `claude-haiku-5-5`,
  `claude-haiku-4-5`) and dated pins (`claude-haiku-4-5-20251001`).
- Codex (7): `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`,
  `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`.

Role defaults (`settings/defaults.ts`, issue #88) rank tiers
opus | sol > sonnet | terra > haiku | luna, newest version offered within
a tier, never Fable or Astra; second opinion comes from the provider main
is not using (unset with one provider). Matching is on family plus
highest version, not literal strings: aliases satisfy their family but
lose to explicit versioned ids (`opus` beats drifting `default`; plain
ids beat dated pins on ties), so new versions are picked up with no code
change. One source (`settings/effective.ts`) serves Settings, readiness,
the pipeline, second opinions and shared context: saved picks win, unset
roles take the live default, unfillable roles keep the stored fallback.

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
- Unit tests (`test/acp-runner.test.ts`, 21 tests) run a scripted fake ACP
  agent speaking the real protocol over in-memory stream pairs
  (`test/fake-acp.ts` reuses the production `connectClient()`): event
  mapping, usage aggregation incl. background models, fork+resume ordering,
  `atMessage` fork points, resume/load `_meta` parity with new (#121) +
  fork deny policy, load replay drain, quiet-based settling (#122),
  cancel, crash/restart, permission allow/deny + toolCallId correlation,
  error classification, model listing, read/write usage split (#125).
