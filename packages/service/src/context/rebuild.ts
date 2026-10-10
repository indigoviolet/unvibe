/**
 * Base-rebuild decisions (PRD §9.4) as a pure function.
 *
 * A new base is built when:
 * 1. a new version arrived, or the guide was regenerated;
 * 2. the provider cache has expired (the prefix is cold anyway, so
 *    rebuilding is free) — the main cleanup trigger;
 * 3. too much has been superseded: more than `supersededRatio` of the
 *    base, or more than `appendedTokens` tokens appended.
 *
 * Thresholds come from settings; the PRD starting guesses are 20% and
 * 10k tokens (see `tokens.ts` defaults).
 */
import {
  DEFAULT_REBUILD_APPENDED_TOKENS,
  DEFAULT_REBUILD_SUPERSEDED_RATIO,
} from "./tokens.js";

export type RebuildReason =
  | "new-version"
  | "guide-regenerated"
  | "cache-expired"
  | "superseded-ratio"
  | "appended-tokens";

export interface BaseRebuildState {
  baseVersion: number;
  baseGuideRevision: string;
  /** Token size of the base when built. */
  baseTokens: number;
  /** Log-batch tokens appended since the base was built. */
  appendedTokens: number;
  /** Base tokens superseded by newer entries. */
  supersededTokens: number;
  /** True when the provider cache for this base has expired. */
  cacheExpired: boolean;
  currentVersion: number;
  currentGuideRevision: string;
}

export interface RebuildThresholds {
  supersededRatio: number;
  appendedTokens: number;
}

/** Fill thresholds from (partial) settings, falling back to PRD defaults. */
export function defaultThresholds(settings?: {
  rebuildSupersededRatio?: number;
  rebuildAppendedTokens?: number;
}): RebuildThresholds {
  return {
    supersededRatio: settings?.rebuildSupersededRatio ?? DEFAULT_REBUILD_SUPERSEDED_RATIO,
    appendedTokens: settings?.rebuildAppendedTokens ?? DEFAULT_REBUILD_APPENDED_TOKENS,
  };
}

/**
 * Decide whether to rebuild the base. Returns every trigger that fired;
 * `rebuild` is true when at least one did. Comparisons are strict
 * greater-than: exactly at the threshold does not rebuild.
 */
export function decideRebuild(
  state: BaseRebuildState,
  thresholds: RebuildThresholds,
): { rebuild: boolean; reasons: RebuildReason[] } {
  const reasons: RebuildReason[] = [];
  if (state.currentVersion !== state.baseVersion) reasons.push("new-version");
  if (state.currentGuideRevision !== state.baseGuideRevision) reasons.push("guide-regenerated");
  if (state.cacheExpired) reasons.push("cache-expired");
  if (state.supersededTokens > thresholds.supersededRatio * state.baseTokens) {
    reasons.push("superseded-ratio");
  }
  if (state.appendedTokens > thresholds.appendedTokens) reasons.push("appended-tokens");
  return { rebuild: reasons.length > 0, reasons };
}
