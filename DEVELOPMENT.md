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
| `build` | Build shared → service → web, via one task per package (`build:shared`, `build:service`, `build:web`, each with only its own `sources`/`outputs`, so a change under any package's `src` rebuilds that package even when another package's `dist` is newer — issue #64; a missing `dist/` still rebuilds) | — |
| `build-freshness` | Scripted check for #64 (web change + shared rebuild must not skip; no change must skip; ~30 s, too slow for `check` — run it directly) | `build` |
| `dev` | Service + Vite dev server together | `build` (auto) |
| `dev:mock` | Web UI against the in-memory mock API, no service | — |
| `lint` / `typecheck` / `test:fast` | ESLint / tsc / fast vitest files | — |
| `test:slow:unit` | Slow vitest files (`*.slow.test.*`: need a build) | `build` (auto) |
| `test:slow` | Slow suite: `test:slow:unit`, then Playwright (`test:e2e`) | `build` (auto) + browsers (`mise run playwright-install`) |
| `test` | Every automated test that needs no login (`test:fast`, then `test:slow`) | as above |
| `typecheck:tests` | tsc over each workspace's tests (service `src` + `test`; shared `test`; web `src` incl. tests); blocking since issue #127 | — |
| `check` | Fast suite: `lint` + `typecheck` + `typecheck:tests` in parallel, then `test:fast`; must pass from a clean tree with no `dist/` | — |
| `gate` | Pre-merge gate: `check`, `build`, `test:slow`, `build-freshness`, shell e2e, `restart-resilience`, d2 seed check, `check-global-install`, one after another | everything (one full run at a time, see below) |
| `restart-resilience` | SIGKILL mid-stage, restart, resume against the built service | `build` (auto) |
| `start` | Run the built service | `build` (auto) |
| `setup` / `doctor` | Build, then `unvibe setup` / `unvibe doctor` | — |
| `fixture-snapshot` | Rebuild `fixtures/urllib3-5020/snapshot.json`; fails on unverified citations | — |
| `test:e2e` | Playwright behaviour tests (mock UI + real service in demo mode) | `build` (auto) + browsers (`mise run playwright-install`) |
| `playwright-install` | Install the Playwright Chromium browser | — |
| `visual-tour` | Visual tour against the real built service (demo + replay agent): screenshots in `packages/web/visual-tour/` (git-ignored), generic viewport/stacking/overflow checks at 1440px and ~900px in light and dark | `build` (auto) + browsers |
| `e2e` | Linux shell end-to-end (setup --no-login, handler, reuse, idle exit, uninstall, in temp HOME/port; the login unit's contents + enable commands are pinned by `setup.test.ts`, not here) | Linux |
| `e2e:macos` | macOS shell end-to-end (setup, helper app, handler, reuse, idle exit, uninstall, in temp HOME/port) | macOS |
| `check-global-install` | `release`, then install the tarball and the `#release` git ref into temp prefixes (npm 10 and 11, no flags) | npm 10 + 11 |
| `release` | Self-contained release tree + tarball + local `release` branch; no push | `build` first |
| `preview:publish [-- <branch>] [--push] [--as-is] [--all] [--prune]` | Publish branches as installable `preview/<slug>` refs (merged builds by default; pushes only with `--push`) | — |
| `test:live` | Live adapter tests over real CLIs (stays on claude/codex) | `claude`/`codex` logins; small token spend |
| `test:live:pipeline` | Full pipeline on real agents (default pi + muse-spark; `--provider`/`--model`/`--cap`) | Logins; token spend, capped |
| `test:live:plotlines` | Hunk scores + plotlines on the demo and public PRs (default pi + muse-spark; read-only, never posts) | Logins; token spend, capped |
| `test:live:second-opinion` | Second-opinion check with real agents (stays cross-provider) | Logins; small spend |
| `test:live:hunk-cap` | Hunk-pass concurrency measurement (#210): caps sweep over one PR review (default pi + muse-spark) | Logins; small spend, capped |
| `test:live:installed` | Live sessions from the installed copy (pi, claude, codex; `--provider`/`--cap`) | Logins; tiny spend, capped |
| `test:live:submit` | Submit path against a scratch repo, pipeline agent turns on pi by default (draft PR only) | Login; opt-in, writes a draft PR; token spend, capped |
| `test:live:full-access` | Full-access check with real agents (default pi + muse-spark; `UNVIBE_LIVE_PROVIDERS`/`UNVIBE_LIVE_CAP`) | Logins; small spend, capped |
| `test:live:fork-tools` | Codex fork review-tools check (stays on Codex) | `codex` login; tiny spend |
| `test:live:diagram` | Live D2 diagram check (stays on claude/codex; #286 moves it to pi) | Logins, d2; small spend |
| `test:live:pi` | Live pi check (#279): subscription login, review tools in a fork, resume, usage split on real pi (unchanged) | Owner's pi login + go; small spend |

Switched tasks (issue #292) share `scripts/live-pi-lib.mjs`: `--provider` and `--model` override the pi + `muse-spark-1.3-contributor` default (pi's bare id; the runner maps it to provider `meta`), `pi --list-models` refuses before any spend when the model isn't offered, the spend cap is priced from pi's own catalogue (`get_available_models`; missing or all-zero cost refuses unless `--allow-unpriced` is passed, never assumed $0), `--cap` pre-flights the worst case and tracks spend from the first token (failed jobs included), and the spend + per-task report is written to `test-results/` (gitignored) as well as the console. Test-only tasks that need a cap read it from `UNVIBE_LIVE_CAP`. Only `test:live:*` may use real pi.

`test:live:*` never runs under `check` or CI. CI (`.github/workflows/ci.yml`)
runs on `ubuntu-latest` for every branch push except `spike/**`, and on
`macos-latest` only nightly against `main` and on manual dispatch
(`gh workflow run ci`, both platforms, to keep per-push CI to one leg;
`release.yml` also covers macOS on every `v*` tag): `check` + `build` +
`build-freshness` + `test:slow` (slow vitest files, then Playwright),
then the shell end-to-end (`e2e` on Linux, `e2e:macos` on
macOS), `check-global-install` (both), and
`mise run restart-resilience` (both). `release.yml` runs `check`, builds
the release, then `test:slow:unit` (the build-dependent guards). Diagrams render service-side
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
  (The Pages workflow `.github/workflows/pages.yml` is the exception: it
  deploys `site/` to GitHub Pages and runs only on `main` pushes that
  touch `site/**`, plus manual dispatch.)
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

- **Timing races that only fail on the runner:** the GitHub runner is
  ~4x slower than a dev machine. Throttle the browser to match with
  `UNVIBE_E2E_CPU_THROTTLE=4` (CDP `Emulation.setCPUThrottlingRate`,
  wired into the specs that have needed it via
  `e2e/cpu-throttle.ts`; a no-op when unset) and run the spec
  repeatedly, e.g.
  `UNVIBE_E2E_CPU_THROTTLE=6 UNVIBE_E2E_WORKERS=2 npx playwright test e2e/reply-draft-service.spec.ts --repeat-each=10`.
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

There are two suites (issue #119). The fast suite is `mise run check`
(lint + typecheck + test typecheck (issue #127) + every vitest file not named `*.slow.test.*`): no
build, no browser. The slow suite is `mise run test:slow` (build, then
vitest `*.slow.test.*`, then all of `packages/web/e2e/`): everything
that needs a `dist/` or a browser. `mise run test` is both;
`mise run gate` is the pre-merge gate (both suites plus
`build-freshness`, shell e2e, restart resilience, the d2 seed check and
`check-global-install`, one after another).

- **Slow by name (vitest):** `foo.slow.test.ts(x)` is slow; every other
  `*.test.ts(x)` is fast. To slow a single test, move it into a sibling
  `foo.slow.test.ts`. Slow files run after `mise run build` and FAIL
  (never skip) when the build is missing or stale.
- **Slow by location (Playwright):** everything under `packages/web/e2e/`
  is slow. There is no fast Playwright subset.
- **Disabled:** one test or group is `it.skip` / `test.skip` /
  `describe.skip` with `// DISABLED(#119): <one-line reason>` on the line
  directly above; a whole file is renamed `*.disabled.test.ts`
  (`*.disabled.spec.ts` for Playwright) with the same comment as its
  first line. Disabled tests still compile (excluded from every run, not
  deleted). List them with `git grep -n "DISABLED(#"`. Never disable
  anything behind a rule in `AGENTS.md` or a gate named here.
- Unit: vitest per workspace (`packages/*/test`, `*.test.ts(x)` next to the code). Prompt rendering has golden files (`prompt-goldens.test.ts`).
- Behaviour: Playwright specs in `packages/web/e2e/` run against mock mode and against the real built service in `replay` mode.
- Shell: `scripts/e2e-linux.mjs` (setup/handler/reuse/idle/uninstall with a temp HOME, data dir and port) and `scripts/restart-resilience.mjs` (SIGKILL mid-stage against the built service).
- Live: `scripts/live-*.mjs` plus `UNVIBE_LIVE=1` suites. Gated by env, excluded from `check` by design.
- Shared options live in `vitest.shared.ts` at the root (imported by all
  three workspace configs): worker cap `min(8, cores-1)`, 1 GB heap cap
  per worker, 10 s fast / 30 s slow per-test timeouts. Playwright is
  capped at `min(4, cores/2)` workers with a 10-minute global timeout
  (`packages/web/playwright.config.ts`). Overrides: `UNVIBE_TEST_WORKERS`
  (vitest), `UNVIBE_E2E_WORKERS` (Playwright, e.g. `=8` when the machine
  is known to be free), `UNVIBE_TEST_SUITE=fast|slow` (run one vitest
  suite directly).

Rules:

- No real agents or GitHub outside `test:live:*`. Tests use the fake/replay `AgentRunner` and stub `gh`/`git` through the injectable command runner. Under vitest `buildApp` substitutes the fake runner, the static model catalog and a command guard (refuses real `gh`/`claude`/`codex`) when a test injects nothing; `test/no-real-spawn.test.ts` guards the substitution.
- Run `gh` with `GITHUB_TOKEN` unset (it can override the keyring login).
- Nothing is posted to GitHub except through `src/submit/` (crash-safe via in-flight leases in `src/submit/lease.ts`); `test/gh-writes.test.ts` enforces the boundary.
- E2E scripts take a temp port/HOME/data dir so parallel checkouts do not clash.
- While implementing, run targeted tests — one thing at a time, never two
  suites in parallel:
  ```sh
  cd packages/service && npx vitest run test/reviews.test.ts        # one file, 1 to 3 s
  cd packages/web && VITE_MOCK=1 npx vitest run src/guide/CardView.test.tsx  # VITE_MOCK=1 is required: without it the mock API is real fetch
  cd packages/web && npx playwright test e2e/comments.spec.ts       # one spec; *-service specs skip without a build, so `mise run build` first to exercise them
  ```
  (`mise run test:e2e -- e2e/<spec>` from the root narrows the same way
  but rebuilds first.)
- Which gate when: targeted tests after each change; `mise run check` before each commit and before reporting; `check` plus the Playwright specs for the touched flows before a preview (**not** the full gate); `mise run gate` once per branch with current `main` merged in, before merge or when the machine is free — one full run at a time across the machine (a plain task chain by owner decision, no lock script), never several at once.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `UNVIBE_PORT` | `4517` | Service port. The installed web app is bound to its origin, so reinstall it after changing ports. |
| `UNVIBE_DATA_DIR` | `~/.local/share/unvibe` | SQLite DB (`unvibe.db`), `token`, lock, `worktrees/<review-id>/`. |
| `UNVIBE_IDLE_MS` | `600000` | Idle exit after this long with no window/jobs; `<=0` disables. The start-at-login unit bakes in `0` (issue #108: a login-started service never idle-exits). |
| `UNVIBE_AGENT` | live agents | `replay` / `none` (see above). |
| `UNVIBE_ACP_DEBUG` | — | `1` logs permission decisions, `2` full payloads (stderr). |
| `UNVIBE_CLAUDE_BIN` / `UNVIBE_CODEX_BIN` | login-shell PATH | Override the agent executable (else `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`). |
| `UNVIBE_REPO_ROOTS` | `~/src`, `~/dev`, … | `path.delimiter`-separated roots for checkout detection. |
| `UNVIBE_PROMPTS_DIR` | repo `prompts/` | Override prompt templates (tests, debugging). |
| `UNVIBE_LIVE` / `UNVIBE_LIVE_PROVIDERS` | — | `=1` enables live suites; providers `claude\|codex` (default both; `full-access` defaults to `pi`, `installed` to all three). `UNVIBE_LIVE_CAP=<usd>` is the required spend cap for the vitest live tasks (issue #292). |
| `UNVIBE_TEST_SUITE` | both | `fast` / `slow`: run one vitest suite directly (`npm run test:fast` / `test:slow` set it). |
| `UNVIBE_TEST_WORKERS` | `min(8, cores-1)` | Cap on vitest workers. |
| `UNVIBE_E2E_WORKERS` | `min(4, cores/2)` | Cap on Playwright workers (`=8` when the machine is known to be free). |
| `UNVIBE_E2E_CPU_THROTTLE` | unset | CDP CPU-throttling rate for test pages (e.g. `=4` to mimic the slower CI runner when reproducing timing races); no-op when unset. |
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
tag `v<version>`. Candidates ship as preview builds instead — publish the
branch (`mise run preview:publish -- <branch> --push`) and install it with
`unvibe update preview/<slug>`; nothing but finals ever touches the
`release` ref users install from.

Tag → branch → install command:

| Tag | Version | Branch (pushed) | Pre-release | Install |
|---|---|---|---|---|
| `v0.0.1` | `0.0.1` | `release` | no | `npm install -g github:indigoviolet/unvibe#release` |

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
GitHub release (`softprops/action-gh-release`, never a pre-release).

### Install story

The repo is public, so installing needs no GitHub login. The git-ref
install works anonymously:

```sh
npm install -g github:indigoviolet/unvibe#release
```

The tarball asset downloads from its plain
`https://github.com/…/releases/download/…` URL the same way. Download it,
then install the file:

```sh
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

Deleting a candidate preview means deleting its `preview/<slug>` ref (and the
local branch once it is merged or abandoned).

### Preview builds (issue #36)

Every in-flight branch is publishable as an installable build, so a
second machine (one that only has the global install) can test it without
a tagged release.

On the dev box, from any checkout (no worktree needed for the target branch):

```sh
mise run preview:publish                  # this checkout's branch, main merged in, no push
mise run preview:publish -- feat/other    # another branch, main merged in, no push
mise run preview:publish -- --push        # also push preview/<slug> (opt-in)
mise run preview:publish -- --as-is      # build the branch as it stands (old behaviour)
mise run preview:publish -- --all        # every local branch ahead of main, plus main itself
mise run preview:publish -- --prune      # list stale preview/* refs (dry run; --push deletes)
```

What it does (`scripts/preview-publish.mjs`, pure helpers in
`scripts/preview-lib.mjs`): by default it builds current local `main`
merged with the branch in a throwaway detached worktree (add at `main`,
merge the branch, `mise trust` the worktree, install, build, release,
remove the worktree — also on failure). A merge conflict is reported
clearly and nothing is published. `--as-is` keeps the old behaviour
(build the branch exactly as it stands: in its worktree when it has one
— refusing a dirty tree there — else in this checkout, or in a
throwaway at the branch when it has no worktree). `--all` publishes
every local branch with commits not on `main`, plus `main` itself
(publish artifacts `preview/*` and `release` are never
selected); one branch failing does not stop the rest and a summary
prints at the end (exit nonzero when anything failed). The version is
`<base>-preview.<slug>.<shortsha>` of the built tree (base =
package.json, slug = branch made safe for semver + ref segments, e.g.
`feat/repo-add-by-url` → `feat-repo-add-by-url`) with
`--branch preview/<slug>`. The generated package.json records an `unvibe`
field (channel, source branch + commit, base branch + commit, built
tree commit, build time, source version) so the installed side can show
both sides (`main@<sha> + <branch>@<sha>`) — no second mechanism.
`--prune` lists `preview/*` refs whose source branch (from each ref's
own `unvibe` record) is merged into `main` or deleted; with `--push`
they are deleted locally and on `origin` instead. Only refs under
`preview/` may ever be deleted (guarded in code); refs with unreadable
provenance and the base's own preview (`preview/main`) are always kept.

Pushing is opt-in and confined: only `--push` pushes, and only the exact
refspec `refs/heads/preview/<slug>:refs/heads/preview/<slug>` (guarded in
code — no other ref can pass). Without `--push` it prints the push
command and the install command. Like the release refs, `preview/*` refs
are orphans with one commit, so every publish is non-fast-forward by
design: **the only refs ever force-pushed are `release`
and `preview/*`** (agents otherwise never push; CI never pushes
`preview/*` — only a human `--push` does).

On the test machine (needs the updater once — the first build with it is
installed by hand):

```sh
unvibe update --list              # release, preview/* via gh; marks the installed one
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
channel from the version (`X.Y.Z` → `release`,
`-preview.<slug>.<sha>` → `preview/<slug>`; old `-rc.N` builds map to no
channel); source checkouts stay
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

Database rule: there is one database and a switch never swaps it. Switching
keeps your database and backs it up first to
`<dataDir>/channel-backups/<channel>/` (`unvibe.db` plus `-wal`/`-shm`
when present). A newer build may upgrade the
database; if an older build then cannot open it, copy the backup back.
Backups are never deleted. Rollback reinstalls the previous build and
restores the backup taken at the start of the switch, so the old build
never opens a database the new build may have migrated.

Only the database files are backed up. The rest of the data dir —
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

The release tree is self-contained: built service bundle (`packages/service/dist/index.js` plus bundled adapter entries `dist/adapters/`), the web build, `prompts/`, the demo fixture, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, and a generated dependency-lean `package.json` (runtime deps only, no workspaces, **no lifecycle scripts** — neither does the source tree).

Setup is one manual step (issues #42, #220): the release package once carried a `postinstall` that ran setup, but any lifecycle script makes npm install a git dependency as a link to its temporary preparation clone and then delete the clone — on the owner's Mac (npm 11, `github:` install) the bin link survived while its target vanished (`unvibe: command not found`), and the same script first died with `ENOENT uv_cwd` when npm launched it from a directory it had already deleted. Automatic setup on first start / after update (v0.0.8) was dropped in #220: `unvibe setup` is run once by hand after install; `unvibe start` without it still starts the service and prints the one-line hint (detection is the pure file check `isSetupInstalled`, also what the start hint uses). The switch/update path still spawns npm with a stable cwd (`stableNpmCwd()` in `src/update/install.ts`: the home dir), never inheriting a cwd inside the package being replaced. With mise-managed Node the global bin can land in one Node version's prefix off the interactive PATH; `unvibe setup` and `unvibe doctor` detect that (`src/cli/setup/bin-reachability.ts`) and print the exact fix (prefix bin dir, `mise reshim` / shims dir, or a `~/.local/bin/unvibe` symlink) — detection only, they never edit PATH. `scripts/global-install-check.mjs` asserts all of it: no lifecycle scripts in the release package.json, the git-ref install (copy mode, no `--install-links`) landing a real package whose bin target exists and runs on npm 10 and 11, start-without-setup printing the hint and still running, setup placement after the explicit `unvibe setup` step, a reinstall spawned from inside the package being replaced, and a mise stand-in phase (version prefix + shims-only PATH, temp HOME).

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

- Gate: `versionPickerEnabled` in settings (off by default) now means "show previews" (issue #231). Releases are always listed and switchable; with the toggle off `GET /api/update/channels` returns only releases and `POST /api/update/switch` to a preview answers 404 (the top-bar update check runs either way); `GET /api/update/status` always works (gate state, running build, pending switch, last outcome).
- Listing is cached 30 s server-side with one shared in-flight call (`?refresh=1` bypasses); a switch is refused with 409 while a submit is in flight or another switch is pending. Running jobs refuse with a structured 409 (`code: "jobs-running"` + count + first 5 blocking jobs); `POST /api/update/switch { ref, force: true }` skips only that refusal — the shutdown path stops the jobs and their count rides the pending switch into the outcome (`interruptedJobs`), so the UI names it after the reload. `force` never bypasses the submit lease, a pending switch, the gate, or the installed-build check. Stopped jobs show as interrupted (resume or retry them from the review; on a different channel they stay with that channel's data).
- `from` is the installed channel read locally from the installed package (`readInstalledBuild` on `process.argv[1]`): a preview ref can be deleted from the remote while installed, and a rollback to "unknown" cannot work. Source checkouts (and pre-field installs without an inferable channel) get 409 + an installed-only message — listing still works there. The install's own version seeds the rollback health wait (`fromVersion`).
- Same channel, same published commit: 200 `{unchanged: true}`, nothing done. A moved commit reinstalls through the same flow (`from === to`); the current row shows "newer build available" with an Update action. A same-channel rollback is one reinstall attempt (the previous build of that ref is no longer published); on failure the outcome is `failed` with the recovery command — never loops.
- Switch = commit + detached helper + restart: the service validates, writes `<dataDir>/update/pending.json`, copies the self-contained `dist/update-helper.js` bundle (`build:helper` in `packages/service/package.json`; node builtins only, enforced by `test/update-helper-bundle.test.ts` on the esbuild metafile; shipped in the release tree by `scripts/release.mjs` and asserted by `scripts/global-install-check.mjs`) into `<dataDir>/update/`, spawns the copy detached, replies 202, then shuts down through the bounded shutdown path (`lifecycle/service-shutdown.ts`, issue #30: abort jobs → dispose agents → close MCP sessions + WebSocket clients → force-close leftover sockets + close HTTP → close DB last; every step bounded at 4 s, whole run on a 10 s deadline, then the process exits no matter what — a stuck shutdown can never leave a live process with a closed DB; idle exit is suppressed while a switch is pending). The helper waits for the service PID to exit (never kills it — 30 s, comfortably past the shutdown deadline; on timeout aborts with outcome `failed` naming `unvibe stop` + retry as the recovery, install untouched, live service keeps serving), calls `switchTo` via the seam (backup, prefix-pinned install, landing verification — the live database stays in place and the new build opens it; the installed build is identified from the service entry path in the helper args, never the helper copy's location), restarts the installed entry (`start --foreground` on the same port + data dir — through the service manager when the login unit is installed, issue #108 follow-up, so the new generation stays managed; a manager-owned generation is stopped through the manager, never SIGTERMed, or the crash-only restart would revive it against the next generation), refreshes the login unit with the just-installed paths, and polls `/api/health` for the target version (the rollback waits for the previous build's version instead of burning the full timeout). Install failure or an unhealthy build rolls back to the previous ref (reinstall + restore of the pre-switch backup, so the old build never opens a database the new build may have migrated); the outcome (`ok` / `rolled-back` / `failed` + reason + log path) lands in `<dataDir>/update/outcome.json` and is surfaced by `GET /api/update/status`. Before a second start — and before the rollback install — the helper stops the generation it started itself (SIGTERM + bounded wait + exit/lock confirmation; the only PIDs it ever signals are its own children), and it trusts only health samples from the generation holding the data-dir lock, so a live-but-wrong build can never satisfy the check while another generation crashes on the held port. `failed` outcomes carry the recovery path (`npm install -g github:indigoviolet/unvibe#release`, then `unvibe start`).
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
# channels file with both versions; install A; run it; switch to B (live DB carries over, A slot backed up)
```

For a rollback drill, lie about the target version in the channels file (with a short `UNVIBE_UPDATE_HEALTH_TIMEOUT_MS`) — the helper installs fine, never sees the target, rolls back through a real reinstall. Kill only the PIDs you start, never by pattern or port sweep; delete the local `preview/drill-*` branches and tarballs afterwards.

## Conventions

- ACP lives only in `packages/service/src/agent/acp/` (enforced by `eslint.config.mjs` `no-restricted-imports` plus `test/acp-isolation.test.ts`). Everything else uses the `AgentRunner` interface from `@unvibe/shared`.
- API types live in `packages/shared`. Service and web both import them; change the contract there first. `GET /api/jobs` and snapshot job lists omit `promptSnapshot` and `turnRecords` (fetch per job at `/api/jobs/:id/output`) to keep snapshots small.
- Work is tracked in GitHub issues at `indigoviolet/unvibe`. Each piece of work has an issue; name it in your report and in the merge commit (`Closes #N`); tick its checklist as items land; open a new issue for anything found but not fixed. Keep the issue's state current (branch comment and `waiting-for-user-testing` once implemented, sub-issues for what remains, closed only when merged to `main`): the steps are in `CLAUDE.md`. Commit in small logical commits on your branch; do not push or merge.
- `docs/acceptance-audit.md` is the requirement-by-requirement verdict plus the open list; update it when behaviour changes.

## Debugging

- Data: look in the data dir (`unvibe.db`, per-review folders, `worktrees/`). Point a scratch run at a temp dir with `UNVIBE_DATA_DIR` and a temp port with `UNVIBE_PORT`.
- Logs: the service logs to stderr (`Unvibe listening on …`, job errors, permission decisions with `UNVIBE_ACP_DEBUG=1`).
- A job's exact prompt, output, tool calls and usage, turn by turn: `GET /api/jobs/:id/output` (the Jobs section on the review's debug page opens it via its Output button), with tokens and cache-hit rate on `GET /api/jobs?review=:id`.
- Environment: `unvibe doctor` locally, `GET /api/readiness` in the app; both share `src/readiness/checks.ts`.
- Reproduce without tokens: `UNVIBE_AGENT=replay` for agent behaviour, `UNVIBE_AGENT=none` for everything else.
- Restart behaviour: `node scripts/restart-resilience.mjs` exercises SIGKILL mid-stage against the built service.

## Network and privacy enforcement

Data stays on the machine. The app's own code contacts nothing but `127.0.0.1`; only the user's tools that Unvibe spawns (`gh`, `git`, the `claude`/`codex` CLIs) reach the network, under the user's own logins. What enforces it:

- Browser: the service serves a strict `Content-Security-Policy` on the HTML shell (mirrored as a `<meta>` tag in `packages/web/public/start.html` for the offline page). A shared Playwright fixture fails the e2e suite on any non-local request, and a dedicated spec walks the front screen, a review, and settings asserting zero non-local requests and zero CSP violations.
- Service: the vitest setup makes non-loopback sockets fail suite-wide (`test/network-privacy.test.ts`); an end-to-end test boots the app, creates the demo review with the replay runner, and asserts no non-loopback attempt.
- Static: a guard test (`test/network-guards.test.ts`) finds no fetchable `http(s)://` URL to a non-local host in shipped web assets and no `fetch`/`http`/`net`/`tls`/`dns`/WebSocket-client use in `packages/service/src` outside the allowlist (loopback clients, the 127.0.0.1-only server, stdio adapters). A stale `dist/` is skipped, never scanned.
- Subprocesses: `test/subprocess-allowlist.test.ts` asserts the service spawns only `git`, `gh`, the login shell, the agent CLIs, and the `unvibe setup` helpers.
- Requests additionally require a loopback `Host` and loopback `Origin`/`Referer` (`src/security/host.ts`, DNS-rebinding defence behind the per-install token, checked on every HTTP and WebSocket route). The accepted names are exactly `127.0.0.1`, `localhost`, `unvibe.localhost`, `::1` and `::ffff:127.0.0.1` (issue #108; no suffix matching, port-agnostic as before). The service listens on `127.0.0.1` plus a `::1` companion socket sharing the Fastify router, so `unvibe.localhost` answers however the browser resolves it — still loopback only, with no host setting that could move it.
