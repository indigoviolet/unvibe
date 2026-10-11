# Unvibe: working agreement

`PRD.md` is the spec. `prototype.html` is the reference for look and behaviour (not for code): reuse its CSS variables, class names, icons and interaction rules when porting UI.

## Tooling

- **mise** owns the environment, tools and tasks. Add tools to `mise.toml`; add tasks as `[tasks.*]` there. Run things as `mise run <task>` (`dev`, `build`, `test`, `lint`, `typecheck`, `check` = all three).
- Node + TypeScript (strict, ESM), **npm workspaces**. No pnpm/yarn/bun.
- Tests: **vitest**. UI behaviour tests: Playwright (only where a milestone asks for it).
- SQLite through the built-in `node:sqlite` (no native addons, so `npm install -g` needs no compiler).
- Must work on **macOS and Linux**. No platform-only shell tricks, no GNU-only flags, use `node:path`/`node:os`, never hard-code `/home/...`.

## Layout

```
packages/shared    types and pure logic shared by service and web: data model (PRD §7),
                   ID grammar, link-token parsing, API request/response types, event types
packages/service   the Unvibe service (PRD §5): HTTP + WebSocket on 127.0.0.1, store,
                   ingest (git/gh), context builder, job queue, citation validator,
                   MCP server, AgentRunner (ACP lives ONLY in src/agent/acp/)
packages/web       React (Vite) UI served by the service
prompts/           prompt templates (PRD §13)
spikes/            throwaway experiments with their own package.json; not part of the build
docs/              write-ups (spike results, decisions)
```

## Rules

- Nothing outside `packages/service/src/agent/acp/` may import ACP. Everything else uses the `AgentRunner` interface (PRD §6).
- Nothing is posted to GitHub except by the Submit review path (crash-safe via in-flight leases in `src/submit/lease.ts`). Tests never hit real GitHub or real agents: use the fake `AgentRunner` and stub `gh`/`git` through an injectable command runner. Only tasks named `test:live:*` may use real logins (and spend tokens).
- Run `gh` with `GITHUB_TOKEN` unset (PRD §15).
- API types live in `packages/shared`; service and web both import them. Change the contract there first. `GET /api/jobs` and snapshot job lists omit `promptSnapshot` (per-job fetch instead) to keep snapshots small.
- Keep `mise run check` green (it must pass from a clean tree with no `dist/`; the dist network scan skips a stale `dist`). Full gates: `mise run build`, `mise run test:e2e`, `mise run e2e`, `mise run check-global-install` (release tarball + `#release` git ref, npm 10 and 11, no flags), `mise run test:live` (+ `test:live:installed` for live sessions from the installed copy; both need logins and spend a little), `node scripts/restart-resilience.mjs`.
- `docs/acceptance-audit.md` is the requirement-by-requirement verdict + open list; update it when behaviour changes. CI (`.github/workflows/ci.yml`) runs check + build + e2e on macOS and Ubuntu.
- Work is tracked in GitHub issues at `indigoviolet/unvibe` (`gh issue list`). Each piece of work has an issue; name the issue in your report and in the merge commit (`Closes #N`), tick its checklist as items land, and open a new issue for anything you find but do not fix. Labels: `in-progress`, `needs-decision`, `needs-mac`, `future`.
- Commit in small logical commits on your branch; do not push, do not merge, do not touch other worktrees.
- When done, report: what was built, what was verified (commands + results), what is stubbed or missing, and anything in the PRD you deviated from.
