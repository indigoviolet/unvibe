# Unvibe (scaffold)

Foundation for Unvibe (see `PRD.md`): npm workspaces, shared contracts, a
token-gated localhost service, and a React shell ported from `prototype.html`.

## Install (users)

Requires Node 24+ (`node:sqlite` must work without flags).

```sh
npm install -g github:<org>/unvibe   # install or update (same command)
unvibe setup                          # per-install token + unvibe:// handler
unvibe open                           # start the service, open the app
```

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

## Install (from a checkout)

```sh
mise run install    # npm install across workspaces
mise run setup      # build + unvibe setup
mise run doctor     # build + unvibe doctor
```

## Run

```sh
mise run dev        # service + Vite dev server together
mise run start      # run the built service (after `mise run build`)
```

The service binds `127.0.0.1` only (port `UNVIBE_PORT`, default `4517`; data
dir `UNVIBE_DATA_DIR`, default `~/.local/share/unvibe`). Agent behaviour is
selected with `UNVIBE_AGENT`: `replay` (recorded fixture sessions, for the
demo and agent-behaviour tests), `none` (pipeline disabled, for tests that
do not exercise agents), or unset/anything else (the real ACP runner). On
start it prints a
URL containing the per-install token, e.g.
`http://127.0.0.1:4517/?token=…`. The web app reads the token from the URL
once, then keeps it in `localStorage` (+ cookie for asset loads).

## Test / lint / typecheck

```sh
mise run test       # vitest across workspaces
mise run lint       # eslint
mise run typecheck  # tsc --noEmit per workspace
mise run check      # lint + typecheck + test
mise run build      # build shared → service → web
mise run test:e2e   # Playwright behaviour tests (mock + real service)
```

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
  host in shipped web assets (`public/`, `dist/` after build) and no
  `fetch`/`http`/`https`/`net`/`tls`/`dgram`/`dns`/WebSocket-client use in
  `packages/service/src` outside the allowlist in the test (loopback
  clients, the 127.0.0.1-only server, ACP stdio adapters).
- Subprocesses: a guard test asserts the service spawns only `git`, `gh`,
  the login shell, the agent adapters/CLIs, and the `unvibe setup` helpers
  (`osacompile`, `lsregister`, `xdg-mime`, `open`/`xdg-open`).

Installing/updating (`npm install -g`) naturally uses the network.

## Layout

- `packages/shared` — entities (PRD §7.1), ID grammar (§7.2), link-token
  parsing (§10), API + WS contract (§14.1), `AgentRunner` (§6). No Node/DOM APIs.
- `packages/service` — Fastify on 127.0.0.1, per-install token, route stubs
  (one module per area, all 501), `node:sqlite` store + migration 001,
  injectable `CommandRunner` + `gh` wrapper, `FakeAgentRunner`, event bus.
  ACP may only ever be imported under `src/agent/acp/`.
- `packages/web` — Vite + React shell (prototype CSS class/variable names kept),
  routes `/`, `/review/:id`, `/settings`, typed API/WS clients, zustand snapshot
  store updated by snapshot + state patches.
- `prompts/` — prompt template stubs (PRD §13).
- App shell (PRD §14): `packages/service/src/cli/` (`unvibe` commands,
  single-instance lock, macOS/Linux `unvibe://` setup, doctor),
  `packages/service/src/lifecycle/` (idle exit + shutdown hooks),
  `packages/web/public/` (manifest, icons, service worker, offline
  start page). The service ships as an esbuild bundle
  (`packages/service/dist/index.js`, `@unvibe/shared` inlined) so
  `npm install -g` works from a tarball; registry deps live in the root
  `dependencies` — keep them in sync with `packages/service/package.json`.

All product endpoints are stubbed (`501 not implemented`); parallel agents
fill them in, one module each, changing the contract in `packages/shared` first.
