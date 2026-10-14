# Spike #171: native Pi runner

Write-up: `docs/pi-runner-evaluation.md`. Not a workspace, never merged.

- `src/runner.ts`: `PiAgentRunner implements AgentRunner` over Pi's SDK (no ACP).
- `src/mcp-bridge.ts`: the session's MCP servers → Pi custom tools.
- `test/runner.test.ts`: offline checks. Pi's real `openai-codex` code runs against `test/fake-codex.ts`, with the service's real `McpRegistry` over the bundled demo (`test/demo.ts`).
- `test/rpc-smoke.test.ts`: the same backend driven through `pi --mode rpc`.
- `test/mcp-secret.test.ts`: a second MCP client on one secret is refused (side finding, write-up section 6).
- `test/bundle-smoke.mjs`: runs an esbuild bundle of the runner on its own.
- `test/live.test.ts`: LIVE, skipped unless `UNVIBE_PI_LIVE=1`; spends subscription usage.

## Run

Pi is not a dependency of the repo. Install it into a scratch prefix and link it:

```sh
S=$(mktemp -d /tmp/unvibe-spike-pi-XXXXXX); mkdir -p "$S/prefix" "$S/home"
(cd "$S/prefix" && echo '{"private":true}' > package.json && \
  npm install --ignore-scripts @earendil-works/pi-coding-agent@1.2.0)
ln -s "$S/prefix/node_modules" spikes/pi-runner/node_modules
HOME="$S/home" PI_CODING_AGENT_DIR="$S/home/.pi-agent" \
  ./node_modules/.bin/vitest run --config spikes/pi-runner/vitest.config.ts
```

Lint: `npx eslint spikes/pi-runner`. Typecheck: `(cd spikes/pi-runner && ../../node_modules/.bin/tsc -p tsconfig.json)`.
