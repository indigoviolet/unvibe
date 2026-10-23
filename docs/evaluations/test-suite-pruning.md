# Evaluation: pruning and de-duplicating the test suite (#253)

Spike branch `spike/253-test-suite-pruning`, based on `main` @ `46baba4`.
Evaluation only — no tests changed.

## Current numbers (static inventory)

### e2e (Playwright, `packages/web/e2e/`)

- Spec files: **83** (50 top-level + 33 journeys in `e2e/journeys/`).
- e2e tests: **373 passed + 21 skipped = 394 specs** (measured on this tree;
  `test()`-call grep gives 256 top-level + 53 journey calls, expanded by
  viewport/theme loops).
- `test.skip` lines in e2e: ~40 (mostly `needs mise run build first` guards on
  service specs, plus ~20 `DISABLED(#119)` mock-mode duplicates kept as skips).
- Disabled spec files: 1 (`network-privacy.disabled.spec.ts`, covered by the
  network-guard fixture on every journey).
- Service boots: **73 `startService(` calls** across the suite; roughly one boot
  per real-service file (`beforeAll`) plus restarts inside J6 (3), J18 (4),
  J14 (3), J247 (3), visual-tour.spec.ts (7 across its describes).
  Real-service files: 16 top-level `*-service.spec.ts` + visual-tour (2 files) +
  all 33 journeys = **51 files that boot the built service**.
  Mock-mode files: ~32 (Vite dev server only, no service).
- Global timeout: still **10 min** on this tree (`playwright.config.ts:46`); the
  raise to 20 min lives on unmerged branch `fix/e2e-global-timeout` (`2ba803f`).
  The suite takes 8–10 min on the GitHub runner and has hit the 10-min cap.

### vitest

- Files: 259 total (shared 18, service ~141 incl. disabled, web ~100 incl. disabled).
  Enabled: shared 17 (1 disabled file), service ~122, web ~84.
- Tests: 1,800+ (issue statement; static grep overcounts parametric cases —
  exact passed counts to be filled from the run below).
- Slow files (`*.slow.test.*`, run only in `test:slow` after build): 3 —
  `diagnostics-api.slow`, `network-guards.slow`, `update-helper-bundle.slow`.
- Disabled files: **35** (17 service + 1 shared + 17 web) + ~20 `DISABLED(#119)`
  skip blocks inside enabled files. Disabled tests still compile
  (`typecheck:tests`, lint), so they cost check time while proving nothing.

### Per-file / per-spec durations (measured)

One full e2e run on this tree (build @ `mise run build`, 4 Playwright workers,
local dev machine — the GitHub runner is ~2–4× slower per DEVELOPMENT.md):

- **Result: 373 passed, 21 skipped, 0 unexpected, 0 flaky. Wall 313.6 s
  (5.2 min).** Sum of spec durations 713.7 s (parallelised over workers).
  JSON: `suites[].specs[].tests[].results[].duration`
  (run output kept outside the repo; command was
  `npx --workspace @unvibe/web playwright test --reporter=json`).
- By category (sum of spec durations): **mock 330.2 s (46%, 33 files) >
  tour 211.3 s (30%, 2 files) > journey 134.0 s (19%, 33 files) >
  service-spec 38.2 s (5%, 14 files).**
- The 21 skips are exactly the `DISABLED(#119)` mock-mode duplicates plus the
  `doctor-service` API-only block — no service-spec skipped (build present).

vitest fast suites (`npm run test:fast --workspace`, same tree):

- **shared: 17 files, 233 tests, 0.93 s wall** (negligible; slowest file 0.02 s).
- **service: 117 files, 1,076 passed + 1 skipped, 19.4 s wall**
  (sum of test durations 70.0 s). Slowest files: `hunk-plotlines-169` 10.5 s,
  `versions-refresh` 4.9 s, `mcp` 4.6 s, `huge-pr-107` 4.0 s, `actions-m4`
  3.9 s, `pipeline` 2.7 s, `diagrams` 2.5 s, `reviews-async` 2.4 s,
  `sessions-jobs-143-151` 2.1 s.
- **web: 84 files, 578 passed + 2 skipped, 14.9 s wall**
  (sum 27.8 s). Slowest files: `DiffView` 4.4 s, `FileExpansion` 3.5 s,
  `ModelsSection` 2.3 s, `ReviewBar` 1.9 s, `DiffView.filter` 1.5 s,
  `StartPage.requested` 1.4 s.
- **Total vitest fast: 218 files, 1,890 tests** (233 + 1,077 + 580), matching
  the issue's "over 1,800". Slow suite adds 3 `*.slow.test.*` files on top.

## Overlaps found

### A. Mock spec vs real-service journey vs visual tour (same flow, 2–3x covered)

| Flow | Mock spec (fast, Vite only) | Real-service journey | Visual tour / service spec |
|---|---|---|---|
| Open + read guide | `guide.spec.ts` (15 tests) | J1 (2 tests, replay) | tour guide scenes (4 passes) + `guide-service.spec.ts` |
| Explain/Ask/follow-up/nested | `interaction.spec.ts` (10) | J2 (2, replay) | `interaction-journey-service`, `expansion-nesting-service`, `ask-service` |
| Comments + Submit | `comments.spec.ts` (18) | J3 (1), J9 (2), J17, J223 | `comments-service.spec.ts` (3) + tour comments-menu scene |
| Diff work (fold/filter/reviewed) | `diff.spec.ts` (3 active; 5 skipped as unit dupes), `diff-expand` (8), `diff-pinned` (2), `diff-sticky-bar` (16), `shiki-highlight` (5) | J4 (3, replay) | `real-service.spec.ts` open + tour diff scenes (unified/split/hscroll/deep) |
| Settings + versions | `settings.spec.ts` (21) | J5 (6), J11 (1) | `settings-versions-service.spec.ts` (3) + tour Settings-tab scenes |
| Second opinion | `second-opinion.spec.ts` (3) | J2 (inside), J20 | `second-opinion-service.spec.ts` (1) |
| Reply drafts | `reply-draft.spec.ts` (1) | J15 multi-turn (inside) | `reply-draft-service.spec.ts` (1) |
| D2 diagrams | `d2-diagrams.spec.ts` (6 active), inline (3 active), overlay (5), multiline (1) | J14 (4, incl. diagrams) | `d2-diagrams-service.spec.ts` (6) |
| Debug page + redo | `debug.spec.ts` (11 active), `debug-redo.spec.ts` (4) | J14 (diagrams-debug-redo) | — |
| Doctor | `doctor.spec.ts` (4) | — (no journey) | `doctor-service.spec.ts` (2) |
| Start page lists | `start.spec.ts` (19), `start-lists` (6), `start-kept` (1), `start-block` (2) | J225-start-pr-list, J228, J230 | `real-service` open + tour start-page scene |
| Review bar | `review-bar.spec.ts` (6 active; 3 skipped as unit dupes) | J225-review-polish, J245 | tour-218 toolbar scenes |
| Version picker | `update-picker.spec.ts` (6, simulated) | J5 (real, fake updater) | tour Settings→Version scene (fake updater) |
| Anchors/footnotes | `anchor-idempotence.spec.ts` (1) | J206 (1) | `anchor-footnotes-service.spec.ts` (1) |
| Hunk summaries | `hunk-summary.spec.ts` (6) | J13 (1) | — |
| Plotlines/scores | `score-plotline.spec.ts` (6) | J242 (1), J4 (inside) | tour guide-plotlines scene |
| File tree | — (no mock spec) | J227 (1) | tour file-tree scene |
| Empty diff / blank band | — | J18 (3), J19 (1) | tour + J4 (partial) |

The pattern: a flow is covered **three times** (mock e2e + journey + tour scene
or pre-#188 service spec). The mock run is cheap (no boot); the journey and the
tour scene each pay a full service boot + demo fill for the same assertions.

### B. Pre-#188 service specs superseded by journeys

These 16 top-level `*-service.spec.ts` files each boot their own service for a
flow a J-journey now covers end to end: `ask`, `comments`, `depth-principle`,
`expansion-nesting`, `guide`, `interaction-journey`, `interaction-none`,
`reply-draft`, `second-opinion`, `anchor-footnotes`, plus `real-service`,
`settings-versions-service`, `doctor-service`, `d2-diagrams-service`
(6 tests, dual d2/no-d2 suites). The journeys use the same harness
(`service-harness.ts` + `journey-helpers.ts`) and the same demo/scratch
fixtures. Keeping both means two boots + two demo fills per flow.

### C. Unit tests that re-prove what a journey proves

Web UI-behaviour unit tests (AGENTS.md: unit tests are for pure logic; UI
behaviour belongs to journeys against the real service):

- `DiffView.test.tsx` (+ `DiffView.filter/github/scorePlotline`, `FileExpansion`,
  `HunkCardActivation.disabled`) vs J4 / diff specs — already partly de-duped
  via `DISABLED(#119)` skips in `diff.spec.ts`, but the enabled unit tests and
  the journey still assert the same folds/filters through different harnesses.
- `CardView.test.tsx`, `BlockView.list.test.tsx`, `GuidePage.retry`,
  `PageView.test.tsx` (+ `Plotlines`) vs J1/J2/J242 guide reads.
- `GuideThreads/ThreadView/ReplyBox/CommentsMenu/anchor/selection/threads`
  vs J3/J9/J17/J214 comment flows.
- `ModelsSection/RepositoriesSection`, `versionFormat/limitsUnits` vs J5/J11
  settings combos (the `LimitsSection/AccessSection/VersionSection` unit files
  are already disabled as covered).
- `DiagramInlineZoom/D2Diagram/DiagramOverlay/DiagramView` vs d2 mock specs
  (one direction already disabled: `d2-diagram-inline.spec.ts:52` defers to the
  unit test; the other specs keep both).
- `StartPage/kept/requested`, `ReviewBar`, `AppShell`, `Tabs`, `ScreenTopBar`
  vs start/review-bar journeys + mock specs (several `review-bar.spec.ts`
  blocks already skip as unit dupes).

Service unit tests that mirror journeys (same behaviour, HTTP-level vs
store-level): `reviews*`, `submit-m6`, `versions-refresh/compare/update`,
`huge-pr-107` (J7), `hunk-summary-99` (J13), `diagrams` (J14), `document-222`
(J222), `comment-host-214` (J214), `code-citations-178-112` (J81),
`reviews-running-247` (J247), `commits-193` (plotlines), `godeeper-217`/`reader-*`
(J20), `pipeline-122`/`conversation` (J2/J15). These are cheap (no browser) and
pin edge cases the journeys only touch once — lower duplication value than the
e2e triple-coverage above.

### D. Slowest specs (measured — top 20 by spec duration, local machine)

Per-spec top 20 from the JSON run (durations scale ~2–4× on the CI runner):

1–4. `visual-tour.spec.ts` tour passes: 1440-light 28.8 s, 1440-dark 26.5 s,
    960-light 25.5 s, 960-dark 24.8 s — each runs ~20 scenes × 10 generic
    checks (`stepChecks`: card/menus/gutter/pinned-band/animation/empty-block
    grids + screenshots) with 300 ms settle loops per scene.
5. `j11-settings-combos` 18.7 s (1 test) — models/effort/full-access toggles +
    repo add/remove + data reset: many Settings navigations + service-side
    resets in one test.
6. `visual-tour writing state (slow replay)` 17.8 s — deliberately slowed
    replay stream (`REPLAY_DELAY_MS`) so the writing state is screenshotable.
7. `j225a-settings-badges` 17.9 s (2 tests) — every settings screen × compact
    rows + start-page rows + PR badges: many navigations, one boot.
8. `j206-anchor-blink` 4.7 s, 9. `j15-multi-turn` 4.5 s (follow-ups + restart +
    access change), 10–17. eight `visual-tour-218` combos 4.2–4.5 s each
    (toolbar/selbar/popover/tooltip/menus/diff per theme/width),
    18. `j2-explain-ask` 4.2 s (explain + ask + nested + depth + second
    opinion in one flow), 19. `218 tour (default-light-960)` 4.2 s,
    20. next journey ~4.4 s (`j245`, `j9`, `j228`…).

Per-file top 10 (sum of its specs): `visual-tour.spec.ts` 159.7 s (40 tests),
`visual-tour-218` 51.7 s (12), `guide.spec.ts` 30.7 s (16 mock tests),
`comments.spec.ts` 30.1 s (19), `interaction.spec.ts` 25.1 s (10),
`start.spec.ts` 22.2 s (19), `settings.spec.ts` 19.7 s (23),
`diff-sticky-bar.spec.ts` 19.7 s (16), `j11` 18.7 s, `j225a` 17.9 s.

Why slow, in one place:

- Tour files dominate (211 s / 30%): scene count × combo matrix × settle loops,
  not boots (one boot per tour file).
- Mock files dominate the rest (330 s / 46%): test count × per-test browser
  work (~1–2 s each: navigate, assert, screenshot on failure config); no
  service boot, so each test is cheap but there are 300+ of them.
- Journeys are cheap locally (134 s / 19% for 33 files; median ~2–4 s):
  one boot + `createDemoReview` replay fill per file. On the slower CI
  runner the boot + fill dominates instead (8–10 min total).
- Service-spec files are cheapest (38 s / 5%): one boot each, few tests.
- Common drivers: `createDemoReview` guide-fill poll (up to 90 s cap, usually
  a few seconds locally), fixed `setTimeout(250–2000)` / `waitForTimeout`
  settles, `test.setTimeout(180–420 s)` masks (no cost unless hit), tour
  `stepChecks` settle loops.

### E. Repeated boots / fixtures that could be shared

- 51 files boot the service; ~73 boots total per run (restarts extra). Each
  replay boot pays `createDemoReview`'s guide-fill poll (up to 90 s).
- `makeScratchRepo` / `makeRepo` / `createScratchReview` are copy-pasted across
  `real-service`, `settings-versions-service`, and `journey-helpers.ts` (three
  implementations of the same scratch repo).
- `writeFakeGh` / `writeFakeGhTour` / `writeFakeGitOffline` set up per file;
  identical fake-`gh`/`git` shadowing in every journey `beforeAll`.
- `guide-service.spec.ts` seeds `snapshot.json` straight into the store (no
  pipeline wait) while every journey waits for replay fill — the seed path is
  the faster fixture all replay journeys could share except the ones that test
  the pipeline itself (J1 reader, J20 critic/concepts, J15 multi-turn, J6 restart).
- No shared Playwright `globalSetup`: each file pays boot + fill serially
  (parallelised only by workers).

### F. Disabled / skipped tests to delete

- 35 `*.disabled.test.*` files + 1 `*.disabled.spec.ts` + ~20 `DISABLED(#119)`
  `test.skip` blocks in enabled e2e specs + `lifecycle.test.ts:15` const-pin.
  All are excluded from runs; the `(#188)` ones name their covering journey and
  the `(#119)` ones name the surviving duplicate. Deleting them saves
  `typecheck:tests` + lint time (disabled tests still compile) and removes the
  "two sources of truth" confusion. Breakdown:
  - Pure copy-pins with no behaviour (delete, ~15 files): `cli-usage`,
    `depth-label`, `fakes`, `prompt-goldens`, `prompts-route`, `release-notes`,
    `release-notices`, `sentry`, `setup`, `site`, `adapter-entry`,
    `copy-guard`, `SelectionToolbar`, `depthToast`, `hoverOutline`,
    `stageLabels`, `inflight` (×2), `PreviewBuildBadge`, `VersionSection`.
  - Covered by a named journey (delete, journey becomes the single source):
    `actions-expansion-nesting` (J2), `comments-m6` (J3/J9), `hunk-cards`
    (J13), `ingest/e2e` (J1), `revealed-block` (J1/J2), `reviews-redo` (J14),
    `GuidePage` (J1), `AccessSection`/`FullAccessMarker` (J11),
    `LimitsSection` (J5), `HunkCardActivation` (J13), `SourcePane` (J1/J4),
    `DiffView.large` (J7), `network-privacy` (J1–J8 guard fixture).
  - `shared/test/prompts.disabled.test.ts` (#119 const restatement; service
    `prompts.test.ts:98` already checks agreement).

## Proposals (ranked by estimated saving; risk to coverage)

> Savings are wall-clock estimates for CI, scaled from the measured local run
> (mock 330 s / tour 211 s / journey 134 s / service-spec 38 s summed durations;
> 5.2 min wall on 4 workers; CI runner ~2–4× slower with fewer effective
> workers). Risk = chance the deletion hides a real regression.

| # | Proposal | Est. CI saving | Risk | Files |
|---|---|---|---|---|
| 1 | Merge the 14 pre-#188 `*-service` specs into their J-journeys (one boot per flow, not two) | 1–2 min (measured 38 s summed locally; each of the 14 boots also pays fill + worker slot on CI) | Low — same harness, same fixtures; move any assert the journey lacks instead of keeping the file | `ask-service`, `comments-service`, `depth-principle-service`, `expansion-nesting-service`, `guide-service`, `interaction-journey-service`, `interaction-none-service`, `reply-draft-service`, `second-opinion-service`, `anchor-footnotes-service`, `doctor-service` (API half; UI Reload stays in `doctor.spec.ts`), `d2-diagrams-service` (9.1 s, fold into J14), `real-service` + `settings-versions-service` (fold into J1/J5) |
| 2 | Seed the demo snapshot instead of waiting for replay fill in journeys that don't test the pipeline | 1–3 min (journeys measured 134 s summed locally; fill poll is the per-boot variable part, worse on CI) | Low — `guide-service.spec.ts` already proves the seed path; keep fill-wait only in J1/J15/J20/J6 + tour writing-state | `journey-helpers.createDemoReview` + ~25 replay journey `beforeAll`s |
| 3 | Collapse mock specs that triple-cover journey flows (delete mock, keep journey + tour scene or vice versa) | 3–6 min wall (mock is the largest bucket: measured 330 s summed / 46% across 33 files — e.g. guide 30.7 s, comments 30.1 s, interaction 25.1 s, start 22.2 s, settings 19.7 s, diff-sticky-bar 19.7 s) | Medium — mock specs are the fast no-boot signal; delete only where the journey asserts the same clicks (§A); keep mock specs with no journey (`doctor` UI, `open-review`, `progress-signs`, `immediate-feedback`, `selection-scroll`, `promote-midfill`) | `comments.spec.ts`→J3/J9, `guide.spec.ts`→J1/J2, `settings.spec.ts`→J5/J11, `second-opinion.spec.ts`→J2/J20, `reply-draft.spec.ts`→J15, `hunk-summary.spec.ts`→J13, `review-bar.spec.ts` remainder→J225/J245, `diff-*`/`start-*`/`update-picker` partial folds per §A |
| 4 | Share one booted service + demo review across read-only journey files (Playwright `globalSetup` or fewer, grouped files) | 1–2 min (removes ~30 boots × fill; journeys measured 134 s summed, mostly boot + fill) | Medium — shared state risks cross-test pollution; keep solo data dirs for mutating flows (submit/refresh/restart) | `playwright.config.ts` + `service-harness.ts` + read-only journeys (J1/J2/J4/J10/J13/J20/J242/…) |
| 5 | Trim the visual tour: fold `visual-tour-218` (measured 51.7 s / 12 tests) into `visual-tour.spec.ts` (159.7 s / 40 tests) and/or cut the combo matrix | 1–3 min (tours measured 211 s summed / 30%) | Medium — screenshots are owner-reviewed; combo cuts need owner sign-off per theme | `visual-tour-218.spec.ts` + `visual-tour.spec.ts` combo loops |
| 6 | Delete all disabled files + `DISABLED` skip blocks (21 measured skips in the run) | ~0 run time; ~10–30 s off `check` (disabled tests still compile via `typecheck:tests` + lint) + clarity | None — excluded from every run, each names its cover | 35 `*.disabled.*` + ~20 skip blocks (§F) |
| 7 | Delete web UI-behaviour unit tests whose journey asserts the same clicks; keep pure-logic units | ~0 e2e time; ~5–10 s off `test:fast` (web measured 27.8 s summed / 14.9 s wall; biggest dupes: `DiffView` 4.4 s, `FileExpansion` 3.5 s, `ModelsSection` 2.3 s, `ReviewBar` 1.9 s) | Medium — units are the fast signal; delete only exact-dupe UI tests, keep logic units (`diffLogic`, `expandLines`, `citations`, `anchor`, `selection`, `versionUtils`, `highlight/*`) | §C web list |
| 8 | De-dupe scratch-repo/fake-gh helpers (one `makeScratchRepo`, one fake-gh) | ~0 run time; maintenance only | None — test-only helpers | `real-service.spec.ts` + `settings-versions-service.spec.ts` → `journey-helpers.ts` |

Not proposed: raising `globalTimeout` further (hides the problem), `UNVIBE_E2E_WORKERS=8`
(masks boot cost on weak machines), deleting `open-review`/`progress-signs`/
`immediate-feedback`/`selection-scroll`/`promote-midfill` mock specs (no journey
covers those async/indicator races).

## Open questions for the owner

1. Which of proposals 1–8 should become issues (and in what order)? No test
   changes are made on this spike.
2. May the visual-tour combo matrix shrink (proposal 5), and if so which
   themes/widths are the keepers?
3. For proposal 3, is the mock suite allowed to shrink where a journey asserts
   the same flow, or should mock stay as the fast signal and journeys shrink
   instead?
