# Pi runner (issue #279, route 2)

A second `AgentRunner` (`packages/service/src/agent/pi/`) driving the
user's own `pi` binary as `pi --mode rpc` — one child process per Unvibe
session. It runs every model the user's pi offers, from any provider
(OpenAI/Codex subscriptions, `meta/*` and the rest), when `pi` is
installed. Nothing in the product depends on pi: no package dependency,
no install script, no compiler. The service stays loopback-only; only the
pi child (under the user's own login) reaches the network.

## Why a separate process

Owner decisions (from #171, binding): no pi dependency by default
(detected on PATH, offered only then); login is pi's business (Unvibe
uses whatever login the user's pi has and never logs in); RPC mode, not
the SDK inside the service — so the service never talks to the network
itself and full access (#160) stays sandboxable.

## The extension mechanism

RPC has no command to register Unvibe's per-session MCP servers, and pi's
built-in MCP (`mcp.json`, `registerMcpServer`) would name them
`mcp__<server>__<tool>` while Unvibe's prompts call the bare names
(`get_hunk`, …) — and would also connect the user's own `mcp.json`
servers. So the runner ships a small extension and loads it with
`pi --mode rpc -e <file>`:

- Source: `packages/service/src/agent/pi/extension.ts` (plain JavaScript,
  `node:` builtins + `fetch` only). It is bundled into `dist/index.js` as
  a string and written to `<dataDir>/pi-sessions/unvibe-extension/` at
  runtime — no new build output, no release-tree entry, nothing to compile
  (pi runs the `.js` directly; jiti is not involved).
- Per pi process it reads `UNVIBE_PI_MCP_SERVERS` (this session's MCP
  mount URLs, per-session secrets on the loopback mount) and bridges each
  server over streamable HTTP (`initialize` → `tools/list` → `tools/call`),
  registering every offered tool under its bare name as a `direct` tool.
  The runner names the same tools in `--tools` (with `read,ls`), because a
  `--tools` allowlist filters out late-registered extension tools.
- RPC runs with `--no-mcp` (user servers can never connect) and
  `--no-context-files --no-extensions --no-skills --no-prompt-templates
  --no-themes` (only `-e` loads), so the session carries exactly Unvibe's
  prompt (pi appends its stable `<cwd>` section) and Unvibe's tools.
- Read-only posture (`UNVIBE_PI_READONLY=1`, the default): the extension
  replaces pi's built-in `read` and `ls` (same names take over) with
  versions that resolve symlinks and refuse anything outside
  `UNVIBE_PI_CWD`. No shell, edit, write, grep or find exists in the
  session. Verified against real pi 1.4.0 offline: `../outside.txt` and a
  symlink escape are refused, inside reads work.
- Forks reuse the base's prompt-cache key: pi keys `prompt_cache_key` by
  session id, so a fork (`--fork <base file>`, new id) would miss the base
  cache. When `UNVIBE_PI_CACHE_KEY` is set (forks only), the extension's
  `before_provider_request` hook rewrites the key on the outgoing payload.
  Verified offline: the fork's request carries the base's key (the spike's
  91% cached vs 0% on its own key).

Resume uses CLI `--session <full session file>` (a bare id does not
resolve). The runner keeps a sidecar per Unvibe session id with the file,
servers, posture, effort and cache key; a `load` whose file is gone, or
whose MCP secrets died in a restart (probed up front), throws so the
session manager rebuilds from the base instead of running tool-less.

## Full access (#160) on this route

- Read-only (default): `--tools read,ls` + the review tools, with the
  extension's guarded `read`/`ls`. Nothing to approve or deny.
- Full access: `--tools read,bash,edit,write,grep,find,ls` + the review
  tools, pi's own tools unrestricted in the review worktree. Pi has no
  sandbox and no per-call approval, so the limits live only in the system
  prompt — the same posture as Codex's `agent-full-access` mode.
- It stays sandboxable because pi is a separate child process: it spawns
  with a scrubbed environment (same denylist as the ACP adapters — no
  `GITHUB_TOKEN`/`GH_TOKEN`, no `UNVIBE_*`, no `OP_*`/`*PASSWORD*`, no
  Sentry DSNs; provider-auth variables are kept so the login works), and
  the boundary is a process a future change can wrap without touching the
  service. The service process itself still contacts nothing but loopback.

## Settings, Doctor, models

- `GET /api/providers` lists `claude,codex` plus `pi` only when the `pi`
  binary is detected (`UNVIBE_PI_BIN` or login-shell PATH). For pi, the
  Settings model pickers list every model pi's `get_available_models`
  offers, whatever its provider (an id offered twice is listed once,
  `openai-codex` winning); each starts on the provider pi names for it; effort comes from pi's
  `get_available_thinking_levels`. Claude and Codex are unchanged (pi never
  becomes a live default).
- Readiness has a `pi` check (installed + logged in, in plain words) plus
  per-role checks when a role picks pi; Doctor shows the `pi` tool row and
  the readiness checks. Login is probed through pi's own
  `auth check --provider <openai-codex|openai> --json` — `~/.pi` is never
  read.

## Tests

- `service/test/pi-runner.test.ts`: the fake pi RPC process
  (`service/test/fake-pi.mjs`, plain Node, no deps) drives the runner:
  streaming, tool calls through a real MCP mount, fork cache-key passing,
  resume after restart, cancel, usage split, both tool lists, dead-secret
  load failure, model/effort listings, login probes.
- `web/e2e/journeys/j279-pi.spec.ts`: real service with the fake pi on
  PATH (replay mode over the fixture recordings) — providers list,
  Settings pickers, a demo review run, Doctor rows; plus the no-pi case.
- Live: `service/test/pi-live.test.ts` via `mise run test:live:pi`
  (gated on `UNVIBE_PI_LIVE=1`, owner's go + $0.50 cap). Four short turns
  on the owner's login: base, fork with a review-tool call, resume after
  restart, usage + cost report. Expected < $0.05 at list price
  (gpt-6.1-sol: input $2, cached read $0.1, cached write $2.5, output $10
  per M). Not run by agents; never under `check`/CI.
