# Spike: agent permissions (issue #104)

Write-up: `docs/agent-permissions-evaluation.md`. This folder is the harness behind it. Nothing here is product code, and nothing here posts to GitHub.

## What is here

| Path | What it is |
|---|---|
| `policy/unvibe-claude.json`, `policy/unvibe-codex.json` | The nono profiles: checkout read-only, `gh` read-only, no home directory, Unix sockets closed |
| `harness/agent-wrapper.sh` | The executable handed to the ACP adapter in place of the CLI; runs the real CLI under nono |
| `harness/setup-scratch.sh` | Builds the scratch layout: a tiny git checkout, an "outside" directory, a fake home with fake secrets, a stub `gh` |
| `harness/run-mechanical.sh` + `probe.sh` | The action list with no agent and no tokens: bare, then under nono; then the credential proxy against the fake GitHub |
| `harness/fake-github.mjs` | A local stand-in for the GitHub API that logs what reaches it |
| `harness/gh-stub.sh` | Stands in for `gh` in the runs without a sandbox; it only records the call |
| `harness/timing.sh` | Start-up and per-command cost of nono |
| `harness/acp-drive.mjs` | Live driver: one adapter, one provider, one scenario (`functional`, `actions`, `injection`, `hold`, `grep`) |
| `fixtures/` | System prompts (Unvibe rules, test-only, neutral), the action list, the made-up PR with the injection |
| `results/mechanical.txt`, `results/timing.txt` | Output of the two scripts on Linux |
| `results/live/*.json` | One file per live run: steps, timings, tool calls with their output, permission requests. Paths are replaced by `<scratch>`, `<tmp>`, `<home>` |

## Safety rules the harness follows

- Everything runs under one scratch directory, `$SPIKE_DIR`, with its own `HOME`. nono is unpacked there, not installed.
- The GitHub token is always the made-up string in `spike-config.json`. Repositories named in the tests do not exist.
- Without a sandbox, `gh` is the stub. Under nono, `gh` writes are refused before the network.
- "Home directory secrets" are fake files in the scratch home.
- Live runs need the agent logins. `setup-scratch.sh --logins` **copies** them into the scratch home; delete them when done.

## Re-running

```sh
npm install                                   # repo root, for the adapters and the MCP SDK
export SPIKE_DIR=$(mktemp -d /tmp/unvibe-spike-perms-XXXXXX)
mkdir -p "$SPIKE_DIR/bin"
# Put the nono binary at $SPIKE_DIR/bin/nono: download the release archive for your
# platform, check it against SHA256SUMS.txt, unpack. Version used: v0.80.0.

bash spikes/agent-permissions/harness/setup-scratch.sh          # fixtures only
bash spikes/agent-permissions/harness/run-mechanical.sh         # no agent, no tokens
bash spikes/agent-permissions/harness/timing.sh spikes/agent-permissions/policy/unvibe-claude.json

bash spikes/agent-permissions/harness/setup-scratch.sh --logins # live runs spend tokens
cd spikes/agent-permissions
node harness/acp-drive.mjs --provider claude --scenario functional --mode bypassPermissions --nono --model haiku --out "$SPIKE_DIR/out.json"
```

Driver options:

- `--provider claude|codex`
- `--scenario functional` (MCP call, fork, resume, load) `| actions` (the ten-step list) `| injection | hold | grep`
- `--mode <session mode>`: Claude `default`, `auto`, `bypassPermissions`; Codex `workspace-write`, `agent`, `agent-full-access`
- `--nono`: point the adapter at the wrapper. Without it the real CLI runs unsandboxed and `gh` is the stub
- `--perm deny|allow|hold:<seconds>`: how permission requests are answered (MCP tools are always allowed)
- `--system <file in fixtures/>`: default `system-prompt.md`
- `--model <id>`

Run `setup-scratch.sh` again before any run that may write to the fixtures. Remove `$SPIKE_DIR` and the short temp directory named in `$SPIKE_DIR/short-tmp-path` at the end.
