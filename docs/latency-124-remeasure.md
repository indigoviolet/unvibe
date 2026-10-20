# Issue #124 re-measure: Codex fork cache + reader repair turn

Date: 2026-10-20. Branch: `spike/124-codex-fork-remeasure` (off `main` 882d82b, v0.0.7). Nothing here is on `main`.

Question, from #124 after #174 fixed fork review-tools: (1) do Codex fork turns now read the base pack from the provider prompt cache, and (2) does the Codex reader still need a citation-repair turn, how long does it take, and what does it send?

## Short answer

1. **The fork cache miss is not gone.** In 10 fork turns on identical state, 2 read the whole prefix from cache and 8 sent the pack again uncached (9.0k–10.0k tokens). The generic Codex prefix (11,008 tokens) was cached every time. What is left looks provider-side, not ours: production now sends the same system prompt, MCP servers and settings on `session/fork` as on `session/new` (#124 fields, #174 mount), and the direct-runner test below sends identical state on every fork, yet hits are intermittent (2/5 in one run, 0/5 in the next).
2. **The reader still sometimes needs the repair turn.** Two successful demo opens: one needed no repair (single 17.8 s turn), one needed a repair turn of **18.2 s** after a 51.9 s first turn. The repair prompt does **not** re-send the guide: it was 932 characters (the failed citations plus "reply with the same cards"), 5.3 % of the stored prompt. The cost of the repair is the model re-emitting the whole guide (its output), not its input. The failed citations were all one kind: 6 malformed `diff:` IDs (`parseId` rejects them — "not a known ID / not a diff ID").
3. One further open failed at the reader stage before any guide landed. The harness at that point did not capture the reader job's error (fixed in the harness after); the cause of that one failure is unrecorded.

## How it was measured

- Fork cache: [live-124-fork-cache.test.ts](/home/venky/.paseo/worktrees/20ucjyap/spike-124-codex-fork-remeasure/packages/service/test/live-124-fork-cache.test.ts), run twice via `mise run test:live:124-fork-cache` (sanctioned live path, `UNVIBE_ALLOW_LIVE_AGENT=1`). One Codex base session (`gpt-5.6-terra`, Codex CLI 0.162.1) with a synthetic ~2k-token pack and the review-tools MCP stub, then 5 sequential `session/fork` turns per run, each a different one-sentence question, no tool calls. Usage is the adapter's per-turn `usage` event split (uncached input / cache read / cache write / output; #125 split). The pack is synthetic filler; no repository content.
- Reader: [run.mjs](/home/venky/.paseo/worktrees/20ucjyap/spike-124-codex-fork-remeasure/spikes/124-remeasure/run.mjs) starts the built service on a temp port/data dir, sets main+small to Codex `gpt-5.6-terra`, opens the bundled demo fixture (no GitHub, no `gh`), and reads the reader job from `GET /api/jobs?review=:id` (usage, `turns` timings from #194, tool names) and its prompt snapshot from `GET /api/jobs/:id/prompt`. The harness reduces failed citations to kind+reason-category counts in memory and stores only those counts; citation targets and prompt text are never written to disk. Raw summaries: `spikes/124-remeasure/raw/<label>/summary.json`. `--reader-only` stops the service as soon as the reader lands, so background critics do not burn budget.
- The old spike used `gpt-6.1-sol`; this one used `gpt-5.6-terra` (the model `scripts/live-pipeline.mjs` uses for Codex) to stay in budget. Cache behaviour is per provider/model, so treat the exact hit rate as terra's, the shape (generic prefix always cached, pack intermittently cached) as the finding.
- The demo's base pack was 3,863 tokens (`GET /api/reviews/:id/shared-context`). The service-level Explain/Ask part of the harness was not run to completion: the budget guard (below) stopped the full-pipeline run while background critics were consuming tokens. Fork numbers therefore come from the direct runner, which is the same `AcpAgentRunner.fork()` production uses, on a smaller pack.

## 1. Fork turns: uncached vs cached

Per-turn tokens. "Total in" is uncached + cache read (Codex reports no cache writes).

| Run | Turn | Uncached in | Cache read | Out | Turn time |
|---|---|---|---|---|---|
| direct-1 | base | 8,989 | 11,008 | 5 | 3.1 s |
| direct-1 | fork 1 | 9,029 | 11,008 | 16 | 3.2 s |
| direct-1 | fork 2 | 832 | 19,200 | 15 | 2.6 s |
| direct-1 | fork 3 | 832 | 19,200 | 38 | 6.0 s |
| direct-1 | fork 4 | 9,023 | 11,008 | 8 | 3.2 s |
| direct-1 | fork 5 | 9,026 | 11,008 | 15 | 2.8 s |
| direct-2 | base | 7,308 | 11,008 | 5 | 2.9 s |
| direct-2 | fork 1 | 10,037 | 11,008 | 16 | 2.9 s |
| direct-2 | fork 2 | 10,032 | 11,008 | 15 | 2.4 s |
| direct-2 | fork 3 | 10,032 | 11,008 | 40 | 4.0 s |
| direct-2 | fork 4 | 10,031 | 11,008 | 13 | 2.5 s |
| direct-2 | fork 5 | 10,034 | 11,008 | 15 | 2.6 s |

Reading:

- Every turn's total input is ~20.0k–21.0k. The 11,008-token generic prefix (Codex CLI system prompt + tools) is cache-read on all 12 turns.
- On a full hit (2 of 10 forks), uncached drops to 832 (the question plus fork framing) and cache read rises to 19,200 — the pack is read from cache.
- On a miss (8 of 10), the pack is sent uncached again: 9.0k–10.0k. That is better than the old spike's 0.6k–23.5k spread and ~21k typical, because the pack here is smaller and the tool list now matches; it is not zero.
- Hits did not cluster by position: run direct-1 hit on forks 2–3 and missed 1, 4, 5; direct-2 missed all five. That pattern — identical prefix, intermittent hit — points at provider-side cache placement/eviction between fork sessions, not at anything the request carries.
- Latency did not separate hits from misses (hits 2.6 s and 6.0 s; misses 2.4–4.0 s): at this size the saving is tokens, not seconds.

Service-level reference (demo open `codex-2`, before the budget abort): the reader job itself cache-read 57,600 of 71,929 input tokens (80 %) across its tool-call turns on `gpt-5.6-terra` — the reader's own session re-reads its context from cache between tool calls; it is forks that intermittently miss.

## 2. Reader repair turn

Two successful opens of the demo fixture (reader job, `#194` turn timings):

| Open | First turn | Repair turn | Repair? | Failed citations (kinds only) |
|---|---|---|---|---|
| codex-2 | 17.8 s | — | no | — (below the repair threshold of 2) |
| codex-3 | 51.9 s | 18.2 s | yes | 6 × `diff:` malformed ID |

- In `codex-3` the repair turn was 26 % of the reader job's 70.4 s wall time. Reader-job totals for that open: 26,888 uncached + 99,328 cache-read input, 4,095 output (first + repair + tool turns combined; per-turn usage is not split on the job).
- What the repair sends: the stored prompt snapshot is `first prompt + "--- repair turn ---" + repair prompt`. First prompt 16,591 chars; repair prompt **932 chars** (5.3 %): the failed citations with reasons plus "Reply with the same cards and corrected citation tokens. End with the same trailing JSON block." The guide text is **not** re-sent as input. The model re-emits the same cards as output, which is where the repair's output tokens and most of its 18.2 s go.
- Failed kinds: all 6 were `diff:` citations whose IDs do not parse (`parseId` returns null: "not a known ID"). No `code:`-outside-hunk, unknown-hunk, or bad-range failures in either open. That points at prompt wording / ID grammar examples for `diff:` IDs, not at the validator's range logic.
- Already true in current code, confirmed live in `codex-3`: the hunk pass runs at ingest in its own bucket (#123) — all 8 hunk jobs were `done` before the reader finished, so the repair did not stall them. The base build still waits: `warmBase` runs after the reader applies its result, so a repair delays base-ready by roughly the repair duration.

## Cost accounting (read this first if you re-run)

Prices are list-price equivalents at the old spike's Codex rates ($2/M input, $10/M output; the runs used the machine's Codex login, so this is an equivalent, not a bill). Two accountings:

- **Upper bound** (cached input priced as uncached, the harness guard's accounting): service runs $0.28 (aborted reader-error open; its raw summary was not retained) + $1.30 (full-pipeline open, budget-aborted while critics ran) + $0.57 (reader-only open, includes 8 hunk jobs) + direct fork runs $0.24 + $0.25 = **$2.65 total**. That exceeds the ~$1.50 cap on this accounting. Spending stopped as soon as the fork and reader questions were answered; no further runs were made.
- **Cached-discounted** (cached reads at 0.1×, the usual provider discount): the directly measured turns total $0.49 (fork runs $0.22, reader jobs $0.06 + $0.24 including hunks). The budget-aborted service run's background jobs were not persisted, so its discounted share cannot be reconstructed exactly; at its observed cache shares it adds roughly $0.3–0.5, putting the realistic total near **$0.8–1.0**.

The lesson for the next measurement: run `--reader-only` and the direct fork test only. A full-pipeline Codex open spends most of its tokens on background critics, which are not the thing being measured.

## Recommendations

Cache half:

- **Do not build more on our side; close the cache half of #124 as provider-side, with monitoring.** The request-side causes are fixed (same system prompt/MCP/settings on fork; #174 mount). What remains is intermittent provider cache placement: 8/10 forks re-send ~9–10k uncached on a small pack, which on a real base (~20k pack in the old spike) is the old ~21k symptom at the same rate. Expected saving if Codex makes fork cache placement reliable: ~9–21k uncached tokens per fork turn (~$0.02–0.04 at list, less at cached-discount rates), with no measured latency change at this size. The app already surfaces per-job cache-hit rate, so a future provider fix is visible without new work. Revisit only if Codex documents fork/cache affinity or the hit rate is seen at 0/10 across a bigger sample.

Repair half:

- **"Repair without re-sending the guide" is already the input-side truth** (932 chars, no guide text). Do not build that version.
- **"Start the base build and hunk pass during the repair" is half done**: the hunk pass already starts at ingest (#123, observed). Starting the base during the repair would build it on the first-pass cards and rebuild or amend it when the repaired guide lands; expected saving is at most the repair duration (~18 s here, 26 % of the reader job) off base-ready, paid for with a likely-discarded base build (~one pack send) per repaired open. Worth it only if repaired opens are common; in this sample 1 of 2 successful opens repaired.
- **The cheaper fix is at the source**: all 6 failures were malformed `diff:` IDs. A `diff:` ID grammar example in the reader prompt (or accepting/repairing the shape Codex actually emits, once a sample is captured through the Debug page's stored repair prompt) could remove most repair turns outright. Expected saving when it fires: ~18 s and ~2k re-emitted output tokens per repaired open, at near-zero build cost. This needs one captured sample of the malformed shape — the Debug page now stores it (the job's prompt snapshot names the failed citations), and this spike deliberately recorded kinds only.
- If a repair still fires after that, a targeted in-place citation fix (rewrite only the bad tokens in the stored cards, no model turn) would remove the remaining 18 s; that is a validator/apply change, bigger than the prompt fix, and only worth it if repairs stay frequent after the grammar fix.

## Reproduce

```sh
mise run build
mise run test:live:124-fork-cache        # direct fork cache, ~$0.25 upper bound per run
UNVIBE_ALLOW_LIVE_AGENT=1 node spikes/124-remeasure/run.mjs --label codex-N --port 4624 --reader-only
```

## Not measured

- Service-level Explain/Ask fork turns through the full pipeline (budget guard stopped that run; the direct runner covers the same `fork()` path with a smaller pack).
- A large PR, Claude, macOS, second opinions, and the update pass.
- Why one open's reader stage failed (harness gap, since fixed in the harness).
- The exact malformed `diff:` ID shapes (kinds only, by the spike's privacy rule).
