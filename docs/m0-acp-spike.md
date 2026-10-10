# M0 ACP spike: session fork + prefix-cache sharing

**Branch:** `m0-acp-spike` · **Date:** 2026-10-10 · **Spec:** PRD §6, §9, §17 (M0 row)

## Headline answer

**Fork works on both adapters and the forks' input is overwhelmingly served
from cache — but with two adapter-specific caveats:**

| Adapter | Fork works? | Fork input from cache? | Caveat |
|---|---|---|---|
| `@agentclientprotocol/claude-agent-acp` 0.89.0 | ✅ (fresh `sessionId`s, correct answers) | ✅ 87.6% cache-read on first fork turn, 99.7% after | Prompting a fresh fork fails with `Session not found` until `session/resume` is called on the forked id (bug, §Pitfalls-1) |
| `@agentclientprotocol/codex-acp` 2.2.2 | ✅ (fresh `sessionId`s, correct answers) | ✅ 99.3% cache-read on first fork turn | No `_meta.systemPrompt` support (1a FAIL); cross-session (no-fork) caching is short-lived (minutes) |

The PRD's fallback (fresh session, byte-identical first message, §6) **does
produce cache reads on both adapters**, but entries expire within minutes, so
it is only viable against a warm base. **Fork is the primary path; the
fallback needs a "rebuild when cold" trigger** (which PRD §9.4 already has).

## Packages and versions (correct names — PRD §6 names are slightly off)

| Role | Correct package | Version pinned in spike | PRD said | Note |
|---|---|---|---|---|
| ACP client SDK | `@agentclientprotocol/sdk` | **1.8.0** | `@agentclientprotocol/sdk` ✓ | fluent `client()` API; `session/fork` exposed as `unstable_forkSession` / raw `session/fork` |
| Claude adapter | `@agentclientprotocol/claude-agent-acp` | **0.89.0** | `claude-agent-acp` (missing scope) | repo `agentclientprotocol/claude-agent-acp`. The old `@zed-industries/claude-agent-acp` (0.23.1) is stale — do not use |
| Codex adapter | `@agentclientprotocol/codex-acp` | **2.2.2** | `codex-acp` implied `agentclientprotocol/` scope | repo `agentclientprotocol/codex-acp`. ⚠️ bare `codex-acp` on npm (1.10.1) is an unrelated community package (`baldaworks/codex-acp`) — do not use |
| MCP SDK (local test server) | `@modelcontextprotocol/sdk` | 1.18.0 | — | stateless Streamable HTTP, `sessionIdGenerator: undefined` |
| Runner | `tsx` 4.20.5 via mise node v26.10.0 | — | — | |

### How each adapter is launched

Both are plain **stdio subprocesses**, one per Unvibe service (the spike runs
one connection per adapter; the real service will multiplex sessions per
connection):

```
node node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js
node node_modules/@agentclientprotocol/codex-acp/dist/index.js
```

Required env/flags (spike findings):

- `PATH` must resolve the **`claude`** and **`codex`** CLIs — the adapters
  drive the user's existing logins through them (Claude Agent SDK spawns
  `claude`; codex-acp uses its bundled `@openai/codex` + `~/.codex/auth.json`).
  The spike prepends the mise install paths
  (`~/.local/share/mise/installs/claude-code/latest`,
  `~/.local/share/mise/installs/codex/latest/bin`). On macOS these paths
  differ — resolve via `mise which` instead of hard-coding (AGENTS.md rule).
- `NO_BROWSER=1` is safe: with it, codex-acp only advertises the `api-key`
  auth method, but the stored ChatGPT OAuth login is still used — no browser,
  no new credentials, no `CODEX_API_KEY` needed. claude-agent-acp advertised
  `authMethods: []` (already authenticated through the CLI login).
- No other env, flags, or credentials were needed. Nothing was posted
  anywhere; all turns were local + provider API calls on the users' logins.

## Results table

Full run: `spikes/acp/src/spike.ts` (one 32.7k-token pack per adapter per run).
Raw evidence: `spikes/acp/results/claude-1791623618509.json`,
`codex-1791623824662.json` (+ `.log` files with the same basename).

### claude-agent-acp 0.89.0 (model `claude-opus-5-5`, context 1M) — 12/12

| # | Check | Result | Evidence |
|---|---|---|---|
| 0 | smoke/auth | ✅ | `PONG` turn, `stop=end_turn`, no auth errors |
| 1a | custom system prompt (`session/new` `_meta.systemPrompt`, string) | ✅ | asked codename → reply `QUOKKA-7` |
| 1b | HTTP MCP server + tool call | ✅ | server saw `get_hunk("h:sp:abc123")`; agent echoed `HUNK:h:sp:abc123:fixed-content:alpha-bravo-42`. 1 `requestPermission` (`mcp__unvibe-spike__get_hunk`, options `allow_once/allow_always/reject_once`) → allowed once |
| 2 | 32.7k-token pack → `READY` | ✅ | reply `READY` in ~1.6–2 s; cold run wrote cache (`cachedWrite=82685`), warm rerun read it (`cachedRead=82685`) |
| 3 | `session/fork` ×2 | ✅ w/ workaround | fresh UUIDs for both forks; **prompting a fork fails with `Internal error / Session not found` until `session/resume` is called on the forked id** (both forks `needed-resume`) |
| 4 | fork answers (concurrent) | ✅ | fork1: `RETRY_BUDGET_MS is … 4500 … (fact ZK-4177, L0164)`; fork2: `Storage Platform team … (fact ZK-6041, L0655)` — correct fact, id, and line |
| 6 | trailing fenced JSON ×10 | ✅ 10/10 | every reply ended with exactly one ```json block parsing as `{title: string, contribute: {facts: [...]}}`; zero failure modes |
| 7a | `session/load` after close | ✅ | close → load → `BANANA-42` recalled verbatim |
| 7b | `session/cancel` mid-reply | ✅ | first chunk seen, cancel sent, `stopReason=cancelled` |
| 7c | list + select model | ✅ | `configOptions`: `mode` (default/acceptEdits/plan/auto/bypassPermissions), `model` (default=Opus 5.5, opus/fable/sonnet/haiku + dated pins), `effort`, `fast`; `set_config_option model=default` → `current=default` |
| 7d | permission behaviour | info | **1 permission request in the whole run** (the intended `get_hunk` call). Told "no tools", the agent attempted nothing else |
| 8 | no-fork fallback | ✅ | fresh session, byte-identical first message → base turn 100% cache reads; follow-up Q 99.9% reads, answer correct (`900`) |

### codex-acp 2.2.2 (model `gpt-5.6-terra`, context 828400) — 11/12

| # | Check | Result | Evidence |
|---|---|---|---|
| 0 | smoke/auth | ✅ | `PONG`, stored ChatGPT login used, no browser |
| 1a | custom system prompt (`_meta.systemPrompt`) | ❌ | **ignored** — codename question answered `Codex`. No `_meta.systemPrompt` handling exists in the adapter (only a title-generation prompt). System instructions must go in the first user message / base pack |
| 1b | HTTP MCP server + tool call | ✅ | server saw the call; agent echoed the fixed string. **0 permission requests**: MCP tool executed without prompting (`tool_call` title `mcp.unvibe-spike.get_hunk`; a `Guardian Review` tool call also reported) |
| 2 | 32.7k-token pack → `READY` | ✅ | `READY` in ~4 s; `total=59459 in=48446 out=5 cachedRead=11008` (18.5% — only the ~11k stable system/MCP prefix hit; pack was cold) |
| 3 | `session/fork` ×2 | ✅ | fresh UUIDs; **forks prompt directly, no resume needed** (`direct-prompt-ok` ×2) |
| 4 | fork answers (concurrent) | ✅ | `RETRY_BUDGET_MS is 4500 milliseconds.` / `The Storage Platform team owns the shard rebalancer.` |
| 6 | trailing fenced JSON ×10 | ✅ 10/10 | same schema, zero failure modes |
| 7a | `session/load` after close | ✅ | `BANANA-42` recalled |
| 7b | `session/cancel` mid-reply | ✅ | `stopReason=cancelled` after first chunk |
| 7c | list + select model | ✅ | `configOptions`: `mode`, `collaboration_mode`, `model` (=`gpt-5.6-terra`), `reasoning_effort`, `fast-mode`; `modes`: read-only/workspace-write/agent/agent-full-access; set `model=gpt-6.1-sol` accepted. Legacy `session/set_model` also exists |
| 7d | permission behaviour | info | **0 permission requests in the whole run**, including for the MCP call. Backstop handler never fired |
| 8 | no-fork fallback | ⚠️ partial | byte-identical first message in a fresh session reproduced the cold accounting exactly (18.5%, `in=48446`) — **no cross-session hit minutes later**; but a repeat seconds later hit 99.5% (see cache-lifetime §) |

## Measured cache behaviour

Per-turn `usage` on `PromptResponse` is **per-turn** (verified: `total ==
in + cachedRead + cachedWrite + out` on every recorded turn, both adapters).
`inputTokens` counts **uncached input only** — compute the read share as
`cachedRead / (in + cachedRead + cachedWrite)`.

### Claude (Opus 5.5)

| Turn | total | in | cachedRead | cachedWrite | out | read share |
|---|---|---|---|---|---|---|
| base pack, cold (run1) | 82691 | 2 | 0 | 82685 | 4 | 0% (write) |
| base pack, warm rerun ~4 min later (run2/run3) | 82691 | 2 | 82685 | 0 | 4 | **100%** |
| fork1 first Q (after fork+resume+FORKED probe) | 82960 | 4 | 72625 | 10278 | 53 | **87.6%** |
| fork2 first Q | 82930 | 4 | 72625 | 10267 | 34 | **87.6%** |
| fork follow-ups (struct turns 1–10) | 83180→85206 | 4 | 82903→84870 | ~160–230 | ~110–130 | **99.7–99.8%** |
| fallback fresh session, byte-identical pack | 82691 | 2 | 82685 | 0 | 4 | **100%** |
| fallback follow-up Q | 82791 | 4 | 82688 | 64 | 35 | **99.9%** |

### Codex (gpt-5.6-terra)

| Turn | total | in | cachedRead | cachedWrite | out | read share |
|---|---|---|---|---|---|---|
| base pack, cold | 59459 | 48446 | 11008 | 0 | 5 | 18.5% |
| fork1 first Q (after FORKED probe) | 59562 | 410 | 59136 | 0 | 16 | **99.3%** |
| fork2 first Q | 59563 | 394 | 59136 | 0 | 33 | **99.3%** |
| fork follow-ups (struct turns) | 59701→60832 | ~500–630 | 59136→60160 | 0 | ~44–61 | **99.0–99.2%** |
| fallback fresh session, byte-identical (min. later) | 59459 | 48446 | 11008 | 0 | 5 | 18.5% (miss) |
| fallback follow-up Q (same session) | 59521 | 370 | 59136 | 0 | 15 | **99.4%** |
| recache probe fresh-A (~25 min later) | 58279 | 47266 | 11008 | 0 | 5 | 18.9% (miss) |
| recache probe fresh-B (seconds after A) | 59459 | 318 | 59136 | 0 | 5 | **99.5%** (hit) |

### Observed cache lifetime

- **Claude:** an identical 131 KB pack message hit **100% cache reads across
  separate processes/runs ~4–5 min apart** (run1 write → run2/run3 reads;
  fallback reads). Consistent with a ~5 min prompt-cache TTL. No expiry
  observed inside a run (turns span ~10 min with continuous activity).
- **Codex:** cross-session hits observed **seconds apart** (recache A→B,
  99.5%) but **misses minutes apart** (in-run fallback, recache-A at ~25 min).
  Consistent with a short prompt-cache TTL (single-digit minutes) and/or
  best-effort routing. Within a live lineage (base→fork→follow-ups) every
  turn after the first is ≥99% reads.
- **Design consequence:** warm the base, then fan forks out **immediately**
  (PRD §9.2 already says this). Treat the no-fork fallback as valid only
  against a warm base; rebuilding a cold base costs one full-price turn
  (PRD §9.4 trigger #2 covers this).

### Token spend (measured, counted turns only)

- Claude run3 (15 turns incl. base, 2 forks, 10 struct, 2 fallback):
  in 56 + cachedRead 1,231,896 + cachedWrite 22,799 + out 1,293.
- Codex run1 (same 15): in 104,809 + cachedRead 794,880 + out 557
  (+29 thought). Plus the recache probe (2 × ~59k, one cold).
- Reruns are cheap *because* of the caching under test — but each rerun
  still bills one cold pack turn on the default model. Keep to a handful.

## Where usage is reported (both adapters)

1. **Unstable `usage` on `PromptResponse`** (`totalTokens, inputTokens,
   outputTokens, thoughtTokens?, cachedReadTokens?, cachedWriteTokens?`) —
   per-turn, verified additive. This is the primary signal for AgentRunner.
2. **`usage_update` notifications** (`used`, `size`, i.e. session-level
   context fill) after most turns. Claude attaches
   `_meta._claude/model` (e.g. `claude-opus-5-5`) and sometimes
   `_meta._claude/rateLimit` (5-hour limit status — useful for backoff UI).
   Codex sends `used/size` only.
3. **Adapter passthrough `_meta.quota`** on the prompt response:
   `token_count` with **provider field names** (`cachedInputTokens`,
   `cachedWriteTokens`/`cacheWriteInputTokens`, `reasoningOutputTokens`)
   plus a **`model_usage` array, one entry per model that billed**.
   ⚠️ The top-level turn usage can **miss background sub-calls**: one run
   showed a 61.6k-input / 19-output `claude-haiku-5-5` call (almost certainly
   background session titling) present only in `model_usage`, not in the
   turn totals. **Aggregate `model_usage` for anything billing-related.**

## Structured output (PRD §19.3)

- **20/20 replies parsed** (10/10 per adapter): trailing
  ` ```json … ``` ` block matching
  `{ "title": string, "contribute": { "facts": [...] } }`, validated with
  `JSON.parse` + shape check. Zero failure modes observed (no missing
  blocks, no invalid JSON, no schema drift, no text after the block).
- **Recommendation: go with the trailing fenced JSON block.** It is reliable
  on both adapters with plain instruction text, needs no adapter-specific
  passthrough, and degrades gracefully (the human-readable answer above it
  is still usable when parsing fails). Keep exact instruction wording in the
  L0 template (`End your reply with one fenced json block … Put nothing
  after the block`) — every measured success used it. Revisit only if a
  future adapter offers real structured output (e.g. elicitation-style
  schemas); do not build per-adapter `_meta` extraction now.

## Concrete recommendations for the real `AgentRunner` (PRD §6)

### Per-adapter implementation notes

**`start` → `session/new`** (absolute `cwd`; `mcpServers` as HTTP —
supported by both; codex does *not* support SSE, claude supports HTTP+SSE):

- Claude: pass the L0 system prompt as **`_meta.systemPrompt`** (string
  replaces the preset; `{append}` object form also supported). Verified
  working.
- Codex: **no system-prompt channel** — L0 instructions must be the first
  user message / head of the base pack. Verified `_meta.systemPrompt` is
  silently ignored.
- Both return `modes` + `configOptions` on `newSession` — persist them;
  they are the model/mode selectors (no separate "list models" call needed).

**`fork`**:

- Claude: `session/fork {sessionId, cwd}` → then **`session/resume`
  on the forked id before the first prompt** (0.89.0 does not register a
  live session for the fork; prompt fails `Session not found` otherwise).
  Re-check on upgrade; file upstream if still present.
- Codex: `session/fork {sessionId, cwd}` → prompt directly.
- Neither offers general fork-from-message over plain ACP: Claude's
  from-message fork requires the AIR-only `_meta.jetbrains.air.fork` (v1);
  Codex forks latest state only. The PRD only needs latest-state fork.

**`load`** (`session/load {sessionId, cwd, mcpServers}` after
`session/close`): works on both, continuity verified. Note load **replays
history as `session/update` notifications** — the client must drain/ignore
the replay before sending the next prompt (or route it to the UI).

**`prompt`**: send `session/prompt`, accumulate `agent_message_chunk` text,
watch `tool_call`/`tool_call_update`. Collect `usage_update`s alongside;
read the final `PromptResponse.usage` + `_meta.quota.model_usage`.

**`close`**: `session/close` on both (advertised). Close forks aggressively;
close idle bases past the cache TTL (cold rebuild is one full-price turn).

**cancel**: `session/cancel` notification → `stopReason: cancelled` on both,
even mid-stream. Safe to wire to card-close (PRD §12).

**usage**: per-turn `usage` + aggregate `_meta.quota.model_usage`;
read share = `cachedRead/(in+cachedRead+cachedWrite)`. Surface the share in
Settings → Jobs (PRD §4.14) straight from these fields.

**models**: `session/set_config_option {sessionId, configId, value}` drives
`model` (+ `effort`/`fast` on claude, `reasoning_effort`/`fast-mode` and
`mode` on codex). Codex default mode is `agent`; initial mode can also be
forced with `INITIAL_AGENT_MODE=read-only`.

**permissions / read-only posture** (agents must only read + call our MCP
tools, never prompt):

- Claude permission modes: `default` (Manual — always ask), `acceptEdits`,
  `plan`, `auto`, `bypassPermissions`. Run Unvibe sessions in **`default`**
  with a deny-by-default `requestPermission` handler that allowlists our
  MCP tools (`allow_once`, never `allow_always`). MCP calls arrive as
  `mcp__<server>__<tool>` titles. Untested but available: stripping
  built-ins entirely via `_meta.claudeCode.options.tools` /
  `_meta.disableBuiltInTools`.
- Codex modes: `read-only` (approval on-request, sandbox read-only, no
  network) is the right default; keep the deny-all permission handler as a
  backstop. Note MCP tool calls did **not** trigger permission prompts in
  `agent` mode — do not rely on the handler alone for MCP gating on codex.
- Empirically, with a "no tools except get_hunk" instruction, **neither
  agent attempted any unprompted tool use** (1 request total on claude =
  the intended call; 0 on codex).

### Fallback path (PRD §6, no fork)

Send the byte-identical base layers as the first message of a fresh session.
Verified to hit cache on both adapters **while warm** (Claude 100%,
Codex 99.5% seconds-apart). Misses cost one full-price turn and occur once
the prefix goes cold (minutes). Implementation: track base warmth
(last-used timestamp + provider TTL assumption ~5 min); reuse warm base,
else rebuild (which is "free" in the sense the prefix is cold anyway —
PRD §9.4).

### Known pitfalls

1. Claude 0.89.0 fork needs a following `resume` (see above).
2. `usage.inputTokens` excludes cached tokens on both adapters — never use
   `cachedRead/input` as the hit rate.
3. Turn-level `usage` can omit background model calls — aggregate
   `_meta.quota.model_usage`.
4. Codex ignores `_meta.systemPrompt` silently.
5. Codex MCP tools may execute without a permission round-trip.
6. ACP errors are generic (`code -32603 Internal error`); the reason is in
   `error.data.details` (e.g. `Session not found`).
7. npm `codex-acp` ≠ `@agentclientprotocol/codex-acp`; PRD §6 package names
   need the scope corrections in the table above.
8. Cache entries live minutes, not hours — fan-out timing matters more than
   base size.

## How to rerun

```sh
cd spikes/acp
npm install            # pins: sdk 1.8.0, claude-agent-acp 0.89.0, codex-acp 2.2.2
npm run typecheck
npm run spike:claude   # full 8-check run, ~10 min, bills Opus 5.5 to the claude login
npm run spike:codex    # full 8-check run, ~5 min, bills gpt-5.6-terra to the codex login
npm run probe -- claude|codex   # zero-token init/capabilities check
npm run codex:recache  # cross-session cache probe only (2 × pack turn)
```

Prereqs: `claude` and `codex` CLIs installed and logged in (the spike
prepends Linux mise paths in `src/spike.ts` — adjust `extraPath` on macOS,
e.g. via `mise which claude/codex`). Results land in
`spikes/acp/results/<adapter>-<epoch>.json` (+ console `.log`).
Spend per full run ≈ one cold ~33k-token pack turn + ~15 cached turns on the
adapter's default model.

## Deviations / limits of this spike

- One full run per adapter (+1 Claude rerun after the fork fix, +1 small
  Codex recache probe). Numbers are single samples; cache behaviour is
  provider best-effort and will vary.
- Fork-from-a-specific-message not exercised (no general client API exists;
  AIR-only on Claude).
- `_meta.claudeCode.options.tools` lockdown and Codex `read-only` mode
  enforcement were **not** empirically tested (read-only posture was via
  instructions + deny-all handler). Test both before M2.
- Structured-output test used short fact answers; long-form `contribute`
  blocks (corrections/open_questions/replaces) not measured.
- `session/delete`, `session/list`, `providers/*`, elicitation, and
  subagent sessions not exercised (not needed for M0).
