# macOS testing checklist (shell milestone, PRD §14)

The shell work was built and verified on Linux; macOS was written carefully
from documentation but **never executed on a Mac**. Work through this
checklist on a Mac and paste back the diagnostics for any step that fails.

Conventions: run in Terminal; `$…` is the command, the rest is what you
should see. Nothing here needs `sudo`. No step writes login items —
spot-check with `ls ~/Library/LaunchAgents | grep -i unvibe` (empty) at the end.

## 0. Prereqs

```
$ node --version   # v24+
$ git --version
$ gh auth status   # logged in
$ which claude codex
```

`gh`/`claude`/`codex` may be missing — `doctor` then reports `[warn]`, which
is fine. Everything else must be `[ok]`/`[fail]`-free (apart from those warns).

## 1. Install from a checkout

```
$ git clone <org>/unvibe && cd unvibe
$ mise run install
$ mise run build
$ mise run check    # must be green before continuing
```

Diagnostics if red: paste the failing section plus
`node --version` and `npm --version`.

## 2. Doctor

```
$ mise run doctor
```

Expect lines like:

```
[ok] node: v24… (need >= 24 for node:sqlite) at …
[ok] git: git version …
[ok] gh: Logged in to github.com account …   # or [warn] when logged out
[ok] login-shell PATH: from /bin/zsh: …      # your interactive PATH
[ok] data dir: /Users/you/.local/share/unvibe (writable)
[ok] port: 4517 is free
```

The `login-shell PATH` line is the macOS gotcha check (PRD §14): it must
contain your mise/shim dirs (compare with `echo $PATH` in a login shell).
If it shows only `/usr/bin:/bin:…`, paste the output of
`echo $SHELL` and `zsh -lc 'echo $PATH'`.

## 3. Setup (helper app)

```
$ mise run setup
```

Expect:

```
helper app written to /Users/you/Applications/Unvibe.app (handles unvibe://start)
registered unvibe:// with LaunchServices
token ready in /Users/you/.local/share/unvibe/token
undo: unvibe setup --uninstall
```

Then verify:

```
$ ls ~/Applications/Unvibe.app/Contents/
$ /usr/libexec/PlistBuddy -c "Print CFBundleURLTypes" ~/Applications/Unvibe.app/Contents/Info.plist
```

The second command must print an array containing `unvibe`.
Re-run `mise run setup` — output identical, exit 0 (idempotent).

**What this does:** compiles an AppleScript applet with `osacompile`
(`on open location` handler) and patches its `Info.plist` with
`CFBundleURLTypes`. A plain shell-script bundle cannot receive URL Apple
Events, which is why the applet form is required. Locally generated ⇒ no
quarantine attribute (`xattr ~/Applications/Unvibe.app` should print
nothing) ⇒ no signing needed.

Diagnostics if `osacompile` fails: paste the error plus
`xcode-select -p` (the CLT may be missing) and `ls -la ~/Applications`.

## 4. URL scheme dispatch

With the service **stopped** (`unvibe stop`; `unvibe status` ⇒ `not running`):

```
$ open "unvibe://start"
```

Within ~5 s the service must be up:

```
$ unvibe status    # running on http://127.0.0.1:4517 (pid …)
$ curl -s http://127.0.0.1:4517/api/health   # {"ok":true,"version":"…"}
```

Also try from Safari's address bar (`unvibe://start`) and by double-clicking
`~/Applications/Unvibe.app` in Finder (its `on run` handler starts the
service too).

Diagnostics if nothing happens: run
`~/Applications/Unvibe.app/Contents/MacOS/applet "unvibe://start"` in
Terminal and paste stderr; check Console.app for `Unvibe` messages; paste
`ls -la ~/Applications/Unvibe.app/Contents/MacOS/`.

## 5. Single instance + stop

```
$ unvibe start     # prints the token URL + "already running (pid …)"
$ unvibe token     # same URL
$ unvibe open      # opens the browser at the token URL
$ unvibe stop      # Stopped.
$ unvibe status    # not running (exit 1)
```

## 6. Token flow + installable web app

```
$ unvibe open
```

The browser URL has `?token=…` once, then the address bar drops it (kept in
`localStorage` + cookie). Reload — the app still works (no token in URL).

1. Chrome → ⋮ → "Install app" (localhost counts as secure). The installed
   app opens standalone with the Unvibe icon.
2. Quit the browser; `unvibe stop`; open the installed app: it must show
   the offline **"Start Unvibe"** page (button links to `unvibe://start`).
3. Click **Start Unvibe**: the helper starts the service; the page polls
   `/api/health` and reloads into the app **without losing the token**.
4. Open a URL with no token (strip nothing — fresh profile or clear
   `localStorage`): the service answers `401` with a page telling you to
   run `unvibe open`.

Diagnostics: DevTools → Application → Service Workers (state, scope `/`),
Cache Storage (`unvibe-shell-v1` must list only shell files — never
`/api/*`), and `localStorage` (`unvibe_token` present after first open).

## 7. Idle exit

```
$ UNVIBE_IDLE_MS=15000 unvibe start --foreground &
$ sleep 20; curl -s --max-time 3 http://127.0.0.1:4517/api/health || echo IDLE-EXITED
```

Expect `IDLE-EXITED` (15 s idle, no windows/jobs ⇒ exit). Then confirm a
window blocks it: `unvibe open`, wait past the timeout, confirm still up,
`unvibe stop`.

## 8. Uninstall the helper

```
$ unvibe setup --uninstall     # removed …/Unvibe.app
$ ls ~/Applications/Unvibe.app # No such file
```

Token and data are kept. Re-run uninstall ⇒ `not present; nothing to remove`.

## 9. Global install (as a user would)

```
$ npm install -g github:<org>/unvibe
$ unvibe setup && unvibe doctor && unvibe open
```

Updates use the same install command. Diagnostics: paste
`npm install -g` output and `ls $(npm root -g)/unvibe`.

## What was NOT verified on macOS

- `osacompile` applet compilation, `lsregister -f` registration, and
  actual `unvibe://` Apple-Event delivery (steps 3–4) — reasoned from
  Apple documentation, untested.
- Gatekeeper behaviour for the generated app (expected: no quarantine
  since it is created locally, step 3 checks the xattr).
- Finder-launched PATH: the service repairs its own PATH from the login
  shell at startup; step 2 checks the resolved value.
- Chrome "Install app" + service-worker offline page on macOS Chrome
  (step 6) — the worker logic is platform-independent and was tested
  headlessly on Linux, but not in a real browser install flow.
