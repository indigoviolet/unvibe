# Acceptance audit (hardening pass, branch `hardening`)

Method: every verdict below is backed by code (`file:line`), a named test,
or a command run against the **built** service (`mise run build` output) in
demo mode (`UNVIBE_AGENT=replay`, recorded pipeline, no tokens) against real
temporary git repos, plus Playwright (61 e2e green, plus a manual UI walk
with 0 console errors). A test that exists is cited as evidence only with
its name; behaviours were re-run where marked “ran”.

Verdicts: **met / partly / not met / cannot verify here**.

## Summary table

| PRD section | met | partly | not met | cannot verify |
|---|---|---|---|---|
| §0 constraints (5) | 4 | 0 | 0 | 1 |
| §4.1 layout (4) | 4 | 0 | 0 | 0 |
| §4.2 start page (5) | 5 | 0 | 0 | 0 |
| §4.3 pages (7) | 7 | 0 | 0 | 0 |
| §4.4 cards (6) | 5 | 1 | 0 | 0 |
| §4.5 links/citations (8) | 8 | 0 | 0 | 0 |
| §4.6 selecting text (4) | 4 | 0 | 0 | 0 |
| §4.7 explanations (5) | 5 | 0 | 0 | 0 |
| §4.8 comments (9) | 9 | 0 | 0 | 0 |
| §4.9 findings (4) | 4 | 0 | 0 | 0 |
| §4.10 second opinion (4) | 4 | 0 | 0 | 0 |
| §4.11 PR description (6) | 6 | 0 | 0 | 0 |
| §4.12 submit (4) | 4 | 0 | 0 | 0 |
| §4.13 diff (16) | 16 | 0 | 0 | 0 |
| §4.14 settings (5) | 5 | 0 | 0 | 0 |
| §4.15 conventions (7) | 7 | 0 | 0 | 0 |
| §6 agent runner (8) | 8 | 0 | 0 | 0 |
| §7 data model + IDs (6) | 6 | 0 | 0 | 0 |
| §8 versions table (6) | 6 | 0 | 0 | 0 |
| §9 context layers/log/rebuild/contributions (12) | 12 | 0 | 0 | 0 |
| §10 linking/MCP/validation (9) | 9 | 0 | 0 | 0 |
| §11 pipelines (7) | 7 | 0 | 0 | 0 |
| §12 models/concurrency (9) | 8 | 1 | 0 | 0 |
| §13 prompts (5) | 5 | 0 | 0 | 0 |
| §14 shell/install/security/storage (8) | 8 | 0 | 0 | 0 |
| §14.1 endpoints (17) | 17 | 0 | 0 | 0 |
| §15 gh/git (10) | 9 | 1 | 0 | 0 |
| §16 non-functional (5) | 5 | 0 | 0 | 0 |
| §17 M0–M6 done-when (7) | 7 | 0 | 0 | 0 |
| §18 test kinds (4) | 4 | 0 | 0 | 0 |
| **Total** | **204** | **2** | **0** | **1** |

Fixed in this branch (was failing/missing before): stale-dist `check`
failure; missing Host/Origin gate; MCP secrets never revoked; submit
double-post window on crash; resume dead after restart (orphan dedupe
block); reply-after-restart failure; demo-fill missing from resume;
demo refresh 502 on UI auto-refresh; cryptic refresh error for deleted
checkouts; job-list snapshot bloat; doctor port diagnosis; broken
`prepare` under global installs (3 bugs); untested git-URL install path
(now guarded + diagnosed).

## §0 Hand-off constraints

- **No new logins** — met. `gh` via keyring (`exec/gh.ts:12` unsets
  `GITHUB_TOKEN`; `readiness/checks.ts:109` probes auth); agents via the
  user's `claude`/`codex` CLIs on the login-shell PATH
  (`agent/acp/connection.ts:41`, `exec/shell-path.ts`). `doctor` reports
  each login state.
- **Nothing hosted publicly** — met. Fastify binds `127.0.0.1` only
  (`server.ts:278`); static network guards (`network-guards.test.ts`,
  `network-privacy.test.ts`, Playwright `network-privacy.spec.ts`,
  `network-guard.ts` fixture) fail the suite on any non-loopback contact.
- **Nothing posted until Submit** — met. `gh-writes.test.ts` proves only
  `src/submit/**` + `routes/submit.ts` contain write-shaped `gh` calls;
  this branch adds the submit lease so even a crash cannot double-post
  (`submit/lease.ts`, `submit-m6.test.ts` “crash safety”).
- **Nothing starts at login** — met. `e2e-linux.mjs` asserts setup writes
  only the `.desktop` handler; `macos-testing.md` step 3 checks
  `~/Library/LaunchAgents` is empty; idle exit (10 min default) shuts the
  service down.
- **New repos under the team org** — cannot verify here (process rule, no
  org access from this machine).

## §4 Product behaviour

Web evidence abbreviations: `e2e/<spec>.spec.ts`, `ui-walk` = manual
Playwright walk of the built service 2026-10-10 (start, guide, submit
panel screenshots, 0 console errors). The web agent is concurrently
editing `packages/web/src` (expansion cards, card controls, corrections
UI); nothing below was edited by this pass.

### §4.1 Layout — all met

- Top bar (title, Tips, Submit + count, Source toggle) — met
  (`e2e/guide.spec.ts`, ui-walk screenshot shows all five).
- Guide left / Source pane right (PR description + Diff tabs, Comments
  menu), drag resize, arrow keys on handle — met (`e2e/diff.spec.ts`,
  `comments.spec.ts`; walk shows pane + tabs).
- Docked ≥900px, overlay below — met (`App.tsx` responsive layout,
  covered by `guide.spec.ts` viewport cases).
- Nothing lost when narrow (wrap/icons/pinned) — met (`diff.spec.ts`
  pinned-row cases; `source/diff/DiffView.test.tsx` 300-file case).

### §4.2 Start page — all met

- Repo picker with recents + local checkout detection — met
  (`routes/repos.ts`, `e2e/start.spec.ts` "prior sessions list").
- Authoring / review-requested / branches / prior reviews with
  unread+stale (“new commits · Update”) — met (`repos/changes.ts`,
  `reviews/list.ts`, `e2e/start.spec.ts`, `settings-versions-service.spec.ts`
  refresh banner counts).
- Selections remembered — met (`reviews/list.ts` last-opened ordering,
  `start.spec.ts` “most recent first”).

### §4.3 Pages — all met

- Kinds (root/concept/finding/opened-expansion), root+finding labels only
  — met (walk shows “GUIDED REVIEW”; `reply-format.md` §7 finding refs).
- Header (label, bookmark, title) — met (`guide.spec.ts`).
- Trail breadcrumb off-root — met (`guide.spec.ts` “pages navigate”).
- Contents box (cards jump + linked pages, read muted, no other labels)
  — met (walk screenshot shows CONTENTS with linked pages;
  `guide.spec.ts` “renders cards, contents and generated go-deeper cards”).
- Go deeper placeholders + Generate fills + follow-ups — met
  (`pipeline/demo.ts` auto-fill, `actions/generate.ts`,
  `guide-service.spec.ts`).
- Bookmark + state exists (sharing deferred) — met (`Page.saved`,
  `reviews/list.ts` summaries).

### §4.4 Cards — 5 met, 1 partly

- Collapse chevron, title-row-only collapsed — met (`guide.spec.ts`).
- Depth −/+ stepper, 3 dots, in-place rewrite, underlying principle at
  deepest, on-demand + kept — met (`actions/depth.ts`,
  `actions-m4.test.ts` “depth round-trips”).
- Examples / Add diagram inserts, never duplicated — met
  (`actions/examples.ts`, `diagram.ts`, dedupe in apply).
- Undo (depth/examples/diagram, no redo, comments/expansions survive) —
  met (`actions/undo.ts`, `actions-m4.test.ts`).
- Mark read (grey + collapse), roll-up to page, muted links — met
  (`guide-service.spec.ts` “card read action”).
- **Partly:** “Underlying principle” block at deepest `+` — the
  `::: principle` parsing exists (`reply-format.md` §3,
  `shared/src/content`), but no e2e drives the deepest-stepper case end
  to end; the web agent owns card controls. Left for the web agent to
  confirm visually.

### §4.5 Links and citations — all met

- Dotted links (page preview → open; collapsed expansion preview →
  expand) — met (`e2e/guide.spec.ts` “dotted-link hover preview: timing
  and content”).
- Citations (`<>` + count; hover previews lines; click opens source pane
  at spot w/ unfold + filter clear) — met (`guide-service.spec.ts`
  “citations reveal over the real API”, `validate/*`).
- Inline code chips behave as citations — met (`reply-format.md` §1,
  `guide/citations.test.ts`).
- Unverified citations dimmed + tooltip — met (`validate/validate.ts`
  `unverified` flag, snapshot tests; live pipeline: 0 unverified of
  37+14 — `docs/live-pipeline-results.md`).
- Comment marker (bubble + count, only unanchored) — met
  (`guide/Markers.test.tsx`).
- Hover timing (~0.2 s), close on scroll/Escape/blur/resize/pointer-leave,
  hover-ignore-until-move — met (`e2e/guide.spec.ts` popover timing +
  close cases, `floating/Tooltip/Toast.test.tsx`).

### §4.6 Selecting text — all met

- Works in guide, description, diff code — met (`comments/selection.test.ts`).
- Snap to words, trim, highlight matches — met (`e2e/comments.spec.ts`
  “selection snaps to whole words”).
- Toolbar Explain / Ask… / Note; no examples/diagrams there; appears only
  on selection-finish — met (`comments.spec.ts`).

### §4.7 Explanations — all met

- Expansion under source block, highlight; header (quote, Open as page,
  Delete, Close) + card controls — met (`actions/explain.ts`,
  `ask-service.spec.ts` “explain runs”).
- Close → dotted link (preview/expand); read closes the same way — met
  (`actions/close.ts`, `promote.ts`).
- Anchor lost → collapsed card — met (`explain.ts` anchor fallback,
  `actions-m4.test.ts`).
- Open as page moves content, anchor becomes link — met
  (`actions/promote.ts`, `actions-m4.test.ts` “promote”).

### §4.8 Comments — all met

- Ask… (agent + citations) / Note (no reply) — met (`actions/ask.ts`,
  `note.ts`, `comments-service.spec.ts` “create a note … survives reload”).
- Thread header (quote/`file:line`, Mark for PR filled when on, Delete,
  Close) — met (`comments/threads.test.ts`, walk screenshot shows
  “Agent · suggested comment” threads with Reply/Discard).
- Reply box always visible, Discard/Reply, typed text survives rerender —
  met (`comments/ThreadView.test.tsx`, `comments.spec.ts`).
- Placement (guide closed + hover outline; diff under line + line-number
  reopen + click-number starts; description under paragraph) — met
  (`comments.spec.ts` “diff line click starts a comment; close leaves an
  icon; reopen works”).
- Comments menu (all comments, jump, For PR filter with editable drafts,
  never posts) — met (`comments-service.spec.ts` “mark for PR, edit the
  draft, submit posts exactly one review”).

### §4.9 Findings — all met

- Separate pages, orange guide card with confidence + “Open →”, dims when
  read — met (walk shows finding-linked content; `pipeline/apply.ts`
  criticApply).
- Finding page label + rust-border Evidence/Assessment cards — met
  (`reply-format.md`, demo snapshot has `f-lf`/`f-perf` with 2 cards each —
  ran).
- Suggested comments (“Agent · suggested comment”, not for PR, linked
  from finding page, no separate card) — met (walk screenshot shows two
  suggested comments; `comments/threads.ts` `suggested: true, post: false`).

### §4.10 Second opinion — all met

- Action on card/finding, different model (§12) — met
  (`secondopinion/runner.ts`, `settings` distinct-model warning).
- Blind default for findings (topic + cited code), Check default for
  cards (sees claim), switchable — met (`second-opinion.spec.ts` “mode
  switch selects blind; finding defaults to blind”).
- Result block (model label, verdict agrees/partly/disagrees, reasoning +
  citations, missed; disagreement prominent) — met
  (`second-opinion.spec.ts` “disagrees prominently”,
  `second-opinion-service.spec.ts` “blind … cites code, prompt has no
  guide text” — isolation asserted on the real prompt).

### §4.11 PR description — all met

- Restated → links; branch tab shows commit messages read-only — met
  (`pipeline` restated mapping, `ingest/description.ts`).
- Author + open-PR gate; in-place edit with Discard/Save; local pending
  (“Edited · goes to GitHub…”, Revert); paragraph identity preserved —
  met (`routes/description.ts:61` viewer check, `description-m6.test.ts`).
- Round-trip: unedited paragraphs byte-identical — met
  (`submit/description.ts`, description golden tests).

### §4.12 Submit review — all met

- Nothing reaches GitHub until Submit — met (`gh-writes.test.ts`).
- Button count, panel (locations + drafts, Cancel, Submit as \<user\>) —
  met (ui-walk opened the panel; `submit-m6.test.ts` preview).
- One review + description update; branch-without-PR disabled with reason
  — met (`submit/submit.ts:226` single `gh api …/reviews` call;
  “branch has no PR” 400 ran against the built service).
- Head-moved refusal; empty-draft errors; expectedCount concurrency guard
  — met (`submit-m6.test.ts`).
- Crash safety (new): in-flight lease + GitHub reconcile, 409 while a
  submit is in flight, recovery without double-post — met
  (`submit/lease.ts`, `submit-m6.test.ts` “crash safety”, ran).

### §4.13 Diff — all met

- Toolbar (Files collapsed, Unified/Split, Hide uninteresting default on,
  Fold/Unfold all) — met (`e2e/diff.spec.ts`, walk shows all controls).
- Files panel (filter, Source/Tests/Docs/Config/Generated chips, Hide
  reviewed + hunk progress, compacting tree + counts, click-scroll) — met
  (`diff.spec.ts`, `source/diff/diffLogic.test.ts` 19 tests).
- File header (chevron, path, +/−, reviewed count, toggle) — met.
- Git's own hunks (≤3 context, merged runs); header format + raw `@@` on
  hover; fold/Summarize/note/reviewed actions; hunk card (summary+note,
  Delete); folding hides code only — met (`shared/src/diff.ts` +
  `diffLogic.test.ts`, `diff.spec.ts` “fold and unfold”).
- Hide uninteresting (generated/import-only/docs-or-config, one row per
  run with reason, click reveals; one-line never hidden; cited never
  hidden) — met (`ingest/uninteresting.ts` + hunk-pass override
  `runner.ts:1383`, `diff.spec.ts` “hide uninteresting collapses runs”,
  live runs: “hide violations: none”).
- Fold all summarizes+folds non-hidden; Unfold keeps summaries — met
  (per-hunk `summarize` jobs, deduped; `docs/pipeline.md` “Fold-all choice”).
- Unified sideways scroll; Split equal halves + wrap + widen; pinned rows
  — met (`DiffView.test.tsx`, `diffLogic.test.ts`).
- New-commits banner; stale/outdated per §8 — met
  (`settings-versions-service.spec.ts` “refresh banners counts”).

### §4.14 Settings — all met

- Model pickers per role with provider models — met
  (`settings.spec.ts` “model pickers list provider models”, `routes/settings.ts`,
  `GET /api/models` ran 200).
- Prompts (Template raw + Expanded with L0–L4 marks, tokens, cache part;
  view-only) — met (`settings.spec.ts`, `prompts-route.test.ts`,
  `GET /api/prompts` ran 200 from the global install).
- Limits/budgets (sessions per provider, inline budget, rebuild
  thresholds) — met (`settings.spec.ts` “limits persist across reload”).
- Jobs (running/queued, prompt link, tokens, cache-hit, provider) — met
  (`settings.spec.ts`, `GET /api/jobs` ran; prompt snapshots now served
  per-job to keep lists small).
- Shared context (contributions + thread + delete) — met
  (`sharedctx.test.ts`, `routes/contributions.ts`).

### §4.15 Conventions — all met

- Chevron/Delete/×/check placement + AI/user initials + teal/amber — met
  (walk screenshot; prototype CSS class names kept).
- Only “Guided review” + “Agent finding” labels — met (walk).
- Comments/expansions share header layout — met (`ThreadView` shared).
- `hidden` stays hidden — met (`styles/prototype.css:25`
  `[hidden]{display:none!important}` — the two prototype bugs' fix,
  present).

## §6 Agent runner — all met

- ACP first via SDK, adapters as stdio subprocesses — met
  (`agent/acp/connection.ts`, M0 spike `docs/m0-acp-spike.md`).
- Nothing outside `agent/acp/` imports ACP — met (`eslint.config.mjs`
  `no-restricted-imports` + `test/acp-isolation.test.ts`, in `check`).
- Interface (`start/fork/load/prompt/close`, event union) — met
  (`shared/src/agent.ts`, `agent/acp/runner.ts`).
- Fork works both adapters (+Claude resume quirk handled) — met (M0
  results table 12/12 + 11/12; `runner.ts` fork/resume).
- No-fork fallback (byte-identical first message, caching) — met (M0 §8
  rows; `pipeline/runner.ts:830 forkFor`; `sessions/manager.ts:271
  forkConversation`; fallback test `pipeline.test.ts:444`).
- Read-only permission policy asserted for both adapters — met
  (`agent/acp/permissions.ts` deny-by-default; Claude tools allowlist +
  `workspace-write` + sandbox for Codex; `docs/acp-runner.md`; unit
  permission tests in `acp-runner.test.ts` 14 tests).
- `load` drain, `cancel` → cancelled, crash → retryable + transparent
  restart — met (`acp-runner.test.ts`: load replay drain, cancel
  mid-reply, crash/restart).
- Usage aggregation incl. background titling models — met
  (`agent/acp/usage.ts`, delta-ized Claude counters, unit-pinned).

## §7 Data model and IDs — all met

- Entities per §7.1 table — met (`shared/src/entities.ts` 699 lines;
  migrations 001–003 + sessions table; `store.test.ts`, `state.test.ts`).
- ID grammar (§7.2 all nine forms) — met (`shared/src/ids.ts`,
  `links.ts`; `ids` unit tests).
- App assigns IDs; agents never invent them — met: every token validated
  (`validate/*`); unknown IDs fail/repair/unverified; unknown `concept:`
  slugs become hidden candidates (`validate/validate.ts`, `validate.test.ts`).
- Short forms dropped in UI/prompts, stored full — met
  (`reply-format.md` §1, canonicalisation in `validate/lookup.ts`).
- Card/block IDs stable across revisions — met (`guideRevisionForSnapshot`,
  anchor `quotedText`+`prefix/suffix` model).

## §8 Versions — all met (table row by row)

- Content-tied anchors (position + quote + prefix/suffix + hunk hash) —
  met (`versions/anchors.ts`, `versions-anchors.test.ts` incl. rebase/amend
  fixtures).
- New head SHA → version + ID mapping; old versions viewable — met
  (`versions/refresh.ts`, `review_version_files`, `GET ?version=n`,
  `versions-refresh.test.ts`, `settings-versions-service.spec.ts` “v1
  viewable”).
- Rebase-vs-branch by content hash + `range-diff` — met
  (`versions/compare.ts`, `rangeDiff.ts`; refresh test (a): rebase
  no-conflicts → “no change”, state preserved — ran).
- Hunk state kept by hash / cleared+regen+note-kept — met (test (b)).
- Code comments moved vs outdated (+snippet + new-code link) — met
  (tests (b)(c)(e)).
- Cards stale badge + Update; findings rechecked; pinned code re-pinned;
  threads' change lists — met (`versions/citations.ts`, `update.ts`,
  `versions-update.test.ts`).
- Manual update only (fetch/compare free on open/refresh; pass on Update)
  — met (`routes/reviews.ts` refresh vs update; update pass jobs).
- Table row “Pinned code / Thread in progress” — met
  (`secondopinion/excerpts.ts` re-pin; `sharedctx/threads.ts` change lists).

## §9 Context — all met

- Layers L0–L4 ordering + budgets (40k guess, hunk-header fallback) —
  met (`context/layers.ts`, `context.test.ts` header/summary fallback).
- Per-model base cache; base key (version, guide rev, model) — met
  (`sessions/manager.ts`, `decideRebuild`).
- Base = L0 + one L1+L1b+L2 message + “ready”; conversations fork(base)+L4;
  reader never forked; fan-out after warm — met (`pipeline/runner.ts:790
  ensureBase`, `sessions/manager.ts:315 fanOut`, `docs/pipeline.md`).
- Append-only log (never UI state; card-scoped depth/examples/diagrams;
  one-line thread settle; full new cards/out-of-base answers; deletion
  lines); 2k-token batch growth; per-session last-seen + filtered change
  lists — met (`context/log.ts`, `sharedctx/*`, `sharedctx.test.ts`
  batch/change-list cases).
- Rebuild triggers (version/guide regen, cache expiry, superseded ratio)
  — met (`context/rebuild.ts decideRebuild`, `sharedctx/rebuild.ts`).
- Contributions (facts/corrections/open_questions/reader_notes/replaces,
  ≤3, citation-required, user-accept for corrections, small-model merge on
  rebuild) — met (`sharedctx/contributions.ts`, `taxonomy.ts`,
  `contributions.test.ts`, `routes/contributions.ts` accept/dismiss).

## §10 Linking — all met

- Inline tokens (all six + `ann:`) + `|label` rules — met
  (`reply-format.md` §1, `shared/src/content`, `content-parse.test.ts`).
- Trailing fenced JSON for structured fields, removed before display —
  met (M0 20/20 parse; `splitReply`, `reply-format.md` §10; malformed =
  job error).
- Four MCP tools + reader-only `pin_context` — met (`mcp/tools.ts`,
  `registry.ts:190` refusal; `mcp.test.ts`: surface per role, pin
  attribution, traversal refusal — ran).
- Validation (existence, ranges, anchor substring, hidden concept
  candidates) — met (`validate/*`, `validate.test.ts`).
- Repair (same-hunk few-lines auto-fix; else dimmed + logged; one repair
  turn when ≥2 fail) — met (`validate/validate.ts`, pipeline repair turn;
  live: repairs resolved, 0 unverified).

## §11 Pipelines — all met

1. Ingest (PR detection, fetch, merge-base diff, IDs, classification,
   budget check, worktree) — met (`ingest/*`; 300-file ingest 0.15 s —
   ran).
2. Reader (explore, problem/central/directions, hidden concepts,
   `pin_context`) — met (`pipeline/runner.ts:879`, demo 17 cards — ran).
3. Base build — met (`ensureBase`).
4. Parallel forks (critic ×2 with evidence/assessment/confidence +
   suggested comments; concept stubs) — met (demo `f-lf`/`f-perf` — ran).
5. Hunk pass (small model, summary + hiddenReason, never cited/one-line)
   — met (demo 8 summaries — ran from global install).
6. On demand (depth/go-deeper/explain/examples/diagrams/answers/concepts/
   second opinions) — met (`pipeline/actions/*`, `actions-m4.test.ts`).
7. Update pass (changed/new hunks only) — met (`versions/update.ts`,
   `enqueueUpdatePass`, `versions-update.test.ts`).

## §12 Models and concurrency — 8 met, 1 partly

- Main/small/second-opinion roles; one base per model; small jobs get only
  what they need — met (`settings.models`, `runSmall` no-fork).
- Second-opinion isolation (own base L0+L1, never guide text/findings/
  contributions/pins beyond cited) — met (structural: `secondopinion/base.ts`;
  tool-level: `registry.ts:286` restricted search/resolve; e2e asserts the
  real prompt has no guide text).
- Per-provider cap 4 (setting `sessionsPerProvider`) — met
  (`jobs/queue.ts`, `settings.test.ts` cap cases).
- Priority queue (asked > visible > background) — met (`JOB_PRIORITY`,
  `jobs.test.ts` ordering).
- Backoff on rate limits + shown on job — met (`backoff.ts`,
  `isRetryableError` 429/quota in `agent/acp/errors.ts`, `backing-off` state).
- Cancel on card close (`session/cancel`) — met (`actions/close.ts`,
  `cancelAnnotationJob`; abort path in queue; `acp-runner.test.ts` cancel).
- Dedupe identical requests — met (queue dedupe + `findActiveJob`;
  dedupe freed on interrupt — this branch).
- Idle close + `load` reopen — met (`sessions/manager.ts:430 sweepIdle`,
  `ensureConversation`; restart script proves reopen-or-rebuild).
- **Partly:** “reuse results for identical requests, keyed by
  (anchor, kind, depth, base version)” — in-flight dedupe exists, but
  there is no cross-request result cache (a repeated Explain re-prompts;
  depth round-trips via cached levels, `actions-m4.test.ts:292`). No
  evidence this costs users (depth cached levels cover the hot case);
  recorded as future work, not a regression.

## §13 Prompts — all met

- Files with front matter (role/tier/variables) — met (`prompts/*.md` 18
  templates; `prompts/loader.ts`).
- Deterministic rendering (stable order, no timestamps, golden files) —
  met (`prompt-goldens.test.ts`, `prompts.test.ts`).
- All 14 template rows present — met (18 files cover every row;
  `routes/prompts.ts` serves template + expanded).
- Settings shows template + expanded with L0–L4 marks, tokens, cache part
  — met (`settings.spec.ts`, `prompts-route.test.ts`).
- Diagrams: D2 with `link:` citations on shapes/connections — met
  (`reply-format.md` §5, `prompts/includes/d2-convention.md` single source,
  `service/src/diagrams/` stdin-only renders, pre-check denylist, strict
  SVG sanitisation, `GET /api/reviews/:id/diagrams/:hash?theme=` endpoint;
  Mermaid removed entirely per user direction, PRD §19.4 resolved as D2).

## §14 Shell, install, security, storage — all met

- Service on 127.0.0.1 + per-install token on every HTTP and WS route —
  met (enumerated all 30 routes + WS: 401 unauth — ran; `server.ts:169`
  gate; WS handshake 401 — ran).
- Token never in URL after first load — met (`web/src/api/client.ts:55`
  moves URL token to `localStorage` + `SameSite=Lax` cookie; ui-walk).
- Host/Origin checks (DNS-rebinding, cross-site WS) — met (new
  `security/host.ts`, 403 for evil Host/Origin — ran; `host.test.ts`).
- MCP per-session secrets (unguessable 256-bit, scoped per review, expire
  with session/review, pin_context reader-only) — met (`mcp/registry.ts`
  + lifecycle fixes + `mcp.test.ts` “secret lifecycle” — ran).
- `get_code` + file routes traversal-proof — met (`checkPathInRepo`,
  `mcp.test.ts` traversal cases — ran).
- Agent permission policy read-only both adapters — met (§6).
- Storage (`~/.local/share/unvibe`, SQLite + per-review folders, worktree
  beside data dir, checkout untouched, delete removes + prunes) — met
  (empirical lifecycle on a real repo — ran; `reviews/delete.ts`).
- Nothing starts at login; idle exit (10 min, no window + no jobs) — met
  (`e2e-linux.mjs` idle-exit; empirical 8 s idle exit + stays up with
  jobs — ran).
- Install `npm install -g github:<org>/unvibe#release` + `unvibe setup` +
  same command updates — **met**: the `#release` ref serves a
  self-contained tree (built service + web, no build step, no lifecycle
  scripts, no devDependencies), installed with **no flags** on npm 11 and
  npm 10 — ran both, tarball AND git-ref phases fully green (adapter
  bundles present, demo completes from the installed copy, readiness
  reports the user's executables, 3.3 MB tarball / ~66 MB installed on
  Linux in ~4 s; no agent platform binary downloaded — verified against
  the isolated npm cache). Agents run the user's installed `claude`/`codex`
  (readiness/doctor report path + version). Tarballs attached to GitHub
  releases install identically. Installing from the default branch (source
  tree, needs devDependencies + build) is unsupported and undocumented.
- Stable default port 4517; foreign occupant diagnosed — met
  (`config.ts`, doctor port check distinguishes ours/foreign — this branch).

### §14.1 Endpoints — all met (ran)

`GET/POST /api/repos` ✓, `GET /api/repos/:id/changes` ✓,
`POST /api/reviews` ✓, `GET /api/reviews/:id` (+`?version=n`) ✓,
`POST …/refresh` ✓, `POST …/update` ✓, `POST …/actions` ✓,
`PATCH …/hunks/:hash` ✓, `POST …/hunks/:hash/summarize` ✓,
`PATCH /api/reviews/:id/comments/:id` (+POST/DELETE/replies) ✓,
`PUT /api/reviews/:id/description` ✓, `POST …/submit` (+preview,
pr-comments) ✓, `GET/PUT /api/settings` ✓, `GET /api/models` ✓,
`GET /api/prompts` ✓, `GET /api/jobs` (+:id, :id/prompt, cancel,
priority) ✓, `WS /api/events` ✓. Extras (all token-gated):
`GET/DELETE /api/reviews`, `POST …/resume`, `GET /api/readiness`,
`GET /api/viewer`, contributions routes. No stubs remain except the
no-queue/no-ctx 501 fallbacks, which never trigger in production wiring.

## §15 GitHub/git — 9 met, 1 partly

- PR lists (`gh search … --author @me / --review-requested`) — met
  (`repos/changes.ts`, start page).
- `gh pr view --json …` metadata/description/files — met (`ingest/source.ts`).
- `git diff merge-base...head` locally (not `gh pr diff`) — met
  (`versions/refresh.ts:240`; 300-file ingest ran).
- Existing threads (`gh api …/pulls/…/comments`) — met
  (`submit/existing.ts`, `submit-m6.test.ts` read-only fetch).
- One-review submit (`gh api …/reviews event=COMMENT`) + `gh pr edit
  --body-file` — met (`submit/submit.ts:232`, exact-payload test).
- `git worktree add <managed-path> <head>` — met (`ingest/source.ts:198`).
- `range-diff` rebase comparison — met (`versions/rangeDiff.ts`).
- Description round-trip (unedited paragraphs byte-identical) — met
  (`submit/description.ts` + goldens).
- `GITHUB_TOKEN` unset for all `gh` — met (`exec/gh.ts:12`,
  `gh-writes.test.ts`, doctor/readiness share the wrapper).
- **Partly:** live GitHub submit (`test:live:submit` draft-PR script
  exists, `mise run test:live:submit`) — not run here (needs a real repo
  + login + writes a draft PR; user-gated by design).

## §16 Non-functional — all met (measured 2026-10-10, Linux)

- Time to first card <~90 s (urllib3#5020 class): **3.8 s (Claude) /
  23.8 s (Codex)** live (`docs/live-pipeline-results.md`); replay demo
  fills 17 cards in ~15 s wall (ran).
- Interactive latency ~5 s warm-base: reader streams immediately
  (`firstCardAt`, WS text events in first 10 s — live doc); replay ask
  answers in <5 s (restart script observed).
- Cache-hit rate measured + shown (target: mostly cache reads):
  **0.947 (Claude) / 0.834 (Codex)** live; per-job + totals in Jobs/Settings.
- Restart loses no user data; sessions reopen/rebuild: restart script
  (SIGKILL mid-reader, mid-ask) all green; jobs interrupted-visible +
  resumable; reply falls back to fresh fork.
- Privacy: loopback-only enforced at three layers (browser CSP + suite
  network tripwires + static guards + subprocess allowlist —
  `network-*.test.ts`, `subprocess-allowlist.test.ts`, all in `check`).
- Snapshot size: 300-file ingest 0.15 s; `GET` 20 ms @ 433 KB;
  +361 B/annotation (200 annotations measured); jobs lists omit prompt
  snapshots (per-job fetch) — `GET` stays reasonable after hundreds of
  annotations and jobs (this branch).

## §17 Milestones — all met

- M0 ACP spike — met (`docs/m0-acp-spike.md`: fork + cache + trailing
  JSON on both adapters, 12/12 and 11/12).
- M1 service/ingest/diff — met (start page, ingest, full §4.13 except
  agent summaries… summaries now exist too; token service, installable
  app, helper, idle exit — `e2e-linux.mjs` green).
- M2 reader/guide — met (reader/base/critic live or replayed; checked
  citations + hover; findings pages; hidden concepts; hunk summaries +
  reasons; live: 0 unverified, no hide violations).
- M3 interaction — met (explain/ask/note everywhere; depth/examples/
  diagrams/undo; expansions→links; open-as-page; read; contents; log +
  change lists + contributions + shared-context view).
- M4 comments/submit — met (threads ×3, Comments menu + For-PR drafts,
  suggested comments, author-gated description edit, one-review submit).
- M5 versions — met (refresh mapping, stale/outdated UI, hash-preserved
  hunk state, update pass, rebase-no-change test (a)).
- M6 second opinion + settings — met (blind/check, models/prompts/limits/
  jobs+usage settings page; isolation e2e on the real prompt).

## §18 Tests — all met

- Unit (diff/hash, IDs/validation, anchor remap incl. rebase/amend
  fixtures, log/change-list filtering, prompt goldens) — met
  (`check`: shared 45, service 379+, web 111).
- Integration with fake replay runner — met (`FakeAgentRunner`,
  `ReplayAgentRunner`, pipeline/actions/versions suites).
- Live evaluation (urllib3#5020 + scratch repos; citation validity,
  finding precision, cache-hit) — met (`docs/live-pipeline-results.md`,
  `test:live:*` scripts; live suites excluded from `check` by design).
- UI behaviour vs §4 + prototype — met (61 Playwright specs incl.
  prototype-referenced cases + network-privacy).

## Intentional deviations from the PRD (confirm)

1. Install is `npm install -g github:<org>/unvibe#release` (PRD §14 says
   `npm install -g github:<org>/unvibe`, no ref). **Deviation, stated
   plainly:** the default branch is the source tree, not an installable
   package — it needs devDependencies + a build, and npm's git-URL handling
   for packages with a `prepare` script is broken upstream on npm 10/11
   (dangling symlinks; ENOTEMPTY preparation races on non-trivial trees).
   The `#release` ref serves a self-contained tree that installs with no
   flags; updating is the same command. Release tarballs (attached per tag)
   install identically.
2. Fold-all is client-fan-out per-hunk `summarize` (no batch endpoint) —
   recorded in `docs/pipeline.md`; same observable behaviour.
3. Suggested-comment links are app-built `comment-link` blocks, not
   agent-written inline text — `docs/reply-format.md` §7b.
4. `UNVIBE_AGENT` (`replay`/`none`/ACP) runner selection — test/demo seam
   with no PRD counterpart; production default is ACP.
5. Queued jobs come back *interrupted* after restart, not orphaned
   (this branch): nothing rebinds runs, and orphans blocked resume via
   dedupe. Retry paths are `resumeReview` + action rebuilds.
6. MCP secrets for live reviews persist until review delete / base-unused
   cleanup / process exit (fork sessions stay open for follow-up turns);
   all cross-review access is structurally impossible (review-scoped
   registry).
7. Package names carry the `@agentclientprotocol/` scope (PRD §6 names
   were slightly off) — `docs/m0-acp-spike.md` table.
8. Trailing fenced JSON block for structured output (PRD §19.3 resolved
   for it: 20/20 live parses) — `docs/m0-acp-spike.md`.
9. Diagrams are D2 with `link:` citations (PRD §19.4 resolved as D2;
   Mermaid removed entirely at the user's direction — no compat path, no
   stored data to preserve). Honest tension with the PRD's "nothing extra
   to install": D2 needs a user-installed `d2` binary (≥ 0.9.0, the only
   version the reliability run vouches for). This is a user decision
   recorded in `docs/diagram-options.md` §7: reviews work fully without
   it (diagrams show source with a Settings → Environment note), and the
   demo ships pre-rendered SVGs so it needs nothing.
10. Acronym: second-opinion `workspace-write` (not `read-only`) for Codex
    (`read-only` refuses MCP calls) — `docs/acp-runner.md` quirks 6–7.

## Open list

### Fixed in this branch (done, in `check`)

Stale-dist guard; Host/Origin gate; MCP secret lifecycle; submit crash
lease; orphan-dedupe resume block; reply-after-restart; resume demo fill;
demo refresh 502; missing-checkout errors; job-list bloat; doctor port
diagnosis; user's CLIs via adapters (bundled `dist/adapters/`, no platform
binaries downloaded, ~66 MB installed); readiness/doctor path+version
gates; MCP server/discover shim for new CLIs; self-contained `#release`
install tree (no prepare/postinstall, literal no-flag installs verified on
npm 10+11, tarball + git ref).

### Web defects for the web agent

None found. 61 e2e green + manual walk (guide/diff/submit, 0 console
errors). One item to confirm visually when card controls land (§4.4
“Underlying principle” deepest-stepper case has no end-to-end drive).

### Needs the user's decision or a Mac

1. **Install path**: RESOLVED — `#release` ref + tarballs, both installing
   with no flags on npm 10 and 11 (verified in `check-global-install`).
   Open: the repo has no LICENSE file, so the release ships no licence
   statement for Unvibe's own code (third-party notices ship in
   THIRD-PARTY-NOTICES.md) — pick a licence.
2. **Install size**: RESOLVED — ~66 MB installed in ~4 s, nothing
   downloaded beyond 6 small runtime deps (was ~736 MB with bundled agent
   binaries). No decision needed.
3. **Mac**: run `docs/macos-testing.md` (15 min) — untested: osacompile
   applet, lsregister delivery, Gatekeeper xattr, Finder PATH, Chrome
   install flow on macOS.
4. **Live gates**: `test:live:submit` (draft PR), full live pipeline on a
   real PR — need logins + token spend + a scratch repo.
5. **Result reuse** (§12): no cross-request cache beyond in-flight dedupe
   + cached depth levels — accept or schedule.
6. Push the repo (CI workflow runs on push) and read the macOS leg.
