# Unvibe

Unvibe reads a branch or pull request with you. It restates the change as a guide with links to the exact code, shows the diff beside it, answers questions anchored to the text, and submits review comments to GitHub when you choose.

![The guide beside the diff, in demo mode](docs/images/review.png)

## Status

It works on Linux. macOS is untested (see `docs/macos-testing.md`). The release install is not published yet (issue [#8](https://github.com/indigoviolet/unvibe/issues/8)), so today you run it from a checkout. Open work is tracked at [github.com/indigoviolet/unvibe/issues](https://github.com/indigoviolet/unvibe/issues).

## Requirements

Node 24 or newer, `git`, and `gh` logged in (needed for PRs and submitting; local branches work without it). For the guide itself, the `claude` and/or `codex` CLIs installed and logged in. Unvibe uses those logins and does not install the CLIs for you. Minimum versions: Codex 0.160.1, Claude Code 2.1.293.

## Install and run

From a checkout (`mise` supplies the Node toolchain):

```sh
git clone https://github.com/indigoviolet/unvibe && cd unvibe
mise run install && mise run build
node packages/service/dist/index.js setup
node packages/service/dist/index.js open
```

Once the release is published, this will install it instead (not yet available):

```sh
npm install -g github:indigoviolet/unvibe#release
```

`unvibe setup` registers the `unvibe://` handler that starts the service from the browser: a helper app on macOS, a desktop file on Linux. When the service is not running, the installed web app shows a start page that links to `unvibe://start`; the helper starts the service and the page reloads. Nothing starts at login, and the service exits after 10 minutes with no open window and no running jobs. `unvibe setup --uninstall` removes the handler.

Other commands:

- `start` — start the service (reuses it when already running).
- `stop` / `status` — stop it; report whether it runs.
- `token` — print the app URL with the per-install token.
- `doctor` — environment checks, each with a fix.

## Using it

The front screen lists prior reviews, your repos and PRs, and recent branches. Open a PR or branch and the guide fills in beside the diff.

Select any text to explain it, ask about it, or leave a note. Cards have a depth stepper and undo; a second-opinion action asks a different model about a card or finding. Citations are marked `<>`: hover previews the cited lines, click jumps to them in the diff. The diff pane filters files, hides uninteresting hunks, folds and summarizes, and tracks what you marked reviewed. Comments can be marked For PR; Submit posts them as one GitHub review. If it is your PR, you can also edit the description, and the edit goes with the same submit.

When new commits arrive, a banner offers Update, which carries your comments and read state over to the new version. A branch with no PR works the same except Submit, which stays disabled. Nothing reaches GitHub until you submit.

## Try the demo

No logins, no token spend:

```sh
UNVIBE_AGENT=replay node packages/service/dist/index.js open
```

If the service is already running, stop it first (`stop`) so the setting takes effect. Then open the demo review from the front screen. It replays recorded sessions against a bundled fixture through the same code as a real review.

## Settings

The Settings page picks the model for each role (main, small, second opinion) and tunes limits such as sessions per provider and the inline size budget. It also shows each review's jobs with their token usage, the exact prompt each job sent, and an environment section with the same checks as `unvibe doctor`.

| Variable | Default | When to set it |
|---|---|---|
| `UNVIBE_PORT` | `4517` | Another program holds the port. |
| `UNVIBE_DATA_DIR` | `~/.local/share/unvibe` | You want data elsewhere. |
| `UNVIBE_IDLE_MS` | `600000` | Idle exit timeout; `<=0` disables it. |
| `UNVIBE_AGENT` | live agents | `replay` for the demo without tokens. |
| `UNVIBE_CLAUDE_BIN` / `UNVIBE_CODEX_BIN` | login-shell PATH | A CLI lives somewhere unusual. |

## Your data and the network

Everything lives under the data dir: the SQLite database, the token, and a worktree per review where the agents read the code. Removing a review in the UI deletes its data and its worktree; your checkout is left alone. Full removal: `unvibe stop`, `unvibe setup --uninstall`, then delete the data dir and the checkout.

The service and the web app talk only to `127.0.0.1`. The only network traffic goes through tools you already use: `gh` and `git` for GitHub and fetching, and the `claude`/`codex` CLIs for the agent calls, all under your own logins. How this is enforced is in `ARCHITECTURE.md` and `DEVELOPMENT.md`.

## Troubleshooting

`unvibe doctor` checks Node, `git`, `gh`, the agent CLIs, the login-shell PATH, the data dir, and the port, each with a fix. The app shows the same checks under Settings.

- `gh not logged in` → `gh auth login`. Local branches still work.
- `claude`/`codex` missing or too old → install or update the CLI, make sure it is on the login-shell PATH, then Re-check.
- Port in use by something else → set `UNVIBE_PORT` to a free port.
- A failed agent job shows its error on the card with a retry. Jobs interrupted by a restart come back marked and can be resumed.
- Opening a review whose checkout moved or was deleted says so and names the missing directory.
- On macOS, the CLIs must be on the login-shell PATH (not just the Terminal PATH); `doctor` reports which PATH the service sees.

## More

- `DEVELOPMENT.md` — setup, tasks, tests, releases.
- `ARCHITECTURE.md` — components and the life of a review.
- `PRD.md` — the product spec.
- Issues: [github.com/indigoviolet/unvibe/issues](https://github.com/indigoviolet/unvibe/issues).

Licence: MIT (see `LICENSE`). Bundled third-party code keeps its own terms; the release lists them in `THIRD-PARTY-NOTICES.md`.
