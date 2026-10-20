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

## 1b. Cache-key follow-up: why forks miss, and the ephemeral-fork test

Added 2026-10-20 on this branch (owner-approved check of the routing-key hypothesis). Sources are the public upstreams at the exact installed versions: Codex `rust-v0.162.1` (commit `092d3acd6bec3e3a14bdc7e7a2810ab628ab759d`, matching `codex-cli 0.162.1` on this machine) and `@agentclientprotocol/codex-acp` v2.2.2 (commit `202e66e63343ec4f5a5e35ab590251d813d129ca`, the adapter our service launches via `CODEX_PATH` → `codex app-server`).

### How `prompt_cache_key` is derived (hypothesis confirmed, with one refinement)

- Every Responses request sets `prompt_cache_key = Some(self.prompt_cache_key(responses_metadata))` ([client.rs:978](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/client.rs#L978)). The derivation, in priority order ([client.rs:581-592](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/client.rs#L581-L592)):
  1. an explicit `prompt_cache_key_override` on the `ModelClient`, if set;
  2. for internal sub-agents (`SessionSource::Internal`) with a parent thread, `"{source}:{parent_thread_id}"`;
  3. otherwise `responses_metadata.session_id`.
- For a root thread, `session_id` **is** the thread ID: `SessionId::from(thread_id)` ([session.rs:932-938](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/session/session.rs#L932-L938)). So the owner's phrasing ("from the conversation/thread ID") is effectively right at this version; the code names it session ID. The same value also goes out as the Responses session-id header for root sessions ([client.rs:597-604](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/client.rs#L597-L604)), so header- and body-based affinity agree.
- A fork mints a **new** thread ID ([session.rs:875-885](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/session/session.rs#L875-L885): `InitialHistory::Forked` with no reserved ID calls `generate_thread_id()`), hence a new session ID and a new routing key. That is the whole mechanism: identical prefix bytes, different `prompt_cache_key`, likely a different cache machine. Codex's generic ~11k prefix is shared by every Codex user, so it is warm on every machine — which fits it hitting on all 12 baseline turns while the pack hit only 2/10.

### The one exception: ephemeral forks keep the parent's key

- `ModelClient.prompt_cache_key_override` is written in exactly one place, `Session::new` via `with_session_context` ([session.rs:1793-1800](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/session/session.rs#L1793-L1800)), from two sources: Guardian review sessions (`guardian:{parent_thread_id}`, [review_session.rs:286-297](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/guardian/review_session.rs#L286-L297) — Guardian-only), or `fork_cache_key`.
- `fork_cache_key` is the parent rollout's stored `session_id`, and it is computed **only** when the forked session's config is ephemeral ([session.rs:901-915](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/session/session.rs#L901-L915), comment: "Ephemeral forks reuse cache routing, without sharing storage or lifecycle identity"). Ephemerality arrives per-thread through the app-server API: `ThreadForkParams.ephemeral` ([thread.rs:610](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L610); `ThreadStartParams.ephemeral` at [thread.rs:115](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L115)), applied as `typesafe_overrides.ephemeral = ephemeral.then_some(true)` ([thread_processor.rs:5031](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_processor.rs#L5031)). So "one key per review" needs no key management at all: ephemeral forks of one base automatically share the base's key, and different reviews (different bases) get different keys.

### No other override exists at these versions

- **No `CODEX_PROMPT_CACHE_KEY`.** Zero occurrences in `codex-rs` core/config/app-server/protocol or in the codex-acp source (the adapter reads only `CODEX_API_KEY`, `CODEX_CONFIG`, `CODEX_HOME`, `CODEX_PATH` and its own crash-limit vars); the installed binary's strings contain the Responses field name `prompt_cache_key` only, no such env var. The third-party guide's claim does not hold for 0.162.1.
- **No config.toml key.** `Config`/`ConfigToml` have no prompt-cache field (config schema has no cache-key entry), and nothing outside the Guardian/ephemeral paths above ever sets the override. The per-thread `config` override map on `thread/fork` cannot reach it either — there is no config field to set.
- **No ACP/session parameter.** codex-acp v2.2.2's fork calls `threadFork({ excludeTurns: true, config, cwd, modelProvider, threadId })` with **no `ephemeral`** ([SessionFork.ts:39-46](https://github.com/agentclientprotocol/codex-acp/blob/v2.2.2/src/SessionFork.ts#L39-L46)), and its new-session calls `threadStart` likewise ([CodexAcpClient.ts:797-802](https://github.com/agentclientprotocol/codex-acp/blob/v2.2.2/src/CodexAcpClient.ts#L797-L802)). ACP `session/fork` has no ephemeral field and the adapter drops unknown `_meta` (it reads only the AIR custom-instructions and fork-point keys, both of which our runner already sends). So as shipped, our stack **cannot** reach the ephemeral path: it needs an adapter change, not a client change. Upstream knows the general gap — [openai/codex#21796](https://github.com/openai/codex/issues/21796) asks for stable prompt-cache keys across app-server sessions.

### Step 2: direct fork test with forks sharing the base's key

To test the override anyway, the spike locally patched the installed adapter bundle (node_modules only, never committed; patch + rationale in [adapter-ephemeral-fork.patch.md](/home/venky/.paseo/worktrees/20ucjyap/spike-124-cache-key/spikes/124-remeasure/adapter-ephemeral-fork.patch.md)) to send `ephemeral: true` on `thread/fork` when `UNVIBE_CODEX_FORK_EPHEMERAL=1`, then re-ran the same direct test (`mise run test:live:124-fork-cache`, `gpt-5.6-terra`, 2 runs × base + 5 forks, sequential, well under the ~15 requests/min per key+prefix guidance):

| Run | Turn | Uncached in | Cache read | Out |
|---|---|---|---|---|
| eph-1 | base | 9,005 | 11,008 | 5 |
| eph-1 | fork 1 | 853 | 19,200 | 16 |
| eph-1 | fork 2 | 848 | 19,200 | 15 |
| eph-1 | fork 3 | 848 | 19,200 | 46 |
| eph-1 | fork 4 | 847 | 19,200 | 8 |
| eph-1 | fork 5 | 9,042 | 11,008 | 15 |
| eph-2 | base | 8,997 | 11,008 | 5 |
| eph-2 | fork 1 | 845 | 19,200 | 8 |
| eph-2 | fork 2 | 840 | 19,200 | 41 |
| eph-2 | fork 3 | 840 | 19,200 | 45 |
| eph-2 | fork 4 | 839 | 19,200 | 8 |
| eph-2 | fork 5 | 842 | 19,200 | 15 |

- **9 of 10 forks hit** (uncached 839–853, cache read 19,200), against **2 of 10** for the identical non-ephemeral test above. The single miss (eph-1 fork 5, 9,042 uncached) shows the shared key is not a guarantee — provider placement/eviction still has the last word — but the rate flips from intermittent to usual.
- Cost of step 2: upper bound (cached priced as uncached) $0.242 + $0.242 = **$0.48**, inside the $0.50 hard cap; cached-discounted (reads at 0.1×) $0.064 + $0.049 = **$0.11**. Counted per turn from the test's usage lines as the runs went; no full-pipeline opens, no background critics.
- Saving per fork turn when it hits: ~8.2k fewer uncached tokens on this small pack (~$0.016 list, ~$0.015 discounted); on a real ~20k pack the baseline miss was ~21k, so ~$0.04 list per fork turn. Latency again did not separate (hits 2.5–3.8 s, the one miss 2.9 s): the saving is tokens, not seconds.

### What production would need

Not a Unvibe-side key to invent: make Codex forks **ephemeral** so Codex itself reuses the base's key (one key per review falls out of the base's thread ID). That means codex-acp must forward an ephemeral option on `thread/fork` (upstream adapter change, or a vendored patch — our ACP runner cannot add it from the client side; `_meta` is ignored for this). Before adopting, check the trade-off: ephemeral threads are not persisted on disk, so a forked session cannot be resumed after the adapter restarts; Unvibe forks are short-lived Explain/Ask turns, but `load`-after-close of a fork would need to fall back to a fresh session. Until the adapter supports it, the recommendation below stands.

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

- **Do not build more on our side today; close the cache half of #124 as provider-side, with monitoring** — refined by §1b: the miss mechanism is now confirmed in Codex source (new `prompt_cache_key` per fork), and the one fix (ephemeral forks sharing the base's key, 9/10 hits in the spike) is blocked on codex-acp forwarding `ephemeral`, which our ACP client cannot supply. Revisit when the adapter exposes it (or Codex answers [openai/codex#21796](https://github.com/openai/codex/issues/21796)); the production change then is "forks are ephemeral" in the adapter/runner, with one key per review falling out of the base thread ID, worth ~8–21k uncached tokens (~$0.02–0.04 list) per fork turn. The request-side causes are fixed (same system prompt/MCP/settings on fork; #174 mount). What remains is intermittent provider cache placement: 8/10 forks re-send ~9–10k uncached on a small pack, which on a real base (~20k pack in the old spike) is the old ~21k symptom at the same rate. Expected saving if Codex makes fork cache placement reliable: ~9–21k uncached tokens per fork turn (~$0.02–0.04 at list, less at cached-discount rates), with no measured latency change at this size. The app already surfaces per-job cache-hit rate, so a future provider fix is visible without new work. Revisit only if Codex documents fork/cache affinity or the hit rate is seen at 0/10 across a bigger sample.

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
