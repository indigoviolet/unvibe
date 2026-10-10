# ACP adapters (only place ACP may be imported)

Nothing outside this directory may import `@agentclientprotocol/sdk`,
`claude-agent-acp`, or `codex-acp` (AGENTS.md, PRD §6; enforced by
`no-restricted-imports` in the root `eslint.config.mjs` and by
`test/acp-isolation.test.ts`). Everything else — routes, jobs, context
builder, pipelines — uses the `AgentRunner` interface from `@unvibe/shared`
(re-exported by `../index.ts`, factory in `../acp-runner.ts`).

Contents:

- `runner.ts` — `AcpAgentRunner`: start/fork (`atMessage` via AIR fork meta,
  Claude fork+resume quirk)/load/close/prompt streaming/cancel, model +
  thinking + mode setters, usage delta-ization, crash restart, dispose.
- `connection.ts` — one lazy stdio subprocess per provider (login-shell
  PATH, `NO_BROWSER=1`), update demux per session, permission answering,
  fs/terminal denial, toolCallId→title correlation, `connectClient()` shared
  with unit tests.
- `permissions.ts` — deny-by-default policy (our MCP tools + file readers
  allowed once; everything else rejected).
- `usage.ts` — `aggregateTurnUsage` over `usage` + `_meta.quota.model_usage`
  (background sub-calls included), `deltaTurnUsage` for Claude's cumulative
  counters, `cacheReadShare`.
- `errors.ts` — retryable vs terminal error classification.
- `mcp.ts` — shared `McpServerConfig` → ACP wire shape (HTTP; stdio).
- `types.ts` — provider ids, session records, model/thinking info.
- `index.ts` — public surface (no `../acp-runner.ts` factory imports ACP).

Details, quirks and test instructions: `docs/acp-runner.md`.
