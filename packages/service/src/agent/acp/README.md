# ACP adapters (only place ACP may be imported)

Nothing outside this directory may import `@agentclientprotocol/sdk`,
`claude-agent-acp`, or `codex-acp` (AGENTS.md, PRD §6). Everything else —
routes, jobs, context builder, pipelines — uses the `AgentRunner` interface
from `@unvibe/shared` (re-exported by `../index.ts`).

Planned contents (M0 and later milestones):

- `claude.ts` — ACP client spawning `claude-agent-acp` over stdio
- `codex.ts` — ACP client spawning `codex-acp` over stdio
- `client.ts` — shared session/fork/load/prompt/close logic
