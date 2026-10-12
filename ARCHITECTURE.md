# Architecture

One process owns everything. The browser app is served by it and talks to it over HTTP + WebSocket on `127.0.0.1`.

```
browser: React app (served by the service, installable)
  │  HTTP + WebSocket, per-install token, loopback Host/Origin checks
service: Node on 127.0.0.1:4517
  ├── store ─────── SQLite + files under the data dir
  ├── ingest ────── git/gh ──► managed worktree of the branch
  ├── agent sessions ───────── your claude / codex CLIs (your logins)
  └── submit ────── gh ──► one GitHub review, only on Submit
```

The service never writes into your checkout; agents read the code in a worktree it manages beside the data dir. Nothing outside `src/agent/acp/` talks to the agent CLIs; everything else uses the `AgentRunner` interface.

## Life of a review

1. **Ingest** (`src/ingest/`): work out whether the source is a PR or a branch, fetch, compute the merge-base diff, parse it into hunks with content hashes, classify files, create or reuse the worktree. No agent involved.
2. **Reader** (`src/pipeline/`): the main model explores the worktree and streams the guide cards (problem, central change, go-deeper directions), hidden concept candidates, and pinned code excerpts.
3. **Base session** (`src/sessions/`): the shared context (source, pinned code, guide) is built once per model and kept warm, so later conversations start mostly from cache.
4. **Parallel forks**: a critic writes findings as separate pages with drafted suggested comments on diff lines; concept stubs become full pages; the small model summarizes each hunk and marks uninteresting ones (never a cited or one-line hunk).
5. **Conversations** (`src/pipeline/actions/`, `src/secondopinion/`): explain, ask, depth, examples, go-deeper generation, and second opinions each run in a fork of the base and apply their result to the page.
6. **Comments** (`src/comments/`): threads on guide text, description paragraphs, and diff lines, with editable For-PR drafts. The comments menu lists them all and never posts.
7. **Submit** (`src/submit/`): one GitHub review with every marked comment, plus the description edit when there is one. An in-flight lease reconciled against GitHub means a crash and retry can never double-post.
8. **New commits** (`src/versions/`): opening or refreshing compares the new head for free and marks what moved or changed; Update runs the agent pass that revises stale cards, rechecks findings, and covers new code. Hunk state keyed by content hash survives rebases.

## Ideas a newcomer must hold

- **Snapshot + patch stream.** The UI holds a full review snapshot (`GET /api/reviews/:id`) and applies state patches over the WebSocket (`src/events.ts`, `packages/web/src/state/store.ts`).
- **Base session + forks.** Every conversation forks one warm base per model instead of resending the context, which is what keeps follow-up turns cheap. The reader's own session is never forked.
- **Citations + validation.** Agent answers link code with tokens (`src/validate/`); ranges are checked, unambiguous slips are repaired, and what cannot be verified is shown dimmed.
- **Content-hashed hunks + versions.** Hunk state (folded, reviewed, summary, note) is keyed by content hash, not line number, and each new head SHA becomes a version with an ID mapping — so comments and read state carry across pushes and rebases.
- **Agent boundary.** Providers differ; the `AgentRunner` interface (`packages/shared/src/agent.ts`) does not. Permission policy is deny-by-default: agents may read files and call the service's own tools, nothing else.
- **What talks to the network.** Only `gh`, `git`, and the agent CLIs, all spawned by the service under your logins. The service process and the web app contact nothing but loopback. Enforcement detail lives in `DEVELOPMENT.md`.

## Where things live

| Directory | Responsibility |
|---|---|
| `packages/service/src/routes/` | One module per API area; token gate + loopback checks apply to all |
| `packages/service/src/ingest/` | PR/branch detection, fetch, diff parse, file classification, worktree |
| `packages/service/src/pipeline/` | Reader, base build, forks, hunk pass, on-demand actions |
| `packages/service/src/sessions/` | Base + conversation session lifecycle (fork, idle close, reopen) |
| `packages/service/src/context/` + `src/sharedctx/` | Layered context packs, append-only log, contributions |
| `packages/service/src/validate/` | Link-token checking and repair |
| `packages/service/src/versions/` | Refresh compare, ID mapping, update pass |
| `packages/service/src/comments/` | Threads, For-PR drafts, suggested comments |
| `packages/service/src/submit/` | One-review submit + description update, crash-safe lease |
| `packages/service/src/secondopinion/` | Isolated second-model verdicts on cards and findings |
| `packages/service/src/agent/` | `AgentRunner` factory (`replay`/`none`/real); ACP only in `src/agent/acp/` |
| `packages/service/src/replay/` | Recorded-session runner for demo + tests |
| `packages/service/src/exec/` | Injectable command runner, `gh` wrapper, login-shell PATH, agent binaries |
| `packages/service/src/readiness/` | Environment checks shared by `doctor` and the app |
| `packages/service/src/store/` + `src/state/` | SQLite, migrations, review snapshots |
| `packages/service/src/jobs/` | Priority queue, retry/back-off, restart recovery |
| `packages/service/src/mcp/` | Per-session tools the agents query review data through |
| `packages/service/src/settings/` | Models per role, limits, persisted settings |
| `packages/service/src/cli/` | `start`/`stop`/`status`/`setup`/`open`/`token`/`doctor`, single-instance lock |
| `packages/service/src/lifecycle/` | Idle exit, shutdown hooks |
| `packages/service/src/security/` | Token auth, loopback Host/Origin gates, CSP header |
| `packages/service/src/telemetry/` | Dev-only Sentry error reporting (off without `SENTRY_DSN_SERVICE`; SDK not in the release) |
| `packages/service/src/repos/` + `src/reviews/` | Repo detection/list, review create/list/delete |
| `packages/web/src/start/` | Front screen: prior reviews, demo, repos, PRs, branches |
| `packages/web/src/guide/` | Guide pages, cards, citations, hover previews |
| `packages/web/src/source/` | Source pane: PR description, diff, hunk state |
| `packages/web/src/comments/` | Threads, selection toolbar, comments menu |
| `packages/web/src/settings/` | Models, prompts, limits, jobs, environment |
| `packages/web/src/debug/` | Per-review shared-context debug page (base, log, contributions as rendered Markdown + delete) |
| `packages/web/src/versions/` | Refresh banner, stale/outdated markers, Update |
| `packages/web/src/api/` + `src/state/` | Typed API/WS clients, snapshot store |
| `packages/web/src/shell/` + `src/components/` + `src/floating/` | App shell, shared controls, tooltips/popovers |
| `packages/web/src/mock/` | In-memory API for UI development without a service |
| `packages/web/public/` | Manifest, icons, service worker, offline start page |
| `packages/shared/src/` | Entities + IDs + link parsing + API/WS types (`entities.ts`, `ids.ts`, `links.ts`, `content/`, `api.ts`, `agent.ts`); no Node/DOM APIs |
| `prompts/` | Prompt templates with front matter (role, tier, variables) |
| `fixtures/urllib3-5020/` | Bundled demo fixture: real diff + description + recorded sessions |

## Deeper docs

- `docs/acceptance-audit.md` — requirement-by-requirement verdicts + open list. Current; update when behaviour changes.
- `docs/pipeline.md` — pipeline stages and the seam for adding actions. Current.
- `docs/acp-runner.md` — adapter configuration, permission policy, per-adapter quirks. Current.
- `docs/reply-format.md` — normative agent reply format. Current.
- `docs/d2-diagrams.md` — the D2 diagram decision, the rules the pipeline implements and its defences. Current.
- `docs/macos-testing.md` — macOS verification checklist. Current; not yet run.
- `docs/live-pipeline-results.md` — measured live run against real agents. Historical measurement.
- Spikes and evaluations are not on `main`: see the `spike/*` branches (`spike/acp`, `spike/diagram-options`, `spike/pierre-diffs`, `spike/json-diagram-spec`).
