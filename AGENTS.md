# Unvibe: working agreement

`PRD.md` is the spec. `prototype.html` is the reference for look and behaviour (not for code): reuse its CSS variables, class names, icons and interaction rules when porting UI.

Details live in `DEVELOPMENT.md` (setup, tasks, tests, releases) and `ARCHITECTURE.md` (components, life of a review, where things live).

## Tooling

- **mise** owns the environment, tools and tasks. Run things as `mise run <task>` (see `DEVELOPMENT.md` for the list).
- Node + TypeScript (strict, ESM), **npm workspaces**. No pnpm/yarn/bun.
- Tests: **vitest**. UI behaviour tests: Playwright (only where a milestone asks for it).
- UI behaviour is tested against the **real service** (built app + bundled demo + browser, the `*-service.spec.ts` pattern and `mise run visual-tour`); mock-mode tests are only for quick component checks. Do not write a million unit tests for UI behaviour — prefer real testing. Before publishing any preview that changes UI, run `mise run visual-tour` and look at every screenshot.
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
docs/              design notes and decisions (spikes live on spike/* branches)
```

## Rules

- Nothing outside `packages/service/src/agent/acp/` may import ACP. Everything else uses the `AgentRunner` interface (PRD §6).
- Nothing is posted to GitHub except by the Submit review path (crash-safe via in-flight leases in `src/submit/lease.ts`). That rule covers Unvibe's own code, and it stays true there. Under the full-access opt-in (issue #160) it does NOT cover what an agent session does with its own shell: the agent can run `gh` as the user, and only the system prompt forbids it from posting — nothing enforces it. Live checks therefore run with no real credentials available to the session (scratch HOME, fake `gh` that refuses writes, or a local fake endpoint) and assert on the attempt, never on a successful write. Tests never hit real GitHub or real agents: use the fake `AgentRunner` and stub `gh`/`git` through an injectable command runner. Only tasks named `test:live:*` may use real logins (and spend tokens). See `DEVELOPMENT.md` for the test rules and the full task list.
- Run `gh` with `GITHUB_TOKEN` unset (PRD §15).
- Secrets come from the 1Password Environment through `mise run op -- <cmd>` (see `DEVELOPMENT.md`). Never print their values and never commit `.env`.
- API types live in `packages/shared`; service and web both import them. Change the contract there first.
- No backward compatibility. Everything is dev only and stored data can be reset. Do not read two shapes of the same data, migrate existing reviews, add "absent means the old default" fields, or keep fallbacks for older clients, old file layouts or old import paths. When a stored shape changes, change it. If that makes existing data unreadable, say so in your report so the owner can reset.
- Keep `mise run check` green from a clean tree with no `dist/`. The fast suite is `check` (lint + typecheck + fast vitest); the slow suite is `mise run test:slow` (build, slow vitest, Playwright); the pre-merge gate is `mise run gate` (see `DEVELOPMENT.md` for all gates and when each runs).
- Run targeted tests while implementing: only the test files and specs for what you changed (plus typecheck and lint when they are cheap). Do not run the full `mise run check`, `test:slow` or `gate` on every iteration, and say in your report exactly which tests you ran. This machine is shared by many agents: full suites run at once have exhausted its memory.
- The full gate runs once per branch, with current `main` merged in, before the merge or when the machine is free, and never several at the same time (one full run at a time across the machine; `gate` is a plain task chain, no lock script). A supervisor runs it for its agents. Nothing merges into `main` without it passing on that tree.
- A preview may be published on targeted tests alone. The issue comment then says "full gates not yet run".
- `docs/acceptance-audit.md` is the requirement-by-requirement verdict + open list; update it when behaviour changes.
- Work is tracked in GitHub issues at `indigoviolet/unvibe` (`gh issue list`). Each piece of work has an issue; name the issue in your report and in the merge commit (`Closes #N`), tick its checklist as items land, and open a new issue for anything you find but do not fix. Labels: `in-progress`, `waiting-for-user-testing`, `waiting-for-user-response`, `needs-decision`, `needs-mac`, `future`.
- Keep the issue current, so its state always says where the work is:
  - Starting: add `in-progress`.
  - Implemented and waiting on the owner: comment with the worktree branch name, the preview build and its install command, and the status (what was built, what was verified, how to try it). Swap `in-progress` for `waiting-for-user-testing`. This state always has a published preview (see the finishing rule below).
  - Blocked on a question for the owner: ask it in a comment and add `waiting-for-user-response` (`needs-decision` is for a design choice the owner has to make). Remove the label once it is answered.
  - Part done, part left: split the issue into sub-issues, one per piece. Close the ones that are done and on `main`, leave the rest open under the parent.
  - Close the issue when its work is merged into `main`, never at "implemented on a branch". Close it yourself with a comment naming the merge commit and the branch: `Closes #N` only takes effect on push, and agents do not push. Remove the status labels when it closes.
- Spikes, evaluations and experiments never go to `main`. They live on a pushed branch named `spike/<topic>` (harness, screenshots and write-up together) and are linked from their issue. Only work that is adopted gets merged.
- Never develop in the main checkout. It stays on `main` with a clean tree. Before the first edit, create a git worktree on a new branch (a Paseo worktree workspace, whose setup in `paseo.json` copies `.env` and installs) and do all edits, installs, builds and commits there. This holds for small changes too.
- Commit in small logical commits on your branch; do not push, do not touch other worktrees.
- Finished work never sits on a local branch waiting. Once it is verified, do one of two things:
  - Merge it into `main` yourself, if you judge it does not need the owner's approval. Close the issue as described above.
  - Otherwise publish a preview build, always, so the owner can try it, and put the install command in the issue comment.

  A subagent working for a supervisor reports back instead; the supervisor does this step.
- The one push an agent may make is a preview build: `mise run preview:publish -- <branch> --push` force-pushes the orphan ref `preview/<slug>` and nothing else (the script refuses any other ref). Source branches stay local. See `DEVELOPMENT.md` (preview builds). Deleting a preview ref from the remote is also allowed (`git push origin --delete preview/<slug>`), and is part of cleanup.
- A supervisor asked to "spin off" an issue creates the worktree, starts an Implementer agent in it with a full brief, and labels the issue `in-progress`. An empty worktree is not a spin-off.
- A supervisor owns every agent it started until that work is merged and cleaned up:
  - Set a recurring check (a Paseo heartbeat, every 5 to 10 minutes) as soon as the first agent starts, without being asked. Unblock or replace agents that are stuck.
  - When an agent reports, review the branch, then publish its preview and comment on the issue, saying which tests have run. Run the full gates one branch at a time, before merging at the latest.
  - Once the owner approves the preview, merge, close the issue, archive the Paseo workspace, remove the worktree and branch, and delete the branch's preview refs, local and on the remote (or ask the agent to). Cleanup is not done while a `preview/<slug>` for a merged branch is still on the remote.
- This repository and its issues are public. Never put anything from a repository under review into an issue, comment, commit message, branch name, test, fixture, doc, screenshot, spike corpus or agent brief, or into anything pushed (preview refs, spike branches): no repository or organisation names, PR or issue numbers, PR titles, branch names, file paths, identifiers, code, diagram source, commit hashes, or people's names and logins.
  - When a report or screenshot from the owner shows such details, describe the problem with neutral placeholders (`acme/app#123`, `example_module.py`, `some_function`) and say only what is needed to reproduce it.
  - Examples and test data come from this repo, the bundled demo, or public open-source projects.
  - If you find such details already published, tell the owner. Edits leave a public edit history that only the owner can delete.
- Durable guidance about how to work on this repo goes in this file, not in an agent's private memory.
- When done, report: what was built, what was verified (commands + results), what is stubbed or missing, and anything in the PRD you deviated from.
