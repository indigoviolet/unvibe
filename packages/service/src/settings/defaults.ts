/**
 * Default model selection (PRD §§4.14/12).
 *
 * With real agents, role defaults come from what each adapter actually
 * offers (`listModels`), not from a static catalog:
 * - main: the most capable Claude model offered;
 * - small: the smallest/fastest Claude model offered (one provider for
 *   main + small keeps one login sufficient);
 * - second opinion: the default Codex model when Codex is available,
 *   otherwise unset (the UI explains a different model from main is needed).
 *
 * Pure functions over captured id lists, unit-tested against the real
 * adapter listings (see `docs/acp-runner.md`).
 */
import type { ModelPick } from "@unvibe/shared";

/** Claude capability families, least → most capable. */
const CLAUDE_FAMILIES: { match: RegExp; rank: number }[] = [
  { match: /haiku/i, rank: 1 },
  { match: /sonnet/i, rank: 2 },
  { match: /fable/i, rank: 3 },
  { match: /opus/i, rank: 4 },
];

/**
 * Capability score for a Claude model id. The bare `default` aliases the
 * current flagship (Opus-class), so it ranks above fable but below the
 * explicit `opus` name (explicit family names are stable to persist;
 * `default` drifts); dated pins (`claude-opus-4-6`) rank below the short
 * family name.
 */
export function claudeCapabilityScore(id: string): number {
  if (id === "default") return 4 * 2;
  let rank = 0;
  for (const f of CLAUDE_FAMILIES) {
    if (f.match.test(id)) rank = Math.max(rank, f.rank);
  }
  const short = /^(opus|fable|sonnet|haiku)$/i.test(id);
  return rank * 2 + (short ? 1 : 0);
}

/** Family rank only (no short-name bonus): for small-model ties. */
function claudeFamilyRank(id: string): number {
  if (id === "default") return 4;
  let rank = 0;
  for (const f of CLAUDE_FAMILIES) {
    if (f.match.test(id)) rank = Math.max(rank, f.rank);
  }
  return rank;
}

function isShortName(id: string): boolean {
  return /^(default|opus|fable|sonnet|haiku)$/i.test(id);
}

export interface AdapterModelLists {
  claude: string[];
  /** Adapter's current (default) Claude model, when known. */
  claudeDefault?: string | null;
  codex: string[];
  /** Adapter's current (default) Codex model, when known. */
  codexDefault?: string | null;
}

export interface DefaultModels {
  main: ModelPick;
  small: ModelPick;
  /** Null when Codex offers nothing: second opinion stays unset. */
  secondOpinion: ModelPick | null;
}

const FALLBACK_MAIN: ModelPick = { provider: "claude", model: "claude-sonnet" };
const FALLBACK_SMALL: ModelPick = { provider: "claude", model: "claude-haiku" };

/**
 * Pick role defaults from live adapter lists. Empty Claude list → static
 * fallback picks (adapter unreachable); empty Codex list → unset second
 * opinion.
 */
export function selectDefaultModels(offered: AdapterModelLists): DefaultModels {
  const claude = [...new Set(offered.claude.filter(Boolean))];
  let main = FALLBACK_MAIN;
  let small = FALLBACK_SMALL;
  if (claude.length > 0) {
    // Main: highest capability; ties prefer the short family name, then
    // list order. Small: lowest family rank; ties prefer the short name.
    let top = claude[0];
    let bottom = claude[0];
    for (const id of claude) {
      if (claudeCapabilityScore(id) > claudeCapabilityScore(top)) top = id;
      if (claudeFamilyRank(id) < claudeFamilyRank(bottom) || (claudeFamilyRank(id) === claudeFamilyRank(bottom) && isShortName(id) && !isShortName(bottom))) {
        bottom = id;
      }
    }
    main = { provider: "claude", model: top };
    small = { provider: "claude", model: bottom };
  }
  const codex = [...new Set(offered.codex.filter(Boolean))];
  let secondOpinion: ModelPick | null = null;
  if (codex.length > 0) {
    const def = offered.codexDefault && codex.includes(offered.codexDefault) ? offered.codexDefault : null;
    secondOpinion = { provider: "codex", model: def ?? codex[0] };
  }
  return { main, small, secondOpinion };
}
