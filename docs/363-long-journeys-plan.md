# #363 long journeys — analysis and plan (Phase 1)

Source: issue #363 (owner decisions 2026-11-06; comment 2026-11-07 starts
Phase 1 on branch `chore/363-long-journeys`). Follows #357 (pruning),
#362 (1440-light default + `e2e/tour-matrix.ts`), #358 (`test:affected`).

Baseline measured from `/tmp/gate-f6.log` (latest full gate) plus a static
survey of `packages/web/e2e/` (no Playwright run in Phase 1, per brief).

## 1. Baseline (before)

- Playwright: **346 passed + 11 skipped = 357 tests, 8.6 min** (`test:e2e`
  step "Finished in 518.52s" in gate-f6). `playwright.config.ts` notes
  ~13 min locally and 20+ min on the GitHub runner (v0.0.16 CI timed out
  at 20 min with every finished test green).
- **97 spec files**: 24 top-level in `e2e/`, 73 in `e2e/journeys/`.
- **~3,463 `expect()` calls**, zero `test.step`, zero `expect.soft`.
- **~88 service boots**: 81 files call `startService` (15 top-level specs
  are mock-mode with no boot; nearly every journey boots its own service;
  `visual-tour.spec.ts` alone boots ~7 services across its `beforeAll`s).
- Slowest single tests (all frame-capture in `visual-tour.spec.ts`):
  writing-state 34.5 s, ask-thread 34.1 s, ask-pending 26.3 s,
  ask-retry 20.5 s — ~115 s of slow-replay recording just for frames.

## 2. Journey list (14 long journeys)

Each journey boots once (`beforeAll` service + seeded review), walks an
area in usage order, and uses `test.step` (named steps) with `expect.soft`
inside steps so one failure reports everything. Hard `expect` only for
boot/precondition gates. Convention for all journeys:

- `test.beforeEach`: `cpuThrottleFromEnv(page)` (already the pattern in
  10 specs; make it universal so throttling is one env var away).
- `testId`s / roles for behaviour; no assertions on demo-recording copy
  (see §4, wording pins).
- Geometry reads are single-`evaluate` atomic reads (the j352 fix, §4 B1),
  never paired `boundingBox()` calls across a potential banner/poll tick.
- Screenshots on failure only (`screenshot: "only-on-failure"` already in
  config); no frames in the gate.

| # | Journey (file) | Steps (each a `test.step`) |
|---|---|---|
| L1 | Start page (`l1-start.spec.ts`) | selector lists remembered/detected repos; readiness quiet line vs callouts; lists follow repo + demo row; failing/partial/held lists with Retry; re-select reloads; stale-checkout rows openable/removable; remove confirm deletes local only; PR by number/URL/owner#N incl. unknown-repo clone flow + cancel; managed-clone refresh note; fresh-install clone; request groups + recency filter + diff-size/PR-label/branch rules; block layout + empty recency; kept rows across reload; PR-list edge alignment + quiet remove (#225, #274); author filter; Load more past 30; refresh flips merged/approved + statuses without re-ingest; stacked badges + popover; review-bar icon + single bar + GitHub deep links at 960 |
| L2 | Open and ingest (`l2-open.spec.ts`) | fixture demo opens non-degraded + worktree serves beyond diff (#176); guide reads, citation reveals diff, reload keeps; scratch repo opens with no agent; scratch branch snapshot + hunk state survives reload + restart + WS PATCH; reopen from start reuses (#149); concept page writes on open + reveals canonical hunk; empty diff (no changes / merged-equal-base / refresh-emptied); huge diff filter/fold/counts; reviews progress line through opening→ingesting→building→failed→done, no pill, constant geometry (j352); remove mid-build keeps service up |
| L3 | Guide reading (`l3-reading.spec.ts`) | file tab open/close + bracket-path chip (#81, #332); second citation re-scrolls with tokens; description card + comments-menu jump; glossary hover definition + citation + labelled preview (#252, #302, #304); code highlight python vs unknown + comment placement (#255 behaviour); selection snaps to words + toolbar; toolbar survives app scroll, late scroll dismisses (#147, #319); dotted-link hover preview timing; popover closes on scroll/Esc/outside/resize; hover ignored until pointer moves after scroll; citation preview shows real lines; navigation/trail/back; on-demand concept + finding pages (#216, #240); example aside; controls reachable by hover/focus + shared Tooltip (#274); scroll-restore across pages, no self-scroll while filling; anchor marks stable under patches + idempotence (#15); highlight upgrade onto marked cells, no page error (#101); anchor-blink closed→deep→chip→open→back; thread/glossary/cross-node/list marks rest/focus/preview (#302, #303, #305, #314); select popups above cards; critic run → findings; go-deeper fills / waits for Generate; D2 inline/overlay/multiline behaviour (fit, zoom, pan, reset, Esc, theme swap, citation click inside overlay, multiline stacking) — frames to tour |
| L4 | Threads: Explain and Ask (`l4-threads.spec.ts`) | explain/ask/follow-up/nested-explain/depth; pinned diff threads open/close/mark/reopen/delete + ask-inside-appends (#204); Ask thread + comment share one line; streamed-patch answers with citations, no streamed text; page-card +/undo; suggested question accept + accept/edit/dismiss comment; explain inside guide thread and inside diff thread appends in place; failed follow-up Retry → clean answer; pending input keeps + sends kept draft; draft typed while pending survives failure+retry; closed mid-answer → banner + Retry → clean answer; follow-ups stay in one thread across restart + access-mode change; sent follow-up survives reload; ask starts thread, explain-inside appends, Reply asks again, link scrolls, collapse-all; avatars + reply counts (#331, #315); reply chrome overlap/chips/avatars (#336) |
| L5 | Comments, Outbox, Submit (`l5-submit.spec.ts`) | comment survives reload; submit posts exactly one review; second submit posts nothing new; new reviews hide existing GitHub comments until filter (#296); accepted suggestion + own comment + reply post as one review; branch comment in Outbox by default + Markdown export; Ask thread + reviewer comment toggles carry only the comment (#339); draft edit/close/reopen/delete; gutter digits + padding, added file drops empty column (#261); draft survives re-renders, Discard clears; guide/description markers open-all vs preview-item; marker expand/collapse/mixed + tooltip; Outcomes: no page error anywhere (network-guard fixture does this globally) |
| L6 | Diff work (`l6-diff.spec.ts`) | toolbar progress + counts; one-row narrow toolbar; hide-uninteresting collapse; split pairs + widens narrow pane; file filter + counts + active state + keyboard + Esc; revealSource unhides hidden hunk + highlights; fold survives tab switch, file-reviewed from hunks; filters combine type+plotline+level (#190); multi-line Explain from dotted range, no gutter marker (#189, #285); expand up/down in steps, whole-gap reveal, no controls at revealed boundary; split keeps alignment; revealed lines offer no comment start; unit name in header, hide control when no unit; headers pin + columns align with expansion; sticky bar: pinned under tab strip, revealed lines/file jumps land below it, Files panel visible, full-width in split + sideways scroll, wraps narrow keeping fold pair on one line (#351, #353), file/hunk header replacement, controls keep working, hidden rows scroll under, no scroll container between header and pane, wrap-vs-sideways pinning, overflow-y hidden pinning, column x-alignment; gutter E2 hover reveals controls first/last rows + click expands, icon swap/rest, EOF drops down control + keeps number; expand-repeat up/down ×3, expand-collapse-expand, show-all closes gap, line-1 keeps number, last hunk drops control at EOF; hidden rows read as one flowing row; hide levels + tooltip + persistence + transient expand + citation reveal; file tree long path, no sideways scroll, indicators, full path on hover; plotlines read as chips, builds-on goes earlier, reviewed checkbox partials, disabled on older versions, long names clamp with tooltips, score dots on hunk headers, no dots in Files list (#184); hunk summaries activate/delete/restore/Fold-all, Comment never activates, Explain activates under hunk, promoted hunk keeps chip; blank band: first file header with filter + split + tab switches |
| L7 | Versions, Since, refresh (`l7-since.spec.ts`) | Update writes Since-B + addendum; plotlines + Since-B filter follow; picker offers versions/commits, picking a commit re-baselines; commit baseline stored + delta hunk set; Since filter reads baseline label; offer gone once guide lands; gone commit fails loudly via API; cards/comment/reviewed survive refresh, changed hunk reopens; refresh banner counts, reviewed clears only on changed hunk, old version read-only; code citation outside diff re-anchored after refresh (#112); update-state model: stale banner offers Update, after Update banner reads current, pass clears every card, unaffected listed |
| L8 | Personas and providers (`l8-personas.spec.ts`) | built-ins seeded + listed; Clarity follows main model until pinned; add/edit/delete custom; persona run on a card, tabs, persona-tab Ask; Clarity run keeps citations; pi in providers, pickers offer it with models/effort, doctor reports it; review runs on pi; without pi on PATH pickers fall back; only stubs + fake probed (no real agent binary) |
| L9 | Settings and system (`l9-settings.spec.ts`) | limits persist + inline invalid; full-access marker on/off; version picker fake channels; tabs/?tab=/#section/deep-link + edits survive switches; release-newer/preview-later/up-to-date icons; toggle hides previews, releases stay (#231); model persists + repo add/remove + data reset; one card per screen, compact rows; start rows edge-align, PR icons, Remove keeps row still; tooltips action-only, filter/fold icons, no stale commentary line; release notes per-channel only (#330); update refusal 409 from source checkout + failed-switch rollback UI copy stays mock-only (real rollback covered by service unit tests); doctor breadcrumb through Settings, service/PATH/tool detail + copy, model display names, reload-everything in mock; version + access confirms; stats export downloads leak-clean file |
| L10 | Failure and recovery (`l10-recovery.spec.ts`) | killed mid-answer → restart reopens review with recoverable thread; remove mid-build keeps service up, another review opens; data reset with drafts (framed notice, disabled bar, Export with count, Reset moves aside) and without (Go back / Reset, deep links land on notice); go back switches builds via helper, data untouched |
| L11 | Documents and web (`l11-documents.spec.ts`) | create/read/explain/comment document review; panel shows one thread + answers from two repos; Settings → Extension active-repo checkboxes, panel model picker, install help, Show-folder via runner, connected line from last worker call; web reviews listed under Documents web group, never in Reviews |
| L12 | Extension button (`l12-extension.spec.ts`) | button starts review directly; plain links keep styled confirm; conversation header keeps one button across tab swaps; settings-extension/panel-ask/web-group smoke (full panel flow lives in L11) |
| L13 | Static demo (`l13-static-demo.spec.ts`) | recorded guide at /; citation hover previews real lines; Explain replays recording; Ask with no recording shows install message; comments persist across reload, Reset demo clears; Outbox toggle on seeded thread; hunk summaries from recordings; submit visibly disabled with tooltip reason; settings read-only; debug/doctor hidden; bundle size report; recorded Explain + on-demand hunk summary + guide cards match replay service |
| L14 | Debug and traces (`l14-debug.spec.ts`) | review bar links to debug, Jobs default; tab switching replaces history, one panel; ?tab= deep link survives reload, other params kept; shared-context blocks collapse/expand, Base open; expand/collapse all; open blocks survive tab switch; jobs show state/tokens/cache/tool counts + cancel; prompts show expanded review text + expand/collapse all; delete removes contribution without collapsing; back-link to review; no full-access marker while off; diagram in guide renders as SVG; re-do from top bar lands on fresh review; without d2 unseeded diagram shows source fallback + Settings link; traces: lean build answers 501 while settings saves; Debug names matching debug install; record/export HTTP + job spans (debug-build only; frames already tour-only) |

## 3. Assertion map

### 3a. Top-level specs → destination

| File (tests) | Where each real assertion goes | Dropped (one-line reason each) |
|---|---|---|
| `anchor-idempotence.spec.ts` (1) | L3 reading (idempotence under streamed patches) | — |
| `d2-diagram-inline.spec.ts` (4) | L3 reading (fit/zoom/pan/reset/citation-click behaviour) | frame-only lines → tour |
| `d2-diagram-multiline.spec.ts` (1) | L3 reading (stacking inline + expanded) | theme-pair loop beyond #362 slim → tour-full only |
| `d2-diagram-overlay.spec.ts` (8) | L3 reading (open/lock, zoom/pan/reset/Esc, citation in overlay, theme swap) | viewport-fit matrix rows → tour (viewport IS the behaviour; keep one in L3, rest tour) |
| `debug.spec.ts` (12) | L14 debug (all 12: tabs, history, deep link, blocks, jobs, prompts, delete, back-link, access marker) | — |
| `diff-expand.spec.ts` (8) | L6 diff (all 8) | — |
| `diff-pinned.spec.ts` (3) | L6 diff (pinned open inline both modes); ask-inside-appends → L4 threads | — |
| `diff.spec.ts` (8) | L6 diff (all 8). Note `diff.spec.ts:115-120` before/after width: keep, add settle assert between (§4 B2) | — |
| `diff-sticky-bar.spec.ts` (15) | L6 diff (all 15) | — |
| `doctor.spec.ts` (4+1) | L9 settings (breadcrumb, detail+copy, display names, reload-everything) | — |
| `extension-322.spec.ts` (2) | L12 extension (button starts review; one conversation button). `waitForTimeout(800)` line 385 → replace with worker-call assert (§4 B3) | — |
| `extension-panel-322.spec.ts` (1) | L11 documents (one thread, two repos) | — |
| `glossary-tour.spec.ts` (1) | behaviour (hover definition + citation) → L3; frames + `checkLayout` → tour | frame capture out of gate (§1 item 2) |
| `guide.spec.ts` (10) | L3 reading (all 10). `waitForTimeout(400)` line 163 → hover-settle assert (§4 B3); `hoverFresh` copy → shared helper (§4 B5) | — |
| `network-privacy.disabled.spec.ts` (1) | Keep as-is (explicit PRD §16 walk; network-guard fixture covers the rest implicitly) | — |
| `reload-anchored-review.spec.ts` (1+2 dim?) | L3 reading (`waitForTimeout(350/1500)` → Shiki-gate + patch asserts, §4 B3) | — (#101 guard kept) |
| `shiki-highlight.spec.ts` (5) | L3 reading (first-paint, selection snap, Explain/Close mark, revealSource highlight, copy-as-text). `waitForTimeout(2000)` line 116 → token-span assert | — |
| `start.spec.ts` (26) | L1 start page (all 26). Pair reads lines 42-44, 51-54, 66-67 → atomic single-evaluate (§4 B1); fixture-name texts ("Docs: clarify…") stay — local mock fixture, not demo recording | — |
| `static-demo.spec.ts` (16) | L13 static demo (behaviour 13); sync trio (guide/Explain/summary match replay) stays in L13 — it is the demo↔service contract, not a frame | banner 1440px pair: keep one, other → tour (same banner, wider viewport only) |
| `thread-polish-tour.spec.ts` (1) | rest/focus states + previews-open asserts → L5; frames → tour | frame capture out of gate |
| `update-picker.spec.ts` (1) | L9 settings (mock-only by design: real service 409s from source checkouts; comment in file says so — keep the reference) | — |
| `visual-tour-218.spec.ts` (3) | All → tour (menus/popovers inside-viewport + no-overflow + no-overlap generic checks already live in tour helpers) | gate copies deleted; tour keeps slim set |
| `visual-tour-255.spec.ts` (1 gate) | Behaviour (python highlights, unknown stays plain, comment placement) already covered by `j255` in L3 → tour only | gate copy deleted as duplicate |
| `visual-tour.spec.ts` (37) | Behaviour → journeys: gutter E2 → L6; hidden-hunk rows → L6; hide-level selector → L6 (open-state assert); review-preparing states → L2; writing/ask-retry/ask-pending/ask-thread → L4 (slow-replay behaviour without frames); file tab → L3; remove-confirm pair → L5; re-do pair → L7/L14 (idle+confirm → L7, result → L14); data-reset pair → L10 (1440 only; 960 → tour keep); version + access confirms → L9 (1440 only; dark → tour keep); release notes → L9; since-B/commit/offer/picker quartet → L7 (1440 only; 960 → tour keep); start-studio/theme/console/dark pairs → tour only (font/shape frames). All `shot()`/`screenshot` lines + `stepChecks`/`waitPaneQuiet` polling → tour only | generic layout sweeps (`checkLayout`, `checkCards`, …) are tour-owned, not gate asserts |

### 3b. Journeys → destination (whole files merge; steps interleave)

L1: `j225-start-pr-list`, `j228-author-filter`, `j297-pr-list-more`,
`j230-pr-state-fresh`, `j298-refresh-review-statuses`, `j321-stacked-prs`,
`j245-reviewbar-pr`, `j225-review-polish` (row parts; settings whistle → L9).
L2: `j1-open-and-read`, `j7-huge-pr`, `j18-empty-diff`,
`j352-reviews-progress`, `j247-running-agreement`.
L3: `j81-code-citations`, `j317-file-tab-scroll-highlight`,
`j263-description`, `j252-glossary`, `j255-code-highlight`,
`j266-scroll-restore`, `j20-critic-concepts-godeeper`,
`j206-anchor-blink`, `j302-thread-marks`, `j303-cross-node-quote`,
`j305-list-citations`, `j314-loose-lists`, `j306-select-popup-zindex`
(slim to 1440-light; other combos → tour-full).
L4: `j2-explain-ask` (scroll-then-toolbar half keeps the #147/#319 guards),
`j214-explain-in-comment`, `j270-ask-retry`, `j271-ask-pending`,
`j272-ask-closed`, `j15-multi-turn`, `j273-flat-threads`,
`j10-suggested`.
L5: `j3-comments-submit`, `j9-comment-edges`,
`j17-submit-mix`, `j223-outbox`, `j339-outbox-toggle`,
`j346-inline-confirm`.
L6: `j4-diff-work`, `j265-expand-up`, `j288-expand-down-last-hunk`,
`j308-expand-repeat`, `j283-hidden-hunks`, `j285-gutter-e2`,
`j325-hide-level`, `j227-file-tree`, `j242-plotlines-card`,
`j353-plotline-names` (frames test → tour; clamp/tooltip/scores → L6),
`j13-hunk-summaries`, `j19-blank-band`.
L7: `j351-since-b`, `j351-since-commit`, `j16-refresh-carryover`,
`j12-refresh`, `j367-update-state`, `j5-settings-versions` (version-picker
parts; settings halves → L9).
L8: `j349-personas` (edit/add **form frames** → tour; the other 3 → L8),
`j349b-personas-variants`, `j279-pi`, `j11-settings-combos` (model/provider
parts; settings halves → L9).
L9: `j5-settings-versions` (settings halves), `j11-settings-combos`
(settings halves), `j225a-settings-badges`,
`j225-review-polish` (settings halves), `j330-release-notes`,
`j323-stats-export`.
L10: `j6-restart-mid-answer`, `j311-data-reset`,
`j354-remove-while-building`.
L11: `j222-document`. (Panel flow: `extension-panel-322.spec.ts`, §3a.)
L12: `j322-extension`. (Button flow: `extension-322.spec.ts`, §3a.)
L13: static-demo behaviour (§3a); no journey merges in.
L14: `j14-diagrams-debug-redo` (**split three ways**: diagram tests → L3,
debug-page tests → L14, re-do tests → L14; the `it(diff:…)` generated
aliases stay with their group), `j356-traces`, `j356-traces-debug`
(record/export → L14; `debug frames` → tour).

### 3c. Pure logic → vitest (no browser)

- Update-icon/channel rules already in service unit tests; the L9/UI half
  keeps only "icon shows / links to Version".
- Filter-combination logic (#190), author-match rules, recency grouping:
  extract pure matchers to `packages/shared` or service units; journeys
  keep one end-to-end combination each.
- Replay prompt-marker matching, permutation logic: already covered by
  prompt goldens + `replay-match` units; the `prompts/` trigger row stays.
- `versionFormat` copy, `data-format` stamping, `gh`-write boundary
  (`test/gh-writes.test.ts`), no-real-spawn guard: already vitest, unchanged.

### 3d. Guards that must survive (named)

Past-bug: j352 under-title line; #319 toolbar-vs-late-scroll; #147
toolbar scroll; #189/#285 dotted-range Explain; #296 hidden GitHub
comments; #204 pinned threads; #274 title/tooltip/quiet-remove; #225
edge alignment; #232 preparing states; #284 reduced motion; #285 EOF
gutter; #283 hidden rows; #265 expand-up; #325 hide level; #311 reset;
#330 notes; #346 inline confirms + version/access; #351 since-B/commit;
#149 start-page reuse; #176 non-degraded demo; #112 re-anchor; #101
highlight upgrade; #15 idempotence; #216/#240 on-demand pages; #131
branch filter; #190 filter combine; #184 score dots; #261 gutter digits;
#339 outbox toggle; #331/#315 avatars; #336 reply chrome; #302/#304
glossary preview; #332 bracket path; #333 one conversation button;
#345/#346 re-do; #367 update state; #227 file tree; #242 plotlines;
#263 description; #266 scroll restore; #270/#271/#272 ask recovery;
#302/#303/#305/#314 marks; #308 expand repeat; #317 file tab; #321
stacked PRs; #322 extension; #112 re-anchor.
Security / privacy / data / money: network-guard on every spec +
`network-privacy` walk (PRD §16); `gh`-write boundary; submit lease +
exactly-once submit (L5); DATA_FORMAT stamp + reset-moves-aside (L10);
Outbox export before reset (L10); extension origin+token gate (L11/L12);
409 switch refusal from checkouts (L9); no-real-spawn; full-access marker;
`GITHUB_TOKEN` stripped in harness; fake-`gh`-refuses-writes for live
checks (test rules, unchanged).

## 4. Brittleness findings

- **B1 — non-atomic layout reads (the j352 race, fixed twice).**
  `2c83c5b` then `3a86f1f`: two `boundingBox()` calls straddled a
  late-loading readiness banner (CI hit: 67.5 px). Fix used in j352:
  one synchronous `evaluate` returning both rects + measuring the title
  offset *inside its row*. Remaining instances of the pattern:
  `start.spec.ts:42-44`, `:51-54`, `:66-67` (three reads incl. readiness
  line — same banner family as j352, highest risk);
  `j225a-settings-badges.spec.ts:272-274` (triple: row/title/meta);
  `:96-98` (card/input pair); `j305:47-48`, `j297:256-257`,
  `j245:218-221` (pairs on settled content — convert anyway, cheap).
  `diff.spec.ts:115-120` before/after across a click is a legitimate
  comparison but needs a settle assert between (split table visible).
  `j352:measure()` still uses two calls — only across reloads, low risk;
  convert for uniformity. Proposed fix: a shared `measureWithin(page,
  rowSel, innerSel)` helper (single `evaluate`) used by all journeys.
- **B2 — fixed sleeps (41 `waitForTimeout` sites).** Replace every one
  with a web-first assert; the tour move deletes the visual-tour ones:
  `j206:102` 3000 ms (blink settle → assert on mark class);
  `shiki-highlight:116` 2000 ms (grammar upgrade → token-span assert);
  `reload-anchored:101` 1500 ms (staggered completion → held-request +
  patch asserts); `j3:142` 1000 ms (post-submit settle → review-list
  row assert); `visual-tour:953` 800 ms, `:2788/:2813` 500 ms (tour);
  `extension-322:385` 800 ms (side-panel settle → worker-call log
  assert); `j2:670` 2000 ms, `:282/:285` 150/600 ms (streamed patch →
  patch-path asserts); `j273:516-554` 300-400 ms ×4 (thread rest →
  class asserts); `j271:136`/`j270:64`/`j272:78`/`j6:54,102` 500 ms
  (answer-pending windows → status asserts); `j19:131` 400 ms,
  `guide:163` 400 ms, `reload-anchored:41` 350 ms, `j321:144`,
  `j11:62`, `j228:264`, `j297:269` 250 ms (poll/settle → explicit
  visibility asserts); `select.ts:27` 250 ms shared helper (selection
  flush → selection-range assert); `visual-tour-218:141` 600 ms (tour).
- **B3 — wording / fixture pins.** Long-literal asserts:
  "Plotline: Unfold obsolete folded response headers…" ×3,
  "Unfold obsolete folded response header values…" ×1 (use the plotline
  chip test id + builds-on link, not the demo card title);
  "npm install -g github:indigoviolet/unvibe#v0.0.12" (pin to a released
  version — assert the install-command shape, not the version);
  "Demo: a recorded Unvibe review of urllib3#5020" (assert demo-row
  test id). `start.spec` row names ("Docs: clarify…") are the local mock
  fixture — allowed, but move behind test ids so fixture edits don't
  break the suite. j352's "Journey test PR" is test-created data — fine.
- **B4 — late-loading UI / background polling.** Readiness banners load
  late on slow runners (`start.spec`, j352 — addressed by B1 +
  in-row asserts); Refresh flows (`j230`, `j298`, `j12`, `j16`) poll
  behind banners — assert banner text first, then the settled row;
  `j247` list↔snapshot agreement polls a live pipeline — bound the wait
  (`UNVIBE_REPLAY_DELAY_MS` is already the lever) and assert via
  `/api/reviews` status, not pixels; j352's
  `waitForLoadState("networkidle")` is load-sensitive — replace with the
  Reviews-heading assert it already does next; tour's `waitPaneQuiet` /
  `stepChecks` 300 ms × 15/10 polling loops move to the tour with the
  frames.
- **B5 — hover / order dependence.** `hoverFresh` is copied into 4 files
  (`guide`, `d2-overlay`, `static-demo`, `j9`) — unify into one helper
  next to `measureWithin`. Hover-gated asserts (j285 gutter controls,
  j352 `.uic-idlehold` opacity, j225-start quiet remove) keep hover but
  assert the pre-hover hidden state first (j352 already does) after
  fonts/scroll quiet. Order-dependent: `visual-tour passes` serial
  (shared review + same quotes + global collapse-all) — split the shared
  review per journey in L4/L5/L6 so journeys never share mutable state;
  since-tour serial describes — same treatment; `update-picker` mock
  singleton — unchanged (single test).
- **B6 — throttle coverage.** Only 10 files wire `cpuThrottleFromEnv`
  (j283, j265, j285, j266, j325, j308, j288, j4 + visual-tour globally);
  every other timing-sensitive spec is unprotected. Make it universal
  via a shared fixture (one line in each journey file), so §6's
  one-throttled-core run actually bites.

## 5. Work packages (one full suite at a time)

Packages run **sequentially** (never two full suites at once — shared
machine, §AGENTS.md). Within a package the agent runs only its journeys
(+ `check`, which is fast and lock-free). Order: A → B → C → D, then one
final full `gate` on the merged tree before merge.

- **Pkg A — shell** (L1 start, L2 open/ingest, L10 recovery).
  Runs alone: `l1/l2/l10` spec files (mock start halves need no build;
  real halves need `build`). Files absorbed: `start.spec.ts`,
  `j225-start-pr-list`, `j228`, `j297`, `j230`, `j298`, `j321`, `j245`,
  `j1`, `j7`, `j18`, `j352`, `j247`, `j6`, `j311`, `j354`.
- **Pkg B — reading** (L3 guide, L6 diff). Runs alone: `l3/l6` files.
  Absorbs: `guide`, `shiki`, `anchor-idempotence`, `reload-anchored`,
  `glossary-tour` (split), `d2-*` (behaviour), `diff`, `diff-expand`,
  `diff-pinned`, `diff-sticky-bar`, `j81`, `j317`, `j263`, `j252`,
  `j255`, `j266`, `j20`, `j206`, `j302/303/305/314`, `j306`, `j4`,
  `j265/288/308`, `j283`, `j285`, `j325`, `j227`, `j242`, `j353`,
  `j13`, `j19`, `j14`-diagram-third, tour-preparing/gutter/hidden-row/
  hide-level/file-tab frames→tour.
- **Pkg C — conversation** (L4 threads, L5 submit, L8 personas). Runs
  alone: `l4/l5/l8` files. Absorbs: `j2`, `j214`, `j270/271/272`,
  `j15`, `j273`, `j10`, `j3`, `j9`, `j17`, `j223`, `j339`, `j346`,
  `thread-polish-tour` (split), `j349`, `j349b`, `j279`, `j11`-halves,
  `j5`-halves, tour ask-trio behaviour.
- **Pkg D — system + harness** (L7 since, L9 settings, L11 documents,
  L12 extension, L13 static demo, L14 debug/traces; tour migration of
  `visual-tour*.spec.ts`, `glossary/thread-polish` tours,
  `j349/j353/j356` frames; `test:affected` throttle change §6; AGENTS.md
  rules text §7). Runs alone: `l7/l9/l11/l12/l13/l14` + tour files.
  Absorbs the rest. Pkg D also deletes the gate copies of the tour
  specs and slims `j306`/banner/960 leftovers per §3a.

Each package: build once, run its journey files, run `mise run check`,
report. Supervisor runs the single final `gate` (with current `main`
merged in) before merge.

## 6. Estimates

| | Files (gate) | Tests | Service boots | Local | CI runner |
|---|---|---|---|---|---|
| Before (gate-f6) | 97 | 357 (346+11 skip) | ~88 | ~13 min | 20+ min (timeout at 20 in v0.0.16) |
| After | ~14 journeys (+ tour on-demand) | ~14-20 `test()`s, ~150-250 steps | ~15-25 | 3-5 min | 6-10 min |

Why: boots dominate (each `startService` + seeded review + browser is
~10-30 s; 88 → ~20). Frame removal saves the ~115 s slow-replay quartet
plus all `shot()` time; `expect.soft`+steps don't reduce time but turn
one-failure-per-run into full reports. CI range assumes the runner stays
~4× slower than dev (DEVELOPMENT.md §CI); the throttled-core `affected`
run (§7) keeps slow-machine races visible before merge.

`test:affected` change (#358 + #363 item 5): run the affected Playwright
set with `UNVIBE_E2E_WORKERS=1 UNVIBE_E2E_CPU_THROTTLE=4` (one throttled
core, as the #319 fix verified) — implement by wrapping the two
Playwright invocations in `scripts/test-affected.mjs`, keeping
`--dry-run` output identical plus the two env lines. Universal
`cpuThrottleFromEnv` (§4 B6) makes the throttle bite everywhere.

## 7. Proposed AGENTS.md rules text (item 4)

Append to the "When a gate fails" rule block:

```md
- When a test fails, name the cause or race in the fix (what rendered,
  loaded or polled late, and what the assert now waits on). Raising a
  timeout or adding a sleep is not a fix.
- A test fixed twice for timing gets rewritten or deleted on the second
  fix — the third strike is the rewrite, not a third patch.
- A CI-only flake is root-caused the same day (throttle locally with
  `UNVIBE_E2E_CPU_THROTTLE=4` and repeat until it shows) or quarantined
  with `test.skip` + a tracking issue the same day. It never blocks a
  release unresolved: quarantined tests are listed in the issue comment
  at publish time.
```

## 8. Comment draft for #363

(Identical content to §§1-7 above, wrapped for posting; supervisor to
post. Numbers: 357 → ~14-20 tests, 88 → ~20 boots, CI 20+ min → 6-10 min;
14 journeys L1-L14; packages A-D sequential; AGENTS.md text as in §7.)
