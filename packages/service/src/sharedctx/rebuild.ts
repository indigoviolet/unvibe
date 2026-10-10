/**
 * Base-rebuild orchestration (PRD §9.4).
 *
 * A new base is built when `decideRebuild` fires:
 * 1. a new version, or the guide regenerated;
 * 2. the provider cache expired — tracked as last-use time per base against
 *    the cache-lifetime setting (`cacheLifetimeMs`). The prefix is cold
 *    anyway so rebuilding is free; this is the main cleanup trigger;
 * 3. too much superseded (>20% of the base by default, or >10k appended
 *    tokens).
 *
 * On rebuild the small model merges contributions (`consolidate` template):
 * duplicates removed, superseded items resolved, accepted corrections folded
 * in. In-flight conversations on the old base keep working (their sessions
 * are untouched); new forks use the new base; old bases are pruned when
 * unused.
 */
import { decideRebuild, defaultThresholds, type RebuildReason, type RebuildThresholds } from "../context/rebuild.js";

export type { RebuildReason };

export interface RebuildPlanInput {
  baseVersion: number;
  baseGuideRevision: string;
  baseTokens: number;
  appendedTokens: number;
  supersededTokens: number;
  /** Epoch ms the base was last used (cache-expiry tracking). */
  baseLastUsedAt: number;
  now: number;
  /** Provider cache lifetime in ms (settings). */
  cacheLifetimeMs: number;
  currentVersion: number;
  currentGuideRevision: string;
  thresholds?: Partial<RebuildThresholds> & { rebuildSupersededRatio?: number; rebuildAppendedTokens?: number };
}

export function resolveThresholds(input: RebuildPlanInput): RebuildThresholds {
  return defaultThresholds({
    ...(input.thresholds?.supersededRatio !== undefined
      ? { rebuildSupersededRatio: input.thresholds.supersededRatio }
      : input.thresholds?.rebuildSupersededRatio !== undefined
        ? { rebuildSupersededRatio: input.thresholds.rebuildSupersededRatio }
        : {}),
    ...(input.thresholds?.appendedTokens !== undefined
      ? { rebuildAppendedTokens: input.thresholds.appendedTokens }
      : input.thresholds?.rebuildAppendedTokens !== undefined
        ? { rebuildAppendedTokens: input.thresholds.rebuildAppendedTokens }
        : {}),
  });
}

/** Pure rebuild plan: every trigger that fired. */
export function planRebuild(input: RebuildPlanInput): { rebuild: boolean; reasons: RebuildReason[] } {
  const thresholds = resolveThresholds(input);
  return decideRebuild(
    {
      baseVersion: input.baseVersion,
      baseGuideRevision: input.baseGuideRevision,
      baseTokens: input.baseTokens,
      appendedTokens: input.appendedTokens,
      supersededTokens: input.supersededTokens,
      cacheExpired: input.now - input.baseLastUsedAt >= input.cacheLifetimeMs,
      currentVersion: input.currentVersion,
      currentGuideRevision: input.currentGuideRevision,
    },
    thresholds,
  );
}

/**
 * Superseded-token accounting: contributions with `replaces` (or dropped by
 * consolidation) supersede earlier log payloads. Callers estimate the
 * superseded tokens from the retired entries' rendered size; this helper
 * keeps the ratio math in one place.
 */
export function supersededRatio(baseTokens: number, supersededTokens: number): number {
  if (baseTokens <= 0) return 0;
  return supersededTokens / baseTokens;
}
