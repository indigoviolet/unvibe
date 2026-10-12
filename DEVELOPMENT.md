# Development

Setup (Node 24 comes from `mise.toml`):

```sh
mise run install
mise run build
mise run dev        # service + Vite dev server together
```

Secrets (Sentry DSNs, Axiom) come from a 1Password Environment, never from files in the repo. `.env` (gitignored, loaded by `mise.toml`) holds only `OP_SERVICE_ACCOUNT_TOKEN` and `OP_ENVIRONMENT_ID`; `mise run op -- <cmd>` runs `<cmd>` under `op run --environment`. `dev`, `dev:mock`, `build` and `start` go through it; tests, `check` and the `test:live:*` tasks do not. With no `.env` (CI, a fresh clone) the wrapper runs the command without secrets. Never print secret values. `paseo.json` copies `.env` into new Paseo worktrees.

### Sentry (dev only)

Errors go to Sentry when the DSNs are in the env, which in practice means under `mise run op`; with no DSN nothing loads and nothing is sent.

- **Service** (`SENTRY_DSN_SERVICE`, `packages/service/src/telemetry/sentry.ts`): uncaught exceptions and unhandled rejections (both still end the process, as they do without Sentry), route faults (5xx, not 4xx replies) and jobs that end in `error`. Applies to `mise run dev` and `mise run start`. Other code reports through `reportError(err, extra)`, a no-op when Sentry is off.
- **Web** (`SENTRY_DSN_REACT`, `packages/web/src/sentry.ts`): uncaught errors and unhandled rejections, in the Vite dev server only (`mise run dev`, `mise run dev:mock`). `vite build` defines the DSN as `""`, so the built app served by the service does not report.
- `SENTRY_ENVIRONMENT` overrides the service's environment tag (default `development`).

Neither SDK ships: both are devDependencies, `@sentry/node` is external to the service bundle and imported only when the DSN is set, and `@sentry/react` never enters the web build (`network-guards.test.ts` fails if it does). Releases keep the PRD §16 privacy guarantee.

The repo is npm workspaces (`packages/*`), TypeScript strict ESM. SQLite comes from the built-in `node:sqlite`, so installs need no compiler. Code must work on macOS and Linux: use `node:path`/`node:os`, never hard-code home dirs, no GNU-only flags.

## Tasks

Every task lives in `mise.toml`; run it as `mise run <task>`.

| Task | What it does | Needs |
|---|---|---|
| `install` | `npm install` across workspaces | — |
| `op -- <cmd>` | Run `<cmd>` with the 1Password Environment secrets (hidden helper) | `.env`, else runs without secrets |
| `build` | Build shared → service → web (tracked outputs: each `packages/*/dist` + entry files, so a missing `dist/` rebuilds) | — |
| `dev` | Service + Vite dev server together | `build` (auto) |
| `dev:mock` | Web UI against the in-memory mock API, no service | — |
| `lint` / `typecheck` / `test` | ESLint / tsc / vitest across workspaces | — |
| `check` | `lint` + `typecheck` + `test`; must pass from a clean tree with no `dist/` | — |
| `start` | Run the built service | `build` (auto) |
| `setup` / `doctor` | Build, then `unvibe setup` / `unvibe doctor` | — |
| `fixture-snapshot` | Rebuild `fixtures/urllib3-5020/snapshot.json`; fails on unverified citations | — |
| `test:e2e` | Playwright behaviour tests (mock UI + real service in demo mode) | `build` (auto) + browsers (`mise run playwright-install`) |
| `playwright-install` | Install the Playwright Chromium browser | — |
| `e2e` | Linux shell end-to-end (setup, handler, reuse, idle exit, uninstall, in temp HOME/port) | Linux |
| `e2e:macos` | macOS shell end-to-end (setup, helper app, handler, reuse, idle exit, uninstall, in temp HOME/port) | macOS |
| `check-global-install` | `release`, then install the tarball and the `#release` git ref into temp prefixes (npm 10 and 11, no flags) | npm 10 + 11 |
| `release` | Self-contained release tree + tarball + local `release` branch; no push | `build` first |
| `preview:publish [-- <branch>] [--push]` | Publish a branch as an installable `preview/<slug>` ref (builds; pushes only with `--push`) | — |
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
| `UNVIBE_DATA_DIR` | `~/.local/share/unvibe` | SQLite DB (`unvibe.db`), `token`, lock, `worktrees/<review-id>/`. |
| `UNVIBE_IDLE_MS` | `600000` | Idle exit after this long with no window/jobs; `<=0` disables. |
| `UNVIBE_AGENT` | live agents | `replay` / `none` (see above). |
| `UNVIBE_ACP_DEBUG` | — | `1` logs permission decisions, `2` full payloads (stderr). |
| `UNVIBE_CLAUDE_BIN` / `UNVIBE_CODEX_BIN` | login-shell PATH | Override the agent executable (else `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`). |
| `UNVIBE_REPO_ROOTS` | `~/src`, `~/dev`, … | `path.delimiter`-separated roots for checkout detection. |
| `UNVIBE_PROMPTS_DIR` | repo `prompts/` | Override prompt templates (tests, debugging). |
| `UNVIBE_LIVE` / `UNVIBE_LIVE_PROVIDERS` | — | `=1` enables live suites; providers `claude\|codex` (default both). |
| `UNVIBE_UPDATER_BACKEND` | live (not wired) | `fake` selects the test-only update backend: channels from `<dataDir>/update/fake-channels.json` (else a built-in seed), installed ref in `<dataDir>/update/current-ref`. Never touches npm, git or the network. |
| `UNVIBE_UPDATE_FAKE_FAIL` | — | Fake failure injection for switch drills: `install:<ref>` (install throws) or `health:<ref>` (install "succeeds" without advancing, so the new build never reports the target version). Test-only. |
| `UNVIBE_UPDATE_EXIT_WAIT_MS` / `UNVIBE_UPDATE_HEALTH_TIMEOUT_MS` / `UNVIBE_UPDATE_POLL_MS` / `UNVIBE_UPDATE_STOP_WAIT_MS` | `30000` / `120000` / `500` / `10000` | Detached-helper timeout overrides. Test-only. |

Minimum agent versions are enforced in code (`src/exec/agent-bins.ts`): Codex ≥ 0.160.1, Claude Code ≥ 2.1.293. Readiness and doctor report the exact path, version, and login state each agent will run with.

## Releases

### How to cut a release

Finals go through `mise run release:tag` (see `scripts/release-tag.mjs`):

```sh
git checkout main && git pull
mise run release:tag -- 0.0.1   # checks clean tree, on main, CI green for HEAD
git push origin main v0.0.1      # the tag push triggers .github/workflows/release.yml
```

The script bumps the version everywhere it lives (root + workspace
`package.json`s, the `@unvibe/shared` cross-dep, `SERVICE_VERSION`,
`MCP_SERVICE_VERSION`, `package-lock.json`), commits the bump, and creates
tag `v<version>`. Candidates need no bump — tag the candidate commit
directly (`git tag v0.0.1-rc.1 && git push origin v0.0.1-rc.1`); the workflow
takes the version from the tag and patches the built bundle, so the source
can stay at the base version.

Tag → branch → install command:

| Tag | Version | Branch (pushed) | Pre-release | Install |
|---|---|---|---|---|
| `v0.0.1` | `0.0.1` | `release` | no | `npm install -g github:indigoviolet/unvibe#release` |
| `v0.0.1-rc.1` | `0.0.1-rc.1` | `release-rc` | yes | `npm install -g github:indigoviolet/unvibe#release-rc` |

Candidates never overwrite the `release` ref users install from.

### What the workflow does

`.github/workflows/release.yml` runs on tag pushes (`v*`), on Ubuntu and
macOS: `mise run install`, `mise run check` (before the build, from a clean
tree — same order as CI), derive version/branch from the tag, `mise run
release` (build + `scripts/release.mjs`: release tree, `unvibe-<version>.tgz`
at the root with stale tarballs removed first, local orphan branch via
`update-ref`), then `node scripts/global-install-check.mjs` against the
pushed ref (tarball + git ref on npm 11 and 10, no flags, doctor/start/demo
from the installed copy, `--version` must match the package). Only Ubuntu
then force-pushes the release branch (an orphan with one commit, so every
publish is non-fast-forward by design — force is confined to these refs),
writes notes with `scripts/release-notes.mjs` (commits since the previous
tag, or a fixed text for the first release), and attaches the tarball to the
GitHub release (`softprops/action-gh-release`, `prerelease: true` for
`-rc.` tags).

### Private-repo install story

The repo is private. The git-ref install needs git credentials with access
(`gh auth login`, then `gh auth setup-git` so git uses `gh` as credential
helper). The tarball asset is private too: a bare
`https://github.com/…/releases/download/…` URL 404s without authentication.
Download it first, then install the file:

```sh
gh release download v0.0.1 -p 'unvibe-*.tgz'
npm install -g ./unvibe-0.0.1.tgz
```

### How to roll back a bad release

The `release` branch is one orphan commit pointing at a tree; moving it back
is a ref update, and the GitHub release + tag are deleted and re-cut:

```sh
# Point release back at the previous good tree (from the workflow's commit list,
# or rebuild it locally with `mise run release` on the good source commit).
git push --force origin <good-release-sha>:refs/heads/release
gh release delete v0.0.1 --repo indigoviolet/unvibe --yes
git push origin :refs/tags/v0.0.1 && git tag -d v0.0.1
# Fix forward on main, then re-tag when CI is green.
```

Deleting a candidate keeps the same shape (`release-rc`, `v0.0.1-rc.N`).

### Preview builds (issue #36)

Every in-flight branch is publishable as an installable build, so a
second machine (one that only has the global install) can test it without
a tagged release.

On the dev box, from the branch's worktree:

```sh
mise run preview:publish                  # this checkout's branch, no push
mise run preview:publish -- feat/other    # another branch's worktree (must exist)
mise run preview:publish -- --push        # also push preview/<slug> (opt-in)
```

What it does (`scripts/preview-publish.mjs`, pure helpers in
`scripts/preview-lib.mjs`): resolves the target worktree (`git worktree
list --porcelain`, fails clearly when the branch has none), refuses a
dirty tree (so the build always corresponds to a commit), builds there,
then runs that worktree's own `scripts/release.mjs` with
`--version <base>-preview.<slug>.<shortsha>` (base = package.json, slug =
branch made safe for semver + ref segments, e.g.
`feat/repo-add-by-url` → `feat-repo-add-by-url`) and
`--branch preview/<slug>`. The generated package.json records an `unvibe`
field (channel, source branch, full commit sha, build time, source
version) so the installed side can show what a channel is — no second
mechanism.

Pushing is opt-in and confined: only `--push` pushes, and only the exact
refspec `refs/heads/preview/<slug>:refs/heads/preview/<slug>` (guarded in
code — no other ref can pass). Without `--push` it prints the push
command and the install command. Like the release refs, `preview/*` refs
are orphans with one commit, so every publish is non-fast-forward by
design: **the only refs ever force-pushed are `release`, `release-rc`
and `preview/*`** (agents otherwise never push; CI never pushes
`preview/*` — only a human `--push` does).

On the test machine (needs the updater once — the first build with it is
installed by hand):

```sh
unvibe update --list              # release, release-rc, preview/* via gh; marks the installed one
unvibe stop
unvibe update preview/feat-other  # npm install -g github:indigoviolet/unvibe#preview/feat-other
unvibe start
```

`update` refuses while the service runs (the backup needs a quiet store,
and npm must not replace code under a live process) and reports the
version before and after. Updating to the already-installed channel is a
no-op only when the installed and published commits match — otherwise it
reinstalls in place (same database, still backed up first), which is the
normal publish → try → fix → publish → update loop; `--list` flags a
newer build on the installed row with both short shas and the build
time. Installs that predate the `unvibe` package field map to their real
channel from the version (`X.Y.Z` → `release`, `-rc.N` → `release-rc`,
`-preview.<slug>.<sha>` → `preview/<slug>`); source checkouts stay
unknown. The install is pinned with `npm --prefix` to the prefix this
binary came from (derived from its own package path; npm defaults apply
when the layout is unrecognised) and verified afterwards — a landing
elsewhere fails loudly with the path checked and `npm prefix -g`, swapping
no database. Channel logic lives in plain
`packages/service/src/update/` — exactly `channels.ts` (listing, incl.
the `UpdateChannel` shape: ref, kind, version, commit, source branch,
build time, current), `install.ts` (global npm install of a ref) and
`data-backup.ts` (the database rule) — composed for the CLI in
`src/cli/update-flows.ts`. The step-2 in-app picker reuses the same
three modules through a service route (`Updater`, owned by that branch);
`UpdateChannel` mirrors the shared type landing in
`packages/shared/src/api.ts`, which this branch does not touch. Per-ref
metadata is read without cloning (`gh api .../contents/package.json?ref=…`
over the injectable runner); the installed build reports its own
channel/ref, source branch, commit and build time from its package.json
(`readInstalledBuild`). `gh` runs with `GITHUB_TOKEN` unset through the
injectable command runner, like everything else.

Database rule (migrations are forward-only and numbered, so one
channel's migrated DB is wrong for another): each channel keeps its own
copy under `<dataDir>/channel-backups/<slot>/` (`unvibe.db` plus
`-wal`/`-shm` when present; legacy `unvibe.sqlite*` too). Switching
backs up the old channel first, then restores the new channel's copy
when one exists. A new preview never inherits another preview's
database: with no copy of its own it starts from the release copy
(`release-rc` fallback), and the switch stops before installing when
neither exists unless `--keep-data` is given; leaving
`release`/`release-rc` (or a source checkout) with no copy keeps the
live database. Backups are never deleted. `--keep-data` keeps the live
database instead of restoring (e.g. to carry data across channels
deliberately).

Only the database files are per-channel. The rest of the data dir —
`token`, per-review folders (`reviews/<owner>/<repo>/<id>/`),
`worktrees/<review-id>/`, diagram cache — is shared across channels, so
after a restore there can be leftover review folders and worktrees with
no row in the restored database. That state is inert: the front screen
lists reviews from the database (never from the filesystem), review ids
are random per open (`rv_<12hex>`, so a restored database never
addresses another channel's folders), and opening a review reuses a
leftover worktree only when it already points at the wanted head commit,
otherwise removing and re-adding it. Nothing there breaks `unvibe
start`; it just costs disk until the owning channel's copy (which still
references those reviews) is restored or the folders are removed by hand.

No new environment variables.

### Local checks

`mise run release` (build + tree + tarball + local branch, no push) and
`mise run check-global-install` (release, then tarball + git ref on npm
10/11 with isolated caches) exercise the same scripts the workflow runs.
`UNVIBE_RELEASE_VERSION` / `UNVIBE_RELEASE_BRANCH` (or `--version` /
`--branch`) override the version and branch; `--release-ref` / `--tarball`
select what the install check verifies.

The release tree is self-contained: built service bundle (`packages/service/dist/index.js` plus bundled adapter entries `dist/adapters/`), the web build, `prompts/`, the demo fixture, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, and a generated dependency-lean `package.json` (runtime deps only, no workspaces, no lifecycle scripts).

Installing from the default branch is unsupported: it is the source tree, not an installable package.

### Preview builds + version picker (#36)

Every in-flight branch is publishable as an installable build (step 1:
`mise run preview:publish`, the `unvibe update` CLI, `channels.ts` /
`install.ts` / `data-backup.ts`), and the installed app switches between
them from Settings → Version (step 2: the `Updater` seam, the picker, the
switch machinery). One switch core (`update/switch.ts`) serves both the
CLI and the in-app `Updater` — the CLI keeps line-by-line output, the
Updater throws joined lines and streams them to the switch log.

How it works:

- Gate: `versionPickerEnabled` in settings (off by default). When off, `GET /api/update/channels` and `POST /api/update/switch` answer 404 and Settings shows only the toggle; `GET /api/update/status` always works (gate state, running build, pending switch, last outcome).
- Listing is cached 30 s server-side with one shared in-flight call (`?refresh=1` bypasses); a switch is refused with 409 while jobs run, a submit is in flight, or another switch is pending.
- `from` is the installed channel read locally from the installed package (`readInstalledBuild` on `process.argv[1]`): a preview ref can be deleted from the remote while installed, and a rollback to "unknown" cannot work. Source checkouts (and pre-field installs without an inferable channel) get 409 + an installed-only message — listing still works there. The install's own version seeds the rollback health wait (`fromVersion`).
- Same channel, same published commit: 200 `{unchanged: true}`, nothing done. A moved commit reinstalls through the same flow (`from === to`, no DB swap); the current row shows "newer build available" with an Update action. A same-channel rollback is one reinstall attempt (the previous build of that ref is no longer published); on failure the outcome is `failed` with the recovery command — never loops.
- Switch = commit + detached helper + restart: the service validates, writes `<dataDir>/update/pending.json`, copies the self-contained `dist/update-helper.js` bundle (`build:helper` in `packages/service/package.json`; node builtins only, enforced by `test/update-helper-bundle.test.ts` on the esbuild metafile; shipped in the release tree by `scripts/release.mjs` and asserted by `scripts/global-install-check.mjs`) into `<dataDir>/update/`, spawns the copy detached, replies 202, then shuts down through the normal shutdown path (idle exit is suppressed while a switch is pending). The helper waits for the service PID to exit (never kills it — aborts with outcome `failed` instead), calls `switchTo` via the seam (DB plan first, backup, prefix-pinned install, landing verification, restore/seed — the installed build is identified from the service entry path in the helper args, never the helper copy's location), restarts the installed entry (`start --foreground` on the same port + data dir), and polls `/api/health` for the target version (the rollback waits for the previous build's version instead of burning the full timeout). Install failure or an unhealthy build rolls back to the previous ref; the outcome (`ok` / `rolled-back` / `failed` + reason + log path) lands in `<dataDir>/update/outcome.json` and is surfaced by `GET /api/update/status`. Before a second start — and before the rollback install — the helper stops the generation it started itself (SIGTERM + bounded wait + exit/lock confirmation; the only PIDs it ever signals are its own children), and it trusts only health samples from the generation holding the data-dir lock, so a live-but-wrong build can never satisfy the check while another generation crashes on the held port. `failed` outcomes carry the recovery path (`npm install -g github:indigoviolet/unvibe#release`, then `unvibe start`).
- The running build's identity rides on `GET /api/health` (`build`: version, source branch, commit, build time; null when the install carries no channel record). One source: the installed package.json (`unvibe` field) via `readInstalledBuild` — no second stamp. The fake backend reads the current fake channel.
- Listing fetches per-ref metadata with a small concurrency cap (4). Privacy (§16): the service itself still contacts nothing but `127.0.0.1` — channel listing shells out through `gh` under the user's own login (like every other `gh` use), which is why the picker stays opt-in. The only new static-guard entries are the helper's loopback health probe (`update/helper-entry.ts`, same shape as `cli/lock.ts`) and the `npm` literal step 1 added for installs.

Test-only update overrides (env-only, so the UI can never trigger them — for drills that must not touch GitHub):

- `UNVIBE_UPDATER_BACKEND=fake` — the fake backend (channels from `<dataDir>/update/fake-channels.json`, installed ref in `current-ref`; never touches npm/network).
- `UNVIBE_UPDATE_CHANNELS_FILE` — real backend, but the channel list comes from a JSON file instead of `gh` (per-ref `fetchRefPackage` still calls `gh` and degrades to nulls offline).
- `UNVIBE_UPDATE_INSTALL_SOURCE` — real backend, but the npm remote (e.g. `git+file:///tmp/unvibe.git`) instead of `github:indigoviolet/unvibe`; the `#<channel>` suffix is unchanged.
- `UNVIBE_UPDATE_FAKE_FAIL=install|health:<ref>`, `UNVIBE_UPDATE_*_MS` timeouts — fake failure injection + helper timeouts.

Drill a real switch through the real helper with real npm (temp prefix + port + data dir; never 4517, never the real data dir, never the real global prefix; nothing is pushed anywhere):

```sh
mise run build
R=$(mktemp -d)/realdrill; mkdir -p $R; git init --bare -q $R/unvibe.git
git --git-dir=$R/unvibe.git symbolic-ref HEAD refs/heads/preview/drill-a  # npm dereferences HEAD; real hosts always have one
node scripts/release.mjs --version 0.0.1-preview.drill-a.aaaa1111 --branch preview/drill-a --source-branch drill-a
git push $R/unvibe.git preview/drill-a
node scripts/release.mjs --version 0.0.1-preview.drill-b.bbbb2222 --branch preview/drill-b --source-branch drill-b
git push $R/unvibe.git preview/drill-b
# channels file with both versions; install A; run it; seed channel-backups/release/ from the live DB; switch to B
```

For a rollback drill, lie about the target version in the channels file (with a short `UNVIBE_UPDATE_HEALTH_TIMEOUT_MS`) — the helper installs fine, never sees the target, rolls back through a real reinstall. Kill only the PIDs you start, never by pattern or port sweep; delete the local `preview/drill-*` branches and tarballs afterwards.

## Conventions

- ACP lives only in `packages/service/src/agent/acp/` (enforced by `eslint.config.mjs` `no-restricted-imports` plus `test/acp-isolation.test.ts`). Everything else uses the `AgentRunner` interface from `@unvibe/shared`.
- API types live in `packages/shared`. Service and web both import them; change the contract there first. `GET /api/jobs` and snapshot job lists omit `promptSnapshot` (fetch per job at `/api/jobs/:id/prompt`) to keep snapshots small.
- Work is tracked in GitHub issues at `indigoviolet/unvibe`. Each piece of work has an issue; name it in your report and in the merge commit (`Closes #N`); tick its checklist as items land; open a new issue for anything found but not fixed. Commit in small logical commits on your branch; do not push or merge.
- `docs/acceptance-audit.md` is the requirement-by-requirement verdict plus the open list; update it when behaviour changes.

## Debugging

- Data: look in the data dir (`unvibe.db`, per-review folders, `worktrees/`). Point a scratch run at a temp dir with `UNVIBE_DATA_DIR` and a temp port with `UNVIBE_PORT`.
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
