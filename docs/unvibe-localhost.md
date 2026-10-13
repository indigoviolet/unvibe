# Opening Unvibe at `http://unvibe.localhost:4517` (issue #108)

Install once (`unvibe setup`), then open the bookmark. No `unvibe open`,
no installed web app, no link-handler app needed day to day. The installed
app and the `unvibe://` handler stay as an option; nothing was removed.

## Why this name

Browsers resolve `*.localhost` names to the loopback address themselves:
no DNS lookup, no hosts-file edit, no hosted service — and page and
service stay on the same machine. The service listens on `127.0.0.1` plus
a `::1` companion socket (same port, same router, same gate), so it
answers however the browser resolves the name. It never binds a routable
address, and there is no host setting that could move it there.

`http://127.0.0.1:4517` keeps working: it is the same service. There are
no redirects and nothing to migrate.

## First visit and the token

`unvibe setup` prints a link with the token **once**. Opening it stores
the token in that browser profile (`localStorage` plus the
`__unvibe_token` cookie), and from then on the plain bookmark
`http://unvibe.localhost:4517` just works — including across browser
restarts (the cookie carries `Max-Age=31536000`, one year).

Cookie attributes: `SameSite=Lax; Path=/`, host-only (no `Domain`), no
`Secure` (plain http — `Secure` would stop it being sent at all), and no
`HttpOnly` (a JS-mirrored cookie cannot be `HttpOnly`; the token's real
carriers are `localStorage` plus the `Authorization` header, the cookie
only authenticates static asset loads). Same as before, plus persistence.

## Two origins, two jars

A cookie (and `localStorage` entry) set on `127.0.0.1` is **not** sent to
`unvibe.localhost` and vice versa — different hosts, separate jars. A
user who opens the other origin with an empty jar sees the "this browser
isn't connected" page telling them to run `unvibe open`, which opens the
token link for that browser. Pick one bookmark and stay on it.

The token never appears in a URL you are told to bookmark, and never in
any published page.

## Started at login, never idle-exits there

`unvibe setup` writes a start-at-login unit alongside the handler:

- macOS: `~/Library/LaunchAgents/com.unvibe.service.plist` (launchd:
  run at load, kept alive).
- Linux: `~/.config/systemd/user/unvibe.service` (enabled and started
  with `systemctl --user`).

Both run the installed CLI's `start --foreground` with the port and data
dir baked in at setup time (re-run setup after changing either), and both
set `UNVIBE_IDLE_MS=0`: a login-started service never idle-exits. A
manually started service (`unvibe start`) keeps the normal 10-minute idle
exit. Only the port, data dir and idle-disable are baked in — never the
whole environment, never `GITHUB_TOKEN`. `unvibe setup --uninstall`
removes the handler and the unit; `unvibe setup --no-login` installs the
handler only.

## If nothing answers

The service is not running (fresh boot before first login, crash, or you
used `--no-login`). Start it with `unvibe start` (or `unvibe open`, which
also opens the token link), then open the bookmark.

## Browser notes

- Chrome, Edge and Firefox resolve `*.localhost` to loopback internally
  and treat it as a secure context. These are verified by the automated
  suite (real sockets against `unvibe.localhost` in `listen.test.ts`).
- **Safari is unverified and historically different**: Safari has long
  not resolved `*.localhost` subdomains without a hosts entry, while
  Chrome/Firefox/Edge do. If that still holds on your Safari,
  `http://unvibe.localhost:4517` will not load there at all (DNS error,
  not an Unvibe error). The fallback is the old URL,
  `http://127.0.0.1:4517` — via `unvibe open` — which works in every
  browser. Please report what your Safari does (version + whether the
  name loads); see `docs/macos-testing.md` for the exact steps.
