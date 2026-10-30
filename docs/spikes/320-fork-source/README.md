# Spike #320: which session should a question fork from?

Status: spike on `spike/fork-source`. Never merged. No product code changed.

## Question

When the reviewer asks a question (Ask/Explain), the answer session is forked
from the review's **base pack** today (`Pipeline.forkFor` →
`SessionManager.getBase` → `runner.fork(base)` in
[runner.ts](/home/venky/.paseo/worktrees/20ucjyap/spike-fork-source/packages/service/src/pipeline/runner.ts)
and [manager.ts](/home/venky/.paseo/worktrees/20ucjyap/spike-fork-source/packages/service/src/sessions/manager.ts)).
The pack is deterministic text (L0 instructions, L1 source, L2 guide). It never
carries what sessions learned with their tools. This spike compares four fork
sources on the cached large demo (python/cpython#160318, ECH in `ssl`):

| Source | Context the question session starts from |
| --- | --- |
| A | Base pack only (today's behaviour) |
| B | Experienced live session: base pack, then the earlier session's tool reads happen live in the session, then the session is cloned (pi `clone`, the fork equivalent) |
| C | Base pack + deterministic "already explored" layer (no model call) |
| D | Base pack + compacted "what I've learned" note (one extra model turn) |
| CD | C and D combined (the issue asked to include it if cheap; it was) |

## Method

- Harness: [spike-320-harness.mjs](/home/venky/.paseo/worktrees/20ucjyap/spike-fork-source/scripts/spike-320-harness.mjs)
  (asks) and [spike-320-grade.mjs](/home/venky/.paseo/worktrees/20ucjyap/spike-fork-source/scripts/spike-320-grade.mjs)
  (blind grade). Both reuse [live-pi-lib.mjs](/home/venky/.paseo/worktrees/20ucjyap/spike-fork-source/scripts/live-pi-lib.mjs).
- Prep copies the large-demo cache into a fresh scratch dir (never the real
  data dir), starts the built service in browse mode (`UNVIBE_AGENT=none`,
  free), and reads the real base pack from
  `GET /api/reviews/:id/shared-context`. The service process started for prep
  is killed by its recorded PID.
- Asks run on pi + `meta/muse-spark-1.3-contributor` over RPC
  (`pi --mode rpc`, read-only tools `read,grep,find,ls`, cwd = scratch
  worktree). Each ask is two turns (context, reply `ready`; then the question)
  with a `clone` before the question, mirroring the product fork. Deviations
  from the product path, kept identical for every source: pi's built-in file
  tools stand in for the review MCP tools (`get_code`/`get_hunk`), and answers
  are plain Markdown with `file:line` citations instead of the app's reply
  format with citation validation and repair turns.
- The experienced session in this cache is the **critic** (28 content tool
  reads recorded on its job; the reader used none). Source C's layer is built
  deterministically from those recorded calls: each file/range once, in
  first-seen order, with a 12-line excerpt, capped at 24,000 chars, plus the
  one-line answered critic finding. Source B replays five representative
  ranges from that history as live `read` calls; its exploration cost is
  recorded separately as sunk (already paid when the review was built) and is
  not charged to the ask.
- Source D's note is produced by one extra turn over the explored layer.
  Proposed trigger: regenerate when the guide finishes, then after every 15
  further tool reads in the review. Its cost is reported separately and also
  amortised per question.
- Safety: free `pi --list-models` and catalogue pricing first; a bounded
  pre-flight (every context is size-capped) refuses to start over the $1 cap;
  spend is tracked from the first token. Any pi 403
  `client_attestation_denied` stops the run with no provider/model switch.

## Questions

Ten questions written up front ([questions.json](questions.json) holds the
wording plus the verified ground-truth keys used for grading): why (Q1, Q7),
where (Q2, Q6), edge cases (Q3, Q8), test coverage (Q4), cross-file flows
(Q5, Q10) and a follow-up (Q9). Q2/Q3/Q5/Q9 sit on code the critic explored;
the rest sit on code nobody touched.

## Live run

Completed 2026-10-30. No pi 403 occurred. 50/50 asks succeeded
(10 questions x 5 sources). Actual spend: **$0.1360 of the $1 cap** — asks
$0.1112 (including the $0.0007 note turn), blind grades $0.0248. Raw records:
[results.json](raw/results.json), [grades.json](raw/grades.json); every answer
is under [answers/](answers/) as `Q<n>-<source>.md`; the generated contexts are
[explored-layer.txt](raw/explored-layer.txt) and
[compacted-note.txt](raw/compacted-note.txt).

Two measurement facts shape everything below:

1. **Almost no tool reads happened** (0 in 48 of 50 asks; Q9/B and Q9/CD used
   4 each). The base pack already inlines the diff, so the model answered from
   context. The redundancy the explored layer is meant to prevent barely
   exists on this review at ask time.
2. **Cost differences are mostly provider prompt-cache variance**, not source
   size: identical packs alternated between ~$0.0005 (cache hit) and ~$0.005
   (cache miss) depending on run order. Read cost as "all sources are within
   noise of each other", not as a ranking.

### Per-question results

Cost in USD; T = tool reads during the question turn; grades are
correctness/specificity/redundancy (1-5, blind, see below).

| Q | A | B | C | D | CD |
| --- | --- | --- | --- | --- | --- |
| Q1 why, fresh | $0.0006 T0 4/4/3 | $0.0011 T0 3/4/4 | $0.0005 T0 3/3/3 | $0.0008 T0 5/5/5 | $0.0053 T0 3/4/4 |
| Q2 where, explored | $0.0049 T0 4/5/5 | $0.0053 T0 5/5/5 | $0.0005 T0 4/5/5 | $0.0050 T0 4/5/5 | $0.0051 T0 4/5/5 |
| Q3 edge, explored | $0.0006 T0 4/4/5 | $0.0059 T0 4/5/5 | $0.0005 T0 5/5/5 | $0.0051 T0 4/5/5 | $0.0019 T0 5/5/5 |
| Q4 tests, fresh | $0.0049 T0 4/5/5 | $0.0011 T0 2/4/4 | $0.0052 T0 4/5/5 | $0.0005 T0 3/5/5 | $0.0017 T0 3/5/5 |
| Q5 flow, explored | $0.0005 T0 2/4/5 | $0.0011 T0 4/5/4 | $0.0006 T0 5/4/5 | $0.0006 T0 5/5/5 | $0.0006 T0 5/5/5 |
| Q6 where, fresh | $0.0005 T0 4/5/5 | $0.0060 T0 4/5/5 | $0.0006 T0 4/5/5 | $0.0006 T0 5/5/5 | $0.0007 T0 4/5/5 |
| Q7 why, fresh | $0.0004 T0 4/5/5 | $0.0055 T0 4/4/5 | $0.0019 T0 4/4/5 | $0.0004 T0 4/5/5 | $0.0007 T0 2/5/5 |
| Q8 edge, fresh | $0.0007 T0 5/5/5 | $0.0011 T0 4/4/5 | $0.0006 T0 4/5/5 | $0.0051 T0 4/5/5 | $0.0006 T0 5/5/5 |
| Q9 follow-up, explored | $0.0007 T0 3/4/5 | $0.0017 T4 4/5/2 | $0.0019 T0 4/4/5 | $0.0051 T0 4/5/5 | $0.0021 T4 3/5/2 |
| Q10 flow, fresh | $0.0005 T0 4/5/5 | $0.0009 T0 4/5/5 | $0.0053 T0 5/5/5 | $0.0018 T0 4/4/5 | $0.0052 T0 4/5/5 |

Full token and latency columns (input, cache-read, cache-write, output,
time-to-first-token, total) are per ask in [results.json](raw/results.json).

### Totals and means

| Source | Ask cost total | Mean/ask | Mean TTFT | Mean total | Tool reads | Correctness | Specificity | Redundancy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | $0.0142 | $0.0014 | 11.3s | 13.8s | 0 | 3.80 | 4.60 | 4.80 |
| B | $0.0297 | $0.0030 | 14.2s | 18.7s | 4 | 3.80 | 4.60 | 4.40 |
| C | $0.0177 | $0.0018 | 11.6s | 14.1s | 0 | 4.10 | 4.40 | 4.80 |
| D | $0.0250 | $0.0025 | 11.8s | 14.4s | 0 | 4.20 | 4.90 | 5.00 |
| CD | $0.0239 | $0.0024 | 11.4s | 16.4s | 4 | 3.80 | 4.90 | 4.60 |

Not in the per-ask means: B's replayed exploration cost $0.0088 across its 10
asks (sunk in the product, where the reader/critic already paid it), and D's
note cost $0.0007 once per review state ($0.00007 per question amortised over
these 10). On explored questions only (Q2/Q3/Q5/Q9), correctness was A 3.25,
B 4.25, C 4.50, D 4.25, CD 4.25; on fresh questions A 4.17, B 3.50, C 3.83,
D 4.17, CD 3.50. With 4-6 questions per cell this is a signal, not proof.

### Blind grade

A separate process ([spike-320-grade.mjs](/home/venky/.paseo/worktrees/20ucjyap/spike-fork-source/scripts/spike-320-grade.mjs))
shuffled each question's five answers under neutral labels (`Answer 1..5`,
seeded per question), and a fresh pi session scored correctness, specificity
and redundancy against the verified ground-truth keys in
[questions.json](questions.json) without seeing source labels, tool counts or
costs. Scores were mapped back to sources only in
[grades.json](raw/grades.json). Grading cost $0.0248, inside the same $1 cap.
Weakness: one grader, one sample per answer, and the redundancy score is
judged from answer text (the grader could not see tool traces — the two
4-read asks still scored redundancy 2, from repetition in the text).

## Recommendation

**Adopt C (the deterministic explored layer); keep A as the fallback; do not
build B; defer D.**

- **C** is the best trade: highest correctness on explored questions (4.50),
  no overall quality loss, no extra model call, no new session machinery. It
  is a pure function of data the service already records (tool calls on jobs),
  appended under a size cap — the same determinism discipline as the base
  pack itself. Cost and latency were indistinguishable from A.
- **D** graded best overall (4.20/4.90/5.00) and is nearly free per review
  ($0.0007 per note), but it adds an agent call, a trigger/staleness policy,
  and a summary that can drift from the code. The margin over C (0.1
  correctness on 10 questions) does not pay for that complexity yet. Revisit
  if questions routinely reach beyond what tool traces show.
- **CD** added nothing over C or D alone — combining them bought no grade and
  inherited B-like repetition on Q9.
- **B** (fork the experienced session) was joint-worst on quality, slowest
  (18.7s mean), and is the only option needing live-session fork support,
  posture and lifetime handling for a session owned by another job. Its
  premise — that the session's tool history is in its context — was mostly
  moot here because the pack already inlines the diff and the history
  replay produced no tool-read savings.
- Caveat for the owner decision: this is one PR, one model, 10 questions.
  The redundancy hypothesis (sources preventing re-reads) was barely tested
  because asks needed almost no reads. If real Ask usage shows repeated
  `get_code`/`get_hunk` calls on already-read ranges, C's value grows; the
  layer should be built from those recorded calls exactly as prototyped in
  [spike-320-harness.mjs](/home/venky/.paseo/worktrees/20ucjyap/spike-fork-source/scripts/spike-320-harness.mjs)
  (`buildExploredLayer`).

## Reproduce

```sh
mise run build   # once, for the scratch browse service
node scripts/spike-320-harness.mjs --dry-run   # stub transport, no spend
node scripts/spike-320-harness.mjs --cap 1     # live asks (refuses over cap)
node scripts/spike-320-grade.mjs --cap 1       # blind grade
```

No Playwright was used. The scratch data dir and pi session dirs live under
the OS temp dir and are left for inspection; the real data dir, `~/.pi`,
login units and credentials were never touched.
