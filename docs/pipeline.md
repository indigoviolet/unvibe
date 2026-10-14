# M3 pipeline: reader → base → forks → hunk pass

The live pipeline (PRD §11) that turns an ingested review into the guide.
This doc is the seam for the next agents (interaction actions, shared
context, second opinion): how to "run this prompt in a fork of the base for
this review and apply the streamed result".

## Composition root

`src/app.ts:buildApp` constructs everything once and hands route modules
one unified context (`AppContext`):

```
db, bus, repos, reviews (ReviewStore), jobs (JobQueue with recovery),
settings, models, runner (CommandRunner for git/gh), agents (AgentRunner:
replay or ACP seam), sessions (SessionManager), mcp (McpRegistry with a
real ReviewReader over ReviewStore + <dataDir>/worktrees/<id>), pipeline,
updateRunner, promptsDir, fixturesDir, mcpBaseUrl
```

`ServiceContext` (core stores) + `RouteDeps` (M3 singletons) +
`ReviewsRouteDeps` (update wiring) are views over the same `AppContext`.
Tests construct the app with fakes via `createApp` overrides:

```ts
const { app, ctx } = await createApp("tok", {
  runner: new FakeCommandRunner(),
  agents: new FakeAgentRunner([...]),
  autoPipeline: false, // do not auto-trigger on POST /api/reviews
});
```

Runner selection (`src/agent/factory.ts`, `UNVIBE_AGENT`):
- `replay` uses the recorded runner over `fixtures/urllib3-5020/` (demo +
  tests, no tokens). The recordings are matched by prompt markers/keywords,
  not scoped to the fixture repo, so on any other repo replay still matches
  and writes the fixture's guide content there — only use it on the fixture
  or in specs that test agent behaviour (demo review, second opinion).
- `none` disables the pipeline: `startReview`/`resumeReview` enqueue
  nothing and every agent call fails fast with a clear "no agent
  configured" error. Use it in real-service specs that do not test agent
  behaviour (comments, diff, versions), so no background pipeline mutates
  the review mid-test and no misleading fixture content lands on temp repos.
- Any other value (or unset) hits the ACP seam, which fails with a helpful
  error until `src/agent/acp/` merges (do not import ACP elsewhere). The
  future ACP runner will also expose `listModels(provider)` for
  Settings → Models.

## Demo mode

With the replay runner, `POST /api/reviews { repoId: "demo" }` (or
`{ demo: true }`) ingests `fixtures/urllib3-5020/diff.json` +
`description.md` (no git/gh) and runs the *same pipeline code path*
against the recordings, streaming with a small delay (`delayMs: 5`).

Start-page entry (coordinated through the `changes` API, repo-less):

```
GET /api/repos                     → [{ id: "demo", ... }, ...remembered]
GET /api/repos/demo/changes        → [{ kind: "demo", title: "Demo: urllib3#5020 …", demo: "urllib3-5020" }]
POST /api/reviews { repoId: "demo" } → 201 + pipeline starts
```

In demo, the pipeline also auto-fills go-deeper placeholders and concept
stubs to full pages (background jobs, same `runInFork` path) so the demo
snapshot ends up complete without clicks.

## Stages (all jobs on the queue)

1. **Reader** (main model, one session, `cwd` = worktree, `system` =
   `instructions`, MCP role `reader` with `pin_context`). Prompt from
   `reader` template with L1 (`source` + `diff_inline`). Finished cards
   stream via `parseCardsPartial` → `ReviewStore.mutate` (problem, central,
   Go deeper placeholders from `pendingCards`, hidden concept candidates
   from `concepts`): a card appears once the next `## ` heading closes it
   (or all cards once the trailing JSON block lands) — nothing renders
   card content while it is being written. `text` events stream while a
   card is in flight; pins arrive via MCP `onPin` and land in
   `snapshot.pinnedCode`.
2. **Base** (`SessionManager.getBase`) from `buildBasePack` once the reader
   is done. Key `(version, guideRevision, model)`; per-model caches.
   `guideRevision` covers the guide content plus the current description
   HTML (pending edit included — #110), so a description edit keys a new
   base; the L1 source lists description paragraphs with their `desc:` IDs.
3. **Parallel forks** (`fanOut`): **critic** ×2 (findings as separate pages
   with Evidence/Assessment/confidence + drafted suggested comment as a
   thread on a diff line via `comments/threads.ts`, `suggested: true`,
   `post: false`; finding-link block in the guide plus a `comment-link`
   block on the finding page tying it to the thread) and **concept stubs**
   ×1 (hidden candidates; full pages via `ensureConceptPage`).

Stored citation targets are canonical (real file keys): alias-form tokens
(`diff:conn:…`) resolve through the lookup at parse/validate time, so the
web needs no alias table. Ingest records the PR author/state on the
description, and the pipeline maintains its `restated` mapping (paragraph
→ guide block ids from `desc:` citations) as the guide grows.
4. **Hunk pass** (small model, no fork, one prompt per hunk, background;
   starts at ingest in its own queue bucket — #123). Summary +
   `hiddenReason` per hunk, replacing the rule-based pre-classification.
   Never hide a hunk the guide cites (recomputed after the reader) nor a
   one-line change. Past `DEFAULT_HUNK_PASS_FANOUT_LIMIT` (500) hunks
   there is no per-hunk fan-out at ingest (issue #107: no guide exists
   yet to cite, so the stage reaches done with no jobs); only
   guide-cited hunks lacking a stored summary fan out once the reader
   lands, everything else summarises on demand, and the stage still
   reaches done (empty fan-out sets done; completions are counted in the
   success path) so resume never re-runs
   the full fan-out. `POST …/hunks/:hash/summarize` runs
   one hunk on demand at user priority (`kind: "summarize"`); **Fold all**
   is the client calling summarize per hunk missing a summary (jobs dedupe
   per hunk hash, so no batch endpoint is needed).

Every reply: `splitReply` → `parseCards` → citation validator.
Valid/repaired tokens stored resolved; unverified stored flagged
(`unverified: true`, UI dims) + recorded in `logTail`; one repair turn
when `needsRepairTurn`, then accept. Malformed / non-object trailers are
job errors. Every call is a job (kind, model, priority, prompt snapshot,
usage with cached tokens, `cardId` for UI), cancellable, retried on
retryable errors, deduped.

## The seam

```ts
// Fork of the base (main model, L4 = rendered template)
const res = await pipeline.runInFork({
  reviewId, kind: "go-deeper", template: "go_deeper",
  variables: { direction: "Data flow …\nWhy it matters …" },
  priority: JOB_PRIORITY.userRequested,
  dedupeKey: { anchor: "go-deeper:g-flow", requestKind: "go-deeper", baseVersion: "v1" },
  cardId: "g-flow",
  onPartial: async (cards) => { /* progress UI */ },
  signal, replay: { kind: "go-deeper", key: "flow" }, // replay/tests only
});
// res: { job, text, cards, data (trailing JSON), validation, usage, viaFork, repaired }

// Small model, no fork, no base
const small = await pipeline.runSmall({
  reviewId, kind: "hunk-pass", template: "hunk_pass",
  variables: { hunk: "### [[h:…]] …", path: "src/x.py" },
  priority: JOB_PRIORITY.background,
});

// Full concept page on demand (stub → full)
await pipeline.ensureConceptPage(reviewId, "obs-fold");

// One-hunk summarize on demand (user priority)
pipeline.summarizeHunk(reviewId, contentHash);

// Update pass (versions module)
const runner = pipeline.updateRunner(); // { runUpdatePrompt(prompt, { reviewId, toVersion, signal }) }
// wired as POST /api/reviews/:id/update via enqueueUpdatePass
```

Worked example (Go deeper → Generate, the first consumer):

```ts
// POST /api/reviews/:id/actions { kind: "generate", cardId: "g-flow" }
// → dispatcher (src/pipeline/actions/dispatcher.ts) → generate.ts:
await pipeline.fillGoDeeper(reviewId, "g-flow", signal,
  (delta) => jobCtx.reportText(delta), jobCtx);
// placeholder (pending: { label, why }) shows text-event progress,
// then fills with blocks + Follow-ups; revision bumps; logTail grows.
```

`runInFork` handles: base lookup/rebuild (`decideRebuild` thresholds from
settings; new key → new base, old pruned), fork-or-fallback (PRD §6:
`runner.fork` else fresh session + byte-identical base pack), job
bookkeeping, streaming, validation + one repair turn. `runSmall` is the
same without base/fork. Both return parsed content + trailing JSON; callers
apply it (see `src/pipeline/apply.ts` for reader/critic/concept shapes).

One file per action kind (`src/pipeline/actions/<kind>.ts`); the dispatcher
stays 501 for unimplemented kinds so the next agent extends it.

## Resilience

Restart loses no stored content (snapshots + revs in SQLite; jobs
persisted). Interrupted stages are `error`/`orphaned` in `JobStore` and
resumable via `POST /api/reviews/:id/resume` (idempotent; skips done
stages) or automatically on open. Sessions reopen with `load` or rebuild
from the pack (`SessionManager`).

## Measurement

Per-review totals in `snapshot.usageTotals`
(`inputTokens/cachedTokens/outputTokens/cacheHitRate`) updated after every
job; per-job usage + `cacheHitRate` in `GET /api/jobs?review=:id`.
Time-to-first-card in `usageTotals.firstCardAt` (set on the first streamed
card) and `logTail` (`new-card` with `unverified` count).

## Fold-all choice

No batch endpoint: the client calls `POST …/hunks/:hash/summarize` per
hunk missing a summary. Jobs dedupe per hunk hash, run at user priority,
and never hide cited/one-line hunks. Past the shared
`HUNK_PASS_FANOUT_LIMIT` (500 hunks, `packages/shared/src/budgets.ts` —
the single number both sides import) Fold all folds only and requests no
summaries; the per-hunk Summarize button in the hunk header stays as the
on-demand path (`DiffView.tsx` Fold-all guard, `FileSection.tsx`
`.dhunk-h` header, Tips copy, `DiffView.test.tsx` both sides).
Documented here so web and service agree.
