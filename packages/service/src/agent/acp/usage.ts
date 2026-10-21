/**
 * Usage accounting (spike §"Where usage is reported", pitfall #2/#3).
 *
 * - `usage.inputTokens` counts UNCACACHED input only. Never compute a hit
 *   rate as cached/input.
 * - Per-turn `usage` on PromptResponse is per-turn (verified additive:
 *   total == in + cachedRead + cachedWrite + out).
 * - The top-level turn usage can MISS background sub-calls (the spike saw a
 *   61.6k-input Haiku titling call present only in `_meta.quota.model_usage`).
 *   Always aggregate `_meta.quota.model_usage` when present.
 * - Both pinned adapters already return PER-TURN figures (#209, verified
 *   live against claude-agent-acp 0.89.0 + codex-acp 2.2.2): Claude resets
 *   its turn accumulators on turn activation and diffs the SDK's
 *   session-cumulative `result.modelUsage` into that turn's increment
 *   itself; Codex diffs its thread total per prompt. Do NOT delta-ize
 *   again here: a second delta turns each component into
 *   `max(previous, current)` once the warm-turn fold is added, so a fresh
 *   hunk session reported the shared first turn's cache write on every
 *   job and dropped the real turn's smaller counters. (The older
 *   "session-cumulative" reading mistook a growing context — turn 2
 *   legitimately cache-reads turn 1's larger prefix — for a running
 *   total.)
 *
 * AgentEvent carries `cachedReadTokens` + `cachedWriteTokens` (#125); the
 * split is preserved end to end so the hit rate counts reads only.
 */

export interface TurnUsage {
  inputTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Per-model breakdown from `_meta.quota.model_usage` (may include titling). */
  models: Array<{
    model: string;
    inputTokens: number;
    cachedReadTokens: number;
    cachedWriteTokens: number;
    outputTokens: number;
  }>;
}

interface RawCounts {
  inputTokens?: unknown;
  cachedReadTokens?: unknown;
  cachedInputTokens?: unknown;
  cachedWriteTokens?: unknown;
  cacheWriteInputTokens?: unknown;
  outputTokens?: unknown;
  reasoningOutputTokens?: unknown;
  thoughtTokens?: unknown;
  totalTokens?: unknown;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Read one token-count bag with either provider field naming. */
function readCounts(raw: RawCounts | undefined | null): {
  input: number;
  cachedRead: number;
  cachedWrite: number;
  output: number;
} {
  if (!raw) return { input: 0, cachedRead: 0, cachedWrite: 0, output: 0 };
  const cachedRead = num(raw.cachedReadTokens) + num(raw.cachedInputTokens);
  const cachedWrite = num(raw.cachedWriteTokens) + num(raw.cacheWriteInputTokens);
  // reasoning/thought tokens bill as output; fold them in so background
  // reasoning is not silently dropped.
  const output =
    num(raw.outputTokens) + num(raw.reasoningOutputTokens) + num(raw.thoughtTokens);
  return { input: num(raw.inputTokens), cachedRead, cachedWrite, output };
}

/**
 * Aggregate a PromptResponse `{ usage, _meta }` into per-turn counts.
 * Prefers `_meta.quota.model_usage` (complete, incl. background calls) and
 * falls back to top-level `usage`.
 */
export function aggregateTurnUsage(response: { usage?: unknown; _meta?: unknown }): TurnUsage {
  const usage = (response.usage ?? null) as RawCounts | null;
  const meta = (response._meta ?? null) as {
    quota?: { token_count?: RawCounts; model_usage?: Array<{ model?: unknown; token_count?: RawCounts }> };
  } | null;

  const modelUsage = meta?.quota?.model_usage;
  if (Array.isArray(modelUsage) && modelUsage.length > 0) {
    let input = 0;
    let cachedRead = 0;
    let cachedWrite = 0;
    let output = 0;
    const models: TurnUsage["models"] = [];
    for (const entry of modelUsage) {
      const c = readCounts(entry.token_count);
      input += c.input;
      cachedRead += c.cachedRead;
      cachedWrite += c.cachedWrite;
      output += c.output;
      models.push({
        model: typeof entry.model === "string" ? entry.model : "unknown",
        inputTokens: c.input,
        cachedReadTokens: c.cachedRead,
        cachedWriteTokens: c.cachedWrite,
        outputTokens: c.output,
      });
    }
    return {
      inputTokens: input,
      cachedReadTokens: cachedRead,
      cachedWriteTokens: cachedWrite,
      outputTokens: output,
      totalTokens: input + cachedRead + cachedWrite + output,
      models,
    };
  }

  // Fallback: top-level usage, or quota.token_count when usage is absent.
  const top = usage ?? meta?.quota?.token_count ?? null;
  const c = readCounts(top);
  return {
    inputTokens: c.input,
    cachedReadTokens: c.cachedRead,
    cachedWriteTokens: c.cachedWrite,
    outputTokens: c.output,
    totalTokens:
      num((top as RawCounts | null)?.totalTokens) || c.input + c.cachedRead + c.cachedWrite + c.output,
    models: [],
  };
}

/** Cache-read share of total input (spike formula). */
export function cacheReadShare(u: Pick<TurnUsage, "inputTokens" | "cachedReadTokens" | "cachedWriteTokens">): number {
  const total = u.inputTokens + u.cachedReadTokens + u.cachedWriteTokens;
  if (total <= 0) return 0;
  return u.cachedReadTokens / total;
}

/**
 * Sum two per-turn tallies (#209). Only for turns of the SAME job — the
 * shared warm first turn folded into a small session's first real prompt
 * (see `runner.start`). Per-turn payloads from the adapters must never be
 * diffed against each other; summing distinct turns of one job is the
 * only combining this module does.
 */
export function addTurnUsage(a: TurnUsage, b: TurnUsage): TurnUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedReadTokens: a.cachedReadTokens + b.cachedReadTokens,
    cachedWriteTokens: a.cachedWriteTokens + b.cachedWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    models: [...a.models, ...b.models],
  };
}

export function emptyUsage(): TurnUsage {
  return {
    inputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    models: [],
  };
}
