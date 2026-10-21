# Spike #211: what the reader's terminal calls run before its first review-tool call

Question (owner chose option (a)): under full access, find out exactly what
the reader's terminal calls run before its first review-tool call
(`get_hunk` / `get_code` / `resolve`).

## Method

- Branch `spike/211-terminal-calls`: #212 prompts plus #207/#209 merged in
  (`fix/209-usage-figures`, which records tool-call arguments and results
  per turn).
- The earlier #212 live runs predate #207: their jobs have no turn records
  and every tool `detail` is `{}`. They cannot answer the question.
- One live reader run, bundled demo, full access on, Claude (Opus class,
  default effort), prompts from this branch. Service stopped as soon as
  the reader finished, so later stages did not spend.
- Reader usage for the run: input 9,788; cached read 157,048; cached
  write 21,135; output 7,636 tokens. At public Opus list rates
  ($15/$75 per M in/out, cache read 0.1x, cache write 1.25x) that is
  about $1.35 — over the $0.50 guide for the run; reported here rather
  than hidden. Reader took 91 s; first card at 51 s; 9 cards.

## Why `detail` was `{}` (found and fixed on this branch)

The Claude ACP adapter streams tool calls: the opening `tool_call`
carries `rawInput: {}`, the real arguments arrive on intermediate
`tool_call_update` notifications, and the terminal update carries no
`rawInput` at all. #207's extraction read only the opening call, and the
runner dropped intermediate updates for already-seen calls, so the
record stuck at `{}` (now dropped as empty) and the real arguments were
lost.

Fix, in `packages/service/src/agent/acp/runner.ts` and
`packages/service/src/jobs/queue.ts`:

- `formatToolDetail` treats `{}` / `[]` as "no detail yet".
- The runner remembers the latest streamed detail per tool call and
  puts it on the `end` event.
- The job record backfills a missing (or `{}`) detail from the `end`
  event, on the flat tool list and on the turn record.

Covered by a fake-ACP test that streams `tool_call {}` →
`tool_call_update` with arguments → completion without arguments, plus
the existing #207/#160 suites. #207 can take this fix as-is. With
`UNVIBE_ACP_DEBUG=2` the runner also logs raw tool updates to stderr,
which is how the streamed shape above was confirmed.

## What the reader actually did

Whole reader job, in order (result sizes from the #207 records):

| # | Tool | Command or path kind | Result size |
|---|------|----------------------|-------------|
| 1 | ToolSearch | tool discovery query | 60 chars |
| 2 | review tool (`get_code`) | changed source file, line range past end of file — failed | 78 chars |
| 3 | Terminal | `wc -l` + `grep -n` for four symbols across two source files (one missing) | 246 chars |
| 4 | review tool (`get_code`) | changed source file, corrected line range | 543 chars |

Before the first review-tool call there were **no terminal or file
calls at all** — only the tool-discovery call (#1). The single terminal
call (#3) came *after* a review-tool call had failed.

Classification of #3: **legitimate exploration**, not diff
re-derivation. It ran no `git diff` / `git show` / `git log -p` and read
no changed file whose content the context already holds. It located
symbols in the working copy after the review tool had failed on that
file (the demo working copy holds only diff lines for it, so most of
the file reads back blank — the run still ended with that degraded
reason). In other words, the terminal was used as the fallback the
prompts allow when a review tool fails, which is the behaviour #211
asked for.

## Recommendation

**Leave it (do not adopt (b) or (c) yet), and re-measure with the fixed
recording.**

- The one observed terminal call was legitimate exploration triggered
  by a failed review-tool call, not diff re-derivation. Restricting the
  terminal before the first card (c) would have blocked exactly this
  legitimate fallback.
- Putting the diff and hunk map in context (b) would not have changed
  this run: the reader reached for the review tools first on its own.
- Caveat: this is one run, and the #212 pair saw 3 terminal calls
  before the first review-tool call (contents then unrecorded).
  Behaviour varies run to run. Now that #207 records arguments
  properly, the next few full-access demo runs will show whether
  pre-review terminal calls recur and what they run; only if they turn
  out to re-derive the diff is (b) or (c) warranted.
