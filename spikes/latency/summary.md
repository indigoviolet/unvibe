## Open a PR (seconds from the click; one open per run)

| run | load | ingest ready | first card | reader done | base built | first hunk summary | hunk pass done | first finding | critics done | all idle |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-1 | 6.51 | 7.5 | 21.4 | 38.8 | 41.0 | 44.7 | 63.8 | 128.6 | 133.0 | 133.3 |
| claude-2 | 8.05 | 7.9 | 22.0 | 44.3 | 24.6 | 50.2 | 71.8 | 130.4 | 152.0 | 152.3 |
| claude-forkmeta-1 | 1.32 | 7.9 | 23.2 | 42.4 | 45.5 | 46.0 | 68.8 | 113.2 | 134.1 | 134.4 |
| claude-effort-1 | 1.84 | 7.9 | 27.5 | 51.2 | 53.6 | 55.8 | 81.7 | 135.1 | 139.7 | 140.0 |
| codex-1 | 1.6 | 8.0 | 54.7 | 123.9 | 129.2 | 126.4 | 133.2 | 160.8 | 173.8 | 174.1 |
| codex-forkmeta-1 | 3.69 | 7.7 | 74.0 | 151.5 | 156.2 | 154.6 | 159.8 | 202.2 | 202.2 | 202.5 |

## Open: jobs (seconds)

| run | job | queue wait | session set-up | first text | turn(s) | turns | tool calls (tool time) | total | uncached in | cache read | cache write | out |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-1 | reader | 0.0 | 0.9 | 12.9 | 30.1 | 1 | 7 (3.3) | 31.5 | 7181 | 18514 | 20517 | 3066 |
| claude-1 | critic | 0.0 | 3.1 | 74.9 | 86.4 | 1 | 10 (19.6) | 89.8 | 10 | 160809 | 45912 | 7728 |
| claude-1 | critic | 0.0 | 3.2 | 80.7 | 90.6 | 1 | 10 (17.2) | 94.2 | 10 | 164796 | 48095 | 7831 |
| claude-1 | concept | 0.0 | 3.2 | 5.4 | 13.5 | 1 | 0 (0.0) | 17.0 | 2 | 0 | 36898 | 1434 |
| claude-1 | hunk-pass ×8 | 15.0 (0.0–21.0, n=8) | 0.8 (0.8–0.8, n=8) | 2.4 (1.9–4.1, n=8) | 2.8 (2.3–4.7, n=8) | 1 | 0 | 3.9 (3.4–5.8, n=8) run | 2010 | 7435 | 5244 | 479 |
| claude-2 | reader | 0.0 | 1.1 | 12.9 | 35.0 | 1 | 7 (3.0) | 36.6 | 7176 | 28288 | 10818 | 3430 |
| claude-2 | critic | 0.0 | 3.1 | 70.2 | 82.7 | 1 | 10 (20.7) | 86.1 | 10 | 174388 | 37385 | 7457 |
| claude-2 | critic | 0.0 | 3.1 | 75.8 | 104.2 | 1 | 12 (19.6) | 107.7 | 14 | 267445 | 41843 | 9128 |
| claude-2 | concept | 0.0 | 2.9 | 4.9 | 14.4 | 1 | 0 (0.0) | 17.6 | 2 | 10115 | 27189 | 1421 |
| claude-2 | hunk-pass ×8 | 16.2 (0.0–23.6, n=8) | 0.8 (0.7–0.9, n=8) | 2.9 (2.0–4.0, n=8) | 3.2 (2.4–4.6, n=8) | 1 | 0 | 4.4 (3.6–5.7, n=8) run | 2012 | 8539 | 4118 | 518 |
| claude-forkmeta-1 | reader | 0.0 | 0.8 | 14.5 | 33.3 | 1 | 6 (2.3) | 34.6 | 7177 | 28290 | 9579 | 3245 |
| claude-forkmeta-1 | critic | 0.0 | 3.9 | 71.9 | 87.5 | 1 | 12 (12.3) | 91.7 | 10 | 121301 | 13128 | 7777 |
| claude-forkmeta-1 | critic | 0.0 | 4.0 | 57.5 | 66.5 | 1 | 5 (4.9) | 70.8 | 6 | 63023 | 9758 | 5842 |
| claude-forkmeta-1 | concept | 0.0 | 4.0 | 6.4 | 15.8 | 1 | 0 (0.0) | 20.1 | 2 | 17581 | 2765 | 1626 |
| claude-forkmeta-1 | hunk-pass ×8 | 12.9 (0.0–23.2, n=8) | 0.8 (0.7–0.8, n=8) | 2.1 (1.7–3.4, n=8) | 2.4 (2.1–3.8, n=8) | 1 | 0 | 3.5 (3.2–4.8, n=8) run | 2012 | 8539 | 4119 | 502 |
| claude-effort-1 | reader | 0.0 | 0.8 | 18.8 | 42.1 | 1 | 8 (4.6) | 43.4 | 7177 | 28292 | 11232 | 4149 |
| claude-effort-1 | critic | 0.0 | 3.3 | 69.3 | 84.9 | 1 | 10 (10.6) | 88.5 | 8 | 92510 | 12957 | 7556 |
| claude-effort-1 | critic | 0.0 | 3.2 | 68.3 | 80.3 | 1 | 7 (8.6) | 83.9 | 8 | 90591 | 10724 | 7193 |
| claude-effort-1 | concept | 0.0 | 3.3 | 5.4 | 14.5 | 1 | 0 (0.0) | 18.1 | 2 | 17891 | 2767 | 1582 |
| claude-effort-1 | hunk-pass ×8 | 18.5 (0.0–25.9, n=8) | 0.8 (0.7–1.4, n=8) | 2.6 (1.7–3.2, n=8) | 3.1 (2.1–9.0, n=8) | 1 | 0 | 4.2 (3.5–10.1, n=8) run | 2010 | 10092 | 4162 | 432 |
| codex-1 | reader | 0.0 | 0.1 | 18.1 | 115.1 | 2 | 11 (0.1) | 116.1 | 22116 | 155520 | 0 | 3969 |
| codex-1 | critic | 0.0 | 5.4 | 11.9 | 31.2 | 1 | 1 (0.0) | 36.9 | 23105 | 73984 | 0 | 1078 |
| codex-1 | critic | 0.0 | 5.5 | 5.7 | 44.1 | 1 | 1 (0.0) | 49.9 | 22136 | 42496 | 0 | 2201 |
| codex-1 | concept | 0.0 | 5.5 | 8.5 | 13.0 | 1 | 0 (0.0) | 18.8 | 20503 | 11008 | 0 | 529 |
| codex-1 | hunk-pass ×8 | 1.2 (0.0–4.2, n=8) | 0.8 (0.8–0.9, n=8) | 2.5 (0.8–3.3, n=8) | 2.9 (1.2–3.8, n=8) | 1 | 0 | 4.1 (2.4–5.0, n=8) run | 2010 | 7722 | 5078 | 397 |
| codex-forkmeta-1 | reader | 0.0 | 0.1 | 8.2 | 143.0 | 2 | 12 (0.2) | 143.9 | 22976 | 189568 | 0 | 4758 |
| codex-forkmeta-1 | critic | 0.0 | 4.8 | 21.0 | 45.6 | 1 | 1 (0.0) | 50.7 | 21467 | 11008 | 0 | 1097 |
| codex-forkmeta-1 | critic | 0.0 | 4.9 | 18.8 | 45.4 | 1 | 1 (0.0) | 50.6 | 21467 | 11008 | 0 | 1064 |
| codex-forkmeta-1 | concept | 0.0 | 4.9 | 12.9 | 19.5 | 1 | 0 (0.0) | 24.7 | 20976 | 11008 | 0 | 678 |
| codex-forkmeta-1 | hunk-pass ×8 | 1.5 (0.0–4.9, n=8) | 0.9 (0.7–1.0, n=8) | 2.3 (0.9–3.3, n=8) | 2.7 (1.7–3.7, n=8) | 1 | 0 | 3.9 (3.0–4.9, n=8) run | 1795 | 7723 | 5081 | 434 |

## Ingest commands (claude-1; the others are within 0.3 s)

| at (s) | command | ms |
|---|---|---|
| 0.0 | `git fetch origin` | 959 |
| 1.0 | `gh pr view 5020 --json title,body,author,state,isDraft,baseRefName,headRefName,headRefOid` | 1098 |
| 2.1 | `git fetch origin refs/pull/5020/head` | 1603 |
| 3.7 | `git fetch origin main` | 947 |
| 4.6 | `git merge-base origin/main 00162b2030837429af8f2de8ef07b602d910cbbd` | 6 |
| 4.6 | `git diff -U3 -M --no-color --no-ext-diff 6e42ff11a1ba5c1542f38c67ec17238d0b779552` | 1150 |
| 5.8 | `git log --reverse --format=%H%x00%s%x00%b%x1e 6e42ff11a1ba5c1542f38c67ec17238d0b779552..00` | 4 |
| 5.8 | `git worktree add /tmp/unvibe-latency-CrCiEu/worktrees/rv_5d3ea0db8f7f 00162b2030837429af8f` | 1642 |
| 7.4 | `git check-attr linguist-generated --stdin` | 5 |

## Explain (baseline)

| run | flow | load | click → done | of which: wait before enqueue (base build) | queue | fork/session set-up | first text (in turn) | turn | grace | after turn | uncached in | cache read | cache write | out | visible text tokens (≈) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-1 | explain#1 (first on review) | 3.39 | **15.5** | 2.3 | 0.0 | 0.8 | 6.2 | 12.0 | 0.3 | 0.0 | 2 | 10115 | 30867 | 944 | 408 |
| claude-1 | explain#2 | 2.72 | **16.2** | 0.0 | 0.0 | 0.9 | 9.0 | 14.9 | 0.3 | 0.0 | 2 | 10115 | 31320 | 1220 | 460 |
| claude-1 | explain#3 | 2.07 | **21.3** | 0.0 | 0.0 | 0.8 | 13.1 | 20.2 | 0.3 | 0.0 | 2 | 10115 | 31917 | 1580 | 543 |
| claude-1 | explain#4 (right after generate) | 0.66 | **22.8** | 2.2 | 0.0 | 0.8 | 11.0 | 19.4 | 0.3 | 0.0 | 2 | 10115 | 34133 | 1528 | 612 |
| claude-1 | explain#5 | 0.49 | **11.6** | 0.0 | 0.0 | 0.9 | 3.1 | 9.0 | 0.3 | 1.4 | 2 | 10115 | 35353 | 774 | 449 |
| claude-2 | explain(early, during pipeline) | 13.4 | **18.0** | 2.6 | 0.0 | 1.2 | 5.7 | 13.8 | 0.3 | 0.0 | 2 | 10115 | 26275 | 1071 | 519 |
| claude-2 | explain#2 | 3.92 | **21.9** | 2.6 | 0.0 | 0.9 | 10.6 | 18.1 | 0.3 | 0.0 | 2 | 10115 | 32752 | 1404 | 553 |
| claude-2 | explain#3 | 3.6 | **24.3** | 0.0 | 0.0 | 0.9 | 22.6 | 23.0 | 0.3 | 0.0 | 6 | 98292 | 34601 | 1761 | 586 |
| claude-2 | explain#4 (right after generate) | 2.51 | **24.6** | 2.5 | 0.0 | 0.9 | 9.7 | 17.2 | 0.3 | 3.7 | 2 | 10115 | 35738 | 1400 | 553 |
| claude-2 | explain#5 | 2.68 | **13.4** | 0.0 | 0.0 | 1.1 | 5.3 | 11.2 | 0.3 | 0.7 | 2 | 10115 | 37201 | 945 | 443 |
| codex-1 | explain#1 (first on review) | 1.97 | **22.2** | 5.6 | 0.0 | 0.1 | 11.5 | 16.2 | 0.3 | 0.0 | 21245 | 11008 | 0 | 573 | 208 |
| codex-1 | explain#2 | 1.62 | **10.7** | 0.0 | 0.0 | 0.1 | 5.1 | 10.2 | 0.3 | 0.0 | 21397 | 11008 | 0 | 310 | 226 |
| codex-1 | explain#3 | 1.5 | **22.3** | 0.0 | 0.0 | 0.1 | 13.7 | 21.8 | 0.3 | 0.0 | 21569 | 11008 | 0 | 805 | 374 |
| codex-1 | explain#4 (right after generate) | 1.73 | **27.7** | 5.6 | 0.0 | 0.2 | 12.4 | 21.6 | 0.3 | 0.0 | 12555 | 21248 | 0 | 773 | 353 |
| codex-1 | explain#5 | 1.87 | **18.9** | 0.0 | 0.0 | 0.2 | 12.4 | 18.4 | 0.3 | 0.0 | 23095 | 11008 | 0 | 623 | 234 |

## Explain with the fork experiment (UNVIBE_SPIKE_FORK_META=1)

| run | flow | load | click → done | of which: wait before enqueue (base build) | queue | fork/session set-up | first text (in turn) | turn | grace | after turn | uncached in | cache read | cache write | out | visible text tokens (≈) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-forkmeta-1 | explain#1 (first on review) | 0.89 | **17.6** | 2.2 | 0.0 | 1.1 | 7.5 | 13.9 | 0.3 | 0.0 | 2 | 20278 | 4345 | 1056 | 421 |
| claude-forkmeta-1 | explain#2 | 1.26 | **12.4** | 0.0 | 0.0 | 0.9 | 5.2 | 11.1 | 0.3 | 0.0 | 2 | 20278 | 4880 | 879 | 427 |
| claude-forkmeta-1 | explain#3 | 1.59 | **12.4** | 0.0 | 0.0 | 0.8 | 4.8 | 11.3 | 0.3 | 0.0 | 2 | 20278 | 5407 | 908 | 481 |
| claude-forkmeta-1 | explain#4 (right after generate) | 1.48 | **16.1** | 2.1 | 0.0 | 0.9 | 5.2 | 12.8 | 0.3 | 0.0 | 2 | 21778 | 6546 | 1116 | 548 |
| claude-forkmeta-1 | explain#5 | 1.58 | **16.3** | 0.0 | 0.0 | 0.8 | 4.2 | 11.4 | 0.3 | 3.7 | 2 | 21778 | 7260 | 949 | 539 |
| codex-forkmeta-1 | explain#1 (first on review) | 2.78 | **21.4** | 3.9 | 0.0 | 0.1 | 11.4 | 17.0 | 0.3 | 0.0 | 21666 | 11008 | 0 | 616 | 263 |
| codex-forkmeta-1 | explain#2 | 2.81 | **31.6** | 0.0 | 0.0 | 0.1 | 5.5 | 31.1 | 0.3 | 0.0 | 32017 | 85248 | 0 | 1160 | 433 |
| codex-forkmeta-1 | explain#3 | 2.32 | **6.8** | 0.0 | 0.0 | 0.1 | 4.9 | 6.3 | 0.3 | 0.0 | 22253 | 11008 | 0 | 528 | 228 |
| codex-forkmeta-1 | explain#4 | 2.28 | **19.4** | 0.0 | 0.0 | 0.1 | 14.5 | 18.9 | 0.3 | 0.0 | 22479 | 11008 | 0 | 511 | 205 |

## Explain and Ask by reasoning effort (Claude, fork experiment on)

| run | flow | load | click → done | of which: wait before enqueue (base build) | queue | fork/session set-up | first text (in turn) | turn | grace | after turn | uncached in | cache read | cache write | out | visible text tokens (≈) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-effort-1 | explain effort=high #1 | 2.53 | **29.1** | 2.0 | 0.0 | 0.9 | 18.6 | 25.8 | 0.3 | 0.0 | 2 | 20842 | 4668 | 2181 | 528 |
| claude-effort-1 | explain effort=high #2 | 3.29 | **30.5** | 0.0 | 0.0 | 0.9 | 28.8 | 29.2 | 0.3 | 0.0 | 4 | 46948 | 6666 | 2474 | 589 |
| claude-effort-1 | explain effort=high #3 | 2.34 | **26.5** | 0.0 | 0.0 | 0.9 | 24.1 | 25.3 | 0.3 | 0.0 | 4 | 47742 | 7657 | 2336 | 627 |
| claude-effort-1 | ask effort=high | 2.1 | **16.8** | 0.0 | 0.0 | 0.9 | 8.5 | 12.3 | 0.3 | 3.3 | 2 | 20842 | 6594 | 1003 | 298 |
| claude-effort-1 | explain effort=medium #1 | 2.51 | **15.4** | 0.0 | 0.0 | 0.9 | 7.0 | 14.2 | 0.3 | 0.0 | 2 | 25173 | 3007 | 1248 | 563 |
| claude-effort-1 | explain effort=medium #2 | 2.18 | **13.1** | 0.0 | 0.0 | 1.1 | 3.5 | 11.6 | 0.3 | 0.0 | 2 | 25173 | 3665 | 1036 | 608 |
| claude-effort-1 | explain effort=medium #3 | 2.42 | **20.5** | 0.0 | 0.0 | 1.0 | 8.7 | 18.5 | 0.3 | 0.7 | 2 | 25173 | 4450 | 1669 | 751 |
| claude-effort-1 | ask effort=medium | 3.25 | **9.0** | 0.0 | 0.0 | 0.9 | 3.0 | 6.3 | 0.3 | 1.4 | 2 | 25173 | 5333 | 478 | 207 |
| claude-effort-1 | explain effort=low #1 | 2.97 | **20.4** | 0.0 | 0.0 | 0.9 | 11.7 | 19.1 | 0.3 | 0.0 | 2 | 27696 | 3014 | 1561 | 590 |
| claude-effort-1 | explain effort=low #2 | 2.48 | **14.0** | 0.0 | 0.0 | 0.9 | 5.7 | 12.7 | 0.3 | 0.0 | 2 | 27696 | 3767 | 1096 | 549 |
| claude-effort-1 | ask effort=low | 2.32 | **5.3** | 0.0 | 0.0 | 0.8 | 0.9 | 4.1 | 0.3 | 0.0 | 2 | 27696 | 4041 | 255 | 203 |

## Ask and reply

| run | flow | load | click → done | of which: wait before enqueue (base build) | queue | fork/session set-up | first text (in turn) | turn | grace | after turn | uncached in | cache read | cache write | out | visible text tokens (≈) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-1 | ask (new thread on a card) | 1.36 | **9.8** | 0.0 | 0.0 | 0.9 | 5.5 | 8.6 | 0.3 | 0.0 | 2 | 10115 | 32400 | 602 | 205 |
| claude-1 | reply#1 (existing thread) | 1.15 | **4.1** | – | – | 0.7 (HTTP 0.3) | 1.1 | 3.2 | 0.3 | – | 2 | 32400 | 0 | 0 | – |
| claude-1 | reply#2 (existing thread) | 1.05 | **3.5** | – | – | 0.6 (HTTP 0.3) | 1.2 | 2.5 | 0.3 | – | 0 | 1666 | 0 | 0 | – |
| claude-2 | ask (new thread on a card) | 3.29 | **10.7** | 0.0 | 0.0 | 0.9 | 6.2 | 9.4 | 0.3 | 0.0 | 2 | 10115 | 33993 | 683 | 227 |
| claude-2 | reply#1 (existing thread) | 3.63 | **5.0** | – | – | 0.7 (HTTP 0.3) | 1.2 | 4.0 | 0.3 | – | 2 | 33993 | 0 | 0 | – |
| claude-2 | reply#2 (existing thread) | 3.22 | **3.6** | – | – | 0.6 (HTTP 0.3) | 1.1 | 2.6 | 0.3 | – | 0 | 1826 | 0 | 0 | – |
| codex-1 | ask (new thread on a card) | 1.72 | **9.6** | 0.0 | 0.0 | 0.1 | 5.2 | 9.0 | 0.3 | 0.0 | 21762 | 11008 | 0 | 132 | 162 |
| codex-1 | reply#1 (existing thread) | 1.62 | **14.8** | – | – | 0.7 (HTTP 0.4) | 10.0 | 13.8 | 0.3 | – | 2034 | 32512 | 0 | 490 | – |
| codex-1 | reply#2 (existing thread) | 1.67 | **4.0** | – | – | 0.8 (HTTP 0.4) | 1.3 | 2.9 | 0.3 | – | 2189 | 33536 | 0 | 79 | – |
| claude-forkmeta-1 | ask (new thread on a card) | 1.89 | **15.4** | 0.0 | 0.0 | 0.8 | 14.2 | 14.2 | 0.3 | 0.0 | 4 | 46350 | 6295 | 975 | 330 |
| claude-forkmeta-1 | reply#1 (existing thread) | 1.98 | **6.4** | – | – | 1.5 (HTTP 1.2) | 2.6 | 4.5 | 0.3 | – | 0 | 0 | 28901 | 0 | – |
| claude-forkmeta-1 | reply#2 (existing thread) | 1.76 | **3.8** | – | – | 0.6 (HTTP 0.3) | 1.1 | 2.8 | 0.3 | – | 2 | 35196 | 0 | 0 | – |

## Generate (Go deeper) and depth +

| run | flow | load | click → done | of which: wait before enqueue (base build) | queue | fork/session set-up | first text (in turn) | turn | grace | after turn | uncached in | cache read | cache write | out | visible text tokens (≈) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-1 | generate (Go deeper placeholder) | 0.96 | **27.0** | 0.0 | 0.0 | 0.8 | 18.6 | 25.8 | 0.3 | 0.0 | 4 | 49968 | 30919 | 2350 | 1043 |
| claude-1 | depth + (deeper) on the first card | 0.38 | **27.0** | 0.0 | 0.0 | 0.8 | 13.8 | 25.1 | 0.3 | 0.8 | 2 | 10115 | 34105 | 2038 | 830 |
| claude-2 | generate (Go deeper placeholder) | 3.04 | **25.1** | 0.0 | 0.0 | 0.8 | 15.3 | 23.9 | 0.3 | 0.0 | 4 | 51079 | 32073 | 2082 | 1184 |
| claude-2 | depth + (deeper) on the first card | 2.98 | **19.7** | 0.0 | 0.0 | 1.0 | 7.6 | 18.3 | 0.3 | 0.0 | 2 | 10115 | 35507 | 1480 | 803 |
| codex-1 | generate (Go deeper placeholder) | 1.54 | **44.8** | 0.0 | 0.0 | 0.1 | 4.8 | 44.4 | 0.3 | 0.8 | 21319 | 42496 | 0 | 1790 | 749 |
| claude-forkmeta-1 | generate (Go deeper placeholder) | 1.62 | **24.9** | 0.0 | 0.0 | 0.8 | 10.4 | 23.8 | 0.3 | 0.0 | 2 | 20278 | 3162 | 2129 | 994 |
| claude-forkmeta-1 | depth + (deeper) on the first card | 1.65 | **19.1** | 0.0 | 0.0 | 1.1 | 6.1 | 17.0 | 0.3 | 0.7 | 2 | 26226 | 1604 | 1513 | 854 |

## Hunk summary (one hunk)

| run | flow | load | click → done | of which: wait before enqueue (base build) | queue | fork/session set-up | first text (in turn) | turn | grace | after turn | uncached in | cache read | cache write | out | visible text tokens (≈) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-1 | hunk summary#1 (one hunk) | 0.23 | **4.8** | 0.0 | 0.0 | 0.8 | 3.1 | 3.6 | 0.3 | 0.1 | 1721 | 8840 | 3532 | 842 | 79 |
| claude-1 | hunk summary#2 (one hunk) | 0.93 | **3.9** | 0.0 | 0.0 | 0.8 | 2.4 | 2.8 | 0.3 | 0.1 | 2195 | 8840 | 4006 | 357 | 88 |
| claude-2 | hunk summary#1 (one hunk) | 2.39 | **4.8** | 0.0 | 0.0 | 0.9 | 3.1 | 3.6 | 0.3 | 0.0 | 1721 | 8839 | 3527 | 597 | 90 |
| claude-2 | hunk summary#2 (one hunk) | 2.2 | **3.7** | 0.0 | 0.0 | 0.9 | 2.0 | 2.5 | 0.3 | 0.0 | 2195 | 8839 | 4001 | 350 | 79 |
| codex-1 | hunk summary#1 (one hunk) | 1.49 | **4.8** | 0.0 | 0.0 | 0.7 | 3.3 | 3.7 | 0.3 | 0.0 | 1721 | 12510 | 0 | 818 | 91 |
| codex-1 | hunk summary#2 (one hunk) | 1.61 | **3.5** | 0.0 | 0.0 | 0.8 | 2.1 | 2.5 | 0.3 | 0.0 | 2195 | 9004 | 3980 | 373 | 80 |
| claude-forkmeta-1 | hunk summary#1 (one hunk) | 1.46 | **5.0** | 0.0 | 0.0 | 0.7 | 3.5 | 4.0 | 0.3 | 0.0 | 1721 | 8839 | 3528 | 811 | 94 |
| claude-forkmeta-1 | hunk summary#2 (one hunk) | 1.39 | **3.8** | 0.0 | 0.0 | 0.8 | 2.3 | 2.7 | 0.3 | 0.0 | 2195 | 8839 | 4002 | 340 | 85 |

## Fold all (8 hunks, cap 4 per provider)

| run | load | first summary | half | all | queue wait of the second wave | per job: set-up | first text | turn |
|---|---|---|---|---|---|---|---|---|
| claude-1 | 1.77 | 4.0 | 5.1 | 9.1 | 4.1 (3.9–4.9, n=4) | 0.8 (0.7–0.8, n=8) | 2.5 (2.2–3.7, n=8) | 2.9 (2.4–3.9, n=8) |
| claude-2 | 2.03 | 3.8 | 5.0 | 11.1 | 4.1 (3.7–4.9, n=4) | 1.0 (0.8–1.1, n=8) | 2.7 (1.9–4.4, n=8) | 3.1 (2.4–4.9, n=8) |
| codex-1 | 2.52 | 3.8 | 5.3 | 8.7 | 4.4 (3.8–5.2, n=4) | 0.8 (0.7–0.9, n=8) | 2.4 (1.8–3.7, n=8) | 2.8 (2.3–4.1, n=8) |
| claude-forkmeta-1 | 1.28 | 3.6 | 4.2 | 7.9 | 4.0 (3.6–4.1, n=4) | 0.8 (0.7–0.8, n=8) | 2.4 (1.6–2.8, n=8) | 2.8 (2.0–3.1, n=8) |

## Explain: summary by condition (job only, excludes the base build)

| condition | click → done | job total | first text | turn | cache read | cache write + uncached |
|---|---|---|---|---|---|---|
| Claude, as shipped | 19.7 (11.6–24.6, n=10) | 17.7 (11.6–24.3, n=10) | 9.3 (3.1–22.6, n=10) | 16.1 (9.0–23.0, n=10) | 18933 | 33018 |
| Claude, fork experiment | 16.1 (12.4–17.6, n=5) | 13.9 (12.3–16.2, n=5) | 5.2 (4.2–7.5, n=5) | 11.4 (11.1–13.9, n=5) | 20878 | 5690 |
| Claude, fork experiment + effort high (set explicitly) | 29.1 (26.5–30.5, n=3) | 27.0 (26.5–30.4, n=3) | 24.1 (18.6–28.8, n=3) | 25.8 (25.3–29.2, n=3) | 38511 | 6334 |
| Claude, fork experiment + effort medium | 15.4 (13.1–20.5, n=3) | 15.4 (13.0–20.4, n=3) | 7.0 (3.5–8.7, n=3) | 14.2 (11.6–18.5, n=3) | 25173 | 3709 |
| Claude, fork experiment + effort low | 17.2 (14.0–20.4, n=2) | 17.1 (13.9–20.3, n=2) | 8.7 (5.7–11.7, n=2) | 15.9 (12.7–19.1, n=2) | 27696 | 3393 |
| Codex, as shipped | 22.2 (10.7–27.7, n=5) | 18.9 (10.7–22.2, n=5) | 12.4 (5.1–13.7, n=5) | 18.4 (10.2–21.8, n=5) | 13056 | 19972 |
| Codex, fork experiment | 20.4 (6.8–31.6, n=4) | 18.4 (6.8–31.5, n=4) | 8.5 (4.9–14.5, n=4) | 17.9 (6.3–31.1, n=4) | 29568 | 24604 |

## Base builds (every one in every run)

| run | pack chars | seconds |
|---|---|---|
| claude-1 | 17081 | 2.1 |
| claude-1 | 23750 | 2.3 |
| claude-1 | 27433 | 2.2 |
| claude-2 | 13349 | 2.6 |
| claude-2 | 17986 | 2.0 |
| claude-2 | 26649 | 2.6 |
| claude-2 | 30439 | 2.5 |
| claude-forkmeta-1 | 17484 | 3.0 |
| claude-forkmeta-1 | 24657 | 2.2 |
| claude-forkmeta-1 | 28444 | 2.1 |
| claude-effort-1 | 18258 | 2.4 |
| claude-effort-1 | 26006 | 2.0 |
| codex-1 | 15957 | 5.2 |
| codex-1 | 16389 | 5.6 |
| codex-1 | 19299 | 5.6 |
| codex-forkmeta-1 | 17641 | 4.6 |
| codex-forkmeta-1 | 18088 | 3.9 |

## Tokens per run

| run | model | turns | uncached input | cache read | cache write | output | est. $ |
|---|---|---|---|---|---|---|---|
| claude-1 | claude/opus | 18 | 19580 | 529956 | 458181 | 31127 | 3.10 |
| claude-1 | claude/haiku | 18 | 36024 | 166029 | 61855 | 8817 | 0.02 |
| claude-2 | claude/opus | 19 | 41372 | 777372 | 432589 | 32648 | 3.14 |
| claude-2 | claude/haiku | 18 | 36037 | 174827 | 52820 | 8930 | 0.02 |
| claude-forkmeta-1 | claude/opus | 18 | 28444 | 503573 | 140707 | 28246 | 1.48 |
| claude-forkmeta-1 | claude/haiku | 18 | 36037 | 174832 | 52833 | 8674 | 0.02 |
| claude-effort-1 | claude/opus | 19 | 19000 | 584191 | 114239 | 36327 | 1.49 |
| claude-effort-1 | claude/haiku | 8 | 16082 | 80732 | 33298 | 3457 | 0.01 |
| codex-1 | codex/gpt-6.1-sol | 17 | 295485 | 490240 | 0 | 13367 | 1.71 |
| codex-1 | claude/haiku | 18 | 36024 | 173338 | 56888 | 8503 | 0.02 |
| codex-forkmeta-1 | codex/gpt-6.1-sol | 11 | 224875 | 356992 | 0 | 10422 | 1.27 |
| codex-forkmeta-1 | claude/haiku | 8 | 14361 | 61780 | 40644 | 3474 | 0.01 |

Total: $12.27

## Our own code per flow (claude-1)

| flow | snapshot reads | ms | snapshot writes | ms | snapshot bytes |
|---|---|---|---|---|---|
| open#1 | 82 | 28 | 44 | 227 | 51632 |
| explain#1 (first on review) | 16 | 11 | 8 | 53 | 53973 |
| explain#2 | 16 | 11 | 8 | 41 | 58073 |
| explain#3 | 16 | 10 | 8 | 39 | 62829 |
| ask (new thread on a card) | 16 | 11 | 6 | 29 | 66796 |
| reply#1 (existing thread) | 12 | 7 | 4 | 19 | 68278 |
| reply#2 (existing thread) | 12 | 8 | 4 | 19 | 69188 |
| generate (Go deeper placeholder) | 13 | 9 | 4 | 22 | 75093 |
| explain#4 (right after generate) | 16 | 14 | 9 | 48 | 79011 |
| explain#5 | 16 | 12 | 8 | 52 | 84020 |
| depth + (deeper) on the first card | 12 | 10 | 3 | 23 | 89614 |
| hunk summary#1 (one hunk) | 6 | 6 | 3 | 68 | 89741 |
| hunk summary#2 (one hunk) | 6 | 4 | 3 | 56 | 89688 |
| fold all (8 hunks) | 45 | 35 | 22 | 148 | 89555 |
