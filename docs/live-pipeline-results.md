# Live pipeline results (M3 smoke, real agents)

Date: 2026-10-10T17:08:14.298Z. Service: built `dist/index.js`, default ACP runner. Scratch repo: 3 files (calc.py, test_calc.py, notes.md), temp dir, deleted below.

## Settings per run

- claude: main `claude/sonnet`, small `claude/haiku`
- codex: main `codex/gpt-5.6-terra`, small `claude/haiku`

## claude

- review: `rv_8d80627aaeb3`, rev 28, rev growth during watch: 6
- time to first card: 3.8s
- tokens: input 7946, cached 141138, output 5606, cache-hit rate 0.9467011885916664
- citations: 37 total, 0 unverified (repaired are stored resolved; per-stage unverified sums in logTail: 0)
- WS streaming in first 10s: yes (46132 bytes)
- findings: [{"id":"f-critic-0","title":"Evidence","confidence":"medium","cards":2},{"id":"f-critic-1","title":"add coerces None but mul does not","confidence":"medium","cards":2}]
- suggested comments: [{"anchor":{"kind":"diff-line","fileKey":"calc.py","line":13},"post":false,"text":"`add` now tolerates `None` (as 0), but `mul` still raises `TypeError` on `None`, and no test pins either choice for `mul"},{"anchor":{"kind":"diff-line","fileKey":"calc.py","line":14},"post":false,"text":"`add` now coerces `None` to 0, but `mul` right below it still raises on `None`. If that's intentional, please say so in "}]
- hide violations: none
- jobs: reader:done,critic:done,critic:done,concept:done,hunk-pass:done,hunk-pass:done,hunk-pass:done
- failures: none

## codex

- review: `rv_a45971104a5f`, rev 27, rev growth during watch: 6
- time to first card: 23.8s
- tokens: input 32896, cached 165530, output 5470, cache-hit rate 0.8342152742080171
- citations: 14 total, 0 unverified (repaired are stored resolved; per-stage unverified sums in logTail: 0)
- WS streaming in first 10s: yes (6395 bytes)
- findings: [{"id":"f-critic-0","title":"Finding","confidence":"high","cards":2},{"id":"f-critic-1","title":"Test gap: only one None position is covered","confidence":"high","cards":2}]
- suggested comments: [{"anchor":{"kind":"diff-line","fileKey":"test_calc.py","line":13},"post":false,"text":"Could we add coverage for `add(2, None)` (and optionally `add(None, None)`)? Both operands are normalized independently,"},{"anchor":{"kind":"diff-line","fileKey":"test_calc.py","line":13},"post":false,"text":"Could we also cover `add(2, None)` and `add(None, None)`? Both argument-normalization branches are part of the new behav"}]
- hide violations: none
- jobs: reader:done,critic:done,critic:done,concept:done,hunk-pass:done,hunk-pass:done,hunk-pass:done
- failures: none

## Notes

- Repairs: the pipeline sends at most one repair turn per reply when ≥2 citations fail validation; the follow-up text is not persisted as a separate job.

