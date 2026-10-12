# Acceptance audit (hardening pass, branch `hardening`; audit-10 update 2026-10-11)

Method: every verdict below is backed by code (`file:line`), a named test,
or a command run against the **built** service (`mise run build` output) in
demo mode (`UNVIBE_AGENT=replay`, recorded pipeline, no tokens) against real
temporary git repos, plus Playwright (61 e2e green at audit time, plus a manual UI walk
with 0 console errors; audit-10 adds 2 principle specs + 6 reuse unit tests —
see §4.4/§12). A test that exists is cited as evidence only with
its name; behaviours were re-run where marked “ran”.

Verdicts: **met / partly / not met / cannot verify here**.

## Summary table

| PRD section | met | partly | not met | cannot verify |
|---|---|---|---|---|
| §0 constraints (5) | 4 | 0 | 0 | 1 |
| §4.1 layout (4) | 4 | 0 | 0 | 0 |
| §4.2 start page (5) | 5 | 0 | 0 | 0 |
| §4.3 pages (7) | 7 | 0 | 0 | 0 |
| §4.4 cards (6) | 6 | 0 | 0 | 0 |
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
| §12 models/concurrency (9) | 9 | 0 | 0 | 0 |
| §13 prompts (5) | 5 | 0 | 0 | 0 |
| §14 shell/install/security/storage (8) | 8 | 0 | 0 | 0 |
| §14.1 endpoints (17) | 17 | 0 | 0 | 0 |
| §15 gh/git (10) | 10 | 0 | 0 | 0 |
| §16 non-functional (5) | 5 | 0 | 0 | 0 |
| §17 M0–M6 done-when (7) | 7 | 0 | 0 | 0 |
| §18 test kinds (4) | 4 | 0 | 0 | 0 |
| **Total** | **211** | **0** | **0** | **1** |

(Audit-10 correction: the prior total (204/2) was stale — the row values
already summed to 208 met + 3 partly + 1 cannot-verify = 212 requirements.
After closing the three partly items below, the rows sum to 211 met + 0
partly + 1 cannot-verify = 212.)

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
- **Diagnostics + Doctor + Reload (#20)** — met: one diagnostics module for
  doctor + service (scrubbed login+interactive PATH probe with delimiters,
  timeout, fallback; every candidate with shim/symlink/version-only-from-
  success/choice; `unvibe doctor --strict` + service-view diff); Doctor page
  (`/doctor`) with full errors, PATH diff, service identity, warnings, Copy
  diagnostics (home+token redacted); Reload everything re-probes PATH,
  restarts adapters (in-flight fail as retryable, jobs retry), clears
  caches, re-checks d2, without restart.
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

- Repo selector in the top bar with remembered + detected checkouts —
  met (`StartPage.tsx` native `<select>` next to the brand: remembered
  under "Repos", detected under "Detected checkouts" with the local path
  as the title; selection persisted in `unvibe.start.repoId`, demo never
  selectable; `e2e/start.spec.ts` "repo selector lists remembered and
  detected repos, persisted").
- Everything follows the chosen repo — met: the Reviews list shows only
  the selected repo's reviews (filtered on `ReviewSummary.repoId`, which
  the service populates from the review row — `reviews/list.ts:151` — so
  no owner/name matching in web code, correct for remembered and
  `detected-<sha1>` ids alike); PR / branch lists and "Open a PR by URL
  or number" stay scoped as before; a pasted PR URL for a different known
  repo opens it and switches the selector; while a new selection loads,
  the old repo's lists stay hidden behind a loading hint (`listsFor`
  gate in `StartPage.tsx`; `e2e/start.spec.ts` "reviews list follows the
  selected repo").
- No "New review" / "Try the demo" sections — met: no divider,
  scroll-to button or `newReviewRef` plumbing; the PR / branch sections
  follow the Reviews list; the demo is a row inside Reviews ("Demo · no
  tokens", `{ repoId: "demo" }`, shown regardless of the selected repo;
  an existing demo session row replaces the second entry —
  `e2e/start.spec.ts` "demo row opens the fixture review").
  `newreview-agent-hint` sits by Reviews, `newreview-gh-hint` by the PR
  lists (same `data-testid`s).
- No repos: short empty state linking to `/settings#repositories` (demo
  row still shows) — met (`data-testid="no-repos"`; exercised by
  `e2e/real-service.spec.ts`, whose fresh data dir starts repo-less).
  A failed `GET /api/repos` keeps sessions visible instead (offline copy
  in the same box).
- List loads are per-selection loading / loaded / failed — met: the PR
  input never waits on the lists; switching repos clears the old lists
  synchronously (no stale frame) behind a loading hint, and a nonce
  guarantees every selection pairs with a fresh load (re-selecting the
  current repo still fires `change` and reloads — without this the
  effect's id-equality bail-out stuck the page on "Loading…", found via
  a 3-minute e2e hang whose trace showed completed responses); a 30 s
  timeout bounds the loading state regardless; a total failure shows an
  inline error with Retry; one failed filter shows its error in that
  section while the others render (`Promise.allSettled` in
  `StartPage.tsx`; the service already degrades gh/git failures to empty
  per source in `repos/changes.ts`, so gh being down never rejects —
  whole-request failures are unknown-repo 404s or an unreachable
  service). Covered by `e2e/start.spec.ts` (fail-all + Retry recovery,
  fail-two section errors with branches intact, deterministic held-load
  with release, same-value reselect reloads).
- Reviews whose repo is in neither list stay reachable — met: sessions
  with an unknown non-demo `repoId` render in a labelled orphan group at
  the end of Reviews with working open and Remove (`e2e/start.spec.ts`
  "reviews for checkouts no longer listed").
- Repos are added in Settings — met (`RepositoriesSection.tsx`:
  remembered repos with owner/name + path, add-by-path input with an
  empty-field hint; `#repositories` anchor; `e2e/settings.spec.ts`
  "repositories section lists remembered repos and adds by path").
  Remove is covered by the #27 bullet below (`DELETE /api/repos/:id` +
  per-kind confirms in the same section).
- Add by GitHub URL (#27, complete) — met end to end: `POST /api/repos`
  accepts a URL / `owner/name` / PR URL / `owner/name#N` (shared `repos.ts`
  parsing + table tests), clones blobless into
  `<dataDir>/repos/<owner>/<name>` via `gh repo clone`
  (`GITHUB_TOKEN` unset, prompt-free env), remembers the repo marked
  `managed`, reuses it on repeat adds (lowercase-canonical, one row per
  spelling), and refuses/degrades distinctly (400/404/403/gh-login/502);
  `DELETE /api/repos/:id` forgets the repo and deletes the clone for
  managed repos only (guarded, refused while reviews exist).
  UI: Settings → Repositories has a separate add-by-URL row (client-side
  validation with the same parser, "Cloning owner/name…" busy state,
  service errors via toast), marks managed clones ("Cloned by Unvibe",
  "(cloned)" in the start-page selector), and removes with per-kind
  confirm copy (409 surfaces as is). The start page offers to clone on a
  pasted PR URL for an unknown repo (confirm selects the repo and opens
  the PR; cancel keeps the input) and shows the service's `fetchError`
  note once above the lists.
- Authoring / review-requested / branches / prior reviews with
  unread+stale (“new commits · Update”) — met (`repos/changes.ts`,
  `reviews/list.ts`, `e2e/start.spec.ts`, `settings-versions-service.spec.ts`
  refresh banner counts).
<- Selections remembered — met (selector in `localStorage`,
  `start.spec.ts` persistence round-trip; last-opened ordering in
  `reviews/list.ts`).
- Native folder picker (#26) — met: `POST /api/repos/pick-folder`
  (frontmost osascript dialog / zenity→kdialog with cancelled/unavailable
  outcomes, `pick-folder.test.ts`) plus the `BrowseFolderButton`
  (`BrowseFolderButton.test.tsx`), mounted in the Settings Repositories
  section beside the path field: picking fills the input (the user still
  clicks "Add by path"), the unavailable reason shows inline
  (`RepositoriesSection.test.tsx`), and the text field stays as the
  fallback.

Conformance note: this matches PRD §4.2 ("For the selected repo: …")
more closely than the previous all-repos Reviews list did — no PRD edit
needed (that deviation is closed, not added).

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

### §4.4 Cards — all met (audit-10)

- Collapse chevron, title-row-only collapsed — met (`guide.spec.ts`).
- Depth −/+ stepper, 3 dots, in-place rewrite, underlying principle at
  deepest, on-demand + kept — met (`actions/depth.ts`,
  `actions-m4.test.ts` “depth round-trips”).
- Examples / Add diagram inserts, never duplicated — met
  (`actions/examples.ts`, `diagram.ts`, dedupe in apply; audit-10 adds
  upfront `reused:true` short-circuit so repeats cost no agent call —
  `reuse.test.ts`).
- Undo (depth/examples/diagram, no redo, comments/expansions survive) —
  met (`actions/undo.ts`, `actions-m4.test.ts`).
- Mark read (grey + collapse), roll-up to page, muted links — met
  (`guide-service.spec.ts` “card read action”).
- “Underlying principle” block at deepest `+` — met (audit-10):
  `e2e/depth-principle-service.spec.ts` (real service, `UNVIBE_AGENT:
  "replay"`, shared harness, demo review) steps a page card to deep,
  presses + → exactly one principle block; presses + again → still one
  plus `#toast` “deepest/nothing more”; undo removes it; same flow on an
  expansion card (new `depth-expansion-deep.md` fixture + manifest entry;
  normal standard→deep steps strip the fixture principle, only + at
  deepest adds it — `actions/depth.ts` `addPrinciple` flag; ran 2/2 green).

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
- Comment marker (bubble + count, only never-quoted) + footnote chips
  sharing the citations line (issue #72) — met (`guide/Markers.test.tsx`
  quoted-vs-unquoted + footnote chips; `e2e/anchor-footnotes-service.spec.ts`
  chip on the citations row).
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
- Anchor lost → footnote chip on the citations line, open cards stay with
  a "from an earlier wording" hint (issue #72, replaces the collapsed-card
  fallback) — met (`interaction/cards.ts` visible-level `markStaleAnchors`
  + `cards-stale.test.ts`; `guide/Markers.test.tsx`,
  `guide/CardView.test.tsx` footnote chips;
  `e2e/anchor-footnotes-service.spec.ts` closed → deep → chip → open →
  back → highlight).
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
- Syntax highlighting (issue #23): plain rows first, token colours after
  (lazy Shiki core/engine/grammars, class-based theme colours, content-hash
  cache); unshipped languages stay plain — met
  (`source/diff/highlight/*.test.ts(x)`, `e2e/shiki-highlight.spec.ts`).
- New-commits banner; stale/outdated per §8 — met
  (`settings-versions-service.spec.ts` “refresh banners counts”).

### §4.14 Settings — all met

- Model pickers per role with provider models — met
  (`settings.spec.ts` “model pickers list provider models”, `routes/settings.ts`,
  `GET /api/models` ran 200). Switching a role's provider only browses that
  provider's list and saves nothing; choosing a model saves provider + model
  together, with no false “no longer offered” alert mid-browse (issue #87;
  `ModelsSection.test.tsx`).
- Model display names (#21) — met: `GET /api/models` carries `name` +
  `description` from the adapters; pickers show display name beside the id
  with description as secondary text (Claude + Codex); readiness, Doctor,
  jobs and second-opinion labels use the same format; `opus` (Opus 5.5)
  outranks dated `claude-opus-5` (older Opus 5) in defaults + tests.
- Prompts (Template raw in Settings — six sections in tabs, issue #61:
  Repositories, Models, Environment, Prompts, Limits and budgets, Version,
  with the tab in `?tab=`, older `#section` links still landing on the
  right tab, and unsaved edits surviving tab switches; per-review Expanded
  with L0–L4 marks, tokens, cache part on the debug page's Prompts tab,
  issue #60: collapsible templates + layers with Expand/Collapse all;
  view-only) — met
  (`settings.spec.ts`, `e2e/debug.spec.ts`, `prompts-route.test.ts`,
  `GET /api/prompts` ran 200 from the global install).
- Limits/budgets (sessions per provider, inline budget, rebuild
  thresholds) — met (`settings.spec.ts` “limits persist across reload”).
- Jobs (running/queued, prompt link, tokens, cache-hit, provider) — met
  (issue #32; on the per-review debug page's Jobs tab now, relocated
  unchanged from Settings apart from the redundant divider: `e2e/debug.spec.ts`,
  `GET /api/jobs` ran; prompt snapshots now
  served per-job to keep lists small; the per-job prompt toggle lazy-loads
  as before).
- Shared context debug page (issue #32; per-review `/review/:id/debug`,
  not in Settings): base keys + stats + current pack, log lines
  verbatim in fenced blocks under in-base/ready/waiting headings (issue
  #75), contributions with thread + delete — met
  (`shared-context-debug.test.ts`, `routes/shared-context.ts`,
  `e2e/debug.spec.ts`). Issue #60 puts Jobs / Prompts / Shared context in
  tabs (tab in `?tab=`, panels kept mounted) and every large block in a
  collapsible with a sticky summary (Base open, the rest closed;
  Expand/Collapse all on Prompts + Shared context; open state survives tab
  switches, job updates and contribution deletes).

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
  (`agent/acp/connection.ts`, M0 spike the `spike/acp` branch (`docs/m0-acp-spike.md`)).
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
- Per-model base cache; base key (review, version, guide rev, model) — met
  (#43: the key had no review id, so reviews shared a base and a removed
  review's session was reused when the change was added again; Remove now
  closes the review's sessions)
  (`sessions/manager.ts`, `decideRebuild`).
- Base = L0 + one L1+L1b+L2 message + “ready”; conversations fork(base)+L4;
  reader never forked; fan-out after warm — met (`pipeline/runner.ts:790
  ensureBase`, `sessions/manager.ts:315 fanOut`, `docs/pipeline.md`).
- Append-only log (never UI state; card-scoped depth/examples/diagrams;
  one-line thread settle; new cards, findings, out-of-base answers and
  contributions in full, as text, never cut short (issue #77); deletion
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
- Inline Markdown inside a block (bold, italic, strikethrough, links,
  escapes; raw HTML escaped, tokens resolved before emphasis) — met
  (#66; `markdown-it` inline mode in `renderInline`,
  `content-parse.test.ts`). Streaming returns finished cards only; the
  unused in-card partial parser is gone (#67).
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
   Root cards stored once (#28): streamed cards and the final apply share
   one id scheme (`readerCardId`), the final reply replaces whatever was
   streamed, and text before the first `## ` card is dropped — met
   (`pipeline/apply.ts`, `pipeline.test.ts` “stored once”). Reviews
   created before the fix keep their duplicate cards; no migration.
3. Base build — met (`ensureBase`).
4. Parallel forks (critic ×2 with evidence/assessment/confidence +
   suggested comments; concept stubs) — met (demo `f-lf`/`f-perf` — ran).
5. Hunk pass (small model, summary + hiddenReason, never cited/one-line)
   — met (demo 8 summaries — ran from global install).
6. On demand (depth/go-deeper/explain/examples/diagrams/answers/concepts/
   second opinions) — met (`pipeline/actions/*`, `actions-m4.test.ts`).
   Full concept pages may draw a `d2` diagram inline, same rule as
   explain/go_deeper (#69; the template used to recommend one in prose).
7. Update pass (changed/new hunks only) — met (`versions/update.ts`,
   `enqueueUpdatePass`, `versions-update.test.ts`).

## §12 Models and concurrency — all met (audit-10)

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
- “Reuse results for identical requests, keyed by (anchor, kind, depth,
  base version)” — met (audit-10): stored-result reuse with `reused:true`,
  no job, no tokens (`shared/src/api.ts` `ActionResponse.reused`,
  `SummarizeHunkResponse.reused`; dispatcher propagates). Per-action:
  explain reopens stored expansion (closed too) same version, deleted/new
  version → new; ask same message+anchor+version reuses (key now includes
  the message — previously different questions shared in-flight dedupe),
  different/deleted/new-version → new; depth cached levels + principle
  reuse; examples saturated / diagram present reuse; generate filled and
  concept full reuse; second-opinion same card+mode+model+version reuses
  (`findStoredSecondOpinion`); hunk summary same hash reuses
  (`POST …/summarize` 200 `reused`); follow-up/reply one-shot by design
  (suggestion consumed / new message — no stored reuse). Invalidated by
  new base version for explain/ask/second-opinion via `anchor.version` /
  stored `version`; card-scoped caches invalidate via content replacement
  (guide regen clears levels/examples/diagrams) — version-bump with card
  untouched correctly reuses (hash-preserved, like hunk state). Evidence:
  `test/reuse.test.ts` 6 tests, scripted fake, zero `prompts.length`
  growth on every repeat (ran).

## §13 Prompts — all met

- Files with front matter (role/tier/variables) — met (`prompts/*.md` 18
  templates; `prompts/loader.ts`).
- Deterministic rendering (stable order, no timestamps, golden files) —
  met (`prompt-goldens.test.ts`, `prompts.test.ts`).
- All 14 template rows present — met (18 files cover every row;
  `routes/prompts.ts` serves template + expanded).
- Settings shows the template; the debug page shows the per-review
  expanded text with L0–L4 marks, tokens, cache part — met
  (`settings.spec.ts`, `e2e/debug.spec.ts`, `prompts-route.test.ts`).
  Both pages are tabbed now (issues #60/#61; see §4.14).
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
   releases install identically (verified 2026-10-11 from GitHub itself:
   `gh release download v0.0.1-rc.3` + `npm install -g` on npm 10 and 11,
   doctor/start/demo/diagrams/stop green; the repo is private so the git ref
   needs `gh auth setup-git` and the tarball needs `gh release download` —
   a bare download URL 404s). Installing from the default branch (source
   tree, needs devDependencies + build) is unsupported and undocumented.
- Stable default port 4517; foreign occupant diagnosed — met
  (`config.ts`, doctor port check distinguishes ours/foreign — this branch).
- Preview builds, step 1 (issues #36, #41) — implemented, not a PRD requirement:
  `mise run preview:publish [-- <branch>] [--push] [--as-is] [--all] [--prune]`
  builds local `main` merged with the branch in a throwaway detached
  worktree (no worktree needed; `--as-is` builds the branch as it stands)
  into a local orphan `preview/<slug>` ref (merge conflicts fail clearly
  with nothing published; dirty-tree refusal for in-place `--as-is`
  builds; preview-only push guard, `unvibe` provenance field in the
  generated package.json now naming both sides
  `main@<sha> + <branch>@<sha>`);
  `unvibe update --list` / `unvibe update <channel>`
  lists channels via `gh` (GITHUB_TOKEN unset) — per-ref version, source
  commit/branch and build time read without cloning
  (`.../contents/package.json?ref=…`), typed as `UpdateChannel`
  (mirrors the step-2 shared type; owned by that branch) — and installs
  `github:indigoviolet/unvibe#<channel>`. Switching keeps your database
  and backs it up first to `<dataDir>/channel-backups/<channel>/`
  (never deleted; service must be stopped; no restart logic — refusal
  points at `unvibe stop`). Same-channel updates
  compare installed vs published commits (no-op with the commit, else
  reinstall in place); `--list` flags a newer build
  on the installed row. Pre-field
  installs map to their real channel from the version (source checkouts
  stay unknown). The install is pinned to this binary's npm prefix and
  verified at its package path — a landing elsewhere fails naming the
  path and `npm prefix -g`, swapping nothing. Plain modules are exactly
  `src/update/{channels,install,data-backup}.ts`, composed for the CLI in
  `src/cli/update-flows.ts`. A newer build may upgrade the database; if an
  older build then cannot open it, copy the backup back. Only database
  files are backed up; the
  rest of the data dir is shared, and leftover review folders are inert
  (DB-driven listing, random review ids, self-healing worktrees — see
  DEVELOPMENT.md).
  Evidence: `test/preview-publish.test.ts` (12), `test/update.test.ts`
  (49), `subprocess-allowlist.test.ts` (`npm` entry), `gh-writes.test.ts`
  still green. Note: the live database file is `unvibe.db`
  (`store/paths.ts`); `DEVELOPMENT.md`'s `unvibe.sqlite` name was stale
  and is corrected there — the backup covers both names when present.

### §14.1 Endpoints — all met (ran)

`GET/POST /api/repos` ✓, `DELETE /api/repos/:id` ✓ (new, #27: forgets the
row; deletes the clone directory for managed repos only, guarded to
`<dataDir>/repos`, refused while reviews exist), `GET /api/repos/:id/changes` ✓,
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

## §15 GitHub/git — all met (audit-10)

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
  `gh-writes.test.ts`, doctor/readiness share the wrapper). Managed-clone
  refresh (#27) is `git fetch origin` on managed checkouts only, before
  changes listings and review ingest/refresh (best effort, 30 s freshness +
  in-flight sharing; failures degrade to stale data with a `fetchError`
  note). User checkouts are never fetched implicitly.
- Live GitHub submit — met (audit-10, ran 2026-10-11):
  `mise run test:live:submit` green against sandbox draft PR
  `indigoviolet/lvu#2` (fresh temp clone, never `~/dev/lvu`, never merged,
  no other PRs/issues touched). Posted one review (`commentCount: 2`,
  inline + general) + description edit (`descriptionUpdated: true`,
  review URL `…/pull/2#pullrequestreview-5482002501`); PR still OPEN draft
  unmerged afterwards. Repeat-run verification fixed to `>=1` matching
  review (the sandbox PR accumulates reviews by design;
  `scripts/live-submit.mjs`). Guard still green: `gh-writes.test.ts`
  (only `src/submit/**` + `routes/submit.ts` write).

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
  A base rebuilt after a restart keeps the MCP secret it was started
  with (#68: `getBase` reported it as not fresh and the caller revoked
  it, so forks ran without the review tools); a restored base is never
  rebuilt from its persisted MCP URL (`sessions.test.ts`,
  `review-base-sessions.test.ts` restart case).
- Privacy: loopback-only enforced at three layers (browser CSP + suite
  network tripwires + static guards + subprocess allowlist —
  `network-*.test.ts`, `subprocess-allowlist.test.ts`, all in `check`).
  Dev-only exception (issue #29): with a Sentry DSN in the env the service
  and the Vite dev server report errors to Sentry. Releases carry neither
  SDK nor DSN (`sentry.test.ts`, dist scan in `network-guards.test.ts`).
- Snapshot size: 300-file ingest 0.15 s; `GET` 20 ms @ 433 KB;
  +361 B/annotation (200 annotations measured); jobs lists omit prompt
  snapshots (per-job fetch) — `GET` stays reasonable after hundreds of
  annotations and jobs (this branch).

## §17 Milestones — all met

- M0 ACP spike — met (the `spike/acp` branch (`docs/m0-acp-spike.md`): fork + cache + trailing
  JSON on both adapters, 12/12 and 11/12).
- M1 service/ingest/diff — met (start page, ingest, full §4.13 except
  agent summaries… summaries now exist too; token service, installable
  app, helper, idle exit — `e2e-linux.mjs` green).
- M2 reader/guide — met (reader/base/critic live or replayed; checked
  citations + hover; findings pages; hidden concepts; hunk summaries +
  reasons; live: 0 unverified, no hide violations).
- M3 interaction — met (explain/ask/note everywhere; depth/examples/
  diagrams/undo; expansions→links; open-as-page; read; contents; log +
  change lists + contributions + per-review shared-context debug page,
  issue #32).
- M4 comments/submit — met (threads ×3, Comments menu + For-PR drafts,
  suggested comments, author-gated description edit, one-review submit).
- M5 versions — met (refresh mapping, stale/outdated UI, hash-preserved
  hunk state, update pass, rebase-no-change test (a)).
- M6 second opinion + settings — met (blind/check, models/prompt-
  templates/limits settings page; jobs + expanded prompts + usage on the
  per-review debug page, issue #32; isolation e2e on the real prompt).

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
   were slightly off) — the `spike/acp` branch (`docs/m0-acp-spike.md`) table.
8. Trailing fenced JSON block for structured output (PRD §19.3 resolved
   for it: 20/20 live parses) — the `spike/acp` branch (`docs/m0-acp-spike.md`).
9. Diagrams are D2 with `link:` citations (PRD §19.4 resolved as D2;
   Mermaid removed entirely at the user's direction — no compat path, no
   stored data to preserve). Honest tension with the PRD's "nothing extra
   to install": D2 needs a user-installed `d2` binary (≥ 0.9.0, the only
   version the reliability run vouches for). This is a user decision
   recorded in `docs/d2-diagrams.md`: reviews work fully without
   it (diagrams show source with a Settings → Environment note), and the
   demo ships pre-rendered SVGs so it needs nothing.
10. Acronym: second-opinion `workspace-write` (not `read-only`) for Codex
    (`read-only` refuses MCP calls) — `docs/acp-runner.md` quirks 6–7.
11. Managed clones (#27): the PRD assumes reviews open on existing local
    checkouts (§4.2 "finds local checkouts", §14 storage). Unvibe now also
    clones repos itself (`gh repo clone -- --filter=blob:none` into
    `<dataDir>/repos/<owner>/<name>`, migration 005 `repos.managed`) and
    keeps those checkouts fresh with `git fetch`; reviews of a managed
    clone work exactly like reviews of a user checkout (a worktree per
    review, no separate ingest path). The user never edits the managed
    checkout, so fetching is safe; removing the repo deletes the clone
    (managed only), and only while it has no reviews.

## Open list

### Preview builds, step 2: version picker (branch `feat/version-picker`, issue #36)

In-app switching between `release`, `release-rc` and `preview/*` builds,
merged with step 1: one shared switch core (`update/switch.ts`) serves
the `unvibe update` CLI and the in-app `RealUpdater` (step-1 flow logic
moved, CLI keeps its output; step-1's 49 `update.test.ts` tests pass
unchanged via wrappers). One `UpdateChannel` type (shared); build
identity from the installed package.json (`readInstalledBuild`, no
second stamp); `dist/update-helper.js` shipped in the release tree and
asserted by `global-install-check` + a metafile containment test (node
builtins only). Contract first in `packages/shared/src/api.ts`
(`UpdateChannel`, `UpdateBuildInfo` on health + status,
channels/switch/status shapes, `unchanged`). `GET /api/update/status`
 always works; channels + switch are gated off by default
 (`versionPickerEnabled`) with 404, refused with 409 while a submit is in
 flight / a switch is pending / not running from an installed build —
 and with a structured 409 (`code: "jobs-running"` + count + blocking
 jobs) while jobs run unless forced (`force: true` skips only that
 refusal; the shutdown path stops the jobs and the outcome names the
 interrupted count) — and sit behind the same token + loopback
 Host/Origin gates as every other route. `from` is the locally installed channel
 (never "unknown"); same channel + same commit is 200 `unchanged`, a
moved commit reinstalls with an Update action on the current row (from
=== to; rollback is one reinstall + health, then `failed`
with the recovery command — never loops). Switch = commit + detached
self-contained helper (copied to the data dir so the npm swap cannot
pull it) + restart on the same port; the helper stops its own previous
generation (verified exited, lock released) before the rollback install
and waits for the install target / rollback source versions
respectively; the outcome (`ok` / `rolled-back` / `failed` + reason +
 log path, `failed` carries the `npm install -g ...#release` recovery) is
 surfaced by status. Shutdown is bounded and ordered (issue #30, fixed
 on this branch: abort jobs → dispose agents → close MCP sessions +
 WebSocket clients → force-close leftover sockets + close HTTP → DB last;
 4 s per step, 10 s deadline, then the process exits — the old hook order
 closed the DB first and `app.close()` hung on deaf sockets/MCP streams
 while agents were disposed last, failing real switches with `did not
 exit within 30000ms`; the stuck-service outcome now names `unvibe stop`
 + retry as the recovery). Web: Settings → Version (enable checkbox above the card, current
 version on top, one aligned row per version under a Versions/Refresh
 header sorted newest build first, with in-row confirm switch, restart wait with reload, rollback
 reason, update-available, installed-only notice, unchanged note, last
 switch outcome under a separator) plus a quiet preview pill in the
 review/Settings/Start headers; the mock API covers the whole flow
 incl. simulated switch + rollback.
 Evidence: `test/update-helper.test.ts` (success, install/unhealthy
 rollback, failed rollback, stuck service, generation stop order,
 expected-version waits, stale-sample guard),
 `test/update-updater.test.ts` (fake semantics + injection, real backend
 selection/rejection, state files, build identity, lease check),
  `test/update-routes.test.ts` (gate, structured jobs/lease/pending/
  installed refusals, force path + non-bypass, same-channel
  unchanged/update, auth/host, commit path with entry-path
  identification), `test/update-helper-bundle.test.ts`
 (metafile containment), `versionFormat.test.ts` (+ newer-available),
 `e2e/update-picker.spec.ts` (4/4 mock-mode green, full `test:e2e` 113
 green). Real-install drill (no pushes): two local preview trees via
 `release.mjs` into a bare repo (HEAD set — npm dereferences it), install
  A into a temp prefix, run it, switch to B through the real helper +
  real npm (health flipped, live DB carried over, slot `preview-drill-a` written),
  then a lying channels file forced a real-npm rollback to A
  (rolled-back + reason, pre-switch backup restored, lock held by the final generation). Privacy
 (§16) unchanged: the service itself still contacts nothing but loopback;
 listing shells out through `gh` under the user's login (opt-in gate,
 concurrent per-ref fetch); the new static-guard entries are the
 helper's loopback health probe, the `npm` literal, and the bundle shape.
 Open: helper restart on macOS still needs the human pass in
 `docs/macos-testing.md` (see #6).

### Fixed on this branch: managed clones (#27, complete)

- Service + contract + stubbed tests are green (`shared/test/repos.test.ts`,
  `service/test/repos-url.test.ts` + `repos-review-fixes.test.ts`): add-by-URL,
  blobless clone, fetch-before-list/ingest/refresh (15 s bound, prompt-free),
  guarded remove.
- Web wiring is done: Settings → Repositories has the add-by-URL row (shared
  client-side validation, named busy state, toasts), managed marks, and
  per-kind remove confirms; the start page offers to clone on pasted PR URLs
  for unknown repos and shows `fetchError` once. Covered by mock-mode
  Playwright specs (`settings.spec.ts`, `start.spec.ts`) plus a real-service
  spec for invalid input and path-checkout remove.

### User-facing copy (#45, branch `fix/45-user-facing-copy`, applied)

The numbered change list (365 entries: web 1–219, CLI/service 220–365)
is applied as written, one commit per area in list order, then the four
flagged renames as four own commits (Settings tab Repositories → Repos;
Version rows are channels with Installed replacing Current version;
environment check names are Main/Small/Second-opinion model; Reload
environment + Limits tab + plain Limits labels), then the copy guard.
Skipped entries (with reasons) and the commit hashes are in the
implementer's report on the issue; glossary item 5 ("Guided review"
default title) is deliberately not done and needs the owner's decision.
Small companion code changes the list calls for: shared stage→label map
(`web/src/guide/stageLabels.ts`, used by the start page and the guide
empty state, with `stageLabels.test.ts`); one `NO_AGENT_COPY` constant;
`friendlyError` where raw transport strings were printed (D2Diagram,
GuideThreads, SubmitPanel conflict/error states); label-based limit
error matching (`LimitsSection.tsx`); exported `ROLE_LABEL` for the
readiness fallback label; dispatcher 501 match follows the new text;
`UPDATE_USAGE` reuses `DB_RULE`; the Doctor pointer prints once after
the list (`formatDoctor`). Behaviour-neutral: `SubmitPanel.tsx` still
detects the conflict with `/head moved|refresh/`, the web still matches
`/no agent configured/`, the dispatcher still maps unknown-review (404),
shape (400) and 501 texts to statuses. Guard:
`web/src/copy-guard.test.ts` (TypeScript compiler API over literals,
template text and JSX text/attributes; scope, patterns and allowlist
format as proposed) passes with 3 allowlist entries (Icon.tsx SVG path
data; client.ts `/contributions` route paths; store.ts `snapshot` event
discriminator) and includes the second jargon list. PRD.md (§4.3 page
kind, §4.14 tab name, §14 token/link-handler wording) and
`prototype.html` (For-PR empty state) updated where they quoted a
changed string. Evidence: `mise run check` green (service 651, shared
105, web 234 unit tests), `mise run --force build` + `mise run test:e2e`
green; `unvibe --help` output in the issue report.
Open: the four flagged renames await owner confirmation (each reverts
independently); non-copy findings from the list are not fixed.

### Switching reviews in one tab (#70)

The web review store is global. Opening a second review in the same tab
used to keep the first review's guide whenever the second had a lower
`rev` (the stale-fetch guard compared revs across reviews). The guard
now applies within one review only, and `ReviewRoute` clears the store
when its review changes or it unmounts — met (`web/src/state/store.ts`,
`store.test.ts` “switching reviews”). The route clear has no test of its
own. A refetch of the previous review that resolves after the switch can
still land in the store; not seen, not guarded.

### Block anchors are card-scoped (#78)

Block ids restart at `b1` in every card, and a selection used to be
anchored on the bare block id, so an Explain or comment on one card also
rendered under the same-numbered block of other cards, and the service
read the host text from the first card with that id. Selections now send
`<card>#<block>` (expansions use their annotation id as the card), the
service looks a qualified id up in that card only and stores block
anchors qualified (`interaction/l4.ts: findBlock`, `comments/threads.ts:
buildAnchor`), and highlight marks search only the named card — met
(`comments-m6.test.ts`, `anchor.test.ts`, `SelectionToolbar.test.tsx`;
`test:e2e` 150 passed). Anchors stored bare before the fix still match
every card; no migration.

### Immediate action feedback (#46, complete)

Every agent-starting control reacts on click, before the request
returns: one client-side in-flight entry per target (zustand store,
`web/src/state/store.ts` + `web/src/guide/inflight.ts`), set
synchronously in the click handler through `performAction`
(`web/src/guide/actions.ts`), handed to the snapshot job once the
response attaches a `jobId`, cleared when the job settles, the request
throws, or the answer needs no job (`accepted: false`, `reused`, no
`jobId`; `deduplicated` follows the existing job). Entries survive
snapshot resyncs, adopt jobs created after the snapshot was fetched
(WS `job` upsert), reconcile at attach time when the fill beat the
response, ignore stale generations (seq guard), and lapse via a 120 s
TTL that applies only with no live job attached — a queued/running/
backing-off job holds its entry indefinitely. The old
revision-polling loop is replaced by a store-driven settle wait plus a
quiescence window keeping the "Nothing more to add" toast without false
positives (the done event can precede the revision-bumping patch).
Covered kinds (verified against `pipeline/actions/`): depth, examples,
diagram, generate, followup, explain, ask, reply, retry, second_opinion,
concept, and the update pass. Local-only kinds (read, collapse,
bookmark, note, promote, close, delete, undo) need nothing.
UI: the clicked control shows dots with `aria-busy` and conflicting
controls go disabled; rewrites (depth/examples/diagram) get an accent
left border plus a pale wash with the text readable (the wash is what
sets expansions apart from their resting accent border, statically too);
new content gets a placeholder where it lands (pending card, explain
slot, one dashed answer-shaped placeholder per follow-up, verdict spot,
concept stub, thread). All processing states carry short fixed
labels — no streamed agent text, thinking text, or `job.progress`
anywhere in guide/comments (the debug Jobs view still shows progress as
diagnostics). Mock mode reports real running→done snapshot jobs for
every agent action so the same handover runs. Service jobs now carry
`cardId` on the job itself (queue + persisted JSON column + recovery;
#62 closed here), so a reload mid-rewrite matches the live job.
 Evidence: `state/inflight.test.ts` (lifecycle incl. live-job TTL hold),
 `guide/inflight.test.ts` (labels/keys/busy/answer detection),
 `guide/actions.test.ts` (funnel incl. stale-response guard and insert
 ordering), `service/test/jobs.test.ts` (card scope incl. persistence),
 `CardView.test.tsx` (incl. reload-mid-rewrite) + `ThreadView.test.tsx` +
 `GuideThreads.test.tsx` (component immediacy), new
 `e2e/immediate-feedback.spec.ts` (mock-mode explain/follow-up/second
 opinion), updated `ask-service.spec.ts` (streams never render), full
 `test:e2e` green incl. the depth-principle + journey service specs
 (which caught and verify the job-upsert handover fix). Screenshots in
 the issue report (before/after for depth, examples, generate,
 follow-up, explain; replay fills run sub-second, captured via CDP
 bursts).
 Open: `threadId` persistence has the same pre-existing gap as `cardId`
 had (not carried through the jobs-store JSON column) — noticed, not
 fixed. Hunk summarize busy never clears on success (#63, adjacent,
 untracked here).

### Reload blank page, part 1: error boundaries (#101, complete)

 Any render/commit exception used to unmount the whole tree (no boundary
 anywhere in `web/src`), leaving a white page. One reusable `ErrorBoundary`
 (`web/src/components/ErrorBoundary.tsx`, renders no wrapper element so
 prototype.css child selectors keep matching) now sits at five levels:
 shell (around the route tree in `App.tsx`, catches non-review routes too,
 resets on navigation), guide page (around `PageView`, resets on
 review/page change), each card (around `CardView` in `PageView`,
 resets on review/card/revision change), source pane (around the tab body
 in `SourcePane`, resets on review/tab change), and each diff file
 section (around `FileSection` in `DiffView`, resets on review/file
 change). A boundary around each diff file section fits the card pattern
 cheaply, so it is in. `AppShell`, `CardView`, `D2Diagram` and
 `DiagramView` are untouched (zero lines): every boundary wraps from the
 outside. Fallbacks say something went wrong in plain style with no raw
 stack (shell: full-page notice plus Reload; the rest: inline card-,
 pane-, file- or guide-sized notices with Retry that re-renders the part
 without reloading). Caught errors go through the existing dev-only web
 reporting path (`reportWebError` in `web/src/sentry.ts`, same
 DSN-guarded dynamic import as `initSentry`, so the SDK still never
 enters the built bundle) with the catching boundary named, plus
 `console.error` locally. New strings (`Something went wrong`,
 `Couldn't show this page/card/guide/source pane/file: something went
 wrong`, `Reload`, `Retry`) pass the copy guard and follow the #45
 failure pattern and button rule.
 Evidence: `ErrorBoundary.test.tsx` (10: isolation, report-once with
 boundary name, local log, reset on identity change, Retry, shell
 fallback + Reload, route reset, reporter no-op), `PageView.test.tsx` (a
 real `CardView` throw leaves sibling cards rendered),
 `GuidePage.test.tsx` (page throw + reset on review change),
 `SourcePane.test.tsx` (diff throw leaves the tab bar),
 `DiffBoundary.test.tsx` (file throw leaves the other file); `mise run
 check` + `build` + `test:e2e` (158) green with a fresh `dist/`
 carrying no `sentry` reference (network guard re-run green).
 Open: part 2, the `removeChild` crash itself — the boundaries above
 stand on their own until it reproduces.

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

None found at audit time (61 e2e green + manual walk, 0 console errors).
Audit-10: §4.4 principle now has an end-to-end drive
(`depth-principle-service.spec.ts` 2/2 green), so the visual-confirm item
is closed. UI sections were NOT re-audited wholesale per #10; suspicious
items noticed while passing through (not verified, listed only):
- Depth + at deepest now toasts via `performAction` `reused` handling
  (`web/src/guide/actions.ts`) — confirm the copy (“deepest/nothing
  more”) reads naturally alongside the examples/diagram “Nothing more”
  toast in `CardView.runInsertAction`.
- `depthViaAgent` normal steps now strip the fixture principle
  (service-only change) — the guide still renders pre-existing principle
  blocks from older snapshots; no migration was added.
- Second-opinion repeat is now silent reuse (no job); the Jobs view shows
  only the original job — confirm that reads correctly in Settings.

### Needs the user's decision or a Mac

1. **Install path**: RESOLVED — `#release` ref + tarballs, both installing
   with no flags on npm 10 and 11 (verified in `check-global-install`).
   Stale-pointer fix (audit-10): PRD §14 still says the bare
   `github:<org>/unvibe` command — see #18 (now points at `#release`).
   Licence: MIT (`LICENSE`, issue #4), shipped in the release beside
   `THIRD-PARTY-NOTICES.md`.
2. **Install size**: RESOLVED — ~66 MB installed in ~4 s, nothing
   downloaded beyond 6 small runtime deps (was ~736 MB with bundled agent
   binaries). No decision needed.
3. **Mac**: run `docs/macos-testing.md` (15 min) — untested: osacompile
   applet, lsregister delivery, Gatekeeper xattr, Finder PATH, Chrome
   install flow on macOS.
4. **Live gates**: RESOLVED (submit) — `test:live:submit` ran green
   2026-10-11 on `indigoviolet/lvu#2` (still OPEN draft, unmerged; see
   §15). Remaining: full live pipeline on a real PR — needs logins +
   token spend + a scratch repo.
5. **Result reuse** (§12): RESOLVED (audit-10) — cross-request cache
   implemented + tested (`reuse.test.ts`); per-action decisions in §12.
   Owner review: card-scoped reuse across version bumps when the card is
   untouched (documented as intentional); ask reuse returns the existing
   thread (no new thread on identical repeat).
6. **CI**: RESOLVED — workflow exists (`.github/workflows/ci.yml`) and the
   base merge (`2eec7cb`) notes green on macOS and Ubuntu (check +
   build + `test:e2e`, shell e2e per OS, `check-global-install`,
   restart-resilience, strict D2 seed gate). Audit-10 did not re-run CI
   (runs on push); `mise run check` + `build` + `test:e2e`
   (incl. the 2 new principle specs) are green locally — see Done-when
   report.
7. **Diagrams**: D2 decision already noted (§13); PRD text itself still
   contradicts (§13/§19.4) — fixed in #18, not here.
