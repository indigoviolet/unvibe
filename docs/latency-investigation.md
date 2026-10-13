# Latency investigation (issue #114)

Question: what can we easily do to cut latency, other than a smaller model or fast mode?

Date: 2026-10-13. Branch: `spike/latency` (cut from `main-rc`). Nothing here is on `main`.

## Short answer

1. **Forks of the base session never read the base from the provider's prompt cache.** On Claude the cause is found and a three-line change fixes it: Explain drops from 17.7 s to 13.9 s (median, job only) and a whole review session costs half as much. On Codex forks miss the cache too; the cause is not found yet.
2. **Almost all the remaining time is the model working**, not our code. With zero provider time (replay mode) an Explain takes 0.2 s end to end. Live it takes 12 to 25 s, of which 4 to 13 s is thinking before the first word and 6 to 9 s is writing about 500 words.
3. **Several fixed waits of 0.3 to 5.6 s sit in our own code path** and are cheap to remove: a base rebuild before the first Explain and after every Generate, the hunk pass waiting for the reader, bookkeeping that holds a finished answer, a fixed 300 ms sleep per turn, and ingest fetching three times in a row.
4. **Re-using idle sessions does not pay.** Starting a fork is 0.9 s on Claude and 0.1 s on Codex, out of 12 to 25 s.

## How it was measured

- Harness: `spikes/latency/run.mjs` starts the built service on its own port with a temporary data dir, opens one PR, and drives each flow the way the web app does (one HTTP call per click, a WebSocket that applies snapshot patches). "Visible" is when the patch that makes the thing true arrives at the client. Browser render time is not included.
- Timing marks: `packages/service/src/spike/timing.ts`, written only when `UNVIBE_SPIKE_TIMING` is set. Every mark in product code carries a `SPIKE(#114)` comment.
- PR: `urllib3/urllib3#5020` (the demo fixture's source PR): 4 files, 8 hunks. The base context is 17 to 30 thousand characters, about 20 thousand tokens with the system prompt. This is a small PR.
- Models: the defaults a fresh install picks. Claude runs: main `opus` (Opus 5.5), small `haiku` (Haiku 5.5). Codex runs: main `gpt-6.1-sol`, small `haiku`.
- Runs: six live (two Claude as shipped, one Claude with the fork experiment, one Claude effort sweep, one Codex as shipped, one Codex with the fork experiment), one replay. Each run opens the PR once. That gives 4 Claude opens, 2 Codex opens, 10 Claude Explains as shipped, 5 with the fix, 5 Codex Explains as shipped.
- Machine load (`uptime`, 16 cores) was between 0.2 and 13 during the runs and is in every table. The run under the heaviest load (`claude-2`, load 8 to 13 during the open) reached its first card in 22.0 s against 21.4 to 27.5 s for the quiet runs: the flows are dominated by waiting on the provider and are not sensitive to our CPU load at this PR size.

Everything in the tables below is measured live unless a line says "replay", "synthetic" or "from code reading". Full tables: `spikes/latency/summary.md`. Raw data per run: `spikes/latency/raw/<run>/` (`timing.jsonl`, `flows.json`, `jobs-1.json`).

## 1. Where the time goes

All times are seconds from the click.

### Open a PR

| run | load | ingest done | first card | guide complete (reader done) | first hunk summary | hunk pass done | first finding | everything idle |
|---|---|---|---|---|---|---|---|---|
| claude-1 | 6.5 | 7.5 | 21.4 | 38.8 | 44.7 | 63.8 | 128.6 | 133.3 |
| claude-2 | 8.1 | 7.9 | 22.0 | 44.3 | 50.2 | 71.8 | 130.4 | 152.3 |
| claude-forkmeta-1 | 1.3 | 7.9 | 23.2 | 42.4 | 46.0 | 68.8 | 113.2 | 134.4 |
| claude-effort-1 | 1.8 | 7.9 | 27.5 | 51.2 | 55.8 | 81.7 | 135.1 | 140.0 |
| codex-1 | 1.6 | 8.0 | 54.7 | 123.9 | 126.4 | 133.2 | 160.8 | 174.1 |
| codex-forkmeta-1 | 3.7 | 7.7 | 74.0 | 151.5 | 154.6 | 159.8 | 202.2 | 202.5 |

Stages to the first card (claude-1; the other Claude runs are within 1 s per stage except the model's own time):

| stage | seconds | note |
|---|---|---|
| HTTP `POST /api/reviews` | 0.02 | answers 202 at once (#92) |
| `git fetch origin` | 0.96 | |
| `gh pr view` | 1.10 | starts after the fetch ends |
| `git fetch origin refs/pull/5020/head` | 1.60 | |
| `git fetch origin main` | 0.95 | third fetch in a row |
| `git diff` | 1.15 | includes lazy blob downloads: the harness used a blob-less managed clone |
| `git worktree add` | 1.64 | same caveat |
| snapshot write + patch | 0.01 | |
| queue wait | 0.00 | |
| reader `session/new` + set model | 0.91 | Claude. Codex: 0.1 |
| reader turn until its first tool call | 1.6 | |
| 6 `search_review` calls + 1 file read | 2.3 | the prompt tells the reader to fetch description IDs this way |
| thinking and writing until the first card is complete | 9.0 | |
| patch reaches the client | 0.04 | |
| **first card** | **21.4** | |

After the first card:

- The second card and the Go deeper placeholders appear only when the reader ends (38.8 s). A card shows when the next `## ` heading or the trailing JSON arrives, and the second card is the last one.
- The hunk pass is enqueued only when the reader ends. On Claude it then shares the cap of 4 sessions per provider with two critics and the concept job, so it runs one or two hunks at a time: jobs waited up to 21 to 26 s in the queue. Each job runs 3.5 to 4.4 s.
- The critics take 71 to 108 s each (5 to 12 tool calls, 58 to 81 s before the first word). They are the last thing to finish.
- Codex: the reader ran a second, citation-repair turn in both opens (34 s in `codex-1`). Nothing downstream starts until it ends.

### Explain

| condition | click to done | job only | first word (inside the turn) | turn | cached input read | input written or uncached |
|---|---|---|---|---|---|---|
| Claude, as shipped | 19.7 (11.6–24.6, n=10) | 17.7 (11.6–24.3) | 9.3 (3.1–22.6) | 16.1 (9.0–23.0) | 18,933 | 33,018 |
| Claude, fork experiment | 16.1 (12.4–17.6, n=5) | 13.9 (12.3–16.2) | 5.2 (4.2–7.5) | 11.4 (11.1–13.9) | 20,878 | 5,690 |
| Codex, as shipped | 22.2 (10.7–27.7, n=5) | 18.9 (10.7–22.2) | 12.4 (5.1–13.7) | 18.4 (10.2–21.8) | 13,056 | 19,972 |
| Codex, fork experiment | 20.4 (6.8–31.6, n=4) | 18.4 (6.8–31.5) | 8.5 (4.9–14.5) | 17.9 (6.3–31.1) | 29,568 | 24,604 |

Median (min–max). Token columns are means per Explain.

Stages of one Explain (Claude as shipped, medians over 10; Codex in brackets where it differs):

| stage | seconds | note |
|---|---|---|
| HTTP handling, working state visible | 0.01–0.05 | the "Thinking…" patch arrives 8 to 45 ms after the click |
| base rebuild before the job is enqueued | 0 or 2.0–3.0 (Codex 3.9–5.6) | on the first Explain of a review and on the first action after each Generate. The HTTP response waits for it |
| queue wait | 0.0 | in every action measured, including an Explain fired while the pipeline was running |
| fork: `session/fork` + `session/resume` + set model | 0.9 (Codex 0.1) | `resume` is 0.75 to 1.1 s of it |
| turn until the first word | 9.3 (Codex 12.4) | hidden thinking: more than half of an Explain's output tokens are never shown |
| writing the answer | 6 to 9 | 400 to 600 visible tokens |
| fixed grace sleep | 0.3 | |
| validation and parse | 0.001 | no repair turn in any Explain |
| bookkeeping before the result is applied | 0.007, or 0.7–3.7 | in 9 of 42 fork turns it appended the log to the base session first |
| snapshot write and patch | 0.005 | |

The owner's observation that the first Explain is slower is the base rebuild: +2.0 to 3.0 s on Claude, +3.9 to 5.6 s on Codex, on this small PR. It recurs after every action that changes the guide.

The first content of an Explain reaches the screen 0.4 s before it is done: the text streams from the provider for 6 to 9 s and is not shown (decided in #46).

### Ask and reply

| flow | Claude | Codex |
|---|---|---|
| Ask, new thread | 9.8, 10.7 (n=2); first word at 5.5 to 6.2 s in the turn | 9.6 (n=1) |
| Reply in the thread | 3.5, 3.6, 4.1, 5.0 (n=4); first word at 1.1 to 1.2 s in the turn | 4.0, 14.8 (n=2) |

A reply runs on the thread's own session and reads its whole context from the cache (32,400 tokens read, 0 written), which is why its first word comes after 1.1 s instead of 5 to 9 s. Before a reply's turn starts, the service spends 0.6 to 0.8 s: two `session/load` round-trips, each followed by a fixed 300 ms sleep, one of them on the HTTP request (the response takes 0.34 s). The reply text is collected whole and then re-chunked, so nothing streams.

### Generate (Go deeper) and depth

| flow | Claude | Codex |
|---|---|---|
| Generate on a placeholder | 27.0, 25.1; with the fork experiment 24.9 | 44.8 (n=1) |
| Depth + on a card | 27.0, 19.7; with the fork experiment 19.1 | not measured (the level was already stored) |

Same stages as Explain with a longer answer (750 to 1,200 visible tokens). After Generate the guide has changed, so the next action pays the base rebuild.

### Hunk summary

| flow | seconds | stages |
|---|---|---|
| One hunk | 3.5 to 5.0 (n=8) | `session/new` + set model 0.8, first word 2.0 to 3.5, rest of turn 0.4, grace 0.3 |
| Fold all, 8 hunks | 7.9, 8.7, 9.1, 11.1 (n=4); first summary at 3.6 to 4.0 | two waves of 4: the second wave waits 3.6 to 5.2 s for a slot |

Each summary job starts a new Claude Code session. Its 1,400-character prompt becomes about 12,500 input tokens (Claude Code's own prompt and tools), of which 8,840 are read from the cache.

### Our own code

- Replay mode (recorded sessions, no provider time, demo fixture): open to all idle 2.6 s, Explain 0.20 to 0.22 s, Ask 0.12 s, reply 0.08 to 0.09 s, one hunk summary 0.07 to 0.10 s, Fold all (8) 0.33 s.
- Live, one Explain does 16 snapshot reads (11 ms) and 8 writes (40 to 53 ms) on a 54 to 84 KB snapshot. A whole open does 82 reads and 44 writes in 255 ms.
- HTTP handling of an action: median 51 ms. The slow ones (2.3 to 5.6 s) are the base rebuild.
- Synthetic (`spikes/latency/bench-store.mjs`): the store parses and re-serialises the whole snapshot on every read and write. At 120 hunks (0.5 MB) an Explain costs 0.08 s of blocked event loop; at 450 hunks (2 MB) 0.3 s, and the hunk pass adds 44 s of blocked loop over its run; at 1,600 hunks (7 MB) 1.1 s per Explain.
- Adapter process start: 0.54 to 0.74 s per provider, once per service start. Both adapters start on the first `GET /api/settings` (1.3 to 1.8 s).

## 2. Ranked changes

Savings are for this PR size. "Share" is of the flow's click-to-done time.

### Cheap and safe first

**1. Give Claude forks the same system prompt and tool list as the base.**

- What: `fork()` in `src/agent/acp/runner.ts` calls `session/resume` without `_meta`. The adapter then builds the resumed session with the default Claude Code system prompt and the full default tool set, not the Unvibe instructions and the read-only tools that `session/new` got (`createSession` in `claude-agent-acp` 0.89.0 reads the prompt from `params._meta`). The prompt cache is a prefix match starting at tools and system prompt, so the fork shares nothing with the base beyond Claude Code's generic prefix. The same is true of `session/load` and the resume-on-error path in `prompt()`.
- Evidence: as shipped every fork reads 10,115 tokens (the generic prefix) and writes 31 to 37 thousand. With `_meta` passed on resume (`UNVIBE_SPIKE_FORK_META=1`) a fork reads 20,278 and writes 4 to 7 thousand.
- Saving: Explain job 17.7 s to 13.9 s median (3.8 s, 21 %). First word 9.3 s to 5.2 s. Opus tokens for a whole session at list price $3.10 and $3.14 to $1.48 (53 %). The Explain ranges overlap (11.6–24.3 against 12.3–16.2), so treat the seconds as "about 4" until more runs confirm.
- Side effects to check: forks will now follow the Unvibe instructions and lose Bash, Edit and the rest, which is what was intended. In one shipped run the critics called `Terminal` three times. Pass the same `_meta` on `session/load` too: with only resume fixed, the first thread reply rewrote 28,901 tokens of cache instead of reading them.
- Effort: a few lines in one file plus a live pipeline check. Risk: low to medium, because fork output will change.

**2. Build the base before the click, and enqueue the job before the base.**

- What: the base is keyed by a hash of the guide, so every guide change (findings landing, concept stubs, Generate, depth) makes the next action build a new base. `runInFork` awaits that build before it enqueues the job, so the HTTP response waits too. Kick off the build in the background when a guide-changing job settles, and enqueue first.
- Saving: 2.0 to 3.0 s on Claude (12 builds), 3.9 to 5.6 s on Codex (5 builds), on the first Explain and the first action after each Generate: 10 to 25 % of those actions. It grows with the PR, since the whole pack is sent as one turn. On a PR where the build passes 10 s the response returns without a job id (`captureJobId` gives up).
- Effort: small, `src/pipeline/runner.ts`. Risk: low. Each build writes about 20 thousand tokens, so builds for guide states nobody acts on cost tokens: debounce it.

**3. Apply the result before the post-turn bookkeeping.**

- What: `runInFork` awaits `ingestTurn` before it resolves the result. When the shared log has a batch ready, that sends a whole turn to the base session first.
- Saving: 0.7 to 3.7 s in 9 of 42 fork turns (the five log appends took 1.4, 1.4, 3.3, 3.7, 3.7 s). Zero the rest of the time.
- Effort: reorder two awaits in `src/pipeline/runner.ts` (and the same in `ask.ts` for replies). Risk: low. Tests that expect contributions stored before the result need a look.

**4. Remove the fixed 300 ms sleep after every turn, and after every `load`.**

- What: `prompt()` sleeps 300 ms after the provider's response for late notifications. `load()` sleeps 300 ms to drain history.
- Saving: 0.3 s per job (7 % of a hunk summary, 2 % of an Explain). 0.6 s per reply plus 0.3 s on its HTTP response (15 % of a 4 s reply). A base build pays it once.
- Effort: small, `src/agent/acp/runner.ts`. Risk: low to medium. The sleep exists because text chunks can arrive after the response; replace it with "wait until quiet for 20 ms" and verify on both adapters.

**5. Put the description paragraph IDs in the reader prompt (#110).**

- What: `prompts/reader.md` tells the reader to fetch `desc:` IDs with `search_review`. Claude made 6 such calls in each of 4 opens, Codex 8 plus 3 `get_code`.
- Saving: about 2 s to the first card on Claude (the tool phase is 2.3 s of 21.4 s, 10 %).
- Effort: small, context builder and prompt. Risk: low.

**6. Ingest: one fetch, and `gh pr view` in parallel.**

- What: `git fetch origin`, `gh pr view`, `git fetch origin refs/pull/N/head`, `git fetch origin <base>` run one after another: 4.6 s.
- Saving: 2 to 3 s to the first card (10 to 13 %): one fetch with both refspecs after `gh pr view`, or `gh pr view` alongside the first fetch.
- Effort: small, `src/ingest/`. Risk: low. Keep the branch-name fallback and the stacked-PR merge-base order.

### Worth doing, more to think about

**7. Start the hunk pass when ingest ends.**

- What: the hunk pass needs only the diff, but it is enqueued after the reader, and on a Claude-only setup it then queues behind the critics.
- Saving: first hunk summary at about 12 s instead of 45 to 56 s on Claude and 126 to 155 s with Codex as main. All 8 hunks by about 16 s instead of 64 to 82 s.
- Effort: medium. The hunk prompt carries a "cited by the guide" hint that does not exist yet at ingest, so a hunk hidden early and cited later must be unhidden when the reader ends. Risk: medium. It also puts 4 small-model sessions next to the reader on the same provider.

**8. Let small-model jobs run more than 4 at a time.**

- What: `sessionsPerProvider` is 4 and covers main and small jobs together. Fold all runs in waves of 4.
- Saving, inferred from the queue waits, not measured at a higher cap: Fold all on 8 hunks about 4 to 5 s instead of 8 to 11 s. For N hunks today the time is roughly N/4 × 4 s.
- Effort: small (a separate cap for small jobs). Risk: provider rate limits at higher concurrency were not tested.

**9. Show Explain and Ask text paragraph by paragraph.**

- What: the answer streams for 6 to 9 s and is shown at the end. #46 decided against showing raw stream text. Completed paragraphs are a middle ground: the partial-parse path already exists for cards.
- Saving: no change to done; first content about 6 to 8 s earlier (at 6 to 10 s after the click instead of 12 to 20 s).
- Effort: medium (parser and UI). Needs an owner decision because of #46.

**10. Codex: find out why forks miss the cache, and what the reader's repair turn repairs.**

- Forks send 21 thousand tokens uncached every time and read only 11,008. Passing the MCP servers on fork (the experiment) did not change it (n=4). Cause unknown.
- The reader ran a repair turn in 2 of 2 opens: 34 s in one, during which the base, critics and hunk pass wait. Claude ran none in 4 opens and 42 fork turns. The harness did not record which citations failed.
- From code reading: `fork()` sends no `mcpServers`, and `codex-acp` 2.2.2 builds a fork's config from `request.mcpServers ?? []`, so Codex forks have no Unvibe MCP server. No fork tried an MCP call in any run, so this was not observed live. It may explain #51.

## 3. What does not matter

- **Re-using or pre-warming sessions for main-model work.** A fork costs 0.9 s on Claude (the `resume`) and 0.1 s on Codex, out of 12 to 25 s. Pre-forking one session while idle would save under 1 s per action on Claude only. Sharing a session between unrelated jobs would break isolation for no further gain. Recommendation for the original question in #114: do nothing here. Provider caching gives the benefit once forks actually hit it (change 1).
- **A pool of warm small-model sessions.** `session/new` is 0.7 to 0.9 s of a 3.5 to 5.0 s hunk summary (20 %). It is the only place pre-warming buys something, and each idle session is a live CLI process. Lower value than changes 7 and 8; not proposed.
- **Adapter and CLI process start.** 0.54 to 0.74 s per provider, once per service start.
- **The model-listing probe behind "effective settings".** 234 calls on the job path: median 0.4 ms, max 18 ms. The listing is cached for 5 minutes; a cold probe is one `session/new` per provider (0.7 s, both at once). So at most 0.7 s on the first action after 5 idle minutes (inferred, not caught in a run).
- **Queue wait for user actions.** at most 8 ms in all 54 user-action jobs, including an Explain fired while the pipeline was running.
- **Retries and back-off.** None in any run: 0 back-offs, 0 inner retries, 0 fork fallbacks, 0 failed jobs.
- **Repair turns on Claude.** None.
- **MCP round-trips in forks.** No fork called an MCP tool in any run. Only the reader does (change 5). The MCP server answers a call in 1 to 3 ms.
- **Validation, snapshot writes, WebSocket.** Parse and validation 1 ms. Snapshot writes 5 ms each. A patch reaches the client in the same millisecond bucket it is written. Job events carry the full prompt each time (172 KB over 72 events in one open) and 120 to 235 KB of text deltas are sent and dropped by the client; on loopback neither showed up in any timing.
- **Our CPU on the request path**, below a few hundred hunks (see the synthetic numbers above; relevant to #107, not to this PR size).
- **Reasoning effort.** Sessions start at the CLI's default. Setting `low` on forks did not speed up Explain: 14.0 and 20.4 s against 13.1, 15.4 and 20.5 s at `medium` (the default behaves like `medium`). Ask was 5.3 s at `low` against 9.0 s at `medium`, one sample each. Setting `high` explicitly doubled Explain (26.5 to 30.5 s). Do not raise it; lowering it is not a clear win.

## 4. Proposed follow-up issues

1. **Claude forks lose the system prompt and tool lockdown (and the prompt cache).** Pass `_meta` (system prompt, read-only tool options) on `session/resume` and `session/load` in `src/agent/acp/runner.ts`. Measured: Explain 17.7 to 13.9 s, Opus spend per session halved. Verify fork output with a live pipeline run; add a live test that a fork's cache-read tokens exceed the base pack.
2. **Build the base ahead of the next action.** Start `ensureBase` when a guide-changing job settles (debounced), and enqueue the job before awaiting the base in `runInFork`. Saves 2 to 5.6 s on the first Explain and after each Generate; removes the 10 s job-id timeout risk on large PRs.
3. **Do not hold a finished answer behind bookkeeping.** Resolve the result before `ingestTurn` / log growth in `runInFork` and the reply path. Saves 0.7 to 3.7 s in about one fork turn in five.
4. **Replace the fixed 300 ms sleeps in the ACP runner.** After a turn and after `load`: wait until notifications are quiet. Saves 0.3 s per job and 0.9 s per thread reply.
5. **Reader prompt carries description IDs (#110).** Remove the `search_review` round-trips at the start of every reader turn. About 2 s to the first card.
6. **Ingest fetches once.** One `git fetch` with both refspecs, `gh pr view` in parallel. 2 to 3 s to the first card.
7. **Hunk pass starts at ingest, with its own concurrency cap.** First hunk summary at about 12 s instead of 45 to 155 s; Fold all about twice as fast. Needs the unhide-when-cited pass and a check against provider rate limits.
8. **Codex forks: cache miss and missing MCP servers.** Find why forks send 21 thousand tokens uncached; pass `mcpServers` on `session/fork`; check against #51.
9. **Codex reader repair turn.** Log which citations fail; repair without re-sending the guide, or start the base and hunk pass before the repair. 34 s per open today.
10. **The cache-hit rate the app shows counts cache writes as hits.** `AgentEvent.cachedTokens` is read plus write, so `claude-1` showed 96 % while the real read share for Opus was 53 %. Split the two so this regression would have been visible.
11. **Decision for the owner: show Explain and Ask answers paragraph by paragraph** (revisits #46). First content 6 to 8 s earlier, done time unchanged.

## 5. Cost, and what was not measured

Tokens by run (every turn, including base builds and log appends):

| run | model | turns | uncached input | cache read | cache write | output | list price |
|---|---|---|---|---|---|---|---|
| claude-1 | opus | 18 | 19,580 | 529,956 | 458,181 | 31,127 | $3.10 |
| claude-2 | opus | 19 | 41,372 | 777,372 | 432,589 | 32,648 | $3.14 |
| claude-forkmeta-1 | opus | 18 | 28,444 | 503,573 | 140,707 | 28,246 | $1.48 |
| claude-effort-1 | opus | 19 | 19,000 | 584,191 | 114,239 | 36,327 | $1.49 |
| codex-1 | gpt-6.1-sol | 17 | 295,485 | 490,240 | 0 | 13,367 | $1.71 |
| codex-forkmeta-1 | gpt-6.1-sol | 11 | 224,875 | 356,992 | 0 | 10,422 | $1.27 |
| all six | haiku | 88 | 174,565 | 831,538 | 298,338 | 41,855 | $0.08 |

Total: about **$12.27** at API list prices. The runs used the CLI logins on this machine, so this is the equivalent, not a bill. Prices used: Opus 5.5 $4 in, $0.20 cache read, $5 cache write, $20 out per million tokens; Haiku 5.5 $0.10 in, $0.50 out, with cache read assumed at 0.1× and write at 1.25×; gpt-6.1-sol $2 in, $10 out from third-party price listings, with cached input priced as uncached because no cached rate was found, so the Codex figures are an upper bound.

Not measured:

- Browser render after a patch arrives. The harness is a WebSocket client, not a browser.
- A large PR, live. The size effects (base build time, store cost) are from the pack size trend and a synthetic benchmark.
- A higher concurrency cap, and provider rate limits at it.
- The first action after more than 5 idle minutes (cache expiry and the model-listing probe).
- Codex as the small model, second opinion, the update pass after new commits, diagrams.
- Why Codex forks miss the cache, and which citations the Codex reader repairs.
- macOS.
- Whether the fork fix changes answer quality. It changes what forks are told, so it needs a read of real output, not just a timing.

## Reproduce

```sh
mise run build
node spikes/latency/run.mjs --provider claude --label my-run --port 4611          # full plan, spends tokens
UNVIBE_SPIKE_FORK_META=1 node spikes/latency/run.mjs --provider claude --label my-fix --port 4611
node spikes/latency/run.mjs --provider codex --main gpt-6.1-sol --label my-codex --port 4612
node spikes/latency/run.mjs --replay --label my-replay --port 4613               # no tokens
node spikes/latency/analyze.mjs my-run        # per-flow stage tables
node spikes/latency/summary.mjs               # the tables in summary.md (edit LABELS)
node spikes/latency/bench-store.mjs           # synthetic store cost
```

The experiment switches (`UNVIBE_SPIKE_FORK_META`, `UNVIBE_SPIKE_EFFORT_FILE`) are off unless set and exist only on this branch.
