# Test-suite audit — spike for issue #188

Spike branch `spike/test-suite-audit` (from `main-rc`). Read-only audit: no test or source
code was changed. All repository and test names below are from this repo, the bundled
demo, or public open-source projects, per `AGENTS.md`.

## Summary

The owner asked for "a smaller number of good regular end-to-end testing" replacing
"a bunch of useless unit tests", and "real testing wherever possible" (#188).

Headline numbers, measured on this checkout (see Method):

| Suite | Files | Tests | Wall time measured here |
| --- | ---: | ---: | ---: |
| Service fast vitest | 118 | 1,068 (1,042 passed, rest skipped live/slow) | 19.1 s |
| Shared fast vitest | 14 | 216 | ~0.7 s |
| Web fast vitest (`VITE_MOCK=1`) | 96 | 651 (650 passed) | 14.8 s |
| Slow vitest (`*.slow.test.*`, needs a build) | 4 | 12 (static count) | not run (no build) |
| Playwright e2e | 48 | 278 (`--list`) | not run (needs a build + browser) |
| **Regular total** | **281** | **≈2,225** | fast vitest ≈34.6 s sequential |

The owner's rough counts (service ~1,040, shared ~215, web ~644, e2e ~250) match the
passed/expanded counts above; the difference is `it.each` expansion and skipped
live tests counted by the reporters.

Classification of the 281 files (tests in brackets; fast-vitest measured unless noted):

| Class | Files | Tests | Meaning |
| --- | ---: | ---: | --- |
| KEEP-UNIT | 109 | 1,142 | Pure logic that catches real mistakes cheaply. Keep as-is. |
| COVERED-BY-JOURNEY | 54 | 370 | Behaviour a real end-to-end journey exercises. Disable once the journey lands. |
| PINS-DETAIL | 21 | 166 | Asserts implementation detail, exact copy, store internals, or an old decision. Disable. |
| MOCK-ONLY-UI | 49 | 270 | Web unit tests that only prove the mock DOM renders. Disable once journeys land. |
| E2E-MOCK | 34 | 242 | Playwright against the Vite mock only. Replace with journeys. |
| E2E-REAL | 14 | 36 | Playwright against the real built service. Fold into the journeys. |

Proposed result (after owner review, journeys built, replaced tests disabled not deleted):

|  | Before | After (estimate) |
| --- | ---: | ---: |
| Test files in regular gates | 281 | ≈117 (106 fast keep + 3 slow keep + 8 journey specs) |
| Tests in regular gates | ≈2,225 | ≈1,156 (1,135 fast keep + 7 slow keep + ≈14 journey tests) |
| Fast vitest wall (`check`, excl. lint/typecheck) | ≈34.6 s | ≈12–18 s (estimate, see below) |
| Playwright wall | 278 tests, unmeasured here; config global timeout 10 min, CI step allows 30 min | ≈4–7 min sequential, ≈2–3 min at 4 workers (estimate) |
| Mock-only tests remaining | 270 unit + 242 e2e = 512 | 0 in regular gates |

Token safety (owner's addition, full section below): `check`, `test:slow`
and `restart-resilience` cannot spend agent tokens as written — every agent
path in them is forced to the replay runner, the scripted fake, a fake ACP
transport, or `none`, and only `test:live:*` sets `UNVIBE_LIVE=1`. Three
edges are safe by convention, not by force (a mistyped `UNVIBE_AGENT`
reaching the factory's real fall-through, the readiness-route factory
fallback, and shell e2e not forcing the runner); a one-flag guard
(`UNVIBE_ALLOW_LIVE_AGENT=1`, set only by `test:live:*` and the product's
own CLI entry) is proposed to make all three fail loudly.

Recommendation: keep the 109 KEEP-UNIT files untouched, build journeys J1–J7 below
(J8, the visual tour, is being built by another agent on `main-rc` — reference it, do
not duplicate it), then disable the 158 COVERED/PINS/MOCK/E2E-MOCK files with the
#119 mechanism (`*.disabled.test.*` / `*.disabled.spec.ts` plus the
`DISABLED(#188):` first-line comment, or `it.skip` for single tests). Nothing is
deleted, so any file can be re-enabled in one rename if a journey proves weaker
than expected. The main risk left uncovered is enumerated in "Risk left uncovered".

## Method

- File inventory: `find packages -name "*.test.*" -o -name "*.spec.ts"` excluding
  `node_modules` (281 files; `__snapshots__/*.snap` are fixtures, not test files).
- Test counts and per-file runtimes: `vitest run --reporter=json` per workspace
  (`UNVIBE_TEST_SUITE=fast`, `VITE_MOCK=1` for web), run sequentially, never in
  parallel, per `DEVELOPMENT.md`. Shared was built first
  (`npm run build --workspace @unvibe/shared`, the same first step as
  `mise run test:fast`); without it 87 service suites fail to resolve
  `@unvibe/shared`, which is a build-order fact, not a test failure.
- Playwright counts: `npx playwright test --list` (278 tests in 48 files).
  Playwright itself was not run: the service is not built in this worktree
  (`packages/service/dist/index.js` absent) and a full run would take the
  shared machine for up to the 10-minute global timeout. Per-spec runtimes
  below are therefore estimates, labelled as such.
- Slow vitest, live, and disabled files are excluded from the fast reporters;
  their counts are static `it(`/`test(` counts and their runtime column says so.
- Per-file runtime in the table is the vitest JSON file duration (start→end of
  that file's suite), rounded to 0.1 s. Because vitest runs up to 8 workers,
  per-file durations sum to more than the wall time; use the wall times in the
  summary for gate estimates.
- Churn evidence: `git log --oneline --name-only -n 600` counted per test file,
  plus `git log` on the specific files named in the task.
- Classification was done per file from its header comment, `describe`/`test`
  titles, and harness imports (`service-harness.ts`/`startService` for real
  service, `resetMockState`/`mockApi` for mock). Where a file mixes kinds, the
  table gives the primary class and the note names the slice that should stay.

### What "real" means for the journeys

Every journey runs the built service (`packages/service/dist/index.js`, as
`service-harness.ts` already spawns it) with: a temp data dir and port, real
SQLite, real `git` in temp repos, the bundled demo / `fixtures/urllib3-5020`,
the replay agent (`UNVIBE_AGENT=replay`) or `none`, `gh` stubbed through the
injectable command runner / fake-`gh` PATH stub, `GITHUB_TOKEN` deleted from
the child env, and real Chromium. Assertions are user-visible outcomes only:
text a reader can see, a draft that survives reload, exactly one stubbed `gh`
call recorded, a version string after a switch — never store rows, exact
prompt bytes, or internal keys.

## Why so many current tests do not catch real bugs

Three structural reasons, all visible in the inventory:

1. **Mock-only rendering cannot see layout.** 49 web unit files (270 tests) and
   34 e2e files (242 tests) run only against the in-memory mock (`VITE_MOCK=1`,
   jsdom or the Vite mock server). jsdom has no layout, and the mock has no
   service, SQLite, or `git`. The recent real bugs the owner cited — a gutter
   painted over cards, clipped menus, a toolbar that did not work inside a
   floating card (fixed in `17c8ccd`, `b535a30`, and the #184 series on this
   branch's history) — are layering/layout bugs. Only a real browser over the
   real service, plus the J8 visual tour's generic layering checks, can see them.
2. **Pinned details break on intended change, not on bugs.** 21 files (166 tests)
   assert exact copy, exact counts, or a test double's own behaviour. Worked
   examples below.
3. **The same behaviour is tested three times.** Dozens of behaviours exist as a
   service unit test, a web mock unit test, and a mock e2e test (comments,
   diff folds, settings, diagrams). The `DISABLED(#119)` comments already in the
   tree say this repeatedly, e.g. `diff.spec.ts` "same clicks and assertions as
   DiffView.test.tsx", `review-bar.spec.ts` "same attributes asserted by
   ReviewBar.test.tsx". A journey replaces all three layers at once.

### Churn and pin evidence (git log)

Most-touched test files in the last 600 commits (touches, not authors):

| Touches | File |
| ---: | --- |
| 15 | `packages/web/e2e/comments.spec.ts` |
| 14 | `packages/web/src/floating/SelectionToolbar.test.tsx` |
| 13 | `packages/web/e2e/settings.spec.ts` |
| 12 | `packages/web/src/source/diff/DiffView.test.tsx` |
| 11 | `packages/service/test/diagrams.test.ts` |
| 10 | `packages/web/src/comments/ThreadView.test.tsx`, `packages/web/src/shell/ReviewBar.test.tsx` |
| 9 | `packages/web/e2e/diff.spec.ts`, `settings-versions-service.spec.ts`, `start.spec.ts` |

Named examples from the task, verified in history:

- **`inflight.test.ts` (both copies).** `packages/web/src/guide/inflight.test.ts`
  (18 tests) and `packages/web/src/state/inflight.test.ts` (22 tests) pin fixed
  in-flight labels, entry keys, and generation counters. History shows them
  edited to follow intended work, e.g. `59d055c test(web): pin #126 stream
  accumulation in inflight.test.ts`, `cf43f34 One box while Explain/Ask work,
  with fixed labels (#97)`, and the #136 slice commits that rewrote the card
  model under them. The user-visible fact ("one working box with a plain label
  while an answer streams") is one assertion in J2; the key arithmetic is not.
- **Prompt counts in e2e.** `settings-versions-service.spec.ts:162` asserts
  `toHaveCount(18)` prompt templates. History: `e400768 e2e: prompt template
  count 17 -> 18 for plotline_assign (#169)`, then `b419004 Fix e2e prompt
  count pin: 18 to 17 templates (#142)` and `ae0121c` for the same pin in
  `prompts-route.test.ts`. Adding or removing a template — an intended change —
  breaks the count; a broken template does not. The parser tests in
  `prompts.test.ts` (KEEP-UNIT) already prove every template parses and agrees
  with the shared name list.
- **Fake runner `starts` collisions.** `3ba3be2 fix(#172): rename fake start
  log to startCalls (collided with subclass starts)`. Tests that read the fake
  runner's `starts` array (e.g. `full-access-160.test.ts:633`) couple the suite
  to the double's field names. `fakes.test.ts` itself tests the doubles and
  already has two tests `DISABLED(#119)` for exactly that reason; the guard
  that matters — no test may spawn a real agent or `gh` — is `no-real-spawn.test.ts`
  (KEEP-UNIT) plus the command guard in `buildApp`.
- **Already-disabled precedent.** 1 whole file (`shared/test/prompts.disabled.test.ts`)
  and ~25 individual `DISABLED(#119)` tests show the owner-approved pattern:
  disable with a one-line reason, do not delete. This audit extends that list;
  it does not invent a new mechanism.

## Classification table

Classes: **KEEP-UNIT** keep · **COVERED-BY-JOURNEY** disable when its journey
lands · **PINS-DETAIL** disable · **MOCK-ONLY-UI** disable when journeys land ·
**E2E-MOCK** replace with a journey · **E2E-REAL** fold into a journey.
"Exercises" is the file's own header/`describe` summary, truncated. Runtime is
the fast-vitest file duration, or the reason it was not measured.

| File | Tests | Runtime | Exercises | Class | Journey / note |
| --- | ---: | ---: | --- | --- | --- |
| `packages/service/test/acp-isolation.test.ts` | 1 | 0.0s | ACP import isolation | KEEP-UNIT | static ACP boundary guard |
| `packages/service/test/acp-live.test.ts` | 16 | 0.0s | Live ACP adapter tests — excluded from `mise run check`, run with `mise run test:live` (UNVI... | KEEP-UNIT | live-only, excluded from gates; not counted in regular suite |
| `packages/service/test/acp-runner.test.ts` | 28 | 0.2s | Wait until the fake transport has received the prompt (abort/crash can then land mid-flight). | KEEP-UNIT | ACP protocol mapping over fake transport; no journey replaces protocol edge c... |
| `packages/service/test/actions-ask-followups.test.ts` | 5 | 0.6s | Follow-up suggestions on the unified card (#136 slice 2, owner decisions on #136): one behav... | COVERED-BY-JOURNEY | J2 |
| `packages/service/test/actions-echo.test.ts` | 3 | 0.4s | Echo stripping (issue #50) end to end: a leading body line that exactly repeats the selectio... | COVERED-BY-JOURNEY | J2 (echo-strip is reply parsing; keep 1 parser case if J2 proves flaky) |
| `packages/service/test/actions-expansion-nesting.test.ts` | 1 | 0.5s | Explain, Ask and Note on text inside a conversation answer (#116, #136) | COVERED-BY-JOURNEY | J2 |
| `packages/service/test/actions-m4.test.ts` | 18 | 4.2s | M4 interaction actions end to end (PRD §4.3, §4.4, §4.6–§4.8, §12) | COVERED-BY-JOURNEY | J2/J3 |
| `packages/service/test/adapter-entry.test.ts` | 2 | 0.0s | Adapter entry resolution (`agent/acp/connection.ts`) | PINS-DETAIL | restates ADAPTER_FILE names; 1 test already DISABLED(#119) |
| `packages/service/test/agent-none.test.ts` | 3 | 0.3s | `UNVIBE_AGENT=none`: the pipeline is disabled (comments/diff/versions specs), so no backgrou... | COVERED-BY-JOURNEY | J1/J5 no-agent state (also interaction-none-service) |
| `packages/service/test/agent-shim-mise.test.ts` | 2 | 0.0s | Issue #105: agent sessions fail to start when the reviewed repo has a mise config and the ag... | KEEP-UNIT | shim/mise security regression, fake shim |
| `packages/service/test/auth.test.ts` | 5 | 0.0s | loadOrCreateToken | KEEP-UNIT | token gate |
| `packages/service/test/cards-stale.test.ts` | 4 | 0.0s | `markStaleAnchors` checks the visible depth level (issue #72) | COVERED-BY-JOURNEY | J2 depth switch |
| `packages/service/test/changes-pr-branch.test.ts` | 2 | 0.4s | #91: PR rows carry the head branch from `gh pr list --json headRefName` (the old `gh search ... | COVERED-BY-JOURNEY | J1 |
| `packages/service/test/changes-pr-lists.test.ts` | 5 | 0.4s | Start-page PR lists (#95, #100, #94, #91): one `gh pr list` call per list returns number, ti... | COVERED-BY-JOURNEY | J1 |
| `packages/service/test/cli-lock.test.ts` | 4 | 0.0s | service lock | KEEP-UNIT | lock file persistence/ownership |
| `packages/service/test/cli-usage.test.ts` | 1 | 0.0s | CLI help (issue #86, finding 17): the help names every command — including `version` and the... | PINS-DETAIL | exact CLI help copy |
| `packages/service/test/comments-m6.test.ts` | 13 | 0.3s | M6 comments: create (reviewer / suggested), reply, open/close, mark For PR, edit draft, dele... | COVERED-BY-JOURNEY | J3 (store-level; journey covers user-visible, keep location cases - see locat... |
| `packages/service/test/context.test.ts` | 15 | 0.0s | Same logical snapshot, rebuilt with a different key insertion order. | KEEP-UNIT | context builder determinism/budget - pure, expensive to hit via journey |
| `packages/service/test/contributions.test.ts` | 2 | 0.1s | Shared-context contributions route (PRD §4.14, §9.5; M8 settings): GET lists `snapshot.contr... | COVERED-BY-JOURNEY | J5/J2 suggested comments |
| `packages/service/test/conversation-mcp-turns.test.ts` | 2 | 0.6s | Conversation turns keep a working review-tool connection (follow-up to the unified card work... | COVERED-BY-JOURNEY | J2 (MCP retry edge stays KEEP if journey cannot force dead URL) |
| `packages/service/test/conversation.test.ts` | 9 | 1.3s | Conversation cards, issue #136 (Explain is Ask with a default question) | COVERED-BY-JOURNEY | J2 |
| `packages/service/test/degraded-turn-51.test.ts` | 13 | 1.7s | Agent replies are never judged by their wording (issues #51, #180) | KEEP-UNIT | reply-wording validator - pure logic, journey cannot enumerate wording cases |
| `packages/service/test/depth-label.test.ts` | 2 | 0.0s | cardTitle (issue #80) | PINS-DETAIL | exact label fallback |
| `packages/service/test/desc-ids-base.test.ts` | 7 | 0.0s | Issue #110: the base context lists the PR description's paragraphs with their `desc:` IDs, s... | KEEP-UNIT | desc: ID assignment/validator agreement |
| `packages/service/test/desc-ids.test.ts` | 5 | 0.5s | Issue #96: agents cannot get `desc:` IDs from the review tools | KEEP-UNIT | desc: ID search/resolve |
| `packages/service/test/description-m6.test.ts` | 6 | 0.2s | M6 description round-trip (PRD 4.11, 15): content outside edited paragraphs round-trips byte... | KEEP-UNIT | description round-trip byte parser |
| `packages/service/test/diagnostics-api.slow.test.ts` | 1 | excluded from fast run | Real-probe diagnostics agreement (issues #20, #35, #40; slow suite #119) | KEEP-UNIT | slow: real-probe agreement |
| `packages/service/test/diagnostics-api.test.ts` | 3 | 0.2s | Diagnostics + reload endpoints (issue #20): token-gated, no token leak, reload flips a fake ... | KEEP-UNIT | diagnostics route contract/token leak |
| `packages/service/test/diagnostics-path.test.ts` | 5 | 0.3s | PATH probing (issue #20): same answer however the process was started | KEEP-UNIT | PATH probing with fake shells |
| `packages/service/test/diagnostics-tools.test.ts` | 8 | 0.0s | Tool discovery (issue #20): every candidate, shim detection, version only from success, skip... | KEEP-UNIT | tool discovery/shim logic |
| `packages/service/test/diagrams.test.ts` | 39 | 2.6s | D2 diagrams (docs/d2-diagrams.md) | KEEP-UNIT | D2 sanitiser/discovery - security; rendering covered by J8 |
| `packages/service/test/error-codes.test.ts` | 5 | 0.1s | Error codes (issue #86, finding 10): the service sets a machine `code` beside the unchanged ... | KEEP-UNIT | error-code mapping contract |
| `packages/service/test/events.test.ts` | 1 | 0.0s | EventBus | KEEP-UNIT | EventBus fan-out |
| `packages/service/test/exec-runner.test.ts` | 2 | 0.0s | RealCommandRunner working-directory errors: a moved/deleted checkout must produce a specific... | KEEP-UNIT | runner cwd errors |
| `packages/service/test/expansion-block-ids.test.ts` | 5 | 0.6s | Block IDs stay unique within one answer body (#116, #136) | KEEP-UNIT | block-ID uniqueness parser |
| `packages/service/test/fakes.test.ts` | 5 | 0.0s | FakeCommandRunner | PINS-DETAIL | tests the test doubles; 2 already DISABLED(#119) |
| `packages/service/test/file-slice.test.ts` | 4 | 0.8s | File-slice route (issue #133): `GET /api/reviews/:id/file` serves raw ranges of a file at a ... | KEEP-UNIT | file-slice route over real git |
| `packages/service/test/full-access-160.test.ts` | 35 | 0.4s | Full access opt-in (issue #160): setting + acknowledgement, the two prompt variants, per-pos... | KEEP-UNIT | permission/posture security matrix; user-visible toggle in J5 |
| `packages/service/test/full-access-live.test.ts` | 6 | 0.0s | Live full-access check (issue #160) — excluded from `mise run check`, run with `mise run tes... | KEEP-UNIT | live-only, excluded |
| `packages/service/test/gh-writes.test.ts` | 1 | 0.0s | M6 guardrail: nothing outside the Submit review path may write to GitHub | KEEP-UNIT | static gh-write boundary guard |
| `packages/service/test/host.test.ts` | 15 | 0.3s | Host/Origin gate tests (DNS-rebinding + cross-site WebSocket defense) | KEEP-UNIT | host/origin security gate |
| `packages/service/test/huge-pr-107.test.ts` | 15 | 4.1s | Issue #107: huge PRs must not overflow the guide prompt, and the hunk summarise pass must no... | KEEP-UNIT | prompt ladder/fan-out pure logic; J7 covers user-visible huge PR |
| `packages/service/test/hunk-cards.test.ts` | 6 | 0.7s | Hunk summaries as content cards (issue #138): the first interaction with an idle summary act... | COVERED-BY-JOURNEY | J4/J2 hunk summary activation |
| `packages/service/test/hunk-plotlines-169.test.ts` | 8 | 10.1s | Issue #169: hunk interestingness scores + change plotlines from the agents Unvibe already runs | COVERED-BY-JOURNEY | J4 (score/plotline parsing edges stay KEEP) |
| `packages/service/test/hunk-summary-99.test.ts` | 12 | 0.3s | Issue #99: a hunk summary in the diff pane shows the agent's raw JSON, cut off at 140 charac... | KEEP-UNIT | reply-shape parser |
| `packages/service/test/ingest/classify.test.ts` | 26 | 0.0s | File classification (language-agnostic) + rule-based uninteresting pre-classification + stab... | KEEP-UNIT | file classification/file keys |
| `packages/service/test/ingest/diff.test.ts` | 5 | 0.0s | Diff parser tests: prototype parity on the real urllib3/urllib3#5020 diff (extracted from `<... | KEEP-UNIT | diff parser prototype parity |
| `packages/service/test/ingest/e2e.test.ts` | 2 | 0.2s | End-to-end ingest against a temporary git repo: real `git`, fake `gh` | COVERED-BY-JOURNEY | J1 ingest over real git (already journey-shaped at service level) |
| `packages/service/test/ingest/fetch-once.test.ts` | 4 | 0.7s | #123: one `git fetch` at ingest (head + base refspecs together), with `gh pr view` running a... | KEEP-UNIT | fetch-once/moved-head logic with stubbed git |
| `packages/service/test/ingest/hash.test.ts` | 5 | 0.0s | Hunk content-hash stability (PRD §8): same content at shifted line numbers and with whitespa... | KEEP-UNIT | hunk hash stability |
| `packages/service/test/ingest/pr-merge-base.test.ts` | 13 | 1.4s | #93: PR merge-base against `origin/<base>` + head fetch via `refs/pull/<n>/head`, through th... | KEEP-UNIT | merge-base resolution with stubbed git; J1 covers happy PR |
| `packages/service/test/jobs.test.ts` | 25 | 0.0s | Deterministic job-queue tests (PRD §12): fake clock + fake random, no timers, no agents. | KEEP-UNIT | job queue: cap/priority/back-off with fake clock |
| `packages/service/test/lifecycle.test.ts` | 10 | 0.0s | IdleMonitor timing | KEEP-UNIT | idle/shutdown timing; 1 constant test already DISABLED(#119) |
| `packages/service/test/listen.test.ts` | 6 | 0.3s | Loopback dual-bind (issue #108): `listen()` answers however the browser resolves `unvibe.loc... | KEEP-UNIT | loopback dual-bind security |
| `packages/service/test/location-m6.test.ts` | 10 | 0.0s | M6 location computation (PRD 4.8, 4.12): diff-line, guide-block via first `diff:` citation, ... | KEEP-UNIT | thread location mapping - pure |
| `packages/service/test/m4-web-fixes.test.ts` | 3 | 0.2s | M4 web fixes (service side, additive): - PATCH /comments/:id `open` applies to conversation ... | COVERED-BY-JOURNEY | J2/J3 |
| `packages/service/test/managed-cli.test.ts` | 14 | 0.0s | Manager-aware start/stop/status (issue #108, follow-up) | KEEP-UNIT | manager-aware start/stop logic with stubbed runner |
| `packages/service/test/mcp.test.ts` | 17 | 4.5s | MCP tests (PRD §10) through a real SDK client over HTTP: tool surface per role, all five too... | KEEP-UNIT | MCP tool surface/traversal security |
| `packages/service/test/network-guards.slow.test.ts` | 5 | excluded from fast run | Static network guard on the built web app (PRD §16 Privacy, issue #119) | KEEP-UNIT | slow: built-app static guard |
| `packages/service/test/network-guards.test.ts` | 2 | 0.0s | Static network guards (PRD §16 Privacy) | KEEP-UNIT | static privacy guard |
| `packages/service/test/network-privacy.test.ts` | 3 | 0.4s | Network and privacy guarantee (PRD §16) | KEEP-UNIT | CSP/no-non-loopback e2e at service level |
| `packages/service/test/no-real-spawn.test.ts` | 5 | 0.1s | Guard against finding 1 (issue #119): no unit test may start the real `claude`/`codex` adapt... | KEEP-UNIT | test-harness guard |
| `packages/service/test/open-questions-181.test.ts` | 7 | 0.5s | Agents' open questions as AI-suggested comments (issue #181) | COVERED-BY-JOURNEY | J2/J3 suggested comments |
| `packages/service/test/outline-route.test.ts` | 4 | 0.9s | Outline route (issue #133, stage 2): `GET /api/reviews/:id/outline` answers enclosing units ... | COVERED-BY-JOURNEY | J4 outline via UI selection (route edge stays KEEP) |
| `packages/service/test/outline.test.ts` | 9 | 0.1s | Outline rules (issue #133, stage 2): unit chains over small fixtures with the real grammars ... | KEEP-UNIT | grammar outline parser |
| `packages/service/test/pick-folder.test.ts` | 11 | 0.2s | Native folder picker (#26): `POST /api/repos/pick-folder` through the injectable command run... | KEEP-UNIT | folder-picker platform parsing via stubbed runner |
| `packages/service/test/pipeline-122.test.ts` | 6 | 1.1s | #122 click-path waits: ordering tests with the fake runner | COVERED-BY-JOURNEY | J1/J2 ordering (bookkeeping edges hard to see in UI) |
| `packages/service/test/pipeline.test.ts` | 14 | 2.6s | M3 pipeline integration (PRD §11): demo e2e with the replay runner, failure paths with scrip... | COVERED-BY-JOURNEY | J1 |
| `packages/service/test/preview-publish.test.ts` | 21 | 0.0s | Preview publish helpers (issue #36): slug + version derivation, the preview-only push guard,... | KEEP-UNIT | preview slug/version pure helpers |
| `packages/service/test/prompt-goldens.test.ts` | 18 | 0.0s | Golden files for every template rendered against the fixed fixture snapshot | PINS-DETAIL | exact prompt bytes for every template; re-render on intent |
| `packages/service/test/prompts-route.test.ts` | 8 | 0.2s | GET /api/prompts | PINS-DETAIL | template list/count pin - see churn note; snapshot shape in J6 debug |
| `packages/service/test/prompts.test.ts` | 13 | 0.0s | parseTemplate front-matter validation | KEEP-UNIT | template parser/front-matter validation |
| `packages/service/test/reader-146-124.test.ts` | 5 | 0.5s | The reader job retries once when its review tools fail to connect (issue #146, plus the repa... | COVERED-BY-JOURNEY | J6/J1 retry (repair-prompt record is PINS-DETAIL slice) |
| `packages/service/test/readiness.test.ts` | 10 | 0.2s | Readiness endpoint (GET /api/readiness): git/gh/agent probes with ok/warning/error, one-line... | COVERED-BY-JOURNEY | J1/J5 readiness UI (probe-state matrix stays KEEP) |
| `packages/service/test/release-notes.test.ts` | 1 | 0.0s | Release-notes install story (issue #156) | PINS-DETAIL | exact release-notes wording |
| `packages/service/test/release-notices.slow.test.ts` | 5 | excluded from fast run | Third-party notices build-match guard (issue #14, slow suite #119) | PINS-DETAIL | slow: notices vs build list pin |
| `packages/service/test/release-notices.test.ts` | 3 | 0.0s | Third-party notices staleness guard (issue #14) | PINS-DETAIL | notices coverage pin |
| `packages/service/test/replay.test.ts` | 8 | 0.0s | ReplayAgentRunner | KEEP-UNIT | replay matcher - test infrastructure correctness |
| `packages/service/test/repos-review-fixes.test.ts` | 13 | 0.5s | Review fixes for managed clones (#27, follow-up): each suite below fails against the pre-fix... | COVERED-BY-JOURNEY | J1 |
| `packages/service/test/repos-url.test.ts` | 24 | 1.0s | Managed clones by URL (#27): clone happy path (exact argv, blobless, GITHUB_TOKEN unset), re... | KEEP-UNIT | repo URL parsing - pure, many cases |
| `packages/service/test/repos.test.ts` | 14 | 0.3s | Repos: remote parsing, checkout detection, and the HTTP routes (GET/POST /api/repos, GET /ap... | COVERED-BY-JOURNEY | J1 repo add/list |
| `packages/service/test/reuse.test.ts` | 7 | 0.4s | PRD §12 result reuse (audit #10): repeating the identical request returns the stored result ... | KEEP-UNIT | worktree reuse logic |
| `packages/service/test/revealed-block.test.ts` | 1 | 0.0s | Revealed-line host text (issue #133): Explain/Ask anchored outside any hunk reads the line t... | COVERED-BY-JOURNEY | J2 citation reveal |
| `packages/service/test/review-base-sessions.test.ts` | 3 | 0.6s | Base sessions belong to one review (#43) | KEEP-UNIT | base-session persistence; J6 covers restart slice |
| `packages/service/test/review-reader.test.ts` | 1 | 0.1s | Agents read explanation text through the review tools (#143) | COVERED-BY-JOURNEY | J1 reader |
| `packages/service/test/reviews-async.test.ts` | 11 | 2.2s | #92: async open — POST answers before ingest, loading→ready via patches, failed + retry + re... | COVERED-BY-JOURNEY | J1 async open |
| `packages/service/test/reviews-list.test.ts` | 6 | 1.1s | Front-screen review list (GET /api/reviews) + delete (DELETE /api/reviews/:id) | COVERED-BY-JOURNEY | J1 |
| `packages/service/test/reviews-redo.test.ts` | 3 | 0.6s | Re-do guide (#115): `POST /api/reviews/:id/redo` deletes + re-creates through the existing p... | COVERED-BY-JOURNEY | J1/J6 redo |
| `packages/service/test/reviews.test.ts` | 5 | 0.8s | Reviews + hunks routes: validation, ingest → snapshot, refresh movement reporting, hunk PATC... | COVERED-BY-JOURNEY | J1 |
| `packages/service/test/route-errors.test.ts` | 3 | 0.2s | Route error handler (issue #86, finding 2): an exception thrown inside a route answers the a... | KEEP-UNIT | route error shape |
| `packages/service/test/second-opinion.test.ts` | 16 | 0.6s | Second opinion (PRD §4.10, §12): isolation, blind topic, same-model refusal, storage/replace... | COVERED-BY-JOURNEY | J2 |
| `packages/service/test/sentry.test.ts` | 5 | 0.1s | Dev-only Sentry reporting (issue #29): off without a DSN, never loads the SDK in that case, ... | PINS-DETAIL | telemetry wiring pin; no user-visible outcome |
| `packages/service/test/server.test.ts` | 2 | 0.2s | HTTP auth gate | KEEP-UNIT | server boot/token |
| `packages/service/test/service-manager.test.ts` | 21 | 0.0s | Start-at-login service management (issue #108, follow-up) | KEEP-UNIT | service-manager unit logic |
| `packages/service/test/service-shutdown.test.ts` | 6 | 0.9s | Bounded, ordered service shutdown (issues #30, #36 follow-up) | KEEP-UNIT | bounded shutdown - restart safety |
| `packages/service/test/sessions.test.ts` | 16 | 0.0s | Session-manager tests (PRD §9.2, §12) with a scripted stub runner — never a real agent. | KEEP-UNIT | session persistence/resume; J6 covers mid-answer slice |
| `packages/service/test/settings-defaults.test.ts` | 30 | 0.3s | Default model selection from live adapter lists (PRD §§4.14/12, issue #88) | KEEP-UNIT | settings defaults/stored-shape - cheap pure |
| `packages/service/test/settings.test.ts` | 10 | 0.2s | Settings + jobs/settings route tests (PRD §4.14, §14.1). | COVERED-BY-JOURNEY | J5 (validation matrix stays KEEP) |
| `packages/service/test/setup.test.ts` | 20 | 0.0s | Stub runner: records calls; fakes osacompile by writing a bundle skeleton. | PINS-DETAIL | setup/login-unit exact contents pin (shell e2e covers behaviour) |
| `packages/service/test/shared-context-debug.test.ts` | 8 | 0.2s | Per-review shared-context debug endpoint (issue #32, PRD §9) | COVERED-BY-JOURNEY | J6 debug page |
| `packages/service/test/sharedctx.test.ts` | 24 | 0.6s | Shared-context tests (PRD §9.3–§9.5, §12): deterministic, fake clock + scripted runners | KEEP-UNIT | shared-context contributions logic |
| `packages/service/test/shim-resolve.test.ts` | 9 | 0.0s | Shim resolution (issue #105): `mise which` / `asdf which` from a neutral directory, caching ... | KEEP-UNIT | shim resolution logic |
| `packages/service/test/site.test.ts` | 5 | 0.0s | Front-door page checks (issue #150) | PINS-DETAIL | site asset pin |
| `packages/service/test/snapshot.test.ts` | 2 | 0.2s | snapshot build | KEEP-UNIT | snapshot store shape |
| `packages/service/test/state.test.ts` | 5 | 0.1s | ReviewStore: patch-op correctness, durability across reopen, event emission, per-review seri... | KEEP-UNIT | store state/persistence |
| `packages/service/test/store.test.ts` | 2 | 0.1s | store migrations | KEEP-UNIT | store round-trip; tiny |
| `packages/service/test/submit-m6.test.ts` | 7 | 0.3s | M6 submit: preview (dryRun) payloads, exact `gh` invocations + JSON, double-submit protectio... | COVERED-BY-JOURNEY | J3 (lease crash-safety slice stays KEEP - see submit lease) |
| `packages/service/test/subprocess-allowlist.test.ts` | 2 | 0.0s | Subprocess allowlist (PRD §16 Privacy) | KEEP-UNIT | static subprocess allowlist guard (31 cases, 1 describe) |
| `packages/service/test/temp-guard.test.ts` | 3 | 0.1s | Temp-dir guard (issue #24): fails the run if the leak machinery regresses | KEEP-UNIT | temp-dir guard |
| `packages/service/test/update-helper-bundle.slow.test.ts` | 1 | excluded from fast run | Switch-helper bundle containment (issue #36) | KEEP-UNIT | slow: helper bundle builtins-only guard |
| `packages/service/test/update-helper.test.ts` | 15 | 0.2s | Switch-helper state machine (issue #36, step 2): every step injected, so the full matrix run... | KEEP-UNIT | update helper restart/rollback logic |
| `packages/service/test/update-mise-path.test.ts` | 9 | 0.0s | mise-managed Node update PATH (issue #170) | KEEP-UNIT | mise PATH handling for update |
| `packages/service/test/update-routes.test.ts` | 15 | 0.5s | Version-picker routes (issue #36, step 2): gate off/on, busy + lease + pending refusals, unk... | COVERED-BY-JOURNEY | J5 version switch routes |
| `packages/service/test/update-updater.test.ts` | 12 | 0.0s | Update seam units (issue #36, step 2): fake backend semantics, failure injection, data-dir s... | COVERED-BY-JOURNEY | J5 |
| `packages/service/test/update.test.ts` | 44 | 0.0s | `unvibe update` (issue #36, step 1 + review fixes): channel listing parsing (incl | KEEP-UNIT | channel/install pure logic (45 tests) |
| `packages/service/test/validate.test.ts` | 17 | 0.0s | validateTarget | KEEP-UNIT | citation validator |
| `packages/service/test/versions-anchors.test.ts` | 9 | 0.0s | versions/anchors: remapping fixtures | KEEP-UNIT | version anchor logic |
| `packages/service/test/versions-compare.test.ts` | 7 | 0.0s | versions/compare: pure hunk-by-hunk comparison fixtures | KEEP-UNIT | version compare pure |
| `packages/service/test/versions-refresh.test.ts` | 13 | 3.4s | versions/refresh: real-git integration (real `git`, no `gh`) | COVERED-BY-JOURNEY | J4/J1 version refresh in UI (refresh logic edges KEEP) |
| `packages/service/test/versions-update.test.ts` | 2 | 0.3s | versions/update: update-pass application with a fake prompt runner | COVERED-BY-JOURNEY | J5 |
| `packages/service/test/viewer.test.ts` | 2 | 0.1s | M6 viewer endpoint: `GET /api/viewer` returns the `gh api user` login and caches it (one `gh... | COVERED-BY-JOURNEY | J1 viewer |
| `packages/service/test/ws.test.ts` | 2 | 0.2s | WS `/api/events?review=:id`: authenticated streaming from the review's bus, tested with a re... | KEEP-UNIT | WebSocket gate/bus |
| `packages/shared/test/blocks.test.ts` | 13 | 0.0s | Block walker (issue #71, #136): the diagrams route must find diagram blocks wherever the dat... | KEEP-UNIT | pure shared logic |
| `packages/shared/test/content-block-ids.test.ts` | 6 | 0.0s | Unique block IDs within one stored body (#116) | KEEP-UNIT | pure shared logic |
| `packages/shared/test/content-hunk.test.ts` | 28 | 0.0s | Hunk-pass reply tolerance (issue #99): `parseHunkReply` accepts the `{"hunk": …}` object fen... | KEEP-UNIT | pure shared logic |
| `packages/shared/test/content-parse.test.ts` | 23 | 0.0s | parseBlocks golden | KEEP-UNIT | pure shared logic |
| `packages/shared/test/content-split.test.ts` | 7 | 0.0s | splitReply | KEEP-UNIT | pure shared logic |
| `packages/shared/test/content-stream.test.ts` | 13 | 0.0s | Paragraph-by-paragraph streaming splitter (issue #126, experiment): completed paragraphs onl... | KEEP-UNIT | pure shared logic |
| `packages/shared/test/content-titles.test.ts` | 19 | 0.0s | Card title fallback (issue #49) and echo stripping (issue #50). | KEEP-UNIT | pure shared logic |
| `packages/shared/test/content-untrusted.test.ts` | 4 | 0.0s | Other people's Markdown (issue #168): paragraphs, lists and fences render; raw HTML never pa... | KEEP-UNIT | pure shared logic |
| `packages/shared/test/diff.test.ts` | 10 | 0.0s | Shared diff pipeline: sync SHA-256 matches `node:crypto`, and the parse → classify → hash → ... | KEEP-UNIT | pure shared logic |
| `packages/shared/test/guide.test.ts` | 2 | 0.0s | isDefaultGuideTitle | KEEP-UNIT | pure shared logic |
| `packages/shared/test/ids.test.ts` | 10 | 0.0s | parseId | KEEP-UNIT | pure shared logic |
| `packages/shared/test/links.test.ts` | 6 | 0.0s | tokenizeLinks | KEEP-UNIT | pure shared logic |
| `packages/shared/test/prompts.disabled.test.ts` | 1 | excluded from fast run | prompt contract (additive, PRD §13) | PINS-DETAIL | already disabled; restates template-name constant |
| `packages/shared/test/repos.test.ts` | 56 | 0.0s | parseGitHubRepoInput | KEEP-UNIT | pure shared logic |
| `packages/shared/test/scores.test.ts` | 19 | 0.0s | Hunk scores + plotlines contract (issue #169): the small interface a later source (the Decis... | KEEP-UNIT | pure shared logic |
| `packages/web/src/api/apiError.test.ts` | 6 | 0.0s | Error-code parsing (issue #86, finding 10): the client reads the service's machine `code` fr... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/api/token-cookie.test.ts` | 4 | 0.0s | Token cookie scope (issue #108): the cookie the web app mirrors from the URL token is persis... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/comments/CommentsMenu.test.tsx` | 2 | 0.2s | Comments menu "Already on GitHub" section (issues #168, #183): the section follows the diff'... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/comments/GithubThreads.test.tsx` | 6 | 0.0s | Existing GitHub comment grouping + outdated detection (issue #168): replies nest under their... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/comments/GuideThreadMarks.test.tsx` | 1 | 0.1s | Guide comment marks (follow-up to the open-as-page staleness fix): the marking pass re-runs ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/comments/GuideThreads.test.tsx` | 3 | 0.1s | Guide explain placeholder (issue #46): an explain started from a selection on the block show... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/comments/ReplyBox.test.tsx` | 5 | 0.2s | Reply-box draft race (follow-up to the unified card work): once a send is accepted the box i... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/comments/ThreadView.test.tsx` | 14 | 0.3s | Comment thread behaviour against the mock API (`VITE_MOCK=1`): typed text survives unrelated... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/comments/anchor.test.ts` | 23 | 0.1s | Deepest nesting of `mark.anc` inside `root` (1 = flat, >1 = nested layers). | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/comments/doubleIndicator.test.tsx` | 2 | 0.3s | Double busy indicator (issue #97): while an Explain or Ask works, the client-side placeholde... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/comments/selection.test.ts` | 10 | 0.0s | snapWordOffsets | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/comments/threads.test.ts` | 5 | 0.0s | threadPostText | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/components/ErrorBoundary.test.tsx` | 10 | 0.2s | Error boundaries (issue #101): a throw in one part shows that part's fallback and leaves the... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/components/escapeHtml.test.ts` | 1 | 0.0s | `escapeHtml` (issue #101): text in, HTML-safe text out. | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/copy-guard.test.ts` | 1 | 0.7s | User-facing copy guard (issue #45, section 4) | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/debug/MarkdownView.test.tsx` | 4 | 0.0s | Debug Markdown renderer (issue #32): headings, lists, fenced code, and inline code/bold rend... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/debug/RedoGuideSection.test.tsx` | 6 | 0.2s | Re-do guide section (#115): confirmation, navigation, and when the control is not offered (d... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/floating/SelectionToolbar.test.tsx` | 32 | 0.1s | resolveSelectionHost (#78) | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/floating/Toast.test.tsx` | 2 | 0.0s | Toast: replace-on-new + auto-dismiss. | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/floating/Tooltip.test.tsx` | 3 | 0.1s | Tooltip: delayed open + PRD §4.5 dismissal rules. | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/BlockView.list.test.tsx` | 2 | 0.0s | List citation layout (issue #165): every item keeps its own chip next to its text, and no bl... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/CardView.test.tsx` | 13 | 0.3s | Card immediate feedback (issue #46) against the mock API (`VITE_MOCK=1`): Generate on a pend... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/CardViewPromoted.test.tsx` | 4 | 0.2s | Page cards moved mid-fill (issue #152): a conversation opened as a page while its answer is ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/D2Diagram.test.tsx` | 23 | 0.3s | D2 diagram tests (D2 decision addendum): - the defensive adopt pass leaves hostile payloads ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/DepthControl.test.tsx` | 4 | 0.1s | Shared depth stepper (issue #129): while a depth change runs, + and − keep their icons and a... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/DiagramInlineZoom.test.tsx` | 5 | 0.2s | Inline in-place diagram zoom tests (round two, item 2): - the diagram fits the block at rest... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/DiagramOverlay.test.tsx` | 13 | 0.4s | Expanded diagram overlay tests (issue #47): - Expand opens a dialog and moves focus into it;... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/DiagramView.test.tsx` | 4 | 0.2s | Diagram caption inline markup (issue #48): a caption with backticked code and a citation ren... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/GuideLoading.test.tsx` | 4 | 0.1s | #92: loading and failed review pages + Reviews row markers. | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/GuidePage.retry.test.tsx` | 2 | 0.1s | Guide error-state retry (issue #86, finding 14): "Couldn't build the guide" offers Retry, wh... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/GuidePage.test.tsx` | 2 | 0.1s | Guide-page error boundary (issue #101): a throw in the page view shows a guide-sized notice ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/Markers.test.tsx` | 7 | 0.1s | Rendering tests for citation markers and counts (PRD §4.5) + footnote chips (issue #72, PRD ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/PageView.plotlines.test.tsx` | 4 | 0.6s | Plotlines on the guide root (issue #169): the reader's named threads sit between Contents an... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/PageView.test.tsx` | 6 | 0.3s | Default guide title display (issue #102): a root page whose stored title is the default "Gui... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/actions.test.ts` | 9 | 0.6s | Action funnel against the mock API (`VITE_MOCK=1`, issue #46): the in-flight entry is set sy... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/citations.test.ts` | 10 | 0.0s | Citation resolution tests: real hunk-line previews, description paragraphs, short-key aliase... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/guide/depthToast.test.ts` | 7 | 0.4s | Depth reuse toasts (issue #65): the toast shows only when the level did not change and nothi... | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/guide/expansions/ConversationCard.test.tsx` | 7 | 0.3s | Conversation card (issue #136 slice 1): one answer view per turn with per-answer controls, a... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/expansions/CorrectionSuggestion.test.tsx` | 1 | 0.0s | Correction cites (issue #86, finding 12): the "cites:" line shows the resolved file:line lab... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/expansions/ExpansionDiagram.test.tsx` | 1 | 0.1s | Answer diagrams (issues #71, #136): a diagram block stored in a conversation turn renders th... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/expansions/ExpansionNesting.test.tsx` | 7 | 0.3s | Selecting text inside an explanation (#116): annotations hosted on an expansion block render... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/expansions/FloatingCard.test.tsx` | 14 | 0.4s | Floating conversation cards (issue #167): clicked cards float above the content by default, ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/expansions/StreamedAnswer.test.tsx` | 7 | 0.2s | Paragraph-by-paragraph answers (issue #126, experiment): completed paragraphs from the live ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/expansions/expansionUtils.test.ts` | 4 | 0.0s | conversation card utils | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/guide/expansions/hoverOutline.test.tsx` | 1 | 0.1s | Hover-outline regression (issue #111): the guide's mouseover handlers must not strip the dep... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/guideUtils.test.ts` | 16 | 0.0s | Unit tests for the pure guide logic: contents model, depth text selection, link discovery (b... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/guide/inflight.test.ts` | 18 | 0.0s | In-flight helpers (issue #46): fixed labels, rewrite detection, entry keys, and busy resolut... | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/guide/secondOpinion/SecondOpinionBlock.test.tsx` | 3 | 0.3s | Second-opinion result block (PRD §4.10): model label, verdict chip, reasoning with citation ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/secondOpinion/SecondOpinionRemove.test.ts` | 1 | 0.1s | Remove-during-rerun (issue #76): removing a second opinion while its re-run is in flight dro... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/guide/stageLabels.test.ts` | 3 | 0.0s | stageLabel | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/settings/AccessSection.test.tsx` | 3 | 0.2s | AccessSection (issue #160): read-only state, the warning confirm step, enabling with the ack... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/settings/BrowseFolderButton.test.tsx` | 4 | 0.2s | BrowseFolderButton (#26): picked → onPick, cancelled → nothing, unavailable → inline reason ... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/settings/LimitsSection.test.tsx` | 3 | 0.0s | Limits validation errors (issue #86, finding 11): the service names the internal key; the UI... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/settings/ModelsSection.test.tsx` | 13 | 0.5s | ModelsSection provider switch (#87): changing the provider only loads that provider's models... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/settings/RepositoriesSection.test.tsx` | 2 | 0.2s | RepositoriesSection + BrowseFolderButton (#26): Browse fills the path field (Add by path sti... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/settings/VersionSection.test.tsx` | 2 | 0.2s | VersionSection switch-anyway flow (#36 follow-up): a running-jobs refusal renders inline on ... | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/settings/versionFormat.test.ts` | 7 | 0.0s | Version-picker display helpers: grouping, short shas, relative times, outcome copy. | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/shell/AppShell.test.tsx` | 5 | 0.3s | Pane-toggle behaviour tests for the review shell (issue #83) against the mock API (`VITE_MOC... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/shell/FullAccessMarker.test.tsx` | 3 | 0.0s | FullAccessMarker (issue #160): renders nothing when the setting is off or unreadable; a quie... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/shell/PreviewBuildBadge.test.tsx` | 3 | 0.1s | Preview-build badge tests (issues #36, #141): the full pill in app headers and the compact r... | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/shell/ReviewBar.test.tsx` | 11 | 1.4s | ReviewBar tests (issue #31 round 2): review identity, the GitHub link-out (PR reviews only),... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/shell/ScreenTopBar.test.tsx` | 4 | 0.1s | ScreenTopBar tests (issue #31 round 2): app-wide header contents — home link, breadcrumb tra... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/shell/jobCounts.test.ts` | 5 | 0.0s | Job-count mapping (issue #98): running vs queued across every job state the service has. | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/SourcePane.tabs.test.tsx` | 2 | 0.1s | Description tab naming (issue #86, finding 22): "Commits" for a branch review (no PR), "PR d... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/SourcePane.test.tsx` | 1 | 0.1s | Source-pane error boundary (issue #101): a throw in the tab body shows a pane-sized notice w... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/description/canEdit.test.ts` | 5 | 0.0s | canEditDescription | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/description/paneName.test.ts` | 3 | 0.0s | Description-pane naming (issue #86, finding 22): "Commits" for a branch review (no PR), "PR ... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/description/segments.test.ts` | 2 | 0.0s | splitDescriptionHtml | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/DiffAnchorCrash.test.tsx` | 2 | 0.1s | Regression tests for issue #101 (the `removeChild` crash itself) | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/DiffBoundary.test.tsx` | 1 | 0.2s | Per-file error boundaries (issue #101): a file section that throws shows a file-shaped notic... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/DiffPromotedLink.test.tsx` | 2 | 0.1s | Promoted links in the diff (issue #152, fault a): opening a diff-anchored conversation as a ... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/DiffView.filter.test.tsx` | 5 | 1.5s | Diff file-filter behaviour against the mock API (`VITE_MOCK=1`): split out of DiffView.test.... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/DiffView.github.test.tsx` | 3 | 1.0s | Existing GitHub comments in the diff (issue #168) against the mock API (`VITE_MOCK=1`): curr... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/DiffView.large.test.tsx` | 1 | 1.1s | Large-diff behaviour (`VITE_MOCK=1`): split out of DiffView.test.tsx (issue #119) so the 300... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/DiffView.scorePlotline.test.tsx` | 6 | 1.4s | Hunk scores + plotlines in the diff pane (issue #169), against the mock API (`VITE_MOCK=1`):... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/DiffView.test.tsx` | 16 | 4.6s | Behaviour tests for the diff pane against the mock API (`VITE_MOCK=1`, see `package.json` te... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/FileExpansion.test.tsx` | 14 | 3.6s | Expand-by-lines behaviour tests against the mock API (`VITE_MOCK=1`): step controls above/be... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/HunkCardActivation.test.tsx` | 5 | 0.3s | Hunk summary activation (issue #138): idle summaries are plain text with a `data-hunk` attri... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/diffLogic.test.ts` | 19 | 0.0s | Unit tests for the pure diff-pane logic (PRD §4.13). | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/expandLines.test.ts` | 10 | 0.0s | Unit tests for expand-by-lines region math (issue #133, stage 1). | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/highlight/codeHtml.test.ts` | 3 | 0.0s | `codeHtml` (issue #101): token runs to HTML, plain runs spanless. | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/highlight/language.test.ts` | 5 | 0.0s | Language detection tests (issue #23). | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/highlight/render.test.tsx` | 8 | 0.6s | Highlight render tests (issue #23) | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/highlight/selectionGuard.test.ts` | 8 | 0.0s | Selection-guard tests (issue #23, hardening item 5): highlight upgrades swap text nodes for ... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/highlight/shiki.test.ts` | 9 | 0.4s | Real-Shiki tokenising tests (issue #23) | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/source/diff/highlight/tokenize.test.ts` | 10 | 0.0s | Hunk-token plumbing tests (issue #23) | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/hunkAnchor.test.ts` | 6 | 0.0s | Hunk-anchor helpers (issue #138): attribute parsing, hunk lookup, the comment line (first ad... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/source/diff/summarizeBusy.test.tsx` | 3 | 0.5s | Hunk summarize busy state (issue #63): clicking Summarize shows dots (`aria-label="Summarizi... | MOCK-ONLY-UI | mock-rendered component; journey covers interaction, this file only proves mo... |
| `packages/web/src/start/StartPage.kept.test.tsx` | 8 | 0.3s | Start page kept lists (issue #90): the last successful PR/branch lists render at once from s... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/start/StartPage.requested.test.tsx` | 19 | 0.5s | Start page review requests (#95): "Waiting on your review" splits into asked-of-you and aske... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/start/StartPage.test.tsx` | 7 | 0.0s | #91: PR rows with no `branch` (as `gh search prs` returns them) render `#N`, never `#N · und... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/start/keptChanges.test.ts` | 13 | 0.0s | Kept PR/branch lists storage (issue #90): versioned key, validation, 10-repo cap, and gracef... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/state/inflight.test.ts` | 24 | 0.0s | In-flight action state (issue #46): set on click, handed over to the snapshot job, and clear... | PINS-DETAIL | pins labels/keys/copy or mock-state shape - see churn |
| `packages/web/src/state/store.test.ts` | 8 | 0.0s | WS patch ordering against the live pipeline (the `comments-service` flake): when a review is... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/src/tabs/Tabs.test.tsx` | 7 | 0.2s | Shared tab strip tests (issues #60, #61): the `?tab=` parsing both pages use, the `#hash` ma... | COVERED-BY-JOURNEY | J5/J1/J6 (currently mock-rendered) |
| `packages/web/src/versions/versionUtils.test.ts` | 9 | 0.0s | Pure-part tests (M8): layer splitting of expanded prompts, token / cache-rate formatting, jo... | KEEP-UNIT | pure web logic (no mock API needed for the logic itself) |
| `packages/web/e2e/anchor-footnotes-service.spec.ts` | 1 | not run (Playwright) | Anchor footnotes over the real service (issue #72, PRD §4.7) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/anchor-idempotence.spec.ts` | 1 | not run (Playwright) | Anchor-highlight idempotence (issue #15) over mock mode | E2E-MOCK | mock Vite only |
| `packages/web/e2e/ask-service.spec.ts` | 1 | not run (Playwright) | Ask over the real service (#136 slice 2: Ask makes the same card) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/comments-service.spec.ts` | 3 | not run (Playwright) | Comments + submit over the real service (M6 web) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/comments.spec.ts` | 19 | not run (Playwright) | Comments + submit over mock mode (M6 web): selection toolbar, threads in guide/diff/descript... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/d2-diagram-inline.spec.ts` | 5 | not run (Playwright) | Inline in-place diagram zoom + breakout width in mock mode (round two, items 2–3): the diagr... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/d2-diagram-multiline.spec.ts` | 1 | not run (Playwright) | Multi-line diagram labels in mock mode (issue #16, round two): the service sanitiser once st... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/d2-diagram-overlay.spec.ts` | 8 | not run (Playwright) | Expanded diagram overlay in mock mode (issue #47): Expand opens the full-window dialog, whee... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/d2-diagrams-service.spec.ts` | 14 | not run (Playwright) | D2 diagrams over the real service (replay agent) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/d2-diagrams.spec.ts` | 12 | not run (Playwright) | D2 diagrams in mock mode (D2 decision addendum): the mock review carries the fixture's real ... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/debug-redo.spec.ts` | 3 | not run (Playwright) | Re-do guide on the Debug page (issue #115) in mock mode: never offered for the demo review; ... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/debug.spec.ts` | 13 | not run (Playwright) | Per-review debug page (issue #32, tabs + collapsible blocks issue #60) against mock mode: re... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/depth-principle-service.spec.ts` | 2 | not run (Playwright) | Deepest-level "Underlying principle" end to end (PRD §4.4, audit #10) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/diff-expand.spec.ts` | 8 | not run (Playwright) | Expand-by-lines behaviour tests against mock mode (issue #133, stage 1): step controls above... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/diff-floating.spec.ts` | 8 | not run (Playwright) | Floating cards in the diff pane (issues #167, #140): a floating card overlays the code below... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/diff-sticky-bar.spec.ts` | 16 | not run (Playwright) | Sticky diff actions bar (issue #132) plus sticky file and hunk headers (issue #140): the `.d... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/diff.spec.ts` | 13 | not run (Playwright) | Diff-pane behaviour tests against mock mode (PRD §4.13): fold/unfold, mark reviewed, hide-un... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/doctor-service.spec.ts` | 3 | not run (Playwright) | Doctor page + reload on the real service (issues #20/#21) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/doctor.spec.ts` | 4 | not run (Playwright) | Doctor page + model display names + Reload (mock mode, issues #20/#21). | E2E-MOCK | mock Vite only |
| `packages/web/e2e/expansion-nesting-service.spec.ts` | 1 | not run (Playwright) | Explain inside an explanation (#116) over the real service (replay agent) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/guide-service.spec.ts` | 2 | not run (Playwright) | Guide over the real service (web-guide owner, dev-only verification) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/guide.spec.ts` | 16 | not run (Playwright) | Guide e2e against mock mode (the generated urllib3#5020 snapshot): hover-preview timing + di... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/hunk-summary.spec.ts` | 6 | not run (Playwright) | Hunk summaries as content cards (issue #138) over mock mode: an idle summary is plain text; ... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/immediate-feedback.spec.ts` | 3 | not run (Playwright) | Immediate action feedback over mock mode (issue #46) | E2E-MOCK | mock Vite only |
| `packages/web/e2e/interaction-journey-service.spec.ts` | 1 | not run (Playwright) | Full reader journey over the real service (M4 interaction, replay agent) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/interaction-none-service.spec.ts` | 1 | not run (Playwright) | No-agent state over the real service (M4 interaction, `UNVIBE_AGENT: "none"`) | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/interaction.spec.ts` | 10 | not run (Playwright) | M4 interaction over mock mode (PRD §4.3, §4.4, §4.7, §4.9, §4.10, §9.5) | E2E-MOCK | mock Vite only |
| `packages/web/e2e/network-privacy.spec.ts` | 1 | not run (Playwright) | Dedicated network-privacy walk (PRD §16): front screen, a review with guide + diff + a D2 di... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/open-review.spec.ts` | 3 | not run (Playwright) | #92: async open in mock mode (deterministic via localStorage hooks) | E2E-MOCK | mock Vite only |
| `packages/web/e2e/progress-signs.spec.ts` | 8 | not run (Playwright) | Progress signs (issues #98, #144) against mock mode: the review bar shows a running / queued... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/promote-midfill.spec.ts` | 1 | not run (Playwright) | Open as page mid-fill (issue #152) over mock mode, deterministic via the `unvibe.mock.turnFi... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/real-service.spec.ts` | 2 | not run (Playwright) | Real-service end-to-end (M1): build + start the actual service with a temporary data dir, ad... | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/reload-anchored-review.spec.ts` | 1 | not run (Playwright) | Anchored expansions vs highlight upgrade (issue #101, mock mode) | E2E-MOCK | mock Vite only |
| `packages/web/e2e/reply-draft-service.spec.ts` | 1 | not run (Playwright) | Reply-box drafts over the real service (replay): sending a follow-up clears the stored draft... | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/reply-draft.spec.ts` | 1 | not run (Playwright) | Reply-box drafts over mock mode: sending a follow-up empties the box and it stays empty once... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/review-bar.spec.ts` | 9 | not run (Playwright) | Review bar behaviour tests against mock mode (issue #31 round 2 + issue #83, one-bar layout ... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/score-plotline.spec.ts` | 6 | not run (Playwright) | Hunk scores + plotlines (issue #169) against mock mode: header dots and plotline tags, the d... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/second-opinion-service.spec.ts` | 1 | not run (Playwright) | Second opinion over the real service with the replay runner (`UNVIBE_AGENT=replay`) on the d... | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/second-opinion.spec.ts` | 3 | not run (Playwright) | Second opinion in mock mode (generated urllib3#5020 snapshot): one icon button per card cont... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/selection-scroll.spec.ts` | 1 | not run (Playwright) | Selection-toolbar scroll race (issue #147) over mock mode | E2E-MOCK | mock Vite only |
| `packages/web/e2e/settings-versions-service.spec.ts` | 3 | not run (Playwright) | Settings + versions against the real service (M8): - limits persist across reload; service v... | E2E-REAL | J1-J8 real-service |
| `packages/web/e2e/settings.spec.ts` | 23 | not run (Playwright) | Settings page + versions banner behaviour tests against mock mode (PRD §4.14, §8): repositor... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/shiki-highlight.spec.ts` | 6 | not run (Playwright) | Shiki-highlight behaviour over mock mode (issue #23): token rows appear without breaking sel... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/start-block.spec.ts` | 2 | not run (Playwright) | Start page filtered-lists block (#148) in mock mode: the PR and branch lists governed by the... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/start-kept.spec.ts` | 1 | not run (Playwright) | Start page kept lists (issue #90): the last fetched PR/branch lists show at once after a rel... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/start-lists.spec.ts` | 6 | not run (Playwright) | Start page PR lists (#95, #100, #94, #131) in mock mode: the review-request split with its r... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/start.spec.ts` | 19 | not run (Playwright) | Front screen (PRD §4.2): the page follows one chosen repo — the repo selector above Reviews ... | E2E-MOCK | mock Vite only |
| `packages/web/e2e/update-picker.spec.ts` | 5 | not run (Playwright) | Version picker in mock mode (issue #36, step 2, PRD §4.14): the toggle above the card, the c... | E2E-MOCK | mock Vite only |

## Proposed journeys (J1–J8)

All journeys are Playwright specs against the real built service, using
`service-harness.ts` conventions (temp data dir/port, `GITHUB_TOKEN` stripped,
service output teed to `test-results/service-logs/`). Each journey is one spec
file with one sequential test (two where noted) so a failure names the step.
Estimated runtimes assume the demo fixture and replay recordings; they are
estimates, not measurements.

### J1 — Open a PR and read the guide

- Steps: start the service (`replay`); create a temp `git` repo with a branch
  change (the `real-service.spec.ts` scratch-repo shape) and, in a second
  variant, open the bundled demo review; open the review from the start page;
  wait for the guide; read the first page; follow a citation into the diff;
  reload and confirm the guide and diff are still there.
- Assertions (user-visible): start page lists the repo and its PR/branch rows;
  the guide title and first card render; clicking a citation highlights the
  cited diff lines; after reload the same guide page is shown; no non-local
  request is made (the existing `network-guard` fixture).
- Estimated runtime: 30–60 s (service boot + replay pipeline + two page loads).
- Makes redundant: `reviews*.test.ts`, `reviews-async/list/redo`, `repos*.test.ts`,
  `changes-pr-*.test.ts`, `pipeline.test.ts` (happy path), `ingest/e2e.test.ts`,
  `viewer/review-reader` service tests; web `StartPage.*`, `GuidePage.*`,
  `PageView.*`; e2e `start*.spec.ts`, `guide.spec.ts`, `open-review.spec.ts`,
  `real-service.spec.ts`, `guide-service.spec.ts`, `interaction-none-service.spec.ts`
  (the `none` half becomes a J1 variant with `UNVIBE_AGENT=none`: controls show
  the no-agent state and no guide is promised).

### J2 — Explain, Ask, a follow-up, and a nested card

- Steps: on the demo review, select text in a guide card → Explain; wait for
  the streamed answer; Ask a question on the same selection; send a follow-up
  in the resulting card; select text inside the answer → Explain again so a
  nested card opens; change depth and confirm the card follows the visible
  level; request a second opinion on the card.
- Assertions: exactly one working indicator with a plain label while each
  answer streams (not the label's exact wording beyond being non-empty and
  stable); the answer text appears and cites the selection; the follow-up
  answer stays in the same card; the nested card opens inside its parent and
  closing the parent does not cancel the child's answer; depth change marks
  the card stale or clears that mark as the quote becomes visible/invisible;
  the second-opinion block appears.
- Estimated runtime: 45–90 s (four replay turns on one review).
- Makes redundant: service `actions-m4`, `actions-ask-followups`,
  `actions-echo`, `actions-expansion-nesting`, `conversation*`, `hunk-cards`
  (activation half), `second-opinion`, `open-questions-181` (suggested-comment
  half), `cards-stale`, `m4-web-fixes`; web `CardView*`, `ConversationCard`,
  `ExpansionNesting`, `FloatingCard`, `StreamedAnswer`, `SelectionToolbar`
  (behaviour half), `SecondOpinion*`, both `inflight.test.ts` files; e2e
  `interaction*.spec.ts`, `ask-service`, `expansion-nesting-service`,
  `depth-principle-service`, `anchor-footnotes-service`, `second-opinion*`,
  `immediate-feedback`, `promote-midfill`, `reply-draft*` (draft-clears-on-send
  is asserted here after the follow-up).

### J3 — Comments and Submit (stubbed gh, nothing posted)

- Steps: select a diff line → Comment; write and save the comment; mark it
  For PR; add a guide-block comment; reply in a thread; edit the PR
  description in the description pane; open Submit; confirm the preview lists
  exactly the For-PR threads; submit.
- Assertions: the comment icon/thread survives reload; the Comments menu lists
  the drafts; the Submit preview shows the edited description and the marked
  threads and nothing else; after Submit, the stubbed `gh` recorded exactly
  one review-post call (and one `gh pr edit` if the description changed) with
  `GITHUB_TOKEN` unset, and an immediate second Submit posts nothing new
  (the in-flight lease makes it crash-safe and idempotent from the reader's
  point of view); older versions of the review show no comment controls.
- Estimated runtime: 30–60 s.
- Makes redundant: service `comments-m6`, `submit-m6` (user-visible half; the
  lease unit slice stays — see Risk), `description-m6` (round-trip parser
  stays KEEP-UNIT; this journey covers the edit-and-submit path);
  web `ThreadView`, `ReplyBox`, `CommentsMenu`, `GithubThreads`,
  `GuideThreads*`; e2e `comments.spec.ts`, `comments-service.spec.ts`.

### J4 — Diff work: folds, filters, reviewed, scores/plotlines

- Steps: open the demo diff; fold and unfold a file; expand a gap by lines and
  show-all; use the file filter; mark a file reviewed and reload; switch
  Unified/Split; filter by the score/plotline selectors (header dots, plotline
  chips, the Files menu); open a hunk summary, then Explain inside it.
- Assertions: folded files hide their hunks and the progress count moves;
  expanded gaps show the previously hidden lines; the filter narrows the file
  list to matching files only; "reviewed" survives reload; the score filter
  shows only hunks in the chosen plotline/score band and the header count
  agrees with the visible hunks; the hunk summary becomes a working card.
- Estimated runtime: 30–60 s.
- Makes redundant: service `hunk-plotlines-169` (UI half), `versions-refresh`
  (visible half); web `DiffView*` (all variants), `FileExpansion`,
  `HunkCardActivation`, `diffLogic` stays KEEP-UNIT (pure), `DiffView.scorePlotline`,
  `PageView.plotlines`; e2e `diff*.spec.ts`, `diff-expand`, `diff-floating`,
  `diff-sticky-bar`, `score-plotline`, `hunk-summary`.

### J5 — Settings, effort, full access, and a version switch (fake backend)

- Steps: open Settings; change a limit and an effort/model choice and reload;
  enter an invalid limit and correct it; turn on full access (with its
  acknowledgement) and confirm the marker in the shell; turn on the version
  picker (`UNVIBE_UPDATER_BACKEND=fake`); list versions; switch to another
  fake channel; wait for the restart; confirm the running version changed and
  the reviews/settings survived; force a failing switch
  (`UNVIBE_UPDATE_FAKE_FAIL`) and confirm the service is still on the old
  version with a readable reason.
- Assertions: settings persist across reload; the invalid value shows an
  inline error and is not saved; the full-access marker is visible only while
  full access is on; after the switch the health/version line names the new
  fake version and the same reviews are listed; after the failed switch the
  old version still serves and the outcome names the failure. No assertion
  counts prompt templates (that pin is removed, not moved here).
- Estimated runtime: 60–120 s (two service restarts through the real helper).
- Makes redundant: service `update-routes`, `update-updater`, `versions-update`,
  `settings.test.ts` (route half; defaults stay in `settings-defaults`),
  `contributions` (settings half); web `ModelsSection`, `LimitsSection`,
  `AccessSection`, `VersionSection`, `RepositoriesSection`, `BrowseFolderButton`,
  `AppShell`/`FullAccessMarker` (render half); e2e `settings.spec.ts`,
  `settings-versions-service.spec.ts`, `update-picker.spec.ts`, `doctor*`
  (the Doctor/Reload half folds into the first Settings visit: readiness
  shows ready, Reload keeps it ready).

### J6 — Restart mid-answer

- Steps: start the service (`replay`); open the demo review; start an Explain
  whose answer is still streaming; stop the service the hard way (the
  `scripts/restart-resilience.mjs` SIGKILL shape, or `stop()` mid-stream in
  the harness); start it again on the same data dir; reopen the review.
- Assertions: the review reopens; the interrupted answer is either completed,
  resumable, or clearly marked interrupted with a working Retry — never a
  silently empty card; comments and reviewed marks made before the kill are
  still there; a second restart is a no-op (nothing is duplicated).
- Estimated runtime: 45–90 s (two boots + one replay turn + the resilience kill).
- Makes redundant: the user-visible slice of service `sessions`,
  `review-base-sessions`, `reviews-redo`, `reader-146-124`, `shared-context-debug`;
  web `GuidePage.retry`, `state/store` stays KEEP-UNIT (pure), `debug.spec.ts`
  and `debug-redo.spec.ts` (the Debug page's Retry/Redo controls are exercised
  here and in J2); e2e `reload-anchored-review`. The existing
  `mise run restart-resilience` shell gate stays as-is and is not replaced by
  this journey; J6 is its browser-level companion.

### J7 — Huge PR

- Steps: generate a large temp repo change (the `huge-pr-107.test.ts`
  synthetic shape: thousands of files/hunks, or the largest fixture the repo
  already carries); open the review with the replay/`none` runner; wait for
  the diff to become usable; filter and fold in the large diff; open one hunk.
- Assertions: the review opens within the spec timeout and the file list is
  navigable (filter responds, folding a file hides its hunks); the guide, if
  requested, degrades to summaries rather than failing with a prompt-too-long
  error visible to the reader; no hunk is silently dropped from the count
  shown in the header.
- Estimated runtime: 60–120 s (repo generation dominates; keep the repo
  generation shared with the existing synthetic generator, do not invent a
  second one).
- Makes redundant: the user-visible slice of `huge-pr-107.test.ts` (its ladder
  and fan-out arithmetic stays KEEP-UNIT), web `DiffView.large.test.tsx`,
  e2e has no current equivalent — this is new coverage, which is the point:
  today the huge case is only a service unit test, never a browser journey.

### J8 — Visual tour (reference only, do not duplicate)

Another agent is building the visual tour on `main-rc`: screenshots of the
front screen, a guide page with floating/nested cards, the diff in both
widths and themes, comments open, and Settings, plus generic layering checks
(no element paints over a card it should sit under, menus are not clipped by
their container, floating cards stay in the viewport). J1–J7 deliberately
assert no pixel or layering facts, so there is no overlap to reconcile beyond
sharing the harness and the demo fixture. When the tour lands, the
MOCK-ONLY-UI files whose only value was "the mock DOM contains X" (49 files,
270 tests) lose their last justification; several are already only reachable
through the mock the tour does not use.

## Token safety: no non-live test can reach a real agent today — with three unforced edges

Owner's addition: "make sure we're not burning tokens for these tests, by
using a stubbed agent that returns content". Verdict: **`check`, `test:slow`
and `restart-resilience` cannot spend agent tokens as written**, because every
path that starts an agent in those gates is forced to the replay runner
(recorded content, `fixtures/urllib3-5020/`), the scripted `FakeAgentRunner`,
a fake ACP transport, or `UNVIBE_AGENT=none`. Only `test:live:*` tasks set
`UNVIBE_LIVE=1`, and only they may reach a real provider. Three edges are
safe by convention rather than by force (R1–R3 below); a cheap guard that
turns the convention into a failure is proposed at the end of this section.

### How the runner is chosen (evidence)

- Factory: `packages/service/src/agent/factory.ts:89`
  `createAgentRunner()` returns `NoAgentRunner` for `UNVIBE_AGENT=none`,
  `ReplayAgentRunner` for `=replay`, and otherwise — unset **or any other
  value** — `createAcpRunner()`, the real claude/codex subprocess runner.
- Composition root: `packages/service/src/app.ts:271`
  `buildApp` substitutes `FakeAgentRunner` + `StaticModelCatalog` +
  `TestCommandGuard` under vitest (`VITEST`/`NODE_ENV=test`) **only when
  `UNVIBE_AGENT` is exactly unset**; `replay`/`none` pass through (both
  hermetic), and explicitly injected runners are never replaced.
- Live self-gating: `acp-live.test.ts:175` and `full-access-live.test.ts:220`
  are `describe.skipIf(!LIVE)` with `LIVE = UNVIBE_LIVE === "1"`, and the
  service `test`/`test:fast` scripts additionally `--exclude` both files.
  The vitest config deliberately does not exclude them (a config exclude
  broke `test:live`); the two script excludes plus the self-skip are the gate.
- Playwright real-service harness:
  `packages/web/e2e/service-harness.ts:68`
  always sets `UNVIBE_AGENT: opts.agent ?? "none"` on the spawned service
  and deletes `GITHUB_TOKEN` from its env. Every `*-service` spec either
  passes `agent: "replay"` (9 specs) or takes the `none` default (5 specs);
  no spec passes any other value, and mock specs spawn only the Vite mock.
- Scripts in the wider `gate`: `restart-resilience.mjs:61` and
  `global-install-check.mjs:259` force `UNVIBE_AGENT: "replay"`.

### Gate-by-gate confirmation

| Gate | Agent path | Can it reach a real provider? |
| --- | --- | --- |
| `check` (service/shared/web fast vitest) | `buildApp` fake substitution; tests inject `FakeAgentRunner`/scripted fakes; `acp-runner.test.ts` and `full-access-160.test.ts` construct `AcpAgentRunner` only with `fakeTransportFactory` transports | No. Tripwired by `no-real-spawn.test.ts` (recording `claude`/`codex`/`gh` shims must never execute). |
| `test:slow:unit` (4 slow files) | None of the 4 files builds an app or a runner (verified by search: no `buildApp`/`createAgentRunner`/`AcpAgentRunner`) | No agent at all. `diagnostics-api.slow` runs real readiness probes (`--version`/auth-style checks, no prompt), so it spawns CLIs but cannot spend generation tokens. |
| `test:slow` Playwright | Mock Vite (34 files) or `service-harness` with `none`/`replay` forced (14 files) | No. |
| `restart-resilience` | Built service spawned with `UNVIBE_AGENT: "replay"` in its env (`restart-resilience.mjs:57-61`) | No. |
| Rest of `gate` (`e2e`/`e2e:macos`, d2 seed, `check-global-install`) | `check-global-install` forces `replay`; shell e2e forces nothing — see R3 | No review is opened in shell e2e, so no session starts today; not forced. |

### Anything that could reach a real agent (the full list found)

- **R1 — Factory fall-through on a mistyped value.** `isReplayEnv`/`isNoneEnv`
  compare the lower-cased value exactly, with no trim and no allowlist
  (`factory.ts:77-83, 115`). `UNVIBE_AGENT=replayy`, `" replay"`, or any
  ambient value exported in a developer shell makes `createAgentRunner()`
  return the real ACP runner. `buildApp`'s vitest guard does not catch this:
  it only substitutes when the value is exactly `""` (`app.ts:272`).
- **R2 — Readiness-route fallback bypasses `buildApp`.**
  `packages/service/src/routes/readiness.ts:29`
  calls `createAgentRunner()` directly when a route context has no `agents`,
  and the readiness agent probe is "initialise + list models"
  (`checks.ts:321`), which starts a real ACP subprocess. No prompt is sent
  (no generation tokens), and `buildApp` always supplies `agents` in
  practice, but a scaffold-context test hitting `GET /api/readiness` with an
  unset or mistyped `UNVIBE_AGENT` would spawn the real CLI binaries.
- **R3 — Shell e2e does not force the runner.** `scripts/e2e-linux.mjs`
  builds its service env from `...process.env` with no `UNVIBE_AGENT`, and
  `scripts/e2e-macos.mjs` explicitly deletes `UNVIBE_AGENT` for the helper
  start. Today both only check `/api/health`, status and idle exit — no
  review, no session, no tokens — but the first future step that opens a
  demo review in shell e2e would silently use real agents.
- **R4 — Ambient `UNVIBE_LIVE=1` leaks into `check`.** Nothing in `check`,
  `test:fast` or CI unsets `UNVIBE_LIVE`. A shell that exported it (e.g.
  after a live run) plus a vitest invocation that bypasses the package
  scripts' `--exclude` (plain `npx vitest run` in `packages/service`, whose
  config includes the live files) would run `acp-live`/`full-access-live`
  for real. Through `mise run check` itself the script `--exclude` still
  protects service tests; this is a direct-invocation hazard, not a gate hazard.
- **R5 — Partial fake transports in direct `AcpAgentRunner` use.**
  `conn()` falls back to the real transport factory for a provider with no
  injected fake (`acp/runner.ts:148`). Current unit tests always inject the
  provider they use, but a test that injects only `claude` and then starts
  a `codex` session would spawn the real adapter. No current test does this.
- Not hazards: `live-*.mjs` scripts delete `UNVIBE_AGENT` on purpose — they
  are only reachable through `test:live:*` tasks, which is exactly the
  allowed path; web unit tests run the mock API client (`VITE_MOCK=1`) and
  never spawn a service; shared tests contain no agent code.

### Replay / fake content per journey, and where recordings are missing

All eight journeys use the replay runner (realistic recorded content) or
`none`/the scripted fake — none needs a real provider. Replay matching is by
explicit `replay-kind:`/`replay-key:` marker, then by kind keywords and
quoted text (`replay/runner.ts:147`); an unmatched prompt returns a visible
`[replay placeholder: …]` text, so a journey asserting answer content fails
loudly rather than silently passing on empty content. The fixture carries
55 recordings: reader ×1, explain ×9, ask ×11, hunk ×8, concept-page ×7,
depth ×5, go-deeper ×4, second-opinion ×3, critic ×2, examples ×2,
diagram ×2, concept-stubs ×1.

| Journey | Runner | Recorded content it needs | Gap |
| --- | --- | --- | --- |
| J1 open + guide | `replay` (demo), `none` (scratch repo) | reader, concept-page, hunk | None for the demo. On a scratch repo replay writes fixture guide text unrelated to that diff (factory comment, `factory.ts:5-10`), so the scratch-repo variant must stay `none` and assert diff/open only. |
| J2 Explain/Ask/follow-up/nested | `replay` | explain ×9, ask ×11, depth, second-opinion ×3 | Follow-up and nested-Explain prompts must quote text the recordings match (e.g. the obs-fold/http-headers selections); an invented follow-up question hits the placeholder. No new recording needed if the journey reuses recorded questions; one new `ask` recording is the cheap fix if a specific follow-up wording is wanted. |
| J3 comments + Submit | `none` (human comments), `replay` only for the suggested-comment half | — | AI-suggested comments come from contributions, not from any current recording (fixture `contributions: []`); either seed the snapshot as `guide-service.spec.ts` already does, or keep that one assertion on the scripted fake at service level. Human comment + Submit needs no agent content. |
| J4 diff + scores/plotlines | `replay` for hunk summaries | hunk ×8 | **Real gap.** The hunk recordings predate #169: their JSON has `summary`/`hiddenReason` and no `score`, and there is no `plotline_assign` recording, so over replay every hunk reads as "routine/other" and the plotline selector has nothing to select. J4 needs 2–3 new hand-written hunk recordings carrying `score` + a plotline id (still stubbed content, no tokens — recordings are fixture markdown) or a seeded scored snapshot. |
| J5 settings/effort/full-access/version | `none` + fake updater backend | — | None. Effort/full-access assertions are on persisted settings, the shell marker and prompt-variant selection, never on live agent output. |
| J6 restart mid-answer | `replay` with pacing overrides | ask/explain | None. Use the existing test-only `UNVIBE_REPLAY_DELAY_MS`/`UNVIBE_REPLAY_CHUNK_CHARS` pacing (`factory.ts:96-112`) so the answer is reliably mid-stream at the kill, as `restart-resilience` already does. |
| J7 huge PR | `none` | — | **Real gap if a guide is asserted.** Synthetic huge-PR hunks match no recording keys and would return placeholder summaries. Run J7 with `none` (assert navigability, counts, folding) and do not assert guide/summary content there; the prompt-ladder arithmetic stays KEEP-UNIT in `huge-pr-107`. |
| J8 visual tour | `replay` (seeded demo snapshot) | reader/pages as seeded | None; owned by the other agent on `main-rc`. |

### Proposed cheap guard (for the implementing issue, not this spike)

One factory change, one entry-point line, task-env additions, and two unit
tests — no new infrastructure:

1. **Factory throws on the real fall-through.** In `createAgentRunner`
   (`factory.ts:115`), replace `return createAcpRunner()` with: throw unless
   `env.UNVIBE_ALLOW_LIVE_AGENT === "1"`, with an error naming
   `mise run test:live:*` as the way to allow it. `replay`/`none` selection
   is unchanged and never needs the flag.
2. **The product entry sets it for itself.** `serve()` in
   `packages/service/src/serve.ts` (reached only from the CLI's
   `start`/foreground path in `src/index.ts`) sets
   `process.env.UNVIBE_ALLOW_LIVE_AGENT = "1"` before `buildApp`, so the
   installed product keeps working exactly as today. This does not reopen
   the test-spawned-service hole: `service-harness` already forces
   `UNVIBE_AGENT=none|replay` on every child, so a spawned child never
   reaches the fall-through; add a harness assertion that `opts.agent` is
   only ever `undefined`, `"none"` or `"replay"` to keep it that way.
3. **Only `test:live:*` tasks set it.** Add `UNVIBE_ALLOW_LIVE_AGENT=1`
   alongside the existing `UNVIBE_LIVE=1` in the `test:live:*` mise tasks
   and in the `live-*.mjs` scripts' env (they currently just delete
   `UNVIBE_AGENT`), and add `UNVIBE_LIVE`/`UNVIBE_ALLOW_LIVE_AGENT` to the
   env scrub in CI so an ambient export cannot arm the live files (closes R4).
4. **Force the shell-e2e runner.** Set `UNVIBE_AGENT: "none"` in
   `e2e-linux.mjs`'s `ENV` and stop deleting it in `e2e-macos.mjs` (pass
   `none` through instead) — they open no reviews, so behaviour is
   unchanged (closes R3).
5. **Gate the direct-construction path too.** At the real-transport spawn
   point (`acp/runner.ts:148`, when neither `factories[provider]` nor
   `transportFactory` was injected), apply the same
   `UNVIBE_ALLOW_LIVE_AGENT` check, so `acp-live` (which constructs
   `AcpAgentRunner` directly and will carry the flag via its task) still
   works while a partial-fake unit test fails loudly instead of spawning
   (closes R5). `acp-runner.test.ts` always injects fakes, so it is unaffected.
6. **Two tests, both in `no-real-spawn.test.ts` (KEEP-UNIT):**
   `createAgentRunner({ env: {} })` and `createAgentRunner({ env:
   { UNVIBE_AGENT: "replayy" } })` both throw (closes R1/R2 at the factory —
   the readiness fallback then throws instead of spawning); and the existing
   recording-shim tripwire stays as the end-to-end proof. With the guard,
   R2's fallback should also be deleted so readiness always uses the
   composed runner — one less caller of the factory.

Estimated cost: under a day including the live-task smoke check
(`mise run test:live` must still pass, which is the positive control that
the flag, and only the flag, re-enables real agents).

## Estimate of the result

### Counts

| Gate | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Fast vitest files / tests | 228 / 1,935 | 106 / 1,135 | −122 files, −800 tests |
| Slow vitest files / tests | 4 / 12 | 3 / 7 (disable `release-notices.slow`) | −1 file, −5 tests |
| Playwright files / tests | 48 / 278 | 8 / ≈14 (J1–J7; J8 counted on its own branch) | −40 files, −264 tests |
| **Regular total** | **281 / ≈2,225** | **≈117 / ≈1,156** | **≈−58% files, ≈−48% tests** |

"After" keeps every KEEP-UNIT file at its current size. No KEEP file needs to
grow to absorb a disabled file's cases, except the three mixed files noted in
the table (`conversation-mcp-turns`, `submit-m6` lease slice, `hunk-plotlines`
parser edges), where the note already says which slice stays as a unit test.

### Gate runtime

- `mise run check` (lint + typecheck + fast vitest): fast vitest wall measured
  at ≈34.6 s sequential (19.1 + 0.7 + 14.8). Keeping only KEEP-UNIT files
  removes 800 of 1,935 tests and 65.7 s of the 90.9 s summed per-file time;
  at the same worker parallelism that projects to ≈12–18 s. Lint and
  typecheck are unchanged (they do not run tests). Estimate, not a
  measurement: the disabled run has not been executed because this spike
  changes no tests.
- `mise run test:slow`: slow vitest is 12 tests and stays ≈unchanged in cost
  (it needs a build either way). Playwright goes from 278 tests to ≈14
  journey tests; even at 60–120 s each for J5/J7, the sequential estimate is
  ≈4–7 min, or ≈2–3 min at the configured 4 workers with independent temp
  data dirs. That is within the existing 10-minute Playwright global timeout
  but leaves less headroom than today if journeys are allowed to creep —
  each journey must stay one sequential test, not a renamed suite.
- `mise run gate`: unchanged in structure (build, build-freshness, shell e2e,
  restart-resilience, d2 seed check, global-install check all stay). The
  saving is inside `check` and `test:slow` only. No gate is removed.

### Risk left uncovered

1. **Protocol and parser edge cases that no journey enumerates.** ACP message
   mapping, citation validation, diff/outline grammars, MCP traversal refusal,
   and the job queue's cap/back-off arithmetic are KEEP-UNIT precisely because
   a journey can only sample them. If a future change disables any of those
   by mistake, coverage drops sharply — the KEEP list is the load-bearing
   part of this proposal.
2. **Wording-sensitive reply handling.** `degraded-turn-51` stays KEEP-UNIT;
   J2 asserts answers appear, but cannot enumerate the "never judge a reply
   by its wording" cases. Same for echo stripping: J2 covers the happy path,
   the parser cases stay available in `actions-echo` if the owner prefers
   keeping that one file — the table marks it COVERED with that note.
3. **Crash-safety of Submit and of the version switch.** J3 and J5 assert
   the reader-visible outcome (exactly one post, old version still serving).
   The lease and helper internals that make a mid-switch kill safe stay as
   unit tests (`update-helper`, `service-shutdown`, and the lease slice of
   `submit-m6`); a journey that kills the helper mid-install would be slow
   and flaky, and `restart-resilience` already covers the kill shape at the
   shell level.
4. **Platform paths.** Folder-picker parsing, service-manager behaviour, and
   macOS shell e2e are untouched by the journeys (Chromium on Linux cannot
   exercise them). Their unit tests are KEEP-UNIT and `e2e:macos` stays a
   separate gate.
5. **Live agents and real GitHub.** Unchanged and out of scope: `test:live:*`
   remains the only place real logins are used, journeys never post to
   GitHub (stubbed `gh` records the attempt), and `gh-writes.test.ts` keeps
   enforcing that boundary statically.
6. **Flake surface moves, it does not vanish.** 278 small Playwright tests
   fail one-at-a-time; 8 journeys fail in longer chains. The mitigation is
   already in the harness: per-step `expect` messages, service logs teed to
   `test-results/`, traces/screenshots on failure, and retries staying at 0
   so flakes surface instead of hiding. A journey that flakes twice should
   be split at the flake, not retried.

## Suggested sequencing (for the implementing issue, not this spike)

1. Owner reviews the KEEP / disable lists in the table above (this is the
   checklist on #188).
2. Build J1, then J3, then J2 (in that order: J1 proves the harness over the
   real service, J3 proves stubbed-`gh` Submit, J2 is the longest chain).
   Land each journey green before disabling anything it replaces.
3. Disable the replaced files in the same PR as each journey, using the #119
   mechanism, and update `docs/acceptance-audit.md` in that PR.
4. Build J4–J7, disable their lists, then run the full `mise run gate` once
   on the merged tree before merging to `main`, per `AGENTS.md`.
5. Keep the disabled files for one release cycle, then delete them in a
   follow-up issue if no journey gap appeared.

## Verification for this spike

- `vitest run --reporter=json` per workspace (fast suite, sequential):
  shared 216 passed, service 1,042 passed / 1,068 total, web 650 passed /
  651 total. No test failed.
- `npx playwright test --list` in `packages/web`: 278 tests in 48 files.
- `git log` churn and pin checks quoted above.
- No test, source, or config file was changed; the only new file is this
  document. Playwright and the slow suite were not run (no build in this
  worktree); their runtimes are labelled estimates wherever used.
