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
| §4.4 cards (5) | 5 | 0 | 0 | 0 |
| §4.5 links/citations (8) | 8 | 0 | 0 | 0 |
| §4.6 selecting text (4) | 4 | 0 | 0 | 0 |
| §4.7 explanations (5) | 5 | 0 | 0 | 0 |
| §4.8 comments (9) | 9 | 0 | 0 | 0 |
| §4.9 findings (4) | 4 | 0 | 0 | 0 |
| §4.10 second opinion (4) | 4 | 0 | 0 | 0 |
| §4.11 PR description (6) | 6 | 0 | 0 | 0 |
| §4.12 submit (4) | 4 | 0 | 0 | 0 |
| §4.13 diff (19) | 19 | 0 | 0 | 0 |
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
| **Total** | **213** | **0** | **0** | **1** |

(Audit-10 correction: the prior total (204/2) was stale — the row values
already summed to 208 met + 3 partly + 1 cannot-verify = 212 requirements.
After closing the three partly items below, the rows sum to 211 met + 0
partly + 1 cannot-verify = 212.)
(Issue #133 stage 1 adds one §4.13 requirement — expand beyond hunks —
so the rows now sum to 212 met + 1 cannot-verify = 213.)
(Issue #133 stage 2 adds two more §4.13 requirements — expand by unit,
no file content — so the rows now sum to 214 met + 1 cannot-verify = 215.)
(Issue #136 slice 1 removes the read state as a feature — one fewer §4.4
requirement — so the rows now sum to 213 met + 1 cannot-verify = 214.)

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
- **Nothing hosted publicly** — met. Fastify binds `127.0.0.1` plus a
  `::1` companion on the same port (issue #108; answers however the
  browser resolves `unvibe.localhost`, still loopback only, no host
  setting); static network guards (`network-guards.test.ts`,
  `network-privacy.test.ts`, Playwright `network-privacy.spec.ts`,
  `network-guard.ts` fixture) fail the suite on any non-loopback contact.
- **Nothing posted until Submit** — met. `gh-writes.test.ts` proves only
  `src/submit/**` + `routes/submit.ts` contain write-shaped `gh` calls;
  this branch adds the submit lease so even a crash cannot double-post
  (`submit/lease.ts`, `submit-m6.test.ts` “crash safety”).
- **Starts at login, stays local** (issue #108) — met. `setup` writes a
  launchd agent (macOS) / systemd user unit (Linux) running
  `start --foreground` with port + data dir baked in and
  `UNVIBE_IDLE_MS=0`, so the login-started service never idle-exits; a
  manually started service keeps the 10-minute idle exit. Follow-up:
  while the unit is installed, `stop`/`start`/`open` go through the
  service manager (crash-only restart: launchd `KeepAlive
  SuccessfulExit:false`, systemd `Restart=on-failure` — a deliberate
  stop stays down, updates can't race a restart); `status` says `starts
  at login`; failed manager starts unload again (no crash-loop, no port
  fight) and fall back to a direct spawn with a warning. Both update
  paths refresh the unit with the just-installed paths; `doctor` warns
  on stale baked paths; the login-shell PATH probe (headless-safe) is
  how manager-started services find their tools. `managed-cli` +
  `service-manager` tests pin the matrix with a stub runner + fake HOME
  (`e2e-*.mjs` use `--no-login` to stay hermetic). macOS
  enable + Safari still need a human (see `macos-testing.md`).
- **New repos under the team org** — cannot verify here (process rule, no
  org access from this machine).

## §4 Product behaviour

Web evidence abbreviations: `e2e/<spec>.spec.ts`, `ui-walk` = manual
Playwright walk of the built service 2026-10-10 (start, guide, submit
panel screenshots, 0 console errors). The web agent is concurrently
editing `packages/web/src` (expansion cards, card controls, corrections
UI); nothing below was edited by this pass.

### §4.1 Layout — all met

- Top bar (app-wide, every screen but reviews: Unvibe home link,
  breadcrumb trail, badge on start/Settings, gear Settings icon in the same
  place; Settings screen has none; no Tips anywhere per #141) — met
  (`ScreenTopBar.tsx`, `settings.spec.ts` gear + breadcrumb cases,
  `doctor.spec.ts` / `debug.spec.ts` breadcrumb cases; issues #31/#55
  round 2, #141).
- Review bar (the only bar on a review per #141: home control first, then
  identity + version selector next to it per #120 + GitHub link-out + Debug
  icon + compact preview marker, [ Guide | Source ] pane toggles incl.
  full-width source per #83, Comments + primary Submit; at narrow widths
  the title gives way first and the selector never truncates; no Settings
  gear) — met
  (`ReviewBar.tsx`, `VersionSwitcher.tsx`, `AppShell.test.tsx`,
  `e2e/review-bar.spec.ts`; `docs/screenshots/55-review.png`,
  `55-review-800px.png`, `55-review-dark.png`,
  `83-source-full-width.png`, `120-wide-light.png`,
  `120-narrow-light.png`, `120-wide-dark.png`, `120-narrow-dark.png`,
  `120-narrow-light-readonly.png`,
  `120-narrow-dark-readonly.png`, `141-review-800-light.png`,
  `141-review-800-dark.png`, `141-review-1440-light.png`,
  `141-review-1440-dark.png`,
  `141-review-readonly-800-light.png`,
  `141-review-readonly-800-dark.png`).
- Guide left / Source pane right (PR description + Diff tabs, Comments
  menu), drag resize, arrow keys on handle — met (`e2e/diff.spec.ts`,
  `comments.spec.ts`; walk shows pane + tabs).
- Docked ≥900px, overlay below — met (`App.tsx` responsive layout,
  covered by `guide.spec.ts` viewport cases).
- Nothing lost when narrow (wrap/icons/pinned) — met (`diff.spec.ts`
  pinned-row cases; `source/diff/DiffView.test.tsx` 300-file case).

### §4.2 Start page — all met

- Repo selector centred above Reviews with remembered + detected checkouts —
  met (`StartPage.tsx` native `<select>`: remembered
  under "Repos", detected under "Detected checkouts" with the local path
  as the title; selection persisted in `unvibe.start.repoId`, demo never
  selectable; `e2e/start.spec.ts` "repo selector lists remembered and
  detected repos, persisted" + "sits centered above Reviews"; quiet
  "Ready · gh + agents ok" content line when healthy; issues #31/#55 round 2).
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
- Kept PR/branch lists (#90) — met (web-only: `start/keptChanges.ts`
  keeps the last successful fetch per repo in versioned `localStorage`
  with an in-memory copy, validated reads, a 10-repo cap, and graceful
  degradation; `StartPage.tsx` shows the kept rows at once on load,
  switch and return, refreshes underneath with a quiet "Updated …"
  line, keeps the rows on a failed refresh with the error note, leaves
  the first load unchanged, and ignores stale responses; opening a kept
  row goes through the fresh open path; entries for unlisted repos are
  pruned and a changed login clears them. No contract change.
  `start/keptChanges.test.ts`, `start/StartPage.kept.test.tsx`,
  `e2e/start-kept.spec.ts`).
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
- Header (label only where it matters, bookmark right-aligned on the
  title line — #118, deliberately off-prototype; no empty label row) —
  met (`PageView.tsx` `.title-row`, `PageView.test.tsx` header cases,
  `guide.spec.ts` finding-label + saved-bookmark cases).
- Trail breadcrumb off-root — met (`guide.spec.ts` “pages navigate”).
- Contents box (cards jump + linked pages, no other labels)
  — met (walk screenshot shows CONTENTS with linked pages;
  `guide.spec.ts` “renders cards, contents and generated go-deeper cards”).
  Card entries show the title (real or the shared #49 fallback), never a
  body prefix cut mid-word (`guideUtils.ts` `contentsModel`,
  `guideUtils.test.ts`).
- Go deeper placeholders + Generate fills + follow-ups — met
  (`pipeline/demo.ts` auto-fill, `actions/generate.ts`,
  `guide-service.spec.ts`).
- Bookmark + state exists (sharing deferred) — met (`Page.saved`,
  `reviews/list.ts` summaries).

### §4.4 Cards — all met (audit-10; #136 slice 1)

- Collapse chevron, title-row-only collapsed — met (`guide.spec.ts`).
  Every page card shows a title: the prompts require one for every card
  (issues #49/#50), and when the agent omits it the header and Contents
  share one derived fallback — the first sentence or clause of the body,
  cut on a word boundary with an ellipsis (`shared/src/content/titles.ts`,
  `CardView.test.tsx`). Explanation cards keep their quoted-selection
  header with no derived second title. Replies never repeat what the reader
   already sees (shared "Reply hygiene" guidance in `instructions.md`;
   the `explain` "quote it back" rule is removed), with a deterministic
   exact-match strip of a leading echo line at parse time
   (`actions-echo.test.ts`, `content-titles.test.ts`). Agent process
   chatter never reaches the reader (#51): the body never mentions
   tools, connections, refusals or what could not be looked up (prompt
   rule; failures go in the trailing `degraded` field). A job fails on
   facts only: a process-complaint frame fails when the turn ran without
   the review MCP server or hit a dead MCP URL — tool names and MCP/gh
   alone never fail a job. A trailing `degraded` field with a usable body
   (it parses and has at least one block) keeps the answer instead of
   failing: the answer shows with the plain-words note "Some references
   in this answer could not be linked to the code." and the raw reason
   lands on the job (`degradedReason`) for the Debug page; only a
   degraded answer with no usable body fails the turn. Connection-error
   failures retry once on a fresh session (fork jobs since #51, the
   reader since #146: fresh per-run secret + session, deterministic
   provisional ids so the retry overwrites rather than duplicates, each
   attempt's usage recorded once; a continued conversation turn falls
   back to a fresh fork with the full first-turn prompt plus the stored
   transcript, since the short follow-up prompt assumes the live
   session's history); a retry that still reports degraded keeps its
   usable body the same way. Everything else degraded is terminal. A
   twice-failed reader sets a plain-words stage
   error ("The guide couldn't be started because the review details
   couldn't be reached. Please retry.") with Retry, the raw reason
   staying on the job error for the Debug page. Streamed partials are
   cleared and the reason lands in the job error on the Debug page
   (`degraded-turn-51.test.ts`, `reader-146-124.test.ts`). A reply anchor
   that names only the card gets one repair turn carrying the reason
   (`validate.test.ts`). The reader's citation-repair prompt (naming the
   failed citations) is kept on the job's stored prompt, so the Debug
   page shows what failed (#124).
- Depth −/+ stepper, 3 dots, in-place rewrite, underlying principle at
  deepest, on-demand + kept — met (`actions/depth.ts`,
  `actions-m4.test.ts` “depth round-trips”). While a depth change runs,
  + and − keep their icons and are disabled, with no dots inside the
  control, in both directions — one shared control for page cards and
  conversation answers (issue #129; the target-pip pulse was dropped as
  allowed — `guide/DepthControl.tsx`, `DepthControl.test.tsx`,
  `depth-principle-service.spec.ts`).
- Examples / Add diagram inserts, never duplicated — met
  (`actions/examples.ts`, `diagram.ts`, dedupe in apply; audit-10 adds
  upfront `reused:true` short-circuit so repeats cost no agent call —
  `reuse.test.ts`).
- Diagrams expand (#47) — met: every rendered diagram block carries an
  Expand control opening a full-window overlay (dialog, focus in/out,
  Esc/close, page scroll locked) with wheel/pinch zoom, drag pan, +/−
  buttons and reset-to-fit on a CSS transform (no new dependency, no CSP
  change); citation hover/click work inside it and a drag never counts
  as a click (`guide/DiagramOverlay.tsx`, `e2e/d2-diagram-overlay.spec.ts`,
  `guide/DiagramOverlay.test.tsx`). The overlay opens on the measured
  fit (whole content incl. badges, equal margins, never above 100%). A
  diagram that did not render carries no zoom, Reset or Expand controls
  (#130) — only the fallback's own retry.
- Failed diagrams (#130) — met: the endpoint answers `error` with the
  compiler message only when `d2` ran and failed, and `unavailable` only
  when the binary is really missing (never inferred from a stale
  snapshot; `DiagramStatusBody` contract in `packages/shared/src/api.ts`
  — `diagrams.test.ts` failing-script cases). Reader-facing text is
  plain ("Couldn't draw this diagram." + Retry; no compiler quote, no
  "out of scope"); the raw reason is stored on the block and shown on
  the Debug Jobs tab. A block with no render result yet shows
  "Drawing diagram…". Inline Explain diagrams run the same finalize +
  one repair turn as Add-diagram blocks
  (`pipeline/actions/diagram-finalize.ts`); unambiguous `steps:`-like
  shapes are renamed (`steps_box`) and inline `{.class: …}` is rejected
  with the legal line form named (`myid.class: [ok]`), with the prompts
  updated to match.
- Diagrams zoom inline (#47, round two) — met: blocks fit by default
  (no scrollbars, never above natural size) with +/−/Reset beside
  Expand on the same shared hook (`panZoom.ts`, `usePanZoom.ts`,
  `ZoomControls.tsx`); trackpad pinch and Ctrl/Cmd+wheel zoom, a plain
  wheel scrolls the page, drag pans once zoomed. With spare pane room
  the block breaks out past the text column, centered, up to the usable
  width (ResizeObserver; caption and citations stay column-aligned;
  cards and Explain expansions alike). Citations work at any zoom
  (`e2e/d2-diagram-inline.spec.ts`,
  `guide/DiagramInlineZoom.test.tsx`).
- Diagrams stay legible inline (#16) — met: multi-line labels no longer
  collapse (the service allowlist dropped tspan `x`/`dy`, collapsing
  every line onto one baseline; `dx` and edge-mask `maskUnits` were
  dropped too — all kept now, plus `url()` rewrites in every adopted
  attribute client-side so masks/markers/clips survive namespacing).
  Data-dir cache filenames carry `DIAGRAM_POSTPROCESS_VERSION` with a
  legacy sweep, and the demo seeds were re-recorded (`d2-seed-check
  --strict` green; snapshot hashes unchanged). The uniform D2
  blue is remapped to the guide palette by stylesheet rules over D2's
  shape classes, with `.class: [ok]` / `[bad]` for ok/warn states
  (`e2e/d2-diagrams.spec.ts` "diagram wears
  the guide palette", `docs/d2-diagrams.md` "Look"). Uneven letter
  spacing (#16) reproduces identically in headed Chromium, so it is not
  a session artifact: D2's embedded subset font carries no kerning
  tables (WOFF has OS/2, cmap, glyf, head, hhea, hmtx, loca, maxp, name,
  post — no GPOS/GSUB/kern), and neither side's sanitiser touches font
  bytes. Not fixed in app code (overriding the family would break D2's
  tight box layout); shorter labels + inline/overlay zoom are the
  mitigations.
- Undo (depth/examples/diagram, no redo, comments/nested cards survive)
  — met (`actions/undo.ts`, `actions-m4.test.ts`).
- Read state removed as a feature (#136, owner decision): no Mark read
  control and no stored read state on any card (guide or
  conversation); the per-hunk reviewed tick and N/M progress stay.
  (`entities.ts` has no `read`; `CardView.tsx` / `ExpansionCard.tsx`
  render no read control; `guideUtils.test.ts` read suites deleted.)
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
  “citations reveal over the real API”, `validate/*`). Chips flow inline
  with their text and never wrap alone onto a line (issue #165); lists
  carry per-item chips with no repeated block-level count row
  (`guide/BlockView.list.test.tsx`).
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
- Toolbar Explain / Ask… / Comment / GitHub; no examples/diagrams there;
  appears only on selection-finish — met (`comments.spec.ts` “toolbar
  Comment creates a quiet thread”, “GitHub action links diff lines”).
  Inside an explanation the same toolbar appears (#116); inside
  second-opinion reasoning and thread replies it does not (neither is an
  anchor host — `SelectionToolbar.test.tsx`).
- Selections inside a conversation answer anchor to the answer's block
  (`<answer>#<block>`, owner from the answer wrapper) for Explain and Ask; a Comment there anchors
  where the card is anchored and quotes the selection as a Markdown
  blockquote prefilled in the composer (issue #135). The nested
  explanation, thread or comment renders under its anchor, nests to any
  depth by the same mechanism, and survives reload with its highlight
  (`actions-expansion-nesting.test.ts`, `ExpansionNesting.test.tsx`,
  `e2e/expansion-nesting-service.spec.ts`).
- GitHub action (issue #134): a plain link out opening the selected diff
  lines in GitHub's file view at the review's commit (head for
  added/unchanged lines, base for removed-only selections; the viewed
  version's commits). No job, no pending thread. Hidden for prose,
  non-GitHub repos and the demo — met (shared `githubFileUrl` +
  `repos.test.ts`, `SelectionToolbar.test.tsx` range cases,
  `comments.spec.ts` “GitHub action links diff lines”).

### §4.7 Explanations — all met (#136 slices 1+2, #152)

- Conversation card under the source block, highlight; header (quote,
  Open as page, Delete, Close) + one answer view per turn, each with the
  card controls acting on that answer alone, plus a reply box answered in
  the same conversation — met (`actions/conversation.ts`,
  `ExpansionCard.tsx` + `ReplyBox.tsx`, `conversation.test.ts`,
  `ConversationCard.test.tsx`, `ask-service.spec.ts` “explain runs”).
- Close → dotted link (preview/expand) — met (`actions/close.ts`,
  `promote.ts`).
- Anchor lost → footnote chip on the citations line, open cards stay with
  a "from an earlier wording" hint (issue #72, replaces the collapsed-card
  fallback) — met (`interaction/cards.ts` visible-level `markStaleAnchors`
  + `cards-stale.test.ts`; `guide/Markers.test.tsx`,
  `guide/CardView.test.tsx` footnote chips;
  `e2e/anchor-footnotes-service.spec.ts` closed → deep → chip → open →
  back → highlight).
- Open as page moves content (one page card per answer, first titled
  with the quote, later ones with their questions), anchor becomes link
  at once in the guide, the description and the diff — met
  (`actions/promote.ts`, `actions-m4.test.ts` “promote”,
  `source/diff/DiffPromotedLink.test.tsx`). Opening as a page never
  discards work (issue #152): a still-running fill keeps running and
  lands on the page card (turns stay on the link as the fill's state
  owner with the card's session, mirrored per partial; the job is
  re-targeted at the page card so the page shows the working state; the
  turns drop off the link and the session closes once everything has
  settled), a failed fill shows the error with Retry on the page, and
  second opinions move to the page with the answers — met
  (`conversation.test.ts` “promote mid-fill”, `guide/CardViewPromoted.test.tsx`,
  `e2e/promote-midfill.spec.ts`).
- One box while working (issue #97) — met: the Explain placeholder gives
  way as soon as its expansion is in the snapshot (guide, description and
  diff alike), the card shows the fixed “Writing explanation…” label from
  the anchor-keyed entry instead of the “Working…” fallback, and
  content-needing controls (depth, examples, diagram, second opinion) stay
  off until the text arrives (`guide/inflight.ts` `anchorEntryForConversation`,
  `ExpansionCard.tsx`, `comments/doubleIndicator.test.tsx` “Explain”,
  `guide/inflight.test.ts` anchor-entry cases). First and later Explains
  take the same code path; the first only looks different because agent
  session setup stretches the patch-before-response window.
- Follow-up suggestions stay on Explain answers; clicking one sends it as
  the next turn in the same conversation (the item stays, like reply-box
  text) — met (`actions/followup.ts` conversation branch,
  `ConversationCard.test.tsx` suggestion case). On guide cards a click
  still consumes the item and opens a new conversation card.
- The card is never submitted to GitHub and carries no For-PR control —
  met (no `post` on conversations; submit posts threads only).
- Explanations nest (#116, #136): an Explain on text inside an answer
  anchors to the answer's block and renders under it, to any depth;
  Ask/Note there behave the same. Citations to answer blocks validate
  (`card:<answer>#<block>`). Closed nested cards and stale
  anchors use the same footnote chips as card-level ones. Block IDs are
  unique within each stored body (multi-card replies dedupe to `-c2`…,
  inserts take fresh IDs; matching is exact on owner + block), so one
  anchor draws exactly one card.
- Deliberately off-prototype (`prototype.html` is look-and-behaviour
  reference, not code): Explain and Ask share one teal conversation
  card — the prototype's separate sand Ask thread (`.ithread`) is gone;
  comments keep the sand thread look so the two stay easy to tell apart
  (owner decisions on #136). Per-answer controls show on the latest
  answer, on hover/focus for earlier ones. Follow-up chips send the next
  turn and stay (they are not consumed). “Ask the agent about this” on
  comments and keep-filling open-as-page have no prototype counterpart.
  Author markers are icons, not text — a person icon for the reviewer,
  the spark for the agent, with screen-reader names (“You” / “Agent”)
  and tooltips — where the prototype prints “Me”/“You”/“AI” plus a name
  line (owner decision; the second-opinion model label stays, since it
  is information, not an author label).

### §4.8 Comments — all met (#136 slice 2: threads are comments only)

- Ask… opens the conversation card (§4.7) on the selection's anchor,
  with the question as its first turn; Comment starts a comment thread
  with no agent reply — met (the old `ask.ts`/`explain.ts` are merged
  into `actions/conversation.ts`, `NewThreadComposer.tsx`,
  `ask-service.spec.ts`). Only Ask sends text to the agent; clicking a
  diff line opens a Comment. Only comments are submitted — conversation
  cards carry no For-PR control and the submit path skips them (issue
  #135). A Comment from an agent answer quotes the selection as a
  Markdown blockquote. A comment offers “Ask the agent about this”: the
  usual Ask card on the comment's anchor, quoting the comment — the only
  way a comment leads to an agent reply, and the answer is never
  submitted.
- Follow-up suggestions live on conversation answers, never in comment
  threads: one behaviour for every answer — the model may end any answer
  with suggestions, they render as chips on that answer, and clicking one
  sends it as the next turn in the same conversation (`actions-ask-followups.test.ts`,
  `ConversationCard.test.tsx` suggestion case).
- Thread header (quote/`file:line`, Mark for PR filled when on,
  Delete, Close) — met (`comments/threads.test.ts`,
  `ThreadView.test.tsx`, walk screenshot shows “Agent · suggested
  comment” threads with Reply/Discard).
- Reply box always visible, Discard/Reply, typed text survives rerender;
  Discard stays disabled on an existing thread until there is a draft —
  met (`comments/ThreadView.test.tsx`, `comments.spec.ts`). Replies are
  reviewer-written only, never agent answers.
- Placement (guide closed + hover outline; diff under line + line-number
  reopen + click-number starts; description under paragraph) — met
  (`comments.spec.ts` “diff line click starts a comment; close leaves an
  icon; reopen works”). The hover outline clears only its own marks and
  cards/threads (issue #111), never the depth stepper pips
  (`guide/expansions/hoverOutline.test.tsx`).
- One box while asking (issue #97) — met: the Ask composer hides as soon
  as its card is in the snapshot, and the card's working row uses the
  fixed Ask label instead of the “Reading the diff…” fallback
  (`comments/NewThreadComposer.tsx`,
  `guide/expansions/ExpansionCard.tsx`,
  `comments/doubleIndicator.test.tsx` “Ask”).
- Comments menu (all comments, jump, For PR filter with editable drafts,
  never posts; lives in the review bar next to Submit since round 2, so it
  opens with the source pane closed) — met (`comments-service.spec.ts`
  “mark for PR, edit the draft, submit posts exactly one review”;
  `e2e/review-bar.spec.ts` “comments menu opens with the source pane closed”).
- Already on GitHub (issue #168) — met: existing review comments load
  with the review and reload on refresh (read-only `gh api`, stubbed in
  tests), render as collapsed read-only threads on their diff lines
  (author + count, Open on GitHub, Markdown rendered with the shared
  untrusted renderer), outdated ones at their file and removed-file ones
  at the diff's end; the menu groups them by file and thread with
  rendered bodies and jumps to them; selecting their text offers
  Explain/Ask/Comment (quoting into the reviewer's own comment); one
  filter-menu control hides them in the diff (remembered with the
  review) without removing them from the agents' context, where they
  arrive framed as other people's material, never instructions
  (`comments/GithubThreads.test.tsx`,
  `source/diff/DiffView.github.test.tsx`, `e2e/comments.spec.ts`
  GitHub-thread cases, `service/test/context.test.ts` framing cases).

### §4.9 Findings — all met

- Separate pages, orange guide card with confidence + “Open →” — met
  (walk shows finding-linked content; `pipeline/apply.ts`
  criticApply). (The read-dim is gone with the read state, #136.)
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
- Remove while a re-run is in flight stays removed (#76): removal
  cancels the run (`pipeline/actions/second_opinion.ts`) and a result
  aborted before storing is dropped (`secondopinion/runner.ts`); the
  mock mirrors it. Re-run waits on its own working state in
  `second-opinion.spec.ts`.

### §4.11 PR description — all met

- Restated → links; branch tab shows commit messages read-only — met
  (`pipeline` restated mapping, `ingest/description.ts`).
- Author + open-PR gate; in-place edit with Discard/Save; local pending
  (“Edited · goes to GitHub…”, Revert); paragraph identity preserved —
  met (`routes/description.ts:61` viewer check, `description-m6.test.ts`).
- Round-trip: unedited paragraphs byte-identical — met
  (`submit/description.ts`, description golden tests).

### §4.12 Submit review — all met

- Nothing reaches GitHub until Submit — met (`gh-writes.test.ts`). Only
  comments are submitted; conversation cards are never posted
  (issue #135).
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
  The bar stays pinned under the tab strip while the diff scrolls (issue
  #132): `position: sticky` with `top` tracking the live strip height
  through `--diffbar-top` (no copied constant), z-index 3 (below the strip
  at 4, above diff content, below app overlays at 25+), opaque with a
  hairline; one row at narrow widths (sideways scroll inside the bar, never
  wrap); full pane width sideways (`left: 0`); reveals, comment jumps and
  file jumps land below the pinned rows through one shared helper
  (`revealDiffElement`/`ensureDiffVisible` over `diffPinnedHeight()` in
  `source/diff/revealSource.ts`); opening Files scrolls the pane to top so
  the panel + filter dropdown open fully visible — met
  (`e2e/diff-sticky-bar.spec.ts` 6 tests; `docs/screenshots/132-*.png`).
  The current file header pins under the bar while its file scrolls and
  the current hunk header pins under that while its hunk scrolls (issue
  #140): plain CSS sticky inside each header's own container, so the next
  file/hunk replaces the previous for free; offsets extend the same shared
  mechanism (`--dfile-top`/`--dhunk-top` kept by `observeDiffPinned`, no
  copied constants; a line reveal lands below all four rows, a file jump
  below strip + bar via `diffPinnedHeight(scope)`); z-order file 2 / hunk 1
  (below bar 3 and strip 4, above content, below overlays 6+); hidden-hunk
  rows, folded placeholders, cards and threads scroll under, never pin;
  controls work while pinned; unified + split, light + dark.
  Follow-up fix: the first version put the hunk header in a table cell
  inside the sideways-scroll wrapper (`.dwrap { overflow-x: auto;
  overflow-y: clip }`). Per the CSS Overflow spec `clip` beside `auto`
  computes to `hidden`, which makes the wrapper a vertical scroll container
  and traps the sticky header — forcing `hidden` in Playwright's Chromium
  reproduces the owner's report exactly (file header, outside the wrapper,
  keeps pinning; hunk headers scroll away), while that Chromium (156)
  natively computes `clip` and pins fine, which is why the spec passed here.
  The owner's Vivaldi build was not directly observed; its exact computed
  value is still open (worth asking its version), but the restructure below
  makes the question moot. Each hunk is now its own section (header, card,
  folded placeholder, code table) with the header outside every horizontal
  scroller: no vertical scroll container sits between header and pane on any
  engine (asserted in the spec, plus a forced-`hidden` regression test).
  Side effect: unified code tables now scroll sideways per hunk instead of
  per file. Follow-up: per-hunk tables size their line-number columns
  independently, so code columns drifted between hunks (measured 802 vs 809
  in the fixture). Fixed with a per-file digit width (`--lnw` from the hunk
  data on `.dfile`; `min-width` on unified number cells, new-side reserving
  the comment-icon slot as the old single table did), asserted in the spec
  in both views. The gate also caught `render.test.tsx` "hostile code text"
  counting `tbody tr` (header row no longer in the table): rewritten to
  assert one code row with the right cell count, the header once outside any
  table, and no injected rows/cells/tables in the section. Verified by breaking sticky on purpose (`position: static`):
  exactly the 4 hunk-stickiness tests fail — met
  (`e2e/diff-sticky-bar.spec.ts` 15 tests; `docs/screenshots/140-*.png`).
  Measured stack 149px (strip 41 + bar 43 + file 34 + hunk 31); no compact
  pinned variant — the hunk header is already one 31px line, pure CSS
  cannot restyle only-while-pinned, and every control must stay usable.
- Files panel (name filter + Filter dropdown with per-type counts, a
  Reviewed row and a GitHub-comments visibility row, active count on the button, hunk progress, compacting tree
  + counts, click-scroll) — met (`diff.spec.ts` "file filter dropdown …",
  `source/diff/DiffView.test.tsx` stored-prefs + active-state + keyboard
  cases, `source/diff/diffLogic.test.ts` 19 tests; issues #56/#57: the
  comments panel keeps a 360–420px min-width anchored to its button so
  tabs/paths no longer wrap).
- File header (chevron, path, +/−, reviewed count, reviewed checkbox with
  indeterminate partial state) — met (issue #162). File fold persists on
  the snapshot (`fileStates`), so tab switches keep it; reviewed is
  derived from hunks (mark-file marks every hunk), never stored.
- Git's own hunks (≤3 context, merged runs); header format + raw `@@` on
  hover; fold/Summarize/reviewed actions; hunk card (summary,
  Delete); folding hides code only, unfolded through the header chevron
  alone (no placeholder row, issue #162) — met (`shared/src/diff.ts` +
  `diffLogic.test.ts`, `diff.spec.ts` “fold and unfold”). Summaries are
  content cards (#138): idle text with one attribute mounts nothing per
  hunk (large-diff fixture: identical DOM node counts before/after,
  zero card chrome for idle summaries); selecting in it offers the
  toolbar on a hunk anchor; the first interaction activates a real
  conversation card on `h:<fileKey>:<contentHash>` from the stored text
  with no agent call, then the action runs nested; Comment lands on the
  first changed line without activating; deleting the card returns the
  idle text — met (`service/test/hunk-cards.test.ts`,
  `source/diff/hunkAnchor.test.ts`,
  `source/diff/HunkCardActivation.test.tsx`,
  `e2e/hunk-summary.spec.ts`). A hunk card opened as a page keeps its
  summary text plus a page-link chip; the summary's click/Explain/Ask
  open that page instead of a second card, and a hunk whose page is gone
  reads as ordinary idle — met (`HunkCardActivation.test.tsx` promoted
  cases, `hunk-summary.spec.ts` promoted flow).
- Hide uninteresting (generated/import-only/docs-or-config, one row per
  run with reason, click reveals; one-line never hidden; cited never
  hidden) — met (`ingest/uninteresting.ts` + hunk-pass override
  `runner.ts:1383`, `diff.spec.ts` “hide uninteresting collapses runs”,
  live runs: “hide violations: none”). Hunk replies tolerate format slips
  (issue #99): bare/unfenced `{"hunk": …}` still yields summary +
  `hiddenReason` (`shared/src/content/hunk.ts`, one helper for both call
  sites); JSON-looking text is never stored and long fallbacks cut on a
  word boundary (the stored-row cleanup for pre-fix rows was removed
  under #137 — a stored JSON-looking summary is now reused/shown as-is).
- Fold all folds non-hidden and summarizes only hunks still missing a
  summary (quiet tooltip when all have one); Unfold keeps summaries —
  met (issue #162; per-hunk `summarize` jobs, deduped;
  `docs/pipeline.md` “Fold-all choice”). Hunk notes are removed (issue
  #162): no stored note, no UI; a private remark is a Comment kept off
  the PR instead.
  The Summarize dots clear when the summary lands by patch — any landed
  summary settles the request (issue #63; `DiffView.tsx` snapshot-rows
  effect, `source/diff/summarizeBusy.test.tsx`).
- Unified sideways scroll; Split equal halves + wrap + widen; pinned rows
  — met (`DiffView.test.tsx`, `diffLogic.test.ts`).
- Syntax highlighting (issue #23): plain rows first, token colours after
  (lazy Shiki core/engine/grammars, class-based theme colours, content-hash
  cache); unshipped languages stay plain — met
  (`source/diff/highlight/*.test.ts(x)`, `e2e/shiki-highlight.spec.ts`).
- New-commits banner; stale/outdated per §8 — met
  (`settings-versions-service.spec.ts` “refresh banners counts”).
- Expand beyond hunks, by lines (issue #133, stage 1) — met:
  `GET /api/reviews/:id/file` serves raw ranges at a commit through the
  shared `readCodeSlice` source with a per-request cap
  (`service/src/routes/files.ts`, `service/test/file-slice.test.ts` 4
  tests); quiet gutter caret icons (single = 20-line step, double =
  whole run) in thin separator rows frozen left while code scrolls, one
  hidden run per gap sharing one remaining count from both ends, no
  controls on continuous boundaries (fully revealed or zero-line gaps,
  file edges; the total is probed up front for single-hunk files), and a
  quiet fold icon on each revealed block's first gutter number instead
  of control rows (`web/src/source/diff/FileExpansion.tsx`,
  `expandLines.test.ts` 10 tests, `FileExpansion.test.tsx` 14 tests,
  `e2e/diff-expand.spec.ts` 8 tests); revealed rows are tinted context
  with Shiki colours in unified and split, both sides aligned
  (`expand.css`, `highlightLines`); deleted files expand on the old
  side, new files on the new side, binary files offer nothing, renames
  read the new path at head — nothing throws; revealed lines offer
  Explain, Ask and GitHub on the diff-line anchor (read as
  `code:<path>:<lines>@<sha>`) while Comment stays hidden there
  (`SelectionToolbar.test.tsx`); `docs/screenshots/133-*.png`.
- Expand beyond hunks, by unit (issue #133, stage 2) — met:
  `GET /api/reviews/:id/outline` answers the enclosing chain for a hunk
  range through the same `git show` source (`service/src/routes/outline.ts`,
  `service/test/outline-route.test.ts` 4 tests), parsed by service-side
  tree-sitter grammars with the indentation fallback
  (`service/src/outline/`, `service/test/outline.test.ts` 9 tests);
  one hunk control steps function, then class, then file with the unit
  name in the hunk header and an approx marker for fallback ranges
  (`FileExpansion.test.tsx` 4 unit tests, `e2e/diff-expand.spec.ts` 2
  unit tests, `docs/screenshots/133-expand-unit.png`); empty chains and
  unreadable files degrade to expand-by-lines; grammars ship as plain
  `.wasm` beside the bundle (7.4 MB, 0.79 MB gzipped; no install
  script), asserted by the release and global-install checks.
- No file content (issue #133): reviews whose commits resolve nowhere
  (the demo) answer `no-content`, and the diff hides every expansion
  control on it instead of showing load errors (service
  `outline-route.test.ts` no-content case, `FileExpansion.test.tsx`
  hiding case).

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
- Live role defaults (#88) — met: tiers opus | sol > sonnet | terra >
  haiku | luna with newest version per tier, never Fable/Astra, matched on
  family plus highest version (aliases lose to versioned ids, `opus` beats
  `default`, plain beats dated pins); one effective-settings source serves
  Settings, readiness, the pipeline, second opinions and shared context
  (saved picks win, defaults never persisted); static fallbacks name ids
  offered today (`settings-defaults.test.ts` table rows + caller coverage).
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
  as before). Finished jobs stay listed after a restart, with prompts and
  results (issue #117: the queue used to hydrate only open jobs, so a
  completed review showed an empty list while every row sat in SQLite;
  `recover()` now loads all stored jobs and open ones still come back
  marked interrupted; `annotationId` is persisted too (#136 slice 2
  renamed the old `threadId`). Evidence:
  `service/test/jobs.test.ts` "finished jobs stay listed after a restart",
  `scripts/restart-resilience.mjs` step 2b, PRD §4.14 + §16).
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
- Re-do guide on the Debug page (issue #115): `POST /api/reviews/:id/redo`
  deletes + re-creates through the existing paths (shared create helper)
  and answers 202 with the new review's loading snapshot; the page
  navigates to it. New id (same as delete + create); running jobs
  cancelled first; refused with 409 for the demo, while loading/failed,
  while a submit lease is held for the review, and when the repo is gone.
  Confirmation states what delete + create discards. Open decisions for
  the owner: keep the new id vs keep the old one, and keep vs discard
  user comments/notes (default = delete semantics). Evidence:
  `service/test/reviews-redo.test.ts`, `RedoGuideSection.test.tsx`,
  `e2e/debug-redo.spec.ts`, PRD §4.14 + §14.1.

### §4.15 Conventions — all met

- Chevron/Delete/× placement + AI/user initials + teal/amber — met
  (walk screenshot; prototype CSS class names kept). The card check
  (Mark read) is gone with the read state (#136); the hunk reviewed
  tick keeps its check.
- Only “Guide” + “Agent finding” labels — met (walk).
- Comments/explanation cards share header layout — met (`ThreadView` shared).
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
  results table 12/12 + 11/12; `runner.ts` fork/resume). Forks carry the
  same `mcpServers` + `_meta` as new/resume/load (#124, fake-transport
  pinned); live-verified that a Codex fork still comes up with no review
  tools (zero tool attempts across 7 forks — the drop is inside the
  adapter/CLI fork path, a bigger fix explicitly deferred), so the live
  fork-tools check is skipped until then (`test:live:fork-tools`).
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
- Version-manager shims + untrusted review configs (#105) — met: agent
  candidates are probed from a worktree-shaped temp dir and mise/asdf
  shims resolve to the real executable (`mise which` / `asdf which`
  from home, cached, refreshed by Reload environment); sessions,
  readiness and Doctor all use the real path (shown next to the shim);
  the adapter environment points `MISE_IGNORED_CONFIG_PATHS` at our own
  worktrees dir (the review copy is never trusted); residual start
  failures read in plain words with the `UNVIBE_*_BIN` fix
  (`exec/shim-resolve.ts`, `diagnostics/tools.ts`, `agent/acp/`,
  `agent-shim-mise.test.ts`, `shim-resolve.test.ts`).
  Open: same exposure for `git`/`gh`-as-shims (open list); final check
  needs a Mac with mise (`docs/macos-testing.md` step 10).

## §7 Data model and IDs — all met

- Entities per §7.1 table — met (`shared/src/entities.ts`;
  #136 slices 1+2: `ContentBody` (page card or answer), `Turn`
  (`ans_…` + question + answer blocks), `Annotation` types
  `conversation` (turns + one session id), `comment` (messages, `post`,
  draft) and `link` (plus `promotedTurns` mapping moved turns to page
  cards while unsettled, #152); `ExpansionState` and `Card.read`
  removed; single schema migration (001–005 collapsed under
  #137; dead `annotations`/`cards`/`blocks`/`hunk_states` tables and the
  unused `note_ack` prompt removed under #142) + sessions table;
  `store.test.ts`, `state.test.ts`).
- ID grammar (§7.2 all eight forms) — met (`shared/src/ids.ts`,
  `links.ts`; `ids` unit tests). `card:` addresses a page card or one
  conversation answer (`ans_…`).
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
  the selector rendered once in the review bar per #120 with the current
  version annotated in the dropdown, `versions-refresh.test.ts`,
  `settings-versions-service.spec.ts` “v1 viewable”).
- Rebase-vs-branch by content hash + `range-diff` — met
  (`versions/compare.ts`, `rangeDiff.ts`; refresh test (a): rebase
  no-conflicts → “no change”, state preserved — ran).
- Hunk state kept by hash / cleared+regen+note-kept — met (test (b)).
- Code comments moved vs outdated (+snippet + new-code link) — met
  (tests (b)(c)(e)).
- Cards stale badge + Update; findings rechecked; pinned code re-pinned;
  threads' change lists — met (`versions/citations.ts`, `update.ts`,
  `versions-update.test.ts`; #52: pins in files the new diff does not touch
  are decided by content at the new head — unchanged kept, moved remapped,
  gone/missing/binary/large/unreadable flagged — `versions/refresh.ts`,
  `versions-refresh.test.ts` (h)–(m)).
- Manual update only (fetch/compare free on open/refresh; pass on Update)
  — met (`routes/reviews.ts` refresh vs update; update pass jobs).
- Table row “Pinned code / Thread in progress” — met
  (`secondopinion/excerpts.ts` re-pin; `sharedctx/threads.ts` change lists).

## §9 Context — all met

- Layers L0–L4 ordering + budgets (40k guess, hunk-header fallback) —
  met (`context/layers.ts`, `context.test.ts` header/summary fallback).
  (#107) L1 is now a ladder with a hard 80k-token cap
  (`DEFAULT_BASE_PROMPT_CAP_TOKENS`, not a setting so tuning the inline
  budget can never reintroduce the provider "Prompt is too long"
  failure): full → budget-limited → no-uninteresting-hunks →
  files-only → counts-only, guide-cited/pinned hunks inlined wherever
  they still fit and dropped last with a notice; every rung past full
  names only real tools (`get_hunk`, `search_review`, `resolve`,
  `get_code`); `buildHunkSummaries`/`buildHiddenHunksSection` obey the
  same cap; reader, base, second-opinion, prompt preview and debug page
  all build from the one ladder call; the update pass caps
  `changed_hunks`. Under the budgets every builder is byte-identical to
  before (`prompt-goldens.test.ts` unchanged). Follow-up: the cap holds
  for the assembled base message, not per section — `buildBasePack`
  gives hunk summaries only what is left of the cap after L1+L1b+L2
  (floor 500 tokens so counts always fit) and asserts the total; the
  prompts preview and `changed_hunks` budget leftovers the same way.
  Cost: rungs render lazily in order (small reviews pay for the first
  rung only), token counting is allocation-free (`countCodePoints`),
  and `capChangedHunks` keeps a running total instead of re-joining per
  chunk. Provider "prompt is too long" errors are non-retryable (`agent/acp/errors.ts`) so the queue
  cannot loop on them, and the ladder throws a plain message naming the
  PR size if even counts-only cannot fit. Deviation from PRD §9.1 noted
  below.
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
- `desc:` IDs from the review tools — met (#96): `resolve` returns
  `desc:` candidates when the query matches description text, under the
  same second-opinion restriction as `search` (description allowed, cards
  hidden — shared `isRestrictedRole`/`matchDescription` in `registry.ts`);
  one source of paragraph IDs (`parseDescriptionParagraphs` in
  `ingest/description.ts` reads the IDs ingest wrote into the stored
  HTML) used by MCP search/resolve, the citation validator
  (`pipeline/lookup.ts`), second-opinion excerpts, and comment-anchor
  text (`comments/threads.ts`, `interaction/l4.ts` — list paragraphs no
  longer truncate at the first `</li>`). Pending description edits are
  read (`pendingHtml ?? html`); stored HTML predating stable IDs falls
  back to positional per-block numbering (`desc-ids.test.ts` — ran).
  (#107) `search_review` also matches changed file paths (one hit per
  file with hunk IDs; second-opinion isolation unchanged), so the agent
  can discover files once the L1 ladder leaves the file list out; the
  tool description change is a deliberate golden update.
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
   Diagrams the reader writes inline in guide cards run the same
   finalize + one repair turn as every other fill (#145: flattened
   across cards for one shared repair turn on the reader session, then
   split back — `splitFinalizedBlocks`); a failed repair keeps
   error-status blocks, prose unaffected. Extra turns per guide build:
   at most one citation repair + one diagram repair per reader run, and
   at most one diagram repair per second-opinion run (each other fill
   keeps its existing one-repair bound).
3. Base build — met (`ensureBase`).
4. Parallel forks (critic ×2 with evidence/assessment/confidence +
   suggested comments; concept stubs) — met (demo `f-lf`/`f-perf` — ran).
5. Hunk pass (small model, summary + hiddenReason, never cited/one-line)
   — met (demo 8 summaries — ran from global install).
   (#107) Past `DEFAULT_HUNK_PASS_FANOUT_LIMIT` (500) hunks there is no
   per-hunk fan-out at ingest (no guide exists yet to cite): only
   guide-cited hunks lacking a stored summary fan out once the reader
   lands, everything else summarises on demand (`POST
   …/hunks/:hash/summarize`, Fold-all; jobs dedupe per hunk hash). The
   stage still reaches done (empty fan-out sets done; completions are
   counted in the success path, fixing a race where concurrent jobs all
   saw each other "running" and nobody marked done), and resume reruns
   the same branch — never the full fan-out. The limit is shared
   (`HUNK_PASS_FANOUT_LIMIT` in `packages/shared`, read by the pipeline
   and the web): past it Fold all folds only and requests no summaries
   (toast, tooltip and Tips copy say so; per-hunk Summarize stays
   on-demand). Hide-uninteresting folding
   needs no model summaries: it folds on the deterministic ingest hidden
   reason, and summary-less rows render the reason copy with no spinner
   (`DiffView.test.tsx` "folds on the deterministic hidden reason").
   Deviation from PRD §11 step 5 noted below.
6. On demand (depth/go-deeper/explain/examples/diagrams/answers/concepts/
   second opinions) — met (`pipeline/actions/*`, `actions-m4.test.ts`).
   Full concept pages may draw a `d2` diagram inline, same rule as
   explain/go_deeper (#69; the template used to recommend one in prose).
   Inline diagrams in expansions used to 404 on the diagrams route, which
   only searched page cards; the route now looks every live `Block[]`
   list up through one shared walker (`shared/src/content/blocks.ts`:
   page cards, card/expansion second opinions, expansion bodies, asides
   at any depth — #71; `diagrams.test.ts` expansion cases,
   `shared/test/blocks.test.ts`, web `ExpansionDiagram.test.tsx`). Ask
   thread replies still show the raw D2 source (`<pre class="d2">`, no
   on-demand render — storing thread replies as blocks would be a
   storage change, deliberately not built).
7. Update pass (changed/new hunks only) — met (`versions/update.ts`,
   `enqueueUpdatePass`, `versions-update.test.ts`).

## §12 Models and concurrency — all met (audit-10)

- Main/small/second-opinion roles; one base per model; small jobs get only
  what they need — met (`settings.models`, `runSmall` no-fork). All
  role consumers (readiness, pipeline, second-opinion runner, shared
  context) resolve the same effective settings as Settings (#88).
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

- Files with front matter (role/tier/variables) — met (`prompts/*.md` 17
  templates: `ask.md` first turns, `ask_turn.md` follow-ups, `explain.md`
  deleted under #136 slice 2; `prompts/loader.ts`).
- Deterministic rendering (stable order, no timestamps, golden files) —
  met (`prompt-goldens.test.ts`, `prompts.test.ts`). Goldens cover
  `ask` + `ask_turn` (the old `explain` golden went with the template).
- All 17 template rows present — met (17 files cover every row;
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
   Prompt guidance (#16): short labels (at most two lines), `direction:`
   to suit the flow, cites on each code-mapped shape/connection,
   `myid.class: [ok|bad]` on its own line for states (never inside
   `{ … }`), never name a shape steps/layers/scenarios/boards — mirrored
   into `diagram.md`, `ask.md`,
   `go_deeper.md`, `concept_page.md`, `instructions.md` and the goldens.

## §14 Shell, install, security, storage — all met

- Service on loopback + per-install token on every HTTP and WS route —
  met (enumerated all 30 routes + WS: 401 unauth — ran; `server.ts`
  gate; WS handshake 401 — ran). Opens at `http://unvibe.localhost:4517`
  (issue #108; the `127.0.0.1` URL is the same service).
- Token never in URL after first load — met (`web/src/api/client.ts`
  moves URL token to `localStorage` + persistent `SameSite=Lax` cookie
  (`Max-Age` one year, issue #108); ui-walk).
- Host/Origin checks (DNS-rebinding, cross-site WS) — met (new
  `security/host.ts`, 403 for evil Host/Origin — ran; `host.test.ts`).
  Issue #108 accepts exactly `unvibe.localhost` more (no suffix match;
  look-alikes, trailing dot, userinfo, hex IPv6 all 403 — ran, HTTP and
  WS; the gate stays port-agnostic by decision: pinning 403s the app's
  own loads on ephemeral binds).
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
  jobs — ran). Superseded by issue #108: the service now starts at login
  (launchd/systemd, `UNVIBE_IDLE_MS=0` there so it never idle-exits);
  manual starts keep the idle exit. See "Starts at login" above.
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
  and is corrected there. The legacy `unvibe.sqlite*` backup was removed
  under #137 — only `unvibe.db*` is backed up and restored.

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

- PR lists (`gh pr list --author @me` / `--search
  "review-requested:@me" + "user-review-requested:@me"`, one call per
  list) — met (`repos/changes.ts`, start page).
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
  per-job + totals on the Debug page as the read share
  `cachedRead/(input+cachedRead+cachedWrite)` with writes listed separately
  (#125; earlier **0.947 (Claude) / 0.834 (Codex)** numbers used the old
  read+write formula and are not comparable).
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
12. Huge-PR prompt tiers (#107): PRD §9.1 says L1 carries "the full
    handwritten diff" with only the 40k-token header fallback, and §11
    step 5 says the hunk pass summarises each hunk. Past the inline
    budget L1 now degrades further (no-uninteresting-hunks → files-only
    → counts-only, hard-capped at 80k tokens), and past 500 hunks the
    hunk pass only fans out guide-cited hunks, summarising the rest on
    demand. Under the budgets every prompt is byte-identical to the
    PRD shape; only oversized reviews see the degraded tiers.

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
default title) was deliberately not done pending the owner's decision —
decided 2026-10-12 and renamed to "Guide" under #102 (no data migration:
stored "Guided review" still counts as the default; removed under #137 —
only "Guide" counts, stored "Guided review" now reads as a real title).
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
independently); non-copy findings from the list are fixed separately —
see "Non-copy findings (#86)" below.

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

### Expansion diagrams render on demand (#71) + inline repair (#130)

Inline `d2` blocks in Explain expansions (and go-deeper results, which
land as ordinary cards) used to 404 on `GET
/api/reviews/:id/diagrams/:hash`, which only searched page cards — so
they never rendered. The route now looks every live `Block[]` list up
through one shared walker (`shared/src/content/blocks.ts`: page cards,
card/expansion second-opinion reasoning, expansion bodies, asides at any
depth; undo stacks and thread HTML deliberately excluded) — met
(`diagrams.test.ts` fake-Explain cases: top-level, aside-nested,
invalid; `shared/test/blocks.test.ts` one case per container;
`ExpansionDiagram.test.tsx` pins light + dark rendering with no
component change). Since #130, Explain expansions, go-deeper results,
concept pages and aside-nested diagrams additionally run the same
finalize + one repair turn as Add-diagram blocks
   (`diagram-finalize.ts`; go-deeper/concept repair runs on the fill's own
   session, nested repairs splice into the failed slots keeping stored
   ids), so a bad inline diagram is repaired before it reaches the reader;
   an unrepairable one resolves to 409 `error` with the source shown and a
   plain note + retry, never 404/500, and never breaks its card. Since
   #145 the same path covers diagrams written inline in guide (reader)
   cards and diagrams in second-opinion reasoning (repair on the
   second-opinion session/model, shared log untouched — isolation holds;
   `second-opinion.test.ts` reasoning-diagram cases).
   Open: ask thread replies still show the raw D2 source (`<pre
   class="d2">`, no fetch). Serving them through the same endpoint would
   need thread replies stored as blocks (a storage change) or parsing the
   HTML back (fragile); left as static source text with working citations
   (with #136).

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
  Fixed under #117: `annotationId` is carried through the jobs-store JSON
  column like `cardId` (#136 slice 2 renamed the old `threadId`). Hunk summarize busy never clears on success (#63,
 adjacent, untracked here).

### Progress signs (#98, branch `feat/98-progress-signs`)

 Still dots vs level dots: the owner's still dots were the working
 indicator's `.dots` — its `blink` (opacity .25↔1 over 1 s) runs in both
 themes but reads as static at 5px. The depth stepper's `.pips` are a
 static level display by design and stay unanimated. One shared
 `dot-pulse` keyframe now bounces each dot up 2.5px and flashes it in
 turn (staggered .15 s), so every working state animates: cards,
 expansions, threads, hunk summaries, placeholders, diagram/composer
 indicators, and the two loading states that had no dots at all (review
 opening step, guide building). Under `prefers-reduced-motion` the dots
 are static but solid accent — still distinct from resting text.
 Running / queued job count: the review bar's right corner (after
 Submit, so appearing never shifts the title or the buttons; no overflow
 at 800px) shows `running · queued` (e.g. `1 · 2`) while any of the
 review's jobs is live — `running` counts `running` jobs, `queued`
 counts `queued` + `backing-off` (both wait: for a slot, for a retry);
 terminal states count for neither — linking to the review's Debug jobs
  list. While anything runs (issue #144) a highlight travels around the
  pill's border with the inside calm — a masked conic gradient on a
  pseudo-element, so the box never moves, resizes or shifts its neighbours;
  queued-only is quiet; nothing renders when idle or while the review is
  still opening/failed (the open is ingest state, never a snapshot job).
  Plain link text, no live region. Under `prefers-reduced-motion` the dots
  take turns fading in place (no rise) and the pill's highlight fades in
  place (no rotation); the rewriting border keeps its colour-only pulse;
  the depth stepper's pips never animate in either mode. CSS only, no new
  dependency, no CSP change.
  Evidence: `shell/jobCounts.test.ts` (mapping across all six states),
  `shell/ReviewBar.test.tsx` (present with numbers/name/target, quiet
  queued-only, hidden idle, hidden while opening), new
  `e2e/progress-signs.spec.ts` (mock-mode count appears/links, disappears
  after cancelling all live jobs, 800px fit, computed
  `animation-name`/`duration` on the dots and on the pill's border in full
  motion, pill + Submit boxes identical over a full travel cycle, depth
  stepper still in both modes, reduced-motion fade animations with no
  transform via emulation), `copy-guard` green. Screenshots
  `docs/screenshots/98-*` and `docs/screenshots/144-*` (both pill options
  tried; the travelling border picked over the stronger gradient: visible
  without flooding the pill or hurting the numbers' contrast).
  Full gates not yet run.

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

### Reload blank page, part 2: the crash (#101, complete)

 Reproduced before fixing, twice, with the exact reported string
 (`NotFoundError: Failed to execute 'removeChild' on 'Node': The node to
 be removed is not a child of this node`):
 - `web/src/source/diff/DiffAnchorCrash.test.tsx` (jsdom, real
   `FileSection` + real `useDiffExpansionBindings` pass): mark an
   expansion quote in a diff cell, then land the plain → token-span
   highlight upgrade — throws, with or without a second marking pass in
   between (the pass's own leading `normalize()` already merges the
   cell's React-tracked text nodes away).
 - `web/e2e/reload-anchored-review.spec.ts` (mock mode, real browser):
   hold the Shiki chunk requests (service worker blocked so routing can
   hold them), Explain a diff selection so its quote is marked, release
   the upgrade onto the marked cells — the page errors with the reported
   string. Pre-part-1 this blanked the page; the run visibly shows part
   1 containing it (page stays up, the marked file shows its fallback).
 Cause: anchor marks wrapped text nodes React rendered (diff `td.c`
 cells were React children). Rule adopted, per the issue's options, and
 applied to every site of the pattern (short form in `anchor.ts`):
 mutate only inside a container React treats as opaque
 (`dangerouslySetInnerHTML`, never mixed with React children).
 Changes: diff cells render their content as an HTML string
 (`highlight/codeHtml.ts`: escaped text, same `shk-*` classes, plain
 runs spanless — `FileSection.tsx`); guide code blocks render their
 text as an HTML string too (`BlockView.tsx`, both code paths);
 description expansions mark only the opaque paragraph body, never the
 mixed segment div (`DescriptionExpansions.tsx`); the dead
 `pruneMarkers` (`GuideThreads.tsx`) is deleted — since #72 the bubble
 lists only unquoted threads so it can never match, and removing
 React-rendered marker nodes is exactly the crash pattern.
 Provably safe, unchanged: `D2Diagram` (keyed host states, owns its
 div), description "Restated →" appends (inside opaque bodies), thread
 marks in guide prose/list/table/description bodies (all opaque),
 description markers (filtered at render through React state).
 The diff-file fallback keeps `id="F-<fileKey>"` so deep links still
 land (found by the e2e probe).
 Evidence: both repro suites fail without the `FileSection` change
 (unit pair re-run against the reverted file; e2e run pre-fix) and pass
 with it; `mise run check` + `build` + `test:e2e` (159) green, network
 guard re-run green on the fresh `dist/`. Nothing in this part touches
 `AppShell`, `CardView`, `D2Diagram` or `DiagramView` either.

### Non-copy findings (#86, branch `fix/86-non-copy-findings`)

One commit per finding. Structural first: thrown route exceptions now
answer the app's `{ error }` body with the right status (stack logged
server-side, never sent; `route-errors.test.ts`); then a machine error
`code` (`shared/src/api.ts`: not-found, invalid-request, no-agent,
head-moved, not-implemented) set by the service (central
`service/src/errors.ts` mapping, `NoAgentError`, submit 409
`code: "head-moved"`, the route error handler) and read code-first by
the web with text fallback (`parseApiError`/`apiErrorCode` in
`web/src/api/client.ts`; `error-codes.test.ts`, `apiError.test.ts`).
Statuses and messages are unchanged. Small fixes: 401s throw
status-prefixed so `friendlyError`'s 401 branch runs; Limits errors
show the field label, not the key; correction "cites:" shows resolved
file:line labels; hunk citations are labelled by file/lines, not hash;
the guide error state retries via `POST …/resume` (new `api.resume` +
mock); help documents the no-command foreground start; the unset
second-opinion copy names the enforced rule (a different model from
main — PRD §4.10 agrees, so the copy was wrong, not the rule);
own-avatar reads "You" like the name beside it. Verified already fixed
(no change): raw transport strings, SubmitPanel location duplication,
D2 double fallback, `concept`/`concepts` label, no-agent toast
wording, "Source .py" chip (still stale inside the `ui/31…` branch's
own CATS — needs a rebase), offline "10 minutes", pre-write fold toast,
start-page Update-looking tag, Debug tip survival. Left for the owner:
the Version-tab running-jobs sentence (18), the "PR description" tab on
branch reviews (22).

### Version-manager shims for git/gh (follow-up to #105, found not fixed)

The service's own `git`/`gh` calls have the same exposure class when
those tools are manager shims (the command runner spawns whatever
`cwd` the caller sets, and several callers set a review copy):

- Review-worktree cwd, degrading not fatal: `git show` in
  `mcp/read.ts` (`get_code` + reader pin excerpts) and
  `secondopinion/excerpts.ts` — a shim trust failure there yields a
  missing excerpt (shown dimmed/honestly), never a failed review.
- Checkout/clone cwd, load-bearing: ingest (`git fetch`,
  `worktree add/remove`, `gh pr view` — throws), submit (`gh pr …`
  posts), repos/refresh (`git merge-base`, `rev-list`, `show`,
  `range-diff`, `gh api`). Unvibe-managed clones
  (`<dataDir>/repos/<owner>/<name>`) hold the reviewed repo's config,
  untrusted like the worktree; user checkouts hold the user's own
  (trusted) config.

Not fixed here on purpose: `git`/`gh` go through `runner.run("git"/"gh",
…)` PATH-literal lookups at ~20 call sites with fake-runner seams keyed
on those literals, so "resolve once, call the real path" is not the same
small shape as the agent-CLI fix (one choice point in `diagnoseTool`
consumed by adapter startup, readiness and Doctor). No failure of this
kind has been reported (`git`/`gh`-via-mise is rare; `claude`-via-mise
is the reported case).

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
  (`web/src/guide/actions.ts`) — settled by #65: the depth response
  carries the resulting level (`ActionResponse.level`), so a stored-level
  switch stays silent and only already-at-the-limit toasts (“Already at
  the deepest level”, “Already at the simplest level” for Simpler —
  `depthToast.test.ts`, `reuse.test.ts`).
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
   build + `test:slow`, shell e2e per OS, `check-global-install`,
   restart-resilience, strict D2 seed gate). Audit-10 did not re-run CI
   (runs on push); `mise run check` + `build` + `test:slow`
   (incl. the 2 new principle specs) are green locally — see Done-when
   report.
7. **Diagrams**: D2 decision already noted (§13); PRD text itself still
   contradicts (§13/§19.4) — fixed in #18, not here.

## Addendum: #91 / #92 / #93 (branch `fix/91-92-93-open-pr`)

- **#93 (ingest, §15, §11.1):** PR merge-base is computed against
  `origin/<base>` first, bare `<base>` second through the shared helper
  `resolvePrMergeBase` (`ingest/source.ts`, reused by
  `versions/refresh.ts`); PR heads are fetched via
  `refs/pull/<n>/head` with a branch-name fallback. All git/gh access
  assumes the `origin` remote (as do detection and managed clones); a
  checkout whose GitHub remote has another name is not handled.
  Errors name the missing piece (base ref vs head commit) plus git stderr.
  Evidence: `test/ingest/pr-merge-base.test.ts` (stacked base, fork fetch,
  default branch, both refresh paths, both error texts).
- **#91 (start page, §4.2):** PR rows show `#N` when `branch` is unset —
  never `#N · undefined`. The `gh pr list` source (#95) returns the head
  branch, so unset only happens when `gh` omits it. Evidence:
  `StartPage.test.tsx` (`changeHead`), `changes-pr-branch.test.ts`, and one
  branch-less PR row in the web mock.
- **#95 (start page, §4.2):** "Waiting on your review" splits into
  requested of you (direct, `user-review-requested:@me`) and requested of
  your team (`review-requested:@me` minus direct, with team names); both
  asks show once, as direct. Each group is newest-first with a relative
  time; the 1d/3d/1w/2w/All recency filter (by last update, remembered)
  applies to both, with an empty state per section and per filtered-out
  window. One extra `gh` call per repo at most. Evidence:
  `test/changes-pr-lists.test.ts` (direct/team/both, sorting, missing
  fields, call counts), `StartPage.requested.test.tsx`,
  `e2e/start-lists.spec.ts`.
- **#131 (start page, §4.2):** the one recency filter sits below Reviews
  and applies to every list below it — "Your PRs" (newest first with the
  same relative time) and Recent branches (by last commit date, newest
  first with the commit age on each row) as well as both review groups; a
  list the filter empties names its window with a Show-all way back.
  Reviews stays unfiltered, ordered by recent activity. No contract change:
  branch commit dates already rode `updatedAt`. Evidence:
  `StartPage.requested.test.tsx` (authoring sort, one control below
  Reviews, filtered-empty with Show all, branch ages, Reviews ignores the
  window), `e2e/start-lists.spec.ts`.
- **#148 (start page, §4.2):** the PR and branch lists the filter governs
  are one delineated block ("PRs and branches": bordered container with a
  heading row) whose boundary matches exactly what the filter covers;
  Reviews and the PR opener stay outside it. The recency selector sits at
  the block's top right, compact (the window alone with an accessible
  label). The last-fetch time is a refresh icon in the same row — the
  same load the Retry button triggers — spinning while fetching (still
  under reduced motion) with the time in its tooltip, so no text line
  ever shifts the layout. Filtered-empty states with Show all keep
  working inside the block. Evidence: `e2e/start-block.spec.ts` (block
  boundary, compact filter, refresh click → spinning → settled tooltip,
  filtered-empty way back), `StartPage.kept.test.tsx` (tooltip states),
  `docs/screenshots/148-wide-light.png`,
  `docs/screenshots/148-wide-dark.png`,
  `docs/screenshots/148-narrow-light.png`,
  `docs/screenshots/148-narrow-dark.png` (looked at).
- **#149 (start page + reviews, §4.2):** one review per PR and one per
  branch in a repo. `POST /api/reviews` reuses the existing review for
  the same source (repo + PR number, or repo + branch) whether loading,
  failed or ready — answering 200 with `reused: true` (new
  `CreateReviewResponse` contract) instead of creating a second review —
  and opening it counts as opening (front-screen order). A PR review and
  a branch review of the same branch are different sources. Stored
  duplicates resolve to the most recently active review; two concurrent
  creates for one source share a single insert (per-key in-flight slot
  over the #92 pending map). New commits still surface through the
  existing review's refresh ("new commits"), never a fork. PR/branch
  list rows that already have a review carry its id (service
  `repoChanges` + mock alike) and show a small "review" marker ("new
  commits" alongside when stale); clicking the row opens that review
  directly. Evidence: `test/reviews-async.test.ts` (ready-PR reuse,
  branch reuse, PR-vs-branch distinct, concurrent creates → one row),
  `test/changes-pr-branch.test.ts` (row markers, PR review does not
  mark its branch), `e2e/open-review.spec.ts` (marker + direct open).
- **#100 (start page, §4.2):** PR rows show `+added −deleted · N files`
  in the quiet meta style with the diff add/delete colours, omitted when
  unknown; thousands separators, "1 file" singular. Evidence:
  `StartPage.test.tsx` (`diffSizeParts`), `StartPage.requested.test.tsx`
  (render + omission), `e2e/start-lists.spec.ts`.
- **#94 (start page + review bar, §4.2):** the PR label links to the PR
  page (new tab, `rel="noreferrer"`): the review-bar identity and the
  start-page PR and Reviews rows. The URL is built once in
  `packages/shared` (`githubPrUrl`, preferring the row's `gh` URL via
  `changePrUrl`); row clicks still open the review and the label stays
  keyboard-reachable. Nothing for branch-only reviews or the demo.
  Evidence: `test/repos.test.ts` (URL helper), `StartPage.requested.test.tsx`
  (link isolation + session rows), `e2e/start-lists.spec.ts`,
  `e2e/review-bar.spec.ts`.
- **#92 (async open, §4.2, §7, §11, §14.1):** `POST /api/reviews` creates
  the row + a loading snapshot (`ingest: {status, step, error}`; placeholder
  version n: 0, empty files) and answers 202 before any fetch; the ingest
  runs after the response, steps the snapshot (fetching → reading diff),
  then fills it to ready in one mutate (one WS patch) and starts the
  pipeline (demo stays 201 sync). The web navigates at once, shows the step
  until the patch lands (PR title/number/author rode the create request),
  lists loading/failed rows in Previous reviews (reopenable), and shows a
  failed page with the error + Retry (removable; never a normal empty
  review). Restart resumes loading ingests or marks them failed (the loading
  snapshot is the durable marker, like the submit lease — no new table; not
  via the agent job queue, which fits provider/model/prompt work, not
  git/gh + DB writes). Same PR/branch while loading reuses the review
  (repo + PR/branch dedupe in the service). Loading/failed refuse Explain,
  comments, Submit, refresh, update, hunks, description, prompts and debug
  with 409. Old rows (no `ingest`) load as ready. Evidence:
  `test/reviews-async.test.ts` (202-before-ingest, loading→ready patch,
  failed + retry + remove, restart, dedupe, pipeline-after-ingest, old-row
  ready), `GuideLoading.test.tsx`, `e2e/open-review.spec.ts` (mock loading
  → guide, failing → Retry).
