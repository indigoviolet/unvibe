# Spike #208: fork the reader after it has read

Branch `spike/208-forked-reader` (off `main-rc`). Never merged. Numbers
below are from live runs on 2026-10-21; card text stayed in `/tmp` and is
not in this repo — this write-up carries numbers and card kinds only.

## Question

Today's reader writes the whole guide (problem, central idea per
plotline, "How it's built up", "Decisions and alternatives") in one long
turn, streamed card by card. Does splitting it — reader explores, writes
the problem card plus a plan, then one fork of the reader session per
remaining card, in parallel — make the guide faster or cheaper?

## What was built (spike only, behind a flag)

- `UNVIBE_FORKED_READER=1` switches the reader job to
  `prompts/reader_forked.md`: explore, settle plotlines, write **only**
  the problem card, and end with the usual trailing JSON plus a
  `cardPlan` (each remaining card's kind, exact title, and 3–6 key
  points, including the names/terms to use).
- The reader job then forks its own session once per planned card
  (`AgentRunner.fork`, so each fork holds everything the reader read)
  and runs them in parallel (`prompts/reader_card.md`). Each fork's card
  is citation-validated on its own fork session, with the usual single
  repair turn, and lands as that fork finishes. A failed fork falls back
  to writing its card on the reader session. No plan → the single-turn
  reply stands, unchanged.
- With the flag off, nothing changes: same prompt, same path.
- Harness: `scripts/live-forked-reader.mjs` boots the built service on a
  temp data dir, opens the subject PR, and records (from review create)
  time to first card, per-card arrival, reader-done time, and the reader
  job's tokens/cache/repair and fork turns. It kills the service it
  started at reader-done, so downstream stages are excluded.

Fake-runner coverage: `packages/service/test/forked-reader-208.test.ts`
(problem + forked cards assemble in plan order; no-plan fallback).

## Subjects and method

- **Demo subject:** the bundled demo PR opened as a real (live-ingest)
  PR review — 4 files, 8 hunks, 3 commits.
- **Public subject:** a second small public PR — 8 files, 16 hunks,
  4 commits.
- Providers: Claude (Sonnet) and Codex (Terra-tier), main role;
  prompts are `main-rc`'s, unmodified. One run per cell, plus retries
  noted below. Times include ingest fetch, which adds a few seconds of
  noise to both modes equally. Costs are list-price estimates from the
  reader job's tokens (Claude $3/$15 per 1M in/out, cache read 0.1×,
  cache write 1.25×; Codex $1.25/$10, cache read 0.1×).

## Results

| Subject | Provider | Mode | First card | Guide done | Cards | Repair turns | Reader tokens (in / cache-read / cache-write / out) | Est. reader cost |
|---|---|---|---|---|---|---|---|---|
| demo | Claude | baseline | 15.2 s | 36.4 s | 4 | 0 | 10k / 0 / 23k / 3.5k | $0.17 |
| demo | Claude | forked | 29.3 s | 39.5 s | 4 | 0 | 9k / 70k / 32k / 5.3k | $0.25 |
| demo | Codex | baseline | 33.5 s | 57.8 s | 4 | 1 | 29k / 204k / 0 / 7.2k | $0.13 |
| demo | Codex | forked | 78.8 s | 97.0 s | 4 | 0 | 111k / 272k / 0 / 4.4k | $0.22 |
| public | Claude | baseline | 21.3 s | 43.7 s | 5 | 0 | 13k / 11k / 15k / 4.2k | $0.16 |
| public | Claude | forked | 42.4 s | 76.8 s | 6 | 1 | 12k / 169k / 45k / 9.4k | $0.40 |
| public | Codex | baseline | — | **failed ×2** | (5 streamed) | 0 | ~26k / ~65–97k / 0 / ~6k per try | ~$0.10 per try |
| public | Codex | forked | 74.1 s | 97.3 s | 6 | 0 | 165k / 266k / 0 / 11.2k | $0.35 |

Card kinds were as designed in every completed run (problem, one
central card per plotline, buildup, decisions). The two modes did not
always settle the same plotlines: on the public subject Claude's
baseline chose 2 plotlines (5 cards) and the forked reader 3 (6 cards),
so that row compares guides of different shapes, not just timings.

**Total live spend:** ≈ $4.0 list-price estimate across all runs
(final-cell reader jobs $1.78; all jobs until each kill $3.32 across the
kept runs, plus ~$0.7 for three retried/superseded runs — one forked
demo rerun after a harness fix, one empty Codex reply, and the first
failed Codex public baseline). Small-model jobs are priced at main
rates in that estimate, so it overstates slightly. At the authorised
cap, so no further runs were made.

## Reading the numbers

- **Forked was slower to first card in every cell** (about 2× on
  Claude). The problem card cannot stream-close until the plan JSON
  finishes, and the planning pass makes the first turn longer, while
  the baseline streams the problem card as soon as the next heading
  starts. This is structural in the "problem + plan in one turn"
  design, not a tuning miss.
- **Forked was slower or equal to guide-done on these subjects.**
  Parallel writing saved less than the plan turn plus per-fork setup
  cost: on small guides the reader's exploration, not card writing, is
  most of the first turn (Codex's first turn alone was 61–71 s).
- **Forked cost more everywhere** (+45% to +140% reader cost). Two
  reasons: each fork re-reads the reader's context, and forked cards
  came out much longer — roughly 1.3–2.5× the baseline guide's text
  (output tokens 9.4k vs 4.2k on public/Claude) even after a
  "keep it tight" instruction was added to the fork prompt.
- **Cache behaved as #124/#200 predict.** Claude forks read the
  reader's prefix from cache (88–93% of fork-turn input cached). Codex
  forks mostly missed: 111–165k uncached input tokens per guide vs
  26–29k for the baseline turn.
- **Coherence was not a problem.** Read side by side, the forked cards
  used the plan's names and plotline terms consistently, and a
  sentence-level check found zero repeated sentences between cards in
  any run. The plan does keep forks aligned; the cost is verbosity,
  not contradiction.
- **Reliability cuts both ways.** The Codex baseline on the public
  subject failed twice in a row on `main-rc` today: the guide streamed
  all its cards, then the reader job errored on a malformed trailing
  JSON block, leaving no finished guide. The forked run on the same
  subject completed. That is a pre-existing baseline defect worth its
  own look, not a fork feature — but smaller per-card replies do
  shrink the blast radius of one bad reply. One earlier Codex demo
  baseline attempt also returned an empty reply (retried, fine).

## What was awkward

- Forks run **inside** the reader job (`Promise.all`), bypassing the
  job queue: per-provider session limits don't apply (up to 6 sessions
  at once here), and the job's turn timings misattribute parallel
  turns (the queue's `endTurn` closes the most recent open turn), so
  per-fork durations in the table's source data are approximate;
  wall-clock card arrivals are the trustworthy measure.
- Fork replies' trailing `contribute` data is dropped — only the
  problem turn's data is ingested. Contributions from forks would
  need merging.
- The reader session (and its review-MCP secret) must stay open for
  the whole fork phase; diagram finalization still runs on it.
- If several forks fail at once, their fallbacks write on the reader
  session concurrently. Not hit live; needs serializing in real code.
- One run per cell: variance is large (Codex especially). Treat the
  gaps as directional, not precise.

## Recommendation: drop as designed; revisit only for large guides

Do not adopt the forked reader in this shape. On small-to-medium
guides it is slower to first card, no faster overall, and markedly
more expensive — worst on Codex, where forks miss the prompt cache
(#200). The single-turn reader's streaming already delivers most of
the perceived-latency win.

If guide latency on **large** PRs (where writing really is the long
pole) still hurts, the changes that would make forking worth
re-measuring, in order:

1. **Stream the problem card before planning**: problem card in turn
   one, a short plan-only turn after it lands, then forks. Restores
   baseline first-card latency. (~0.5 day in this spike's shape.)
2. **Make each fork a real job** (a `reader-card` job kind on the
   queue): restores session limits, honest per-turn timings, retries,
   and Debug-page visibility. (~1–2 days.)
3. **A per-card length budget** in the fork prompt, checked against
   the baseline's card sizes — fork verbosity is the biggest cost
   driver after cache misses. (~0.5 day plus prompt tuning.)
4. **Fork only past a size threshold** (e.g. multi-plotline or a diff
   over the inline budget); small guides keep the single turn.
   (~0.5 day.)
5. **Codex only once ephemeral forks are available** (#200), or
   accept ~3–5× the uncached input there.

Estimated total to productionize with those changes: **3–5 days**
including tests and a re-measurement pass.

## Carry-over to the new card set (#212/#211)

Measured against `main-rc`'s four-card prompts, as instructed. The
fork mechanism is card-agnostic — plan entries carry kind, title and
key points — so nothing here depends on the current card titles. The
three findings that decide the question are structural and should
carry over unchanged: the first-card penalty (problem can't close
until the plan is written), Codex fork cache misses, and per-fork
context re-reads. What will **not** carry over exactly: card
verbosity and repair rates, which are prompt-shaped; if #212 lands
and forking is revisited for large guides, re-measure one Claude cell
and one Codex cell with the new prompts before deciding.

## Verification

- `npx vitest run test/forked-reader-208.test.ts test/pipeline.test.ts`
  in `packages/service`: 16 passed.
- `npx tsc --noEmit -p packages/service/tsconfig.json`: clean.
- ESLint on the changed files: clean.
- Full gate not run (per spike instructions).
