# Evaluation: does `npx` work for running Unvibe? (issue #277)

Date: 2026-10-26. Platform: Linux (Ubuntu, Node 24.21.0 via mise, npm 11).
macOS-specific paths were read from code only and are marked for human verification.
Release under test: `0.0.11`, channel `release`, commit `ee39e65`
(`git ls-remote https://github.com/indigoviolet/unvibe.git release`).

Method: every command ran as `npx --yes github:indigoviolet/unvibe#release <cmd>`
under a scratch HOME (`mktemp -d`, plus scratch XDG dirs, scratch npm cache,
scratch `UNVIBE_DATA_DIR`, scratch `UNVIBE_PORT`, `GITHUB_TOKEN` unset,
`UNVIBE_AGENT=none`). The harness is `spikes/277-npx/npx-probe.sh`. The owner's
real install, data dir, npm prefix, systemd units and services were never
touched (owner unit/data mtimes predate the session; no stray processes left).

## Timings (wall clock, this machine)

| Run | Time | Notes |
|---|---|---|
| Cold `--version` (fresh cache) | ~18 s | downloads the release tree + deps; prints `0.0.11` |
| Cached `--version` (same cache) | ~5 s | prints `0.0.11`, no network install |

The npx cache dir (`<npmcache>/_npx/42d8905e797e0191/…`) is stable across runs
for the identical spec string: no "different cache dir on second run" was
observed. A different dir would only come from a different spec string; the
interop test below shows it would not matter anyway.

## What works

- **`--version`, `doctor`**: work. Doctor honours `UNVIBE_DATA_DIR` /
  `UNVIBE_PORT` (reported the scratch data dir, port 4721 free). `gh` correctly
  reports "not logged in" with `GITHUB_TOKEN` unset; agents resolve via the
  inherited PATH.
- **`start`**: works. Prints the token URL (`http://unvibe.localhost:<port>/?token=…`)
  plus the one-line `run \`unvibe setup\`` hint, writes the lock into the data
  dir. The detached service runs from the npx cache
  (`…/_npx/<hash>/node_modules/.bin/unvibe start --foreground`, reparented to init).
  `/api/health` reports the real build record (`version 0.0.11, channel release`).
- **`status`, `stop`**: work via npx, including **stop from a different npx
  cache** (fresh `npm_config_cache`, same data dir): "stopped", lock removed,
  health dead. The lock is pid-based in the data dir and binary-path-independent,
  so cache identity never matters for process control.
- **`open`** (headless): starts the service if needed and prints the token URL;
  the browser spawn is a silent no-op without a desktop session.
- **`setup --uninstall`**: removes exactly what `setup` placed, cleanly.
- **Channel detection**: the npx-cached package.json carries the real `unvibe`
  field (`channel: release`), so `update --list` would mark the installed
  channel correctly when `gh` works.

## What breaks

1. **`setup` bakes an ephemeral path.** Both the Linux link handler
   (`~/.local/share/applications/unvibe-open.desktop`, `Exec=…`) and the
   systemd login unit (`~/.config/systemd/user/unvibe.service`, `ExecStart=…`)
   embed the npx cache CLI path
   (`…/cache/_npx/<hash>/node_modules/unvibe/packages/service/dist/index.js`).
   npx owns that directory (prune/clean/reinstall moves it), so start-at-login
   and `unvibe://` links rot as soon as the cache changes. The same applies on
   macOS by construction (`resolveSetupPaths` realpaths `argv[1]` into the
   helper app script and the launchd plist) — **needs macOS verification**,
   as do `osacompile`/`LSRegister`/`launchctl` behaviours under npx.
2. **`update <channel>` assumes a global install and must not run under npx.**
   Not executed live on purpose: `installPrefixForPackage` matches only the
   `<prefix>/lib/node_modules/unvibe/package.json` layout and returns null for
   the npx layout (`…/_npx/<hash>/node_modules/unvibe/package.json` — verified
   suffix mismatch), so no `--prefix` is pinned and npm falls back to its
   default global prefix. Under the scratch env that prefix was the *real*
   toolchain prefix (`~/.local/share/mise/installs/node/24.21.0`) — i.e. an
   npx `update` would write into the owner's Node install while leaving the
   running npx-cached copy untouched. The in-app switcher has the same flaw by
   extension (it spawns the same npm path from the npx-run service).
3. **`update --list` needs a `gh` login**: fails with `gh exited 4 … gh auth
   login` when not logged in. Usable, but a try-it user hits this immediately.
4. **mise reshim (#170) is irrelevant under npx** — no global bin is ever
   placed, so there is nothing to reshim and doctor's bin-reachability advice
   (which targets the global bin) does not apply.
5. **`npx unvibe` from the npm registry is impossible today**: the root
   `package.json` is `"private": true` and nothing is published. It would need
   un-privating, a publish, and the name (reasoned from the package shape —
   nothing was published).

## Recommendation: npx for trying it, global install for regular use

npx genuinely works for a zero-commitment try (`doctor`, `start`, demo,
`stop`), and the failure modes are fenced, not silent. Support it for trying,
with two guards (no product-code change was made — this write-up only):

- `setup` under npx must refuse (or warn loudly and refuse the login unit):
  it currently writes units that point into an ephemeral cache and look
  permanently installed. Suggested wording when refused:
  "you're running from an npx cache, which disappears; `setup` needs the
  global install (`npm install -g github:indigoviolet/unvibe#release`)".
- `update` (CLI and in-app) under npx must refuse with "updates need the
  global install" instead of npm-installing into whatever the default global
  prefix happens to be.

README wording (new "Try it without installing" section, ahead of the install
section):

```md
### Try it without installing

npx github:indigoviolet/unvibe#release doctor
npx github:indigoviolet/unvibe#release start   # prints your private app URL
npx github:indigoviolet/unvibe#release stop    # when you're done

First run downloads the release (~18 s on a fast machine); repeat runs take
~5 s from the npx cache. For regular use, install globally instead — the
one-shot copy can't do start-at-login, `unvibe://` links, or self-update:

npm install -g github:indigoviolet/unvibe#release
unvibe setup
unvibe start
```

Still needing macOS verification: the `setup` unit contents under npx
(launchd plist `ProgramArguments`, helper-app AppleScript paths), `open`
dispatching to a real browser, and confirming no Gatekeeper/quarantine
surprise from executing the cached bundle.
