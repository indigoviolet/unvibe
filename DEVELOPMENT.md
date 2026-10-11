# Development

Setup (Node 24 comes from `mise.toml`):

```sh
mise run install
mise run build
mise run dev        # service + Vite dev server together
```

The repo is npm workspaces (`packages/*`), TypeScript strict ESM. SQLite comes from the built-in `node:sqlite`, so installs need no compiler. Code must work on macOS and Linux: use `node:path`/`node:os`, never hard-code home dirs, no GNU-only flags.

## Tasks

Every task lives in `mise.toml`; run it as `mise run <task>`.

| Task | What it does | Needs |
|---|---|---|
| `install` | `npm install` across workspaces | — |
| `build` | Build shared → service → web | — |
| `dev` | Service + Vite dev server together | — |
| `dev:mock` | Web UI against the in-memory mock API, no service | — |
| `lint` / `typecheck` / `test` | ESLint / tsc / vitest across workspaces | — |
| `check` | `lint` + `typecheck` + `test`; must pass from a clean tree with no `dist/` | — |
| `start` | Run the built service | `build` first |
| `setup` / `doctor` | Build, then `unvibe setup` / `unvibe doctor` | — |
| `fixture-snapshot` | Rebuild `fixtures/urllib3-5020/snapshot.json`; fails on unverified citations | — |
| `test:e2e` | Playwright behaviour tests (mock UI + real service in demo mode) | `build` + browsers (`mise run playwright-install`) |
| `playwright-install` | Install the Playwright Chromium browser | — |
| `e2e` | Linux shell end-to-end (setup, handler, reuse, idle exit, uninstall, in temp HOME/port) | Linux |
| `e2e:macos` | macOS shell end-to-end (setup, helper app, handler, reuse, idle exit, uninstall, in temp HOME/port) | macOS |
| `check-global-install` | `release`, then install the tarball and the `#release` git ref into temp prefixes (npm 10 and 11, no flags) | npm 10 + 11 |
| `release` | Self-contained release tree + tarball + local `release` branch; no push | `build` first |
| `test:live` | Live adapter tests over real CLIs | `claude`/`codex` logins; small token spend |
| `test:live:pipeline` | Full pipeline on real agents | Logins; token spend |
| `test:live:second-opinion` | Second-opinion check with real agents | Logins; small spend |
| `test:live:installed` | Live sessions from the installed copy | Logins; tiny spend |
| `test:live:submit` | Submit path against a scratch repo (draft PR only) | Login; opt-in, writes a draft PR |

`test:live:*` never runs under `check` or CI. CI (`.github/workflows/ci.yml`)
runs on `ubuntu-latest` and `macos-latest`: `check` + `build` +
`test:e2e`, then the shell end-to-end (`e2e` on Linux, `e2e:macos` on
macOS), `check-global-install` (both), and
`node scripts/restart-resilience.mjs` (both). Diagrams render service-side
with the `d2` binary (`d2 = "0.9.0"` in `mise.toml`; `mise install d2`
fetches it via the aqua backend): unit tests pass without it, the
real-binary vitest suites and the Playwright D2 specs skip visibly, and
`node scripts/d2-seed-check.mjs` compares fresh renders against the
pre-rendered fixture SVGs byte for byte (`--strict` exits nonzero; it
skips visibly without `d2`). CI runs it strict on both platforms:
darwin/arm64 output proved byte-identical to the Linux-made seeds, which
is what makes content-hash addressing + immutable caching sound
cross-platform — a mismatch there would be a hash/cache design finding,
not something to paper over.

## CI organisation

- **Trigger:** branch pushes only (`push: branches: ["**"]`). There is no
  `pull_request` trigger on purpose: for a branch with an open PR both
  events fire for the same commit and the workflow would run twice.
- **Concurrency:** `ci-${{ github.ref }}` with `cancel-in-progress`, so a
  new push supersedes the previous run on the same branch.
- **Caches (safe):** the npm cache (`~/.npm`, keyed by
  `package-lock.json`) and the Playwright browsers
  (`~/.cache/ms-playwright`, keyed by OS + `@playwright/test` version).
  `mise run playwright-install` stays the installer; a cache hit makes it a
  fast no-op check.
- **Failure evidence:** Playwright keeps traces + screenshots on failure
  (`playwright.config.ts`), and the real-service specs tee the spawned
  services' output to `packages/web/test-results/service-logs/` (shared
  helper `packages/web/e2e/service-harness.ts`). The whole
  `test-results/` directory is uploaded as an artifact when the job fails
  (7-day retention).
- **Timeouts:** the job allows 60 minutes; each step has its own
  `timeout-minutes` (10–30) so a hung step fails loudly instead of burning
  the job budget.
- **No secrets, no network beyond npm:** tests run with
  `UNVIBE_AGENT=none`/`replay` and a stubbed `gh`; the harness strips
  `GITHUB_TOKEN` from spawned test services (PRD §15). Only npm-registry
  traffic (installs, `npx --yes npm@10`) is needed.

## Reproducing a CI failure locally

- **Vite never reachable (`Timed out ... from config.webServer`):** bare
  `vite` listens on `localhost`, which is resolution-order-dependent. Force
  the runner's order with
  `NODE_OPTIONS=--dns-result-order=ipv6first VITE_MOCK=1 npx vite --port 5999 --strictPort`
  and probe `http://127.0.0.1:5999/` (fails) vs `http://[::1]:5999/`
  (answers). The config pins `--host 127.0.0.1` so the bind is explicit;
  verify with the same probe after any webServer change.
- **Release fails with `Author identity unknown`:** runners have no git
  identity. Reproduce with `HOME=$(mktemp -d) GIT_CONFIG_NOSYSTEM=1 mise run release`
  (`scripts/release.mjs` falls back to `unvibe <unvibe@localhost>` only
  when nothing is configured).
- **Hover/popover flakes in Playwright:** `hoverFresh` (copied in the
  guide/interaction/journey specs) waits for fonts + scroll quiet and aims
  at the anchor's own line boxes until the cursor verifiably lands on it
  (union-box centers miss wrapped anchors). If a hover still misses, its
  error names the covering stack, `:hover` chain, scroll and viewport;
  download the `playwright-<os>-<attempt>` artifact and open the
  `trace.zip` (`npx playwright show-trace …`).
- **macOS-only paths on Linux:** `scripts/e2e-macos.mjs` exits 2 off
  macOS; `node --check` it and read it instead. The LaunchServices
  dispatch itself (`open "unvibe://start"`) needs a GUI session — see
  `docs/macos-testing.md` step 4 for what stays human-verified.

## Agent modes (`UNVIBE_AGENT`)

How `packages/service/src/agent/factory.ts` picks the runner:

- Unset (default): real agents. One subprocess per provider driving your installed `claude`/`codex` CLIs through your logins. Spends tokens.
- `replay`: recorded sessions over `fixtures/urllib3-5020/`. No tokens, no network. Use it for the demo and for any test that exercises agent behaviour. Recordings match by prompt markers, not by repo, so replay on a non-fixture repo still writes fixture content there; only use it on the fixture or in agent-behaviour specs.
- `none`: pipeline disabled. Reviews open as diff + metadata with no guide. Use it in real-service specs that do not test agent behaviour, so no background pipeline mutates the review mid-test.

## Tests

- Unit: vitest per workspace (`packages/*/test`, `*.test.ts(x)` next to the code). Prompt rendering has golden files (`prompt-goldens.test.ts`).
- Behaviour: Playwright specs in `packages/web/e2e/` run against mock mode and against the real built service in `replay` mode.
- Shell: `scripts/e2e-linux.mjs` (setup/handler/reuse/idle/uninstall with a temp HOME, data dir and port) and `scripts/restart-resilience.mjs` (SIGKILL mid-stage, restart, resume).
- Live: `scripts/live-*.mjs` plus `UNVIBE_LIVE=1` suites. Gated by env, excluded from `check` by design.

Rules:

- No real agents or GitHub outside `test:live:*`. Tests use the fake/replay `AgentRunner` and stub `gh`/`git` through the injectable command runner.
- Run `gh` with `GITHUB_TOKEN` unset (it can override the keyring login).
- Nothing is posted to GitHub except through `src/submit/` (crash-safe via in-flight leases in `src/submit/lease.ts`); `test/gh-writes.test.ts` enforces the boundary.
- E2E scripts take a temp port/HOME/data dir so parallel checkouts do not clash.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `UNVIBE_PORT` | `4517` | Service port. The installed web app is bound to its origin, so reinstall it after changing ports. |
| `UNVIBE_DATA_DIR` | `~/.local/share/unvibe` | SQLite DB (`unvibe.sqlite`), `token`, lock, `worktrees/<review-id>/`. |
| `UNVIBE_IDLE_MS` | `600000` | Idle exit after this long with no window/jobs; `<=0` disables. |
| `UNVIBE_AGENT` | live agents | `replay` / `none` (see above). |
| `UNVIBE_ACP_DEBUG` | — | `1` logs permission decisions, `2` full payloads (stderr). |
| `UNVIBE_CLAUDE_BIN` / `UNVIBE_CODEX_BIN` | login-shell PATH | Override the agent executable (else `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`). |
| `UNVIBE_REPO_ROOTS` | `~/src`, `~/dev`, … | `path.delimiter`-separated roots for checkout detection. |
| `UNVIBE_PROMPTS_DIR` | repo `prompts/` | Override prompt templates (tests, debugging). |
| `UNVIBE_LIVE` / `UNVIBE_LIVE_PROVIDERS` | — | `=1` enables live suites; providers `claude\|codex` (default both). |

Minimum agent versions are enforced in code (`src/exec/agent-bins.ts`): Codex ≥ 0.160.1, Claude Code ≥ 2.1.293. Readiness and doctor report the exact path, version, and login state each agent will run with.

## Releases

`mise run release` builds first, then `scripts/release.mjs` assembles `./release/`, packs `unvibe-<version>.tgz` at the repo root, and points the local orphan `release` branch at exactly that tree (one commit, no history). Nothing is pushed; `.github/workflows/release.yml` pushes on tag.

The release tree is self-contained: built service bundle (`packages/service/dist/index.js` plus bundled adapter entries `dist/adapters/`), the web build, `prompts/`, the demo fixture, `README.md`, `THIRD-PARTY-NOTICES.md`, and a generated dependency-lean `package.json` (runtime deps only, no workspaces, no lifecycle scripts). Users install it with no flags:

```sh
npm install -g github:indigoviolet/unvibe#release
```

Installing from the default branch is unsupported: it is the source tree, not an installable package. The release itself is not published yet (issue #8).

## Conventions

- ACP lives only in `packages/service/src/agent/acp/` (enforced by `eslint.config.mjs` `no-restricted-imports` plus `test/acp-isolation.test.ts`). Everything else uses the `AgentRunner` interface from `@unvibe/shared`.
- API types live in `packages/shared`. Service and web both import them; change the contract there first. `GET /api/jobs` and snapshot job lists omit `promptSnapshot` (fetch per job at `/api/jobs/:id/prompt`) to keep snapshots small.
- Work is tracked in GitHub issues at `indigoviolet/unvibe`. Each piece of work has an issue; name it in your report and in the merge commit (`Closes #N`); tick its checklist as items land; open a new issue for anything found but not fixed. Commit in small logical commits on your branch; do not push or merge.
- `docs/acceptance-audit.md` is the requirement-by-requirement verdict plus the open list; update it when behaviour changes.

## Debugging

- Data: look in the data dir (`unvibe.sqlite`, per-review folders, `worktrees/`). Point a scratch run at a temp dir with `UNVIBE_DATA_DIR` and a temp port with `UNVIBE_PORT`.
- Logs: the service logs to stderr (`Unvibe listening on …`, job errors, permission decisions with `UNVIBE_ACP_DEBUG=1`).
- A job's exact prompt: `GET /api/jobs/:id/prompt` (the Jobs view in Settings links it too), with tokens and cache-hit rate on `GET /api/jobs?review=:id`.
- Environment: `unvibe doctor` locally, `GET /api/readiness` in the app; both share `src/readiness/checks.ts`.
- Reproduce without tokens: `UNVIBE_AGENT=replay` for agent behaviour, `UNVIBE_AGENT=none` for everything else.
- Restart behaviour: `node scripts/restart-resilience.mjs` exercises SIGKILL mid-stage against the built service.

## Network and privacy enforcement

Data stays on the machine. The app's own code contacts nothing but `127.0.0.1`; only the user's tools that Unvibe spawns (`gh`, `git`, the `claude`/`codex` CLIs) reach the network, under the user's own logins. What enforces it:

- Browser: the service serves a strict `Content-Security-Policy` on the HTML shell (mirrored as a `<meta>` tag in `packages/web/public/start.html` for the offline page). A shared Playwright fixture fails the e2e suite on any non-local request, and a dedicated spec walks the front screen, a review, and settings asserting zero non-local requests and zero CSP violations.
- Service: the vitest setup makes non-loopback sockets fail suite-wide (`test/network-privacy.test.ts`); an end-to-end test boots the app, creates the demo review with the replay runner, and asserts no non-loopback attempt.
- Static: a guard test (`test/network-guards.test.ts`) finds no fetchable `http(s)://` URL to a non-local host in shipped web assets and no `fetch`/`http`/`net`/`tls`/`dns`/WebSocket-client use in `packages/service/src` outside the allowlist (loopback clients, the 127.0.0.1-only server, stdio adapters). A stale `dist/` is skipped, never scanned.
- Subprocesses: `test/subprocess-allowlist.test.ts` asserts the service spawns only `git`, `gh`, the login shell, the agent CLIs, and the `unvibe setup` helpers.
- Requests additionally require a loopback `Host` and loopback `Origin`/`Referer` (`src/security/host.ts`, DNS-rebinding defence behind the per-install token, checked on every HTTP and WebSocket route).
