# macOS testing checklist (15 minutes, PRD §14)

The shell/service was built and verified on Linux; this checklist verifies
the macOS-specific paths on a real Mac. Total budget: ~15 minutes.
Conventions: run in Terminal; `$ …` is the command, the block after is the
expected output. Nothing needs `sudo`. The service starts at login (issue
#108); a manually started service still idle-exits.

If a step fails: run its **Send back** commands and paste all output.

## 0. Prereqs (1 min)

```
$ node --version; git --version; gh auth status 2>&1 | head -3; echo $SHELL; which claude codex d2 zsh
v24.x.x
git version 2.x
Logged in to github.com account <you> ...
/bin/zsh
.../claude .../codex .../d2 /bin/zsh
```

`gh`/`claude`/`codex`/`d2` may be missing — `doctor` then reports `[warn]`,
which is fine (reviews work without `d2`; diagrams show their source
until it is installed: `brew install d2`). `echo $SHELL` may print
`/bin/zsh`, `/bin/bash` or `/opt/homebrew/bin/fish` — all three are
handled (step 2 checks).

**Send back:** the full output above.

## 1. Install from a checkout (4 min)

```
$ git clone <org>/unvibe && cd unvibe
$ mise run install
$ mise run build
$ mise run check
```

Expected: all green (`Test Files … passed`, no `FAIL`). `mise run check`
runs from a clean tree with no `dist/` — it must not depend on a stale
build (hardening: the dist network scan skips a `dist/` older than its
sources with a `skip: web dist is older…` warning).

**Send back:** the failing section plus `node --version` and `npm --version`.

## 2. Doctor — login-shell PATH, Keychain, port (1 min)

```
$ mise run doctor
```

Expected (values vary):

```
[ok] node: v24… (need >= 24 for node:sqlite) at …
[ok] git: git version …
[ok] gh: Logged in to github.com account …     # or [warn] when logged out
[ok] claude: …                                 # or [warn]
[ok] codex: …                                  # or [warn]
[ok] d2: …                                     # or [warn]; diagrams need d2 ≥ 0.9.0 (`brew install d2`)
[ok] login-shell PATH: from /bin/zsh: …        # your interactive PATH
[ok] data dir: /Users/you/.local/share/unvibe (writable)
[ok] port: 4517 is free
```

Checks and why they matter on macOS:

- `login-shell PATH` is the PRD §14 macOS gotcha: apps opened from
  Finder don't inherit the shell PATH, so the service re-reads it from a
  login shell (`zsh -lc 'echo $PATH'`, fish via `-l -c`). It must contain
  your mise/shim dirs — compare with `zsh -lc 'echo $PATH'`. If your
  login shell is very slow (>10 s), startup keeps the inherited PATH and
  this line reports `[warn]`.
- `gh`/`claude`/`codex` logins are Keychain-backed. The service never
  touches the Keychain itself: it spawns your CLIs, which read your
  normal login session. Started from Terminal this just works; started
  by the helper app (step 4) it works because the helper inherits your
  login session too — step 6 proves `gh` works from a helper-started
  service.
- `port`: the default `4517` is stable on purpose — the installed web
  app (a PWA) is bound to its origin `http://127.0.0.1:4517`. `[warn]
  …in use by something else` means a non-Unvibe process holds the port:
  set `UNVIBE_PORT` to a free port, then reinstall the web app (step 5),
  because the origin changes with the port.

**Send back:** the full doctor output plus `echo $SHELL` and
`zsh -lc 'echo $PATH'`.

## 3. Setup — the `unvibe://` helper app + start at login (2 min)

```
$ mise run setup
```

Expected:

```
helper app written to /Users/you/Applications/Unvibe.app (handles unvibe://start)
registered unvibe:// links with macOS
service starts at login (launchd agent at /Users/you/Library/LaunchAgents/com.unvibe.service.plist; never idle-exits there)
token ready in /Users/you/.local/share/unvibe/token
open once to connect this browser: http://unvibe.localhost:4517/?token=…
then bookmark: http://unvibe.localhost:4517
undo: unvibe setup --uninstall
```

Then verify:

```
$ ls ~/Applications/Unvibe.app/Contents/
Info.plist  MacOS  PkgInfo  Resources
$ /usr/libexec/PlistBuddy -c "Print CFBundleURLTypes" ~/Applications/Unvibe.app/Contents/Info.plist
Array {
    Dict {
        CFBundleURLName = com.unvibe.helper
        CFBundleURLSchemes = Array {
            unvibe
        }
    }
}
$ xattr ~/Applications/Unvibe.app
(empty — locally generated with osacompile, so no quarantine attribute, no signing needed)
$ cat ~/Library/LaunchAgents/com.unvibe.service.plist
(Label com.unvibe.service, ProgramArguments <node> <cli> start --foreground,
EnvironmentVariables UNVIBE_PORT=4517, UNVIBE_DATA_DIR=…,
UNVIBE_IDLE_MS=0, RunAtLoad true, KeepAlive with SuccessfulExit false —
restart on crash only, so a deliberate `unvibe stop` is respected)
$ launchctl print gui/$(id -u)/com.unvibe.service | head -8
(running service state)
```

Re-run `mise run setup` — output identical, exit 0 (idempotent; it
restarts the login instance through the manager, so `unvibe status`
shows a fresh `since`).

**Send back:** the setup output, the PlistBuddy output, `xcode-select -p`
(the CLT may be missing if `osacompile` failed), and `ls -la ~/Applications`.

## 4. URL scheme dispatch (2 min)

With the service **stopped** (`unvibe stop`; `unvibe status` ⇒ `not running`):

```
$ open "unvibe://start"
```

Within ~5 s the service must be up:

```
$ unvibe status
running on http://unvibe.localhost:4517 (pid …, since …; starts at login)
$ curl -s http://unvibe.localhost:4517/api/health
{"ok":true,"version":"…"}
```

Also try `unvibe://start` from Safari's address bar, and double-click
`~/Applications/Unvibe.app` in Finder (its `on run` handler starts the
service too).

**Send back:** `~/Applications/Unvibe.app/Contents/MacOS/applet
"unvibe://start"` run in Terminal (stderr), Console.app messages
mentioning `Unvibe`, and `ls -la
~/Applications/Unvibe.app/Contents/MacOS/`.

## 5. Token flow + installable web app (3 min)

```
$ unvibe open
```

The browser URL has `?token=…` once, then drops it (kept in
`localStorage` + a year-long `SameSite=Lax` cookie for asset loads; the
token never appears in URLs after first load, and the plain
`http://unvibe.localhost:4517` bookmark keeps working across restarts).

1. Chrome → ⋮ → "Install app" (localhost counts as secure). The
   installed app opens standalone with the Unvibe icon.
2. `unvibe stop`; open the installed app: it shows the offline
   **"Start Unvibe"** page (button links to `unvibe://start`).
3. Click **Start Unvibe**: the helper starts the service; the page polls
   `/api/health` and reloads into the app **without losing the token**.
4. Fresh profile (or cleared `localStorage`), open the app URL with no
   token: the service answers `401` with a page telling you to run
   `unvibe open`.

Port note: if you run on a non-default `UNVIBE_PORT`, the origin
(`http://127.0.0.1:<port>`) changes — Chrome treats it as a different
app, so reinstall ("Install app" again) after changing ports.

**Send back:** DevTools → Application → Service Workers (state, scope
`/`), Cache Storage (`unvibe-shell-v1` must list only shell files —
never `/api/*`), `localStorage` (`unvibe_token` present after first
open), and any console errors.

## 6. First review + Keychain-backed gh from a helper start (2 min)

With the service started **by the helper** (step 4, not Terminal):

```
$ unvibe token     # copy the URL, open it if not open
```

Open a small PR review end to end (guide fills within ~1 min). Then in
Terminal:

```
$ gh auth status   # still your work login (sanity)
```

The review's `gh` calls ran in the helper-started service: if the guide
built, the Keychain-backed login works outside Terminal.

Case-insensitive filesystem note: macOS checkouts are usually
case-insensitive. File keys are exact strings from `git diff`, and
managed worktrees live beside the data dir
(`~/.local/share/unvibe/worktrees/<id>`), never inside the checkout —
`git status` in the checkout must stay clean through the whole review
lifecycle (verified on Linux; spot-check here with one review).

**Send back:** whether the guide built, `unvibe status`, and any job
error text shown in the UI.

## 7. Idle exit (1 min, manual starts only)

A login-started service never idle-exits (issue #108). This step uses a
manual foreground start, which keeps the normal idle exit:

```
$ UNVIBE_IDLE_MS=15000 unvibe start --foreground &
$ sleep 20; curl -s --max-time 3 http://127.0.0.1:4517/api/health || echo IDLE-EXITED
```

Expected: `IDLE-EXITED` (15 s idle, no windows/jobs ⇒ exit). Then:
`unvibe open`, wait past the timeout, confirm still up (an open window
blocks exit), `unvibe stop`.

**Send back:** which of the two checks failed and the service log lines
(if any).

## 8. Global install as a user would (3 min)

```
$ npm install -g github:<org>/unvibe#release
$ unvibe setup && unvibe doctor && unvibe open
```

Notes (verified on Linux; same mechanism holds for darwin-arm64 —
reasoned from package metadata, not run here):

- The `#release` ref serves a self-contained tree (built service + web,
  no build step, no lifecycle scripts), so the install needs **no flags**
  on npm 10 or 11. Release tarballs install the same way (`npm install -g
  https://github.com/<org>/unvibe/releases/download/…/unvibe-….tgz`).
- Size: ~3.3 MB tarball, ~66 MB installed on Linux. macOS installs the
  same way: the release tree has no agent platform packages at all (the
  adapters are bundled JS in `dist/adapters/`; nothing is resolved per
  platform), and the adapters run your installed `claude`/`codex` via
  `CLAUDE_CODE_EXECUTABLE`/`CODEX_PATH` (both CLIs ship darwin-arm64 builds
  with `app-server`/SDK support). Expect the same ~66 MB order of magnitude.
- Agents: `unvibe doctor` must show your installed `claude`/`codex` with
  path + version (Codex ≥ 0.160.1, Claude Code ≥ 2.1.293); Unvibe does not
  install them for you.

**Send back:** `npm install -g` output, `ls -la $(npm root
-g)/unvibe | head`, `du -sh $(npm root -g)/unvibe`, and `unvibe doctor`.

> 2026-10-11 (release workflow, issue #8): the `#release` / `#release-rc`
> git refs and the attached tarballs install with no flags on npm 10 and 11
> on both CI legs (Ubuntu + macOS), each verified with doctor/start/demo
> from the installed copy (`global-install-check`: tarball ~4s / git ~6–7s
> on npm 11, ~8–10s on npm 10; ~42 MB apparent / ~63 MB on disk; demo 6
> cards, 2 findings, 8 hunk summaries; pre-rendered d2 v0.9.0 diagrams
> served as SVG). The repo is public, so the git-ref install needs no login
> and the tarball downloads from its plain releases/download URL.
> Candidates install from `#release-rc`
> (`v0.0.1-rc.3` verified from GitHub: `--version` matches the tag).

## 9. Uninstall the helper and login start (30 s)

```
$ unvibe setup --uninstall
removed …/Unvibe.app
removed …/Library/LaunchAgents/com.unvibe.service.plist (service no longer starts at login)
removed the link handler and login start (token and data kept).
$ ls ~/Applications/Unvibe.app
ls: /Users/you/Applications/Unvibe.app: No such file or directory
$ ls ~/Library/LaunchAgents/com.unvibe.service.plist
ls: …: No such file or directory
```

Token and data are kept. Re-run uninstall ⇒ `nothing to remove` lines.
Full removal: delete `~/.local/share/unvibe` (see README “Your data
and the network”).

## 10. Agent CLI via mise + reviewed repo with a mise config (2 min, issue #105)

Prereqs: `claude` installed through mise (so `which claude` is a mise
shim), `UNVIBE_CLAUDE_BIN` unset, and a repo whose checkout contains a
`.mise.toml` you have never trusted.

```
$ which claude; mise which claude
.../mise/shims/claude
.../mise/installs/.../bin/claude
$ unvibe doctor 2>&1 | grep -A3 claude
```

Expected:

- Doctor shows the shim **and** what it resolves to (the `mise which`
  path), e.g. `resolves to …/installs/…/bin/claude (what sessions run)`.
- Open a review of the mise-config repo: the guide builds. Before the
  fix every agent job on such a review failed with
  `mise ERROR … are not trusted`.
- Do **not** run `mise trust` on anything under
  `~/.local/share/unvibe/worktrees/` — the fix must work without it, and
  nothing in the UI may suggest it.

**Send back:** the doctor lines for `claude` (and `codex` if it is also
a shim), whether the guide built, and any job error text shown in the UI.

## 11. `unvibe.localhost` bookmark, login start, Safari (issue #108, 5 min)

From the preview build (`npm install -g` the preview ref, or the
checkout's `mise run build` + `node packages/service/dist/index.js`):

```
$ unvibe setup
(open the printed token link once, then bookmark the plain URL)
$ unvibe stop
$ curl -s --max-time 3 http://unvibe.localhost:4517/api/health || echo STOPPED
STOPPED
$ unvibe start
$ curl -s http://unvibe.localhost:4517/api/health
{"ok":true,"version":"…"}
$ unvibe status
running on http://unvibe.localhost:4517 (pid …, since …; starts at login)
```

`stop`/`start` go through launchd while the agent is installed (a
deliberate stop exits 0, so the crash-only restart leaves it down;
`start` bootstraps it back). If `stop` ever leaves the port answering,
or `start` reports a conflict, send back the full output.

1. **Chrome (or Vivaldi):** open the bookmark `http://unvibe.localhost:4517`
   — the app loads with no token in the URL.
2. **Browser restart:** quit the browser fully, reopen the bookmark — still
   connected (year-long cookie). Then open `http://127.0.0.1:4517` in the
   same browser: it shows the "isn't connected" page (separate cookie jar
   — expected), and `unvibe open` reconnects it.
3. **Safari:** open the same bookmark. If Safari cannot resolve
   `*.localhost` (historically it needs a hosts entry — unverified on
   current Safari), this fails with a DNS error; report your Safari/macOS
   version and fall back to `http://127.0.0.1:4517` via `unvibe open`.
4. **Login:** log out and back in — `unvibe status` reports running
   without you starting anything (the launchd agent). Confirm it never
   idle-exits: wait past 10 minutes with no window open, `curl` health
   still answers.
5. **Uninstall:** `unvibe setup --uninstall` removes the helper and the
   plist (step 9); after one more logout/login nothing listens on 4517.

**Send back:** Chrome result, Safari result (version + loads or DNS
error), whether the bookmark survived the browser restart, whether the
service was running after login, and the uninstall `ls` outputs.

## CI coverage on macOS (`.github/workflows/ci.yml`, issue #7)

The `macos-latest` leg runs headless on a runner — no GUI session, no
Keychain logins, no Apple ID. What it genuinely verifies:

- Step 1 (`install`, `build`, `check`): fully covered, from a clean tree.
- Step 2 (`doctor`): covered headless — node/git/gh/agent executables,
  login-shell PATH, data dir, port. Keychain-backed logins report
  `[warn]` (nothing is logged in); the Keychain path itself (step 6's
  helper-started service using your login) still needs a person.
- Step 3 (`setup`): covered by `mise run e2e:macos` — real `osacompile`,
  `Info.plist` scheme entries asserted, no quarantine attribute,
  `lsregister` registration, idempotent uninstall — with `--no-login`,
  so the launchd bootstrap itself stays human (step 11). The agent
  plist's contents and the bootstrap/bootout commands are pinned by
  `setup.test.ts` with a fake HOME. Gatekeeper behaviour
  beyond the quarantine flag still needs a person.
- Step 4 (URL dispatch): **partly**. CI tries `open "unvibe://start"` for
  real; when LaunchServices cannot dispatch headless, `e2e-macos` invokes
  the helper's handler binary directly (proving the generated app starts
  the service) and says so in its output. Dispatch through
  `open`/Safari/Finder double-click **still needs a person at a Mac**.
- Step 5 (token flow, installed web app, offline page): not covered —
  needs Chrome + a GUI. Still human.
- Step 6 (first review with real logins from a helper start): not covered —
  needs Keychain logins + token spend. Still human. (CI's real-service
  specs cover the same UI flows with `UNVIBE_AGENT=none`/`replay` and a
  stubbed `gh`.)
- Step 7 (idle exit + restart): covered by `e2e-macos` (idle exit) and
  `restart-resilience.mjs` (SIGKILL mid-stage + resume).
- Step 8 (global install): covered — tarball + `#release` git ref under
  npm 10 and 11, with doctor/start/demo-pipeline checks from the
  installed copy. `darwin-arm64` adapter behaviour (finding your installed
  `claude`/`codex`) still needs a person with the CLIs installed.
- D2 diagrams (`d2` discovery and rendering): covered — `mise install d2`
  works on the runner (aqua backend, cached), the real-binary unit suites
  run with zero skips (determinism, `icon:`-never-network,
  imports-cannot-read-files — all precheck/empty-cwd based, no Linux-only
  mechanisms, so they prove the same on macOS), the D2 Playwright specs
  pass in both modes, and fresh darwin/arm64 renders reproduce the
  Linux-made fixture SVGs byte for byte (`d2-seed-check --strict`), which
  is what makes content-hash addressing + immutable caching sound
  cross-platform. What still needs a person: `brew install d2` from step
  0/2 (CI uses mise, not brew) and eyeballing rendered diagrams.
- Step 9 (uninstall): covered by `e2e-macos` (helper gone, token/data
  kept, second uninstall a no-op).
- Platform assumptions (`/private/var` temp paths, case-insensitive
  filesystem, `fish` login shell): exercised implicitly wherever the
  suite touches temp dirs, repos and the login shell; `fish` as `$SHELL`
  is still unverified (runners use bash).

## What this checklist does NOT cover

- Windows (unsupported: AGENTS.md is macOS + Linux only).
- Real-agent behaviour on macOS beyond step 6 (token spend; the
  `test:live:*` tasks cover adapters where run).
- The `test:live:submit` draft-PR path (opt-in, writes a draft PR).
