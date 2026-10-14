# Running the ChatGPT-subscription agent through Pi instead of the Codex CLI (issue #171)

Spike branch `spike/pi-runner`, cut from `main` at `ec6818d` (v0.0.5). Harness, prototype and raw results: `spikes/pi-runner/`. Nothing here is in the product.

Date: 2026-10-14. Machine: Ubuntu 24.04, kernel 6.8, x86_64, Node 24.21. macOS was not run.

**Status: offline evaluation complete; the live run (section 8) waits for the owner's ChatGPT login.** Every claim below is marked *verified here* (run in this spike), *read in source* (read in the installed package code) or *read in docs*.

## 1. Recommendation

**Do not use `pi-acp`. If Unvibe wants Pi, embed it as a native runner (no ACP). Building it is optional, though: first try the cheap fix for #124 that this spike turned up (section 6), which may make Codex forks work as they are.**

1. **`pi-acp` (route 1) cannot carry Unvibe.** It accepts the `mcpServers` and throws them away (read in source, 0.0.34; its README says so too), and it declares no HTTP MCP support. It has no fork or resume, no way to pass a system prompt, and it runs Pi with Pi's default tools (read, bash, edit, write), which call no permission request. Usage is reported only as context occupancy. It has one maintainer.
2. **A native runner (route 2) does everything `AgentRunner` needs, and does it better than the Codex adapter.** It is a prototype here (`spikes/pi-runner/src/`, about 350 lines, no ACP). Pi's real ChatGPT-backend code ran against a fake backend on loopback, with the service's real `McpRegistry` over the bundled demo (verified here, 10 offline tests). It covers:
   - **System prompt and tools:** Unvibe's system prompt is sent as is, plus a `<cwd>` line Pi always appends, and no `AGENTS.md`/`CLAUDE.md` from the reviewed repo reaches the session. Unvibe picks the tool list: guarded `read` and `ls` plus the review tools. There is no shell, edit or write tool to refuse.
   - **Forks:** a fork comes up with the same tools and system prompt. Its request starts with the base's request byte for byte, and it reuses the base's prompt-cache key.
   - **Session lifecycle:** sessions resume after a restart from files on disk, cancellation takes effect at once, and usage arrives per request with cache reads split out (#125).
   - **Shipping:** it bundles with esbuild, as the ACP adapters do. The 14 MB bundle runs on its own, so users install no Pi package and run no install scripts.
3. **Whether to build it is a product choice, not a technical one.** For:
   - users do not need the Codex CLI;
   - read-only by construction;
   - #124 cannot occur;
   - Unvibe could offer "Sign in with ChatGPT" itself.

   Against:
   - **a fast-moving dependency:** 16 releases between 4 September and 12 October, a package rename in May, and three breaking changes in that window;
   - **network:** with the SDK, the service process itself talks to OpenAI;
   - **containment:** with the SDK, Pi's tools would run inside the service. That matters for the #160 full-access opt-in, where Pi has no sandbox at all.

   The decisions are listed in section 10.
4. **Codex with fresh sessions (route 3) works but is a step back.** It costs a full resend of the base pack per conversation. It also hits the same MCP-secret problem unless each fresh session gets its own secret, and today's no-fork fallback in `SessionManager` does not issue one.

Whether the subscription login works when driven by Unvibe, and what the prompt cache does live, are **not verified yet**. They need the owner's login (section 8).

## 2. What Pi is (verified here unless marked)

- **The package in the issue is stale.** `@mariozechner/pi-coding-agent` is deprecated at 0.73.1 (May 2026): "please use @earendil-works/pi-coding-agent instead". The current package is **`@earendil-works/pi-coding-agent` 1.2.0** (2026-10-12), repository `earendil-works/pi`.
  - Licence: MIT.
  - Maintainers on npm: badlogic, mitsuhiko and rwachtler; the org is Earendil Works.
  - GitHub: about 115k stars, 14.6k forks and 335 open issues; last push 2026-10-14.
  - 59 versions under the new name since 7 May 2026, and 16 releases between 4 September and 12 October. 1.0.0 shipped on 1 October.
  - Node ≥ 22.19.
- **Packages:**
  - `pi-ai`: providers and auth;
  - `pi-agent-core`: the agent loop;
  - `pi-coding-agent`: sessions, tools, SDK, CLI and RPC;
  - `pi-mcp`: a small MCP client of its own, not the official SDK;
  - `pi-tui`, `pi-codemode` and `pi-telemetry`: the last is contracts only, with no exporter (read in source).
- **ChatGPT subscription: two routes in Pi, both OAuth (read in source and docs).**
  - **`openai-codex`.** Pi's README calls it "OpenAI Codex (legacy)… Superseded by Sign in with ChatGPT".
    - Endpoint: the Codex backend `https://chatgpt.com/backend-api/codex/responses`, over WebSocket with SSE fallback.
    - Login: **the Codex CLI's public OAuth client ID**, with `originator: pi`. Browser callback on `localhost:1455`, or a device code.
    - Models: the Codex list (`gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, `gpt-5.6-sol/terra/luna`, `gpt-5.5`, `gpt-5.3-codex-spark`). It matches the 7 models `docs/acp-runner.md` lists for Codex, plus two.
    - Request headers seen at the fake backend: `originator: pi`, `user-agent: pi (linux …)`, `chatgpt-account-id`, `session-id`.
  - **`openai` with "Sign in with ChatGPT".**
    - Endpoint: OpenAI's Responses API (`api.openai.com/v1`), with the ChatGPT subscription paying.
    - Login: OpenAI's public-client flow with dynamic client registration; the agent registers as "Pi" with scope `chatgpt.tokens.use.direct`. Browser callback on `127.0.0.1:1455` or a pasted URL; no device code.
    - Models: OpenAI's model list.
  - **Credentials:** stored in `<agentDir>/auth.json` (mode 0600) and refreshed automatically under a file lock. The agent directory is `~/.pi/agent` unless `PI_CODING_AGENT_DIR` or the SDK's `agentDir` / `authPath` say otherwise. Unvibe can point it at its own data directory and never touch `~/.pi`.
  - **Programmatic login:** the SDK exposes `ModelRuntime.login(...)`, so Unvibe could run the sign-in from Settings.
- **Ways to drive it:**
  - interactive TUI;
  - print and JSON modes;
  - **RPC mode** (JSONL on stdin/stdout, one *active* session per process);
  - **the TypeScript SDK** (`createAgentSession`, any number of sessions in one process).
- **Tools** (all verified here, except "no sandbox" which is read in docs):
  - Built-ins: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
  - **No sandbox and no per-call approval:** "Pi can read, change, and execute files with the permissions of the account that started it, and it does not ask for approval before every tool call" (`docs/security.md`).
  - **`grep` and `find` download `rg`/`fd`** from GitHub releases when they are missing from `PATH`: the latest release, no checksum, into `<agentDir>/bin`. Interactive mode does this at startup. `PI_OFFLINE=1` or `--offline` stops it.
  - **Built-in MCP extension**, configured by `mcp.json` files, and **custom tools** in the SDK.
- **Prompt context (read in docs, verified here):**
  - By default Pi adds the reviewed repo's `AGENTS.md`/`CLAUDE.md` to the system prompt, without asking for project trust. That is an injection path.
  - The SDK's `ResourceLoader` replaces it all. The CLI has `--no-context-files`.
- **Phoning home (read in source):**
  - The CLI checks `pi.dev` for new versions (`PI_SKIP_VERSION_CHECK`) and sends "anonymous install/update reporting" by default (`enableInstallTelemetry`, `PI_TELEMETRY=0`).
  - It refreshes model catalogs (`PI_OFFLINE`).
  - SDK sessions configured as in the prototype did none of this: every `fetch()` went to loopback (verified here).
- **Prompt caching (read in source):**
  - The Codex route sends `prompt_cache_key = sessionId` and `store: false`.
  - It reports `cached_tokens` as cache reads, subtracts them from input, and reports cache writes when the API does.
  - **`cacheWarming` defaults to `"streaming"`.** That is extra one-token requests to keep a cache alive, priced by Pi's own estimate. The prototype turns it off. It would not fire for the Codex models anyway, since their catalog has no cache lifetime.

## 3. Route 1: Pi through `pi-acp`

`pi-acp` 0.0.34 (2026-09-24, MIT, one maintainer, 23 versions since December 2025, 733 stars, 87 open issues). It spawns `pi --mode rpc --no-themes` per session and bridges events.

| Check | Result |
|---|---|
| Review tools reach the agent | **No** (read in source): `mcpServers` is stored on the session object and never used. The README says "MCP servers are accepted … but not wired through to pi". It advertises `mcpCapabilities: { http: false, sse: false }`, and Unvibe's servers are HTTP |
| System prompt | **No** (read in source): fixed spawn arguments, no `_meta` handling. Pi's default coding-assistant prompt plus the repo's `AGENTS.md` |
| Tools / read-only | **No** (read in source): Pi's default tools, including `bash`, `edit` and `write`. The adapter's `requestPermission` is used only for extension dialogs, never for tool calls, so Unvibe's deny-by-default handler never sees them |
| Fork | **No** (read in source): capabilities are `loadSession`, `list` and `delete` only |
| Resume after restart | `session/load` through its own map file at `~/.pi/pi-acp/session-map.json` (read in source) |
| Usage with cache split | **No** (read in source): only `usage_update` with context occupancy |
| Streaming, cancel | Yes (read in source) |
| Processes | One `pi` process per session |
| Forks of the adapter | The issue mentions a fork claiming MCP auto-configuration. Not evaluated: it would still have no system prompt, tool control or fork |

Verdict: not usable without rewriting the adapter, at which point the native runner is less code.

## 4. Route 2: a native Pi runner (no ACP)

Prototype: `spikes/pi-runner/src/runner.ts` (`PiAgentRunner implements AgentRunner`) and `src/mcp-bridge.ts`. Tests: `spikes/pi-runner/test/`. It imports `@earendil-works/*` only; nothing under `@agentclientprotocol`.

### 4.1 How it maps onto `AgentRunner`

- **`start`:**
  - `createAgentSession` with a full-control `ResourceLoader`: Unvibe's system prompt and no context files, skills, extensions or templates.
  - `noTools: "builtin"`, then custom tools:
    - `read` and `ls`, whose file operations refuse any path that resolves (through symlinks) outside the session's `cwd`;
    - every tool of every MCP server in `mcpServers`, under its bare name (`get_hunk`, `get_code`, `search_review`, `resolve`, and `pin_context` for the reader).
  - In-memory settings: no compaction, Pi's retries off (Unvibe's queue owns retries), cache warming off, install telemetry off.
  - A persistent session file under Unvibe's `sessionDir`, plus a sidecar JSON with what Pi does not store: system prompt, MCP servers, model, cache key.
- **`fork`:**
  - `SessionManager.forkFrom(baseFile)` copies the history into a new session file, rebuilt with the same prompt and tools.
  - It sets `agent.sessionId` to the **base's** ID, so the provider's `prompt_cache_key` stays the base's (section 4.3).
  - It reuses the base's MCP connection in-process (section 6).
- **`load`:** reopens the session file, plus the sidecar. After a service restart the MCP secrets are dead (they live in the registry's memory), so the service hands out fresh ones through a `reissueMcp` hook. A failed `load` already makes `SessionManager` rebuild from the base.
- **`prompt`:** maps Pi events:
  - `text_delta` → `text`;
  - `tool_execution_start/end` → `tool`;
  - each assistant `message_end` → `usage` (per provider request: `input` already excludes cache reads and writes, `cacheRead` and `cacheWrite` are separate) and `error` when `stopReason` is `error`;
  - `agent_settled` → `done` (`cancelled` when aborted).
- **Cancellation:** the `AbortSignal` calls `session.abort()`.
- **Also:**
  - `listModels()`;
  - `loginStatus()` for Doctor;
  - `upstream: "openai-codex" | "openai"` picks the subscription route.

### 4.2 Checks, offline (verified here)

`spikes/pi-runner/test/runner.test.ts`:
- Pi's real `openai-codex` request code runs against `test/fake-codex.ts`, a loopback SSE server that records every request.
- The credential is a fake OAuth token in a scratch `auth.json`, the same file a real login writes.
- The review tools are the service's real `McpRegistry` over `fixtures/urllib3-5020/snapshot.json`, with the real `instructions` / `ask` templates and `buildBasePack`.

| Check | Result |
|---|---|
| System prompt | The request's `instructions` equals Unvibe's L0 plus `\n\n<cwd>\n<worktree path>\n</cwd>`. Pi always appends that section; it is stable per review, so it does not break caching. A planted `AGENTS.md` in the worktree does not appear anywhere in the request |
| Tool list | Exactly `get_code, get_hunk, ls, read, resolve, search_review` |
| Review tools used | A scripted `search_review` call goes through the bridge to the real registry. The registry's call count goes up and the demo's card IDs come back in the next request's `function_call_output`. `tool` start/end events stream |
| Read-only | `read inside.txt` works. `read ../outside.txt` and `read link-out.txt` (a symlink out of the worktree) are refused with "path is outside the review worktree". A `bash` call gets "Tool bash not found" |
| Fork | A fork's request has the base's `instructions` and `tools` byte for byte. Its `input` starts with the base request's `input`, and its `prompt_cache_key` is the base's session ID. Two forks of one base send identical bytes up to their own question. A fork can call the review tools |
| Fork without the key share | A fork with Pi's defaults gets `prompt_cache_key = <its own session id>` |
| Resume after restart | Dispose the runner, build a new one on the same directories, then `load(forkId)`. The next request carries the earlier turns, Unvibe's prompt, the base's cache key and all 6 tools |
| Usage | The `usage` event has `cachedReadTokens` from `input_tokens_details.cached_tokens`, `inputTokens` net of it, and `outputTokens`. There is one event per provider request, so a turn with a tool call gives two |
| Cancellation | `abort()` mid-stream ends the turn with `done: cancelled`. The whole test, including the stream start, took under 30 ms |
| Network | Every `fetch()` in the test process went to `127.0.0.1` (fake backend and MCP) |
| Bundling | `esbuild --bundle --platform=node --format=esm` (the service's adapter flags) plus a `createRequire` banner gives a 14 MB file that runs on its own: start, prompt and fork all worked against the fake backend (`test/bundle-smoke.mjs`). One change was needed: Pi loads OAuth flows through a variable `import()`, which a bundler cannot follow, so the runner calls Pi's own `registerBunOAuthFlows()` |

### 4.3 Prompt cache: what is known and what is not

- **Prefix: verified here.** Base and fork requests share `instructions`, `tools` and the leading `input` items byte for byte.
- **Routing key: verified here.** OpenAI's `prompt_cache_key` routes requests to the same cache. Pi sets it to the session ID, so a plain Pi fork would use a new key; the runner sets the base's instead.
- **Cache hits: not verified.** Whether the Codex backend hits the cache for those forks, and how much, needs the live run. #124 measured Codex forks through the CLI: 13k tokens read from cache and 20k uncached per Explain.

### 4.4 RPC instead of SDK (verified here, `test/rpc-smoke.test.ts`)

`pi --mode rpc` was run with `--system-prompt`, `--tools read,ls`, `--no-context-files --no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes` and `--offline`, against the same fake backend.
- **Works:** prompt, streaming events, usage with `cacheRead`, `get_session_stats` and `abort` (7 ms).
- **Prompt and repo context:** the system prompt is applied and no `AGENTS.md` leaks.
- **Per process:** **0.33 s to start, about 130 MB RSS**.
- **Fork and concurrency:** `clone` (Pi's fork) *replaces* the process's active session, and the clone gets a fresh cache key. RPC has no command to set it.
- **Review tools:** they would need an extension file (`-e`) that bridges to the MCP URL, or Pi's built-in MCP with a per-process `mcp.json`. Not built.
- **Cost:** Unvibe would run one process per concurrent session. The demo already fans out critics, concept pages and hunk summaries at once: about 1 to 2 GB at peak, against one process with the SDK.

**SDK over RPC**, unless containment wins (sections 5 and 10).

### 4.5 Install footprint

- **Scratch install:** `npm install --ignore-scripts @earendil-works/pi-coding-agent@1.2.0`.
  - 77 top-level packages and 155 MB of `node_modules`.
  - Pulls the Anthropic, OpenAI, Google GenAI, Mistral and AWS Bedrock SDKs, because `pi-ai` carries every provider.
- **Install scripts:**
  - `protobufjs` `postinstall`: prints a warning about version schemes, nothing else;
  - `@google/genai` `preinstall`: `echo`.
  - No `binding.gyp`, nothing to compile.
- **Native code:** `pi-tui` ships prebuilt `.node` files for the terminal UI (linux, darwin and win32; x64 and arm64). The runner does not load them; the bundle ran without them.
- **Shipped like the ACP adapters** (bundled into `dist/`): the release tree has no Pi dependency, so users install nothing, run no scripts and compile nothing.
  - **Cost:** about 14 MB in the release, unminified, against today's ~66 MB install.
  - **Import time:** about 0.8 s and about 90 MB RSS for the full SDK, against 0.1 s and about 25 MB for the ACP SDK (verified here). A narrower import surface or a lazy import on first use would trim this.

## 5. Read-only default, the #160 opt-in, and containment

- **Read-only (today's default):** guaranteed by construction. The session has no tool that can write, run or fetch.
  - There is no permission policy to keep in step with adapter quirks: nothing like the Codex `workspace-write` / empty `toolCall` handling in `docs/acp-runner.md` quirks 6 to 8.
  - Paths are confined to the worktree in Unvibe's own code.
- **Full access (#160):** means adding Pi's `bash`, `edit`, `write`, `grep` and `find`.
  - Pi has **no sandbox** and no approval step. Unvibe can still see every call before it runs, through Pi's `beforeToolCall` or the `tool_call` extension event (read in source and docs). That covers #160's "record of what the agent ran", and could block obvious things such as `gh pr comment`. But that is pattern matching on shell strings, not enforcement.
  - The #104 recommendation (nono) works by wrapping the agent **process**. **With the SDK there is no agent process to wrap:** `bash` would be a child of the service, and file edits would happen in the service itself.
  - So full access on Pi is either:
    - **(a)** RPC mode, with the Pi child run under nono like the CLIs;
    - **(b)** the SDK with `bash` replaced by Unvibe's own tool that spawns commands under nono, and no in-process `edit`/`write`;
    - **(c)** prompt-only, like #160 today.
- **Containment of the SDK route generally:** an agent misbehaving inside read-only tools can do little. But Pi's code shares the service's event loop and heap: a bug in Pi, a huge tool result or a stuck stream all happen inside the service. Today the CLIs are separate processes the service can kill. Pi catches tool errors and `abort()` works (verified here). A memory blow-up would still take the service down with it.
- **Network invariant:** `ARCHITECTURE.md` says the service process contacts nothing but loopback; only `gh`, `git` and the agent CLIs talk to the network.
  - With the SDK, **the service itself** would call `chatgpt.com` or `api.openai.com`, and `auth.openai.com` to refresh tokens.
  - The RPC route keeps the rule.

## 6. Side finding: the MCP mount refuses a second client on one secret (likely related to #124)

While wiring forks, a fork that opened its own MCP connection to the base's URL got **`400 Invalid Request: Server already initialized`**.
- **Not a Pi quirk:** the same happens with the official MCP SDK client (`test/mcp-secret.test.ts`, verified here).
- **Why:** `McpRegistry.issueSession` creates one stateful `StreamableHTTPServerTransport` per secret, and that accepts exactly one `initialize`.
- **Today's ACP runner:** `fork()`, `load()` and resume all pass the **base's** `mcpServers` (same URL, same secret) to the adapter.
  - Any adapter that opens a fresh MCP connection for the fork is refused.
  - The secret is known, so `noteUnknownHit` (the #51 detector) does not count it.
- **The consequence matches #124:** "no fork attempted a tool call; a base session in the same runs called the tools", and the Codex CLI does start a new thread, with its own MCP client, for a fork.
  - Not proven here. Proving it needs a live Codex run, and this spike may not use the owner's Codex login.
  - It also does not explain why #124 found Claude forks unaffected. Whether they reuse the base's connection was not checked.
- **`SessionManager.fallbackSession` has the same problem:** the no-fork path reuses `base.build.mcpServers`. Route 3 would hit it too, unless each fresh session gets its own secret. One path in `pipeline/runner.ts` already issues one.
- **Possible fixes:**
  - issue a new secret per session or fork, at the cost of an `AgentRunner.fork` signature change;
  - or let the registry accept a new `initialize` on a known secret by creating a new transport.
- Suggested as a new issue (not opened by this spike: the supervisor decides).

## 7. Route 3: fresh Codex sessions instead of forks

Read in source; not run.
- **How:** stop advertising `fork` for Codex in the ACP runner, so `SessionManager` falls back to `start` plus the base pack as the first message. PRD §6 already describes that fallback.
- **Cost:** each conversation resends the whole base pack, about 20k tokens on the demo.
  - Codex's own cache key is per thread, so the first turn of each fresh session is likely a cache miss, or a partial hit at best. That is the same problem #124 measured for forks.
  - Plus one extra model turn per conversation (the `ready` reply): a few seconds before the user's question starts.
- **Tools:** fresh sessions get the review tools only if each gets its own MCP secret (section 6).
- **Effort:** small (a per-provider capability flag plus a secret per fresh session).
- **What remains:** Unvibe's existing permission-policing layer stays as it is.

If section 6's fix gives Codex forks their tools back, route 3 is unnecessary.

## 8. Live run (pending the owner's login)

Prepared and not run: `spikes/pi-runner/test/live.test.ts`, skipped unless `UNVIBE_PI_LIVE=1`. On the bundled demo it runs five model turns:
- the base pack;
- an Explain fork and an Ask fork on the base's cache key;
- an Explain fork on its own key, to see whether sharing the key matters;
- one follow-up after a simulated restart.

It writes timings, usage per turn (input, cache read, cache write, output, request count), the review-tool calls and the start of each answer to `spikes/pi-runner/results/`. Answers are about the public demo only.

What it will settle:
- the subscription login used from the SDK, with the token stored in an Unvibe-chosen directory;
- which models the login offers;
- the review tools used live;
- the prompt cache live;
- time and tokens for Explain and Ask against today's numbers (`docs/latency-investigation.md` on `spike/latency`). Codex as shipped: Explain turn median 18.4 s with 13,056 cached and 19,972 uncached tokens; Ask 9.6 s.

## 9. What was verified and what was not

| Check | Route 1 `pi-acp` | Route 2 native (SDK) | Route 2 native (RPC) | Route 3 Codex fresh sessions |
|---|---|---|---|---|
| Subscription login driven by Unvibe | not verified | **pending live**; credential path verified with a fake token | pending live | works today (Codex CLI login) |
| Review tools reach the agent | **no** (read in source) | **yes** (verified, offline) | needs an extension; not built | only with a secret per session (section 6) |
| System prompt | no (read in source) | yes, plus a `<cwd>` suffix (verified) | yes (verified) | yes (today's AIR instructions) |
| Fork / base reuse | no | yes, byte-identical prefix, shared cache key (verified) | `clone`, fresh key (verified) | replaced by resending the base |
| Prompt cache live | n/a | **pending live** | pending live | likely miss on first turn (read in source) |
| Resume after restart | yes (read in source) | yes (verified) | `--session` (read in docs) | today's `load` |
| Streaming | yes (read in source) | yes (verified) | yes (verified) | yes |
| Usage with cache split (#125) | no (read in source) | yes (verified with fake usage) | yes (verified) | yes |
| Cancellation | yes (read in source) | yes, test < 30 ms (verified) | yes, 7 ms (verified) | yes |
| Read-only default | no (bash, edit, write live) | by construction (verified) | `--tools read,ls` (verified) | today's policy |
| #160 full access | n/a | no sandbox; tools in-process | no sandbox; could run under nono | Codex sandbox (did not start on this machine in #104) |
| Install without a compiler | needs Pi installed by the user | yes, bundled (verified) | bundled CLI (not built) | user's Codex CLI |
| Network from the service process | no | **yes** | no | no |
| Time and tokens on the demo | n/a | pending live | not planned | from #114 |
| macOS | not run | not run | not run | not run |

## 10. What the owner has to decide

1. **Is the fix in section 6 worth trying first?** It is small and may make Codex forks work as they are. It needs one live Codex check (#124's owner).
2. **Pi as a dependency:**
   - **Churn:** 16 releases in six weeks, a rename in May, three breaking changes in that window. Pin it and bundle it.
   - **The legacy route borrows the Codex CLI's OAuth client.** `openai-codex` signs in with that client ID and calls the Codex backend.
   - **The `openai` route is OpenAI's documented path for third-party agents,** but through Pi it registers as "Pi". Which route, if any, is acceptable to the owner is a terms question this spike cannot settle.
3. **SDK or RPC:**
   - **SDK:** one process, cheapest, simplest. It breaks "the service contacts only loopback", and full access cannot be sandboxed by wrapping a process.
   - **RPC:** keeps both, but means one process per concurrent session (about 130 MB each) and a bridge extension for the review tools.
4. **Login UX:** Unvibe could run "Sign in with ChatGPT" from Settings (the SDK's `ModelRuntime.login`), storing the token under Unvibe's data directory. Or the user runs Pi's `/login` once, with Unvibe pointing Pi at that directory. Doctor can read the login state either way (`loginStatus()`, or `pi auth check --provider openai-codex`).
5. **Live run:** authorize the owner's one-time login for section 8 (instructions below).

## 11. Outline of the build, if route 2 is adopted

1. Move the prototype to `packages/service/src/agent/pi/`, behind the factory as a third provider (`pi`, labelled "ChatGPT via Pi") next to `claude` and `codex`. No ACP import; extend the lint rule so `@earendil-works/*` is only imported there.
2. Bundle it into `dist/adapters/pi.js` (or into `dist/index.js`) like the adapters:
   - pin the exact version;
   - `registerBunOAuthFlows()`;
   - no runtime dependency in the release tree.
3. Its data lives under `~/.local/share/unvibe/pi/`:
   - `auth.json`, written by the Settings sign-in or by a documented `pi` command with `PI_CODING_AGENT_DIR`;
   - session files plus sidecars.
   - Doctor shows the login state and the models.
4. MCP:
   - forks share the base's connection in-process;
   - the service re-issues secrets on `load`. That needs a small change to the `AgentRunner` contract (pass `mcpServers` to `load`), or a runner-side hook as in the prototype.
5. Settings:
   - map `setModel` / `setThinking` to `session.setModel` / `setThinkingLevel`;
   - list models from `ModelRuntime`;
   - keep cache warming, compaction, Pi's retries and install telemetry off;
   - set `PI_OFFLINE=1` for the process.
6. Tests: the offline harness here becomes unit tests (fake backend, real registry). A `test:live:pi` task runs the five-turn live test.
7. Full access (#160) on this provider: not until the SDK-or-RPC decision. Until then the provider is read-only only.

## 12. Live-run instructions for the owner (not yet run)

The spike never logs in on the owner's behalf and never reads the credential. One login is needed, into a scratch directory that the spike deletes afterwards:

```sh
S=/tmp/unvibe-spike-pi-kET7Bj        # the spike's scratch prefix (Pi 1.2.0 is installed there)
mkdir -p "$S/owner-agent" && cd "$S" && \
PI_CODING_AGENT_DIR="$S/owner-agent" PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0 \
  node "$S/prefix/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" \
  --offline --no-session --no-context-files --no-extensions --no-mcp --no-skills
# inside Pi:  /login  → "OpenAI Codex" (ChatGPT Plus/Pro; device code works headless)
#   optionally also /login → "OpenAI" → "Sign in with ChatGPT" to try the newer route
#   then /quit
```

- **Where it is stored:** `$S/owner-agent/auth.json` (mode 0600) holds the OAuth access and refresh tokens. Nothing goes to `~/.pi`, `~/.codex` or `~/.config`.
- **Flags:** `--offline` stops the `fd`/`rg` download and the catalog refresh, not the login. `PI_TELEMETRY=0` turns off install reporting.
- **Removal:** the spike deletes `$S` at the end. The owner may also revoke the grant in ChatGPT's settings.

## 13. Installs, live runs and spend

- **Installed** (scratch only, all under `/tmp/unvibe-spike-pi-kET7Bj/`, `HOME` pointed at a scratch home):
  - `@earendil-works/pi-coding-agent@1.2.0`: tarball `https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-1.2.0.tgz`, integrity `sha512-h/4WaVWv1VlCaY8x8qEN5U+7jbF/e7+Ck6moPeEOFn5juMTWwNAXjwgYM7gRgbBYh8Zppwt6qWvJDzNTf4GNEQ==`, with its dependencies (77 top-level entries in `node_modules`), `--ignore-scripts`;
  - `pi-acp@0.0.34`, for reading only, never run.
  - `spikes/pi-runner/node_modules` is a git-ignored symlink to the scratch install.
- **Live runs:** none yet. Spend: zero.
