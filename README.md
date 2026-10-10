# Unvibe

Unvibe is a reader for code changes (see `PRD.md`). It helps you understand
a branch or pull request — often one an agent wrote — dig into it with an
agent alongside, and turn what you learn into review comments. Everything
runs on your machine: a Node/TypeScript service on `127.0.0.1` plus a
React web app it serves. The UI follows `prototype.html` (look and
behaviour reference, not code).

## Install (users)

Requires Node 24+ (`node:sqlite` must work without flags), `git`, and —
for PRs and posting — `gh` logged in. Agents run through
your existing Claude Code / Codex logins; no new accounts.

```sh
npm install -g github:<org>/unvibe   # install or update (same command)
unvibe setup                          # per-install token + unvibe:// handler
unvibe open                           # start the service, open the app
```

> Known issue (npm 11, 2026-10-10): global installs from a **git URL**
> currently land as a dangling symlink when the package has a `prepare`
> script (reproducible with a trivial package — npm-side, see
> `docs/acceptance-audit.md` §14). Until that resolves, install from a
> release tarball instead:
>
> ```sh
> npm install -g https://github.com/<org>/unvibe/releases/download/<v>/unvibe-<v>.tgz
> ```
>
> Verified: ~2.3 MB tarball, ~736 MB installed on Linux (mostly the
> vendored Codex binary + dependency tree).

`unvibe setup` writes a small URL helper — `~/Applications/Unvibe.app`
(macOS, generated locally with `osacompile` so Gatekeeper stays out of the
way) or `~/.local/share/applications/unvibe-open.desktop` (Linux) — and
registers the `unvibe://` scheme. When the service isn't running, the
installed web app's offline page links to `unvibe://start`; the helper
starts the service and the page reloads. Nothing starts at login
(`unvibe setup --uninstall` removes the helper). The service exits after
10 minutes with no open window and no running jobs
(`UNVIBE_IDLE_MS`, `<=0` disables).

Useful commands: `unvibe start` (reuses the running service), `unvibe stop`,
`unvibe status`, `unvibe token` (print the token URL), `unvibe doctor`
(environment checks: node, `git`, `gh` + auth, `claude`, `codex`,
login-shell PATH, data dir, port).

## First run

1. `unvibe open` — the start page lists detected repos, your PRs
   (`gh search`), recent branches, and prior reviews.
2. Open a PR or branch — ingest takes seconds; the guide starts filling
   within about a minute (faster in the demo below).
3. Read the guide, hover citations (`<>`), open concept/finding pages,
   select text for Explain / Ask / Note, mark hunks reviewed, draft
   comments, mark them For PR, then **Submit review** — one GitHub review,
   only when you click it.

Branch without a PR? Everything works except Submit (disabled with a reason).

## Demo mode (no logins, no network)

```sh
UNVIBE_AGENT=replay unvibe start   # or: pick the demo review in the UI
```

Creating a review with `{ repoId: "demo" }` ingests the bundled
`fixtures/urllib3-5020/` fixture (real diff + description of
urllib3/urllib3#5020) and runs the full pipeline against recorded agent
sessions — the same code path as production, with citations, findings,
hunk summaries and second opinions. Used by the demo, the behaviour
tests, and the restart/global-install checks.

## Agent modes (`UNVIBE_AGENT`)

| Value | Behaviour |
|---|---|
| unset (default) | Real agents via ACP (`claude-agent-acp` / `codex-acp` subprocesses driving your `claude`/`codex` logins). Read-only permission policy; MCP tools served by the service. |
| `replay` | Recorded fixture sessions (demo + agent-behaviour tests). No tokens, no network. |
| `none` | Pipeline disabled: reviews open as diff + metadata with no guide. For tests/specs that don't exercise agents. |

Live adapter checks need logins and spend a little: `mise run test:live`
(~2k-token pack + short prompts per provider, ~1 min each),
`mise run test:live:pipeline`, `mise run test:live:second-opinion`,
`mise run test:live:submit` (draft PR on a scratch repo — opt-in only).
Never run by `check`.

## Configuration

Env vars:

| Var | Default | Meaning |
|---|---|---|
| `UNVIBE_PORT` | `4517` | Service port. Stable on purpose: the installed web app is bound to its origin, so reinstall it after changing ports. |
| `UNVIBE_DATA_DIR` | `~/.local/share/unvibe` | SQLite DB, worktrees, token, lock. |
| `UNVIBE_IDLE_MS` | `600000` | Idle exit after this long with no window/jobs; `<=0` disables. |
| `UNVIBE_AGENT` | ACP | `replay` / `none` / real (see above). |
| `UNVIBE_ACP_DEBUG` | — | `1` logs permission decisions, `2` full payloads. |

In-app Settings (persisted): models per role (main/small/second opinion),
prompt templates + per-review expansions, concurrency caps, inline budget
and base-rebuild thresholds; Jobs view (usage, cache-hit, exact prompt
per job); Shared context (contributions with delete).

## Data location and removal

- `~/.local/share/unvibe/` (or `UNVIBE_DATA_DIR`): `unvibe.sqlite`,
  `token`, `unvibe.lock`, `worktrees/<review-id>/` (managed worktrees,
  beside — never inside — your checkouts), review folders.
- Removing a review in the UI deletes its rows, its worktree (`git
  worktree remove` + `prune` in your repo) and its folders. Your checkout
  is otherwise never written to (`git status` stays clean).
- Full removal: `unvibe stop && unvibe setup --uninstall`, then
  `npm uninstall -g unvibe` and `rm -rf ~/.local/share/unvibe`.

A crashed-then-retried submit never double-posts: an in-flight lease is
reconciled against GitHub before posting again
(`packages/service/src/submit/lease.ts`).

## Troubleshooting (`unvibe doctor`)

`unvibe doctor` (and Settings → environment in the app) checks node, git,
`gh` (+ auth, with `GITHUB_TOKEN` unset per PRD §15), `claude`/`codex`,
the login-shell PATH (the macOS Finder-PATH gotcha), the data dir, and
the port — each with a fix hint. Common cases:

- `gh not logged in` → `gh auth login`; local branches
  still work without `gh`.
- `port … in use by something else` → set `UNVIBE_PORT` (and reinstall
  the web app, see above).
- Agent failures surface on the job/card with retryable errors and
  back-off; interrupted jobs after a restart are marked
  `interrupted: service restarted` and retried via Resume/retry.
- Refresh after a moved/deleted checkout names the missing directory.
- macOS: run through `docs/macos-testing.md` (15-minute checklist).
- Restart resilience is automated:
  `node scripts/restart-resilience.mjs` (SIGKILL mid-reader/mid-ask,
  restart, resume — all green).

## Development

```sh
mise run install    # npm install across workspaces
mise run build      # shared → service → web
mise run dev        # service + Vite dev server together
mise run start      # run the built service
mise run lint | mise run typecheck | mise run test
mise run check      # lint + typecheck + test (stays green; never needs dist)
mise run test:e2e   # Playwright: mock UI (60) + real service in demo mode
mise run e2e        # Linux shell e2e: setup, handler, reuse, idle, uninstall
mise run check-global-install   # tarball + git-URL global install into temp prefixes
node scripts/restart-resilience.mjs  # crash recovery against the built service
```

Tests never hit real GitHub or real agents (fake `AgentRunner`, stubbed
`gh`/`git` via the injectable command runner) except the `test:live:*`
tasks above. `mise run check` must pass from a clean tree with no `dist/`.
CI (`.github/workflows/ci.yml`) runs check + build + e2e on
`macos-latest` and `ubuntu-latest`.

## Network and privacy

Data stays on the machine (PRD §16). The only things that talk to the
outside are the user's own tools that Unvibe launches:

- `gh` (GitHub, with `GITHUB_TOKEN` unset) and `git` (fetching from the
  repo's remote);
- the coding-agent CLIs/adapters (provider calls, through the user's own
  Claude/Codex logins).

Unvibe's own code — the service process and the web app in the browser —
contacts nothing but `127.0.0.1`. Fonts are self-hosted (`@fontsource/*`,
latin subsets bundled by Vite), Mermaid is bundled (no CDN, no remote
fonts/styles at runtime), and links the user clicks to github.com are
navigations (marked `rel="noreferrer noopener"`), not subresource loads.

What enforces it:

- Browser: the service serves a strict `Content-Security-Policy` on the
  HTML shell (mirrored as a `<meta>` in `public/start.html` for the offline
  page); a shared Playwright fixture fails the whole e2e suite on any
  non-local request, plus a dedicated spec walks the front screen, a review
  with guide + diff + Mermaid diagram, and settings asserting zero
  non-local requests and zero CSP violations.
- Service: the vitest setup makes non-loopback sockets fail suite-wide
  (`net`/`tls`/`dns`/`fetch` wrapped); an end-to-end test boots the app,
  creates the demo review with the replay runner, runs actions, and asserts
  no non-loopback attempt.
- Static: a guard test finds no fetchable `http(s)://` URL to a non-local
  host in shipped web assets (`public/`, and `dist/` when freshly built —
  a stale `dist` is skipped, never scanned) and no
  `fetch`/`http`/`https`/`net`/`tls`/`dgram`/`dns`/WebSocket-client use in
  `packages/service/src` outside the allowlist in the test (loopback
  clients, the 127.0.0.1-only server, ACP stdio adapters).
- Subprocesses: a guard test asserts the service spawns only `git`, `gh`,
  the login shell, the agent adapters/CLIs, and the `unvibe setup` helpers
  (`osacompile`, `lsregister`, `xdg-mime`, `open`/`xdg-open`).
- Requests additionally require a loopback `Host` and loopback
  `Origin`/`Referer` (DNS-rebinding / cross-site defense in depth behind
  the per-install token).

Installing/updating (`npm install -g`) naturally uses the network.

## Architecture pointers

- `packages/shared` — entities (PRD §7.1), ID grammar (§7.2), link-token
  parsing (§10), API + WS contract (§14.1), `AgentRunner` (§6). No Node/DOM APIs.
- `packages/service` — Fastify on 127.0.0.1, per-install token, route
  modules (one per area), `node:sqlite` store + migrations, injectable
  `CommandRunner` + `gh` wrapper, replay/fake runners, job queue with
  restart recovery, sessions with idle close + `load` reopen, context
  builder + shared-context log, citation validator, MCP server with
  per-session secrets, pipelines (reader → base → forks → hunk pass +
  on-demand actions + update pass), submit with crash-safe leases.
  ACP lives ONLY in `src/agent/acp/` (lint + test enforced); everything
  else uses the `AgentRunner` interface.
- `packages/web` — Vite + React shell (prototype CSS class/variable names kept),
  routes `/`, `/review/:id`, `/settings`, typed API/WS clients, zustand snapshot
  store updated by snapshot + state patches.
- `prompts/` — prompt templates (PRD §13; deterministic rendering, golden
  tests).
- App shell (PRD §14): `packages/service/src/cli/` (`unvibe` commands,
  single-instance lock, macOS/Linux `unvibe://` setup, doctor),
  `packages/service/src/lifecycle/` (idle exit + shutdown hooks),
  `packages/web/public/` (manifest, icons, service worker, offline
  start page). The service ships as an esbuild bundle
  (`packages/service/dist/index.js`, `@unvibe/shared` inlined) so
  `npm install -g` works from a tarball; registry deps live in the root
  `dependencies` — keep them in sync with `packages/service/package.json`.
- Start with `docs/acceptance-audit.md` (requirement-by-requirement
  verdicts + open list), then `docs/pipeline.md` (the agent seam),
  `docs/acp-runner.md` (adapters + permission policy),
  `docs/reply-format.md` (normative agent reply format),
  `docs/live-pipeline-results.md` (measured numbers).
