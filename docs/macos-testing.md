# macOS testing checklist (15 minutes, PRD §14)

The shell/service was built and verified on Linux; this checklist verifies
the macOS-specific paths on a real Mac. Total budget: ~15 minutes.
Conventions: run in Terminal; `$ …` is the command, the block after is the
expected output. Nothing needs `sudo`. Nothing starts at login.

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

## 3. Setup — the `unvibe://` helper app (2 min)

```
$ mise run setup
```

Expected:

```
helper app written to /Users/you/Applications/Unvibe.app (handles unvibe://start)
registered unvibe:// with LaunchServices
token ready in /Users/you/.local/share/unvibe/token
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
$ ls ~/Library/LaunchAgents | grep -i unvibe
(empty — nothing starts at login)
```

Re-run `mise run setup` — output identical, exit 0 (idempotent).

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
running on http://127.0.0.1:4517 (pid …)
$ curl -s http://127.0.0.1:4517/api/health
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
`localStorage` + `SameSite=Lax` cookie for asset loads; the token never
appears in URLs after first load).

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

## 7. Idle exit (1 min)

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

## 9. Uninstall the helper (30 s)

```
$ unvibe setup --uninstall
removed …/Unvibe.app
setup removed (token and data kept).
$ ls ~/Applications/Unvibe.app
ls: /Users/you/Applications/Unvibe.app: No such file or directory
```

Token and data are kept. Re-run uninstall ⇒ `not present; nothing to
remove`. Full removal: delete `~/.local/share/unvibe` (see README “Your data
and the network”).

## What this checklist does NOT cover

- Windows (unsupported: AGENTS.md is macOS + Linux only).
- Real-agent behaviour on macOS beyond step 6 (token spend; the
  `test:live:*` tasks cover adapters where run).
- The `test:live:submit` draft-PR path (opt-in, writes a draft PR).
