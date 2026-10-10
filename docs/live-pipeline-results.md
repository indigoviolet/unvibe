# Live pipeline results (M3 smoke, real agents)

Date: 2026-10-10T16:36:58.529Z. Service: built `dist/index.js`, default ACP runner. Scratch repo: 3 files (calc.py, test_calc.py, notes.md), temp dir, deleted below.

## Settings per run

- claude: main `claude/sonnet`, small `claude/haiku`
- codex: main `codex/gpt-5.6-terra`, small `claude/haiku`

## claude

- review: `rv_9ced34b38c2c`, rev 25, rev growth during watch: 5
- time to first card: 4.2s
- tokens: input 7947, cached 141104, output 6624, cache-hit rate 0.9466826790829984
- citations: 28 total, 0 unverified (repaired are stored resolved; per-stage unverified sums in logTail: 0)
- WS streaming in first 10s: yes (24044 bytes)
- findings: [{"id":"f-lf","title":"add tolerates None but mul does not; contract undocumented and untested","confidence":"medium","cards":2},{"id":"f-perf","title":"add tolerates None but mul does not","confidence":"medium","cards":2}]
- suggested comments: [{"anchor":{"kind":"diff-line","fileKey":"calc.py","line":14},"post":false,"text":"`add` now treats `None` as 0, but `mul` right below it still raises `TypeError` on `None`. Is that asymmetry intentional"},{"anchor":{"kind":"diff-line","fileKey":"calc.py","line":8},"post":false,"text":"`add` now treats `None` as 0 but `mul` still raises `TypeError` on `None`. Is that asymmetry intentional? If so, please "}]
- hide violations: none
- jobs: reader:done,critic:done,critic:done,concept:done,hunk-pass:done,hunk-pass:done,hunk-pass:done
- failures: none

## codex

- review: `rv_df60d94ef6ab`, rev 22, rev growth during watch: 4
- time to first card: 66.9s
- tokens: input 34653, cached 125098, output 5376, cache-hit rate 0.7830811700709229
- citations: 14 total, 0 unverified (repaired are stored resolved; per-stage unverified sums in logTail: 0)
- WS streaming in first 10s: yes (6242 bytes)
- findings: [{"id":"f-perf","title":"Finding","confidence":"medium","cards":1}]
- suggested comments: []
- hide violations: none
- jobs: reader:done,critic:running,critic:done,concept:done,hunk-pass:done,hunk-pass:done,hunk-pass:done
- failures: none

## Notes

- Repairs: the pipeline sends at most one repair turn per reply when ≥2 citations fail validation; the follow-up text is not persisted as a separate job.

