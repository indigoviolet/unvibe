# Unvibe (scaffold)

Foundation for Unvibe (see `PRD.md`): npm workspaces, shared contracts, a
token-gated localhost service, and a React shell ported from `prototype.html`.

## Install

Requires Node 24+ (`mise` pins it; `node:sqlite` must work without flags).

```sh
mise run install    # npm install across workspaces
```

## Run

```sh
mise run dev        # service + Vite dev server together
mise run start      # run the built service (after `mise run build`)
```

The service binds `127.0.0.1` only (port `UNVIBE_PORT`, default `4517`; data
dir `UNVIBE_DATA_DIR`, default `~/.local/share/unvibe`). On start it prints a
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
```

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

All product endpoints are stubbed (`501 not implemented`); parallel agents
fill them in, one module each, changing the contract in `packages/shared` first.
