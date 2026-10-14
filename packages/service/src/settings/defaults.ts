/**
 * Default model selection (PRD §§4.14/12, issue #88).
 *
 * With real agents, role defaults come from what each adapter actually
 * offers (`listModels`), not from a static catalog. Tiers (highest first):
 * opus | sol > sonnet | terra > haiku | luna. Fable and Astra are never
 * picked, whatever tier they would land in.
 *
 * The rule is an ordered list of (provider, family, minimum version)
 * matchers per role — "preferred order, first offered wins" (issue #88
 * table, ids as listed on 2026-10-12):
 *
 * - main:            claude-opus-5-5 > gpt-6.1-sol > claude-opus-5 >
 *                    gpt-6-sol > claude-sonnet-5-5 > gpt-5.6-terra
 * - small:           claude-haiku-5-5 > gpt-6-luna > claude-haiku-4-5 >
 *                    gpt-5.6-luna
 * - second opinion, main on Claude: gpt-6.1-sol > gpt-6-sol > gpt-5.6-sol >
 *                    gpt-5.6-terra
 * - second opinion, main on Codex:  claude-opus-5-5 > claude-opus-5 >
 *                    claude-sonnet-5-5
 *
 * Matching is on family plus highest version, not on literal strings: each
 * matcher takes the newest offered model in its family at or above its
 * minimum version. A newer version (e.g. a hypothetical `claude-opus-6`)
 * satisfies the family's first matcher and wins with no code change.
 * There is no 6.x Terra, so the Terra matcher floors at 5.6.
 *
 * Aliases and dated ids (the Claude adapter lists short aliases `default`,
 * `opus`, `sonnet`, `haiku` plus dated pins like
 * `claude-haiku-4-5-20251001`):
 * - An alias names a family with no version. It satisfies any matcher of
 *   its family (aliases track the family's current flagship), but an
 *   explicit versioned id always beats an alias of the same family.
 * - `default` is the adapter's drifting flagship name: it matches as Opus
 *   family (the flagship is Opus-class), ranked below the stable `opus`
 *   alias. A versioned id beats both.
 * - Dated pins compare by their version (`4-5-20251001` is 4.5); on an
 *   exact version tie the plain id beats the dated pin.
 *
 * Pure functions over captured id lists, unit-tested against the current
 * adapter listings (see `docs/acp-runner.md`). Roles that cannot be filled
 * from any allowed family come back null — the effective-settings layer
 * keeps the stored (static) pick and readiness reports it plainly.
 */
import type { ModelPick } from "@unvibe/shared";

/** Allowed families per provider. Fable and Astra are deliberately absent. */
type ClaudeFamily = "opus" | "sonnet" | "haiku";
type CodexFamily = "sol" | "terra" | "luna";

interface Matcher {
  provider: "claude" | "codex";
  family: ClaudeFamily | CodexFamily;
  /** Minimum version, parsed like offered ids (`5-5` → [5, 5]). */
  minVersion: number[];
}

/** Component-wise `>=`, missing components counting as 0. */
function versionAtLeast(version: number[], floor: number[]): boolean {
  const n = Math.max(version.length, floor.length);
  for (let i = 0; i < n; i++) {
    const v = version[i] ?? 0;
    const f = floor[i] ?? 0;
    if (v > f) return true;
    if (v < f) return false;
  }
  return true;
}

/** Component-wise compare: negative when a < b, positive when a > b. */
function compareVersions(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface ParsedId {
  family: ClaudeFamily | CodexFamily;
  /** Null for aliases (no version to compare). */
  version: number[] | null;
  /** True for pins with a trailing calendar date (`…-20251001`). */
  dated: boolean;
  /** 0 = versioned id, 1 = family alias, 2 = `default` alias. Lower wins. */
  aliasRank: number;
}

/**
 * Parse one offered id into (family, version). Returns null for anything
 * outside the allowed families — Fable, Astra, and unknown ids never
 * match, whatever tier they would land in.
 */
export function parseModelId(provider: string, id: string): ParsedId | null {
  const lower = id.toLowerCase();
  // Excluded families first: never picked, even as the only high tier.
  if (/fable|astra/i.test(lower)) return null;
  if (provider === "claude") {
    let family: ClaudeFamily | null = null;
    if (lower === "default") {
      // The adapter's flagship alias (Opus-class): matches Opus matchers
      // as the weakest candidate. Deliberately an assumption, documented
      // above — versioned ids always win ties, so a flagship change only
      // matters when nothing versioned is offered.
      return { family: "opus", version: null, dated: false, aliasRank: 2 };
    } else if (/^opus$/.test(lower)) {
      return { family: "opus", version: null, dated: false, aliasRank: 1 };
    } else if (/^sonnet$/.test(lower)) {
      return { family: "sonnet", version: null, dated: false, aliasRank: 1 };
    } else if (/^haiku$/.test(lower)) {
      return { family: "haiku", version: null, dated: false, aliasRank: 1 };
    } else if (/opus/.test(lower)) {
      family = "opus";
    } else if (/sonnet/.test(lower)) {
      family = "sonnet";
    } else if (/haiku/.test(lower)) {
      family = "haiku";
    } else {
      return null;
    }
    const dated = /-\d{8}$/.test(lower);
    const withoutDate = dated ? lower.slice(0, -9) : lower;
    const numbers = (withoutDate.match(/\d+/g) ?? []).map(Number);
    if (numbers.length === 0) return null;
    return { family, version: numbers, dated, aliasRank: 0 };
  }
  if (provider === "codex") {
    let family: CodexFamily | null = null;
    if (/sol/.test(lower)) family = "sol";
    else if (/terra/.test(lower)) family = "terra";
    else if (/luna/.test(lower)) family = "luna";
    else return null;
    const numbers = (lower.match(/\d+/g) ?? []).map(Number);
    if (numbers.length === 0) return null;
    return { family, version: numbers, dated: false, aliasRank: 0 };
  }
  return null;
}

/** Preference order per role: first matcher with a match wins. */
const MAIN_PREF: Matcher[] = [
  { provider: "claude", family: "opus", minVersion: [5, 5] },
  { provider: "codex", family: "sol", minVersion: [6, 1] },
  { provider: "claude", family: "opus", minVersion: [5] },
  { provider: "codex", family: "sol", minVersion: [6] },
  { provider: "claude", family: "sonnet", minVersion: [5, 5] },
  { provider: "codex", family: "terra", minVersion: [5, 6] },
];

const SMALL_PREF: Matcher[] = [
  { provider: "claude", family: "haiku", minVersion: [5, 5] },
  { provider: "codex", family: "luna", minVersion: [6] },
  { provider: "claude", family: "haiku", minVersion: [4, 5] },
  { provider: "codex", family: "luna", minVersion: [5, 6] },
];

/** Second opinion comes from the provider main is NOT using. */
const SECOND_OPINION_IF_MAIN_CLAUDE: Matcher[] = [
  { provider: "codex", family: "sol", minVersion: [6, 1] },
  { provider: "codex", family: "sol", minVersion: [6] },
  { provider: "codex", family: "sol", minVersion: [5, 6] },
  { provider: "codex", family: "terra", minVersion: [5, 6] },
];

const SECOND_OPINION_IF_MAIN_CODEX: Matcher[] = [
  { provider: "claude", family: "opus", minVersion: [5, 5] },
  { provider: "claude", family: "opus", minVersion: [5] },
  { provider: "claude", family: "sonnet", minVersion: [5, 5] },
];

export interface AdapterModelLists {
  claude: string[];
  codex: string[];
}

export interface DefaultModels {
  /** Null when no allowed family is offered (effective layer keeps stored). */
  main: ModelPick | null;
  /** Null when no allowed family is offered (effective layer keeps stored). */
  small: ModelPick | null;
  /** Null when the other provider offers nothing usable: stays unset. */
  secondOpinion: ModelPick | null;
}

function pickFrom(pref: Matcher[], lists: { claude: string[]; codex: string[] }): ModelPick | null {
  for (const m of pref) {
    const ids = [...new Set(lists[m.provider].filter(Boolean))];
    const matches: { id: string; parsed: ParsedId }[] = [];
    for (const id of ids) {
      const parsed = parseModelId(m.provider, id);
      if (!parsed || parsed.family !== m.family) continue;
      if (parsed.version !== null && !versionAtLeast(parsed.version, m.minVersion)) continue;
      matches.push({ id, parsed });
    }
    if (matches.length === 0) continue;
    // Newest version wins; explicit versioned ids beat aliases, plain ids
    // beat dated pins on ties, `default` ranks below the family alias.
    matches.sort((a, b) => {      const av = a.parsed.version;
      const bv = b.parsed.version;
      if (av !== null && bv !== null) {
        const c = compareVersions(bv, av);
        if (c !== 0) return c;
        if (a.parsed.dated !== b.parsed.dated) return a.parsed.dated ? 1 : -1;
        return 0;
      }
      if (av !== null) return -1;
      if (bv !== null) return 1;
      return a.parsed.aliasRank - b.parsed.aliasRank;
    });
    return { provider: m.provider, model: matches[0].id, effort: "" };
  }
  return null;
}

/**
 * Pick role defaults from live adapter lists. Null roles mean no allowed
 * family was offered (or the provider offers nothing): the caller keeps
 * the stored pick for main/small and leaves second opinion unset.
 *
 * Second opinion is picked from the provider main is NOT using. That is
 * the picked main by default; pass `mainOverride` when the effective main
 * is a saved pick the live rule would not choose (a saved main on Codex
 * still takes its second opinion from Claude).
 */
export function selectDefaultModels(
  offered: AdapterModelLists,
  mainOverride?: { provider: string },
): DefaultModels {
  const lists = {
    claude: [...new Set(offered.claude.filter(Boolean))],
    codex: [...new Set(offered.codex.filter(Boolean))],
  };
  const main = pickFrom(MAIN_PREF, lists);
  const small = pickFrom(SMALL_PREF, lists);
  const mainProvider = mainOverride?.provider ?? main?.provider;
  let secondOpinion: ModelPick | null = null;
  if (mainProvider) {
    secondOpinion = pickFrom(
      mainProvider === "codex" ? SECOND_OPINION_IF_MAIN_CODEX : SECOND_OPINION_IF_MAIN_CLAUDE,
      lists,
    );
  } else {
    // Main unfillable (nothing usable offered): second opinion still tries
    // Codex, the historical default provider for the role. With Codex
    // absent too it stays unset.
    secondOpinion = pickFrom(SECOND_OPINION_IF_MAIN_CLAUDE, lists);
  }
  return { main, small, secondOpinion };
}
