/**
 * Apply the citation validation report to stored blocks (M4).
 *
 * `runInFork` validates every reply (one repair turn on failure); the
 * report's `repaired` tokens are stored at their corrected target and
 * `unverified` ones are stored flagged (the UI dims them, PRD §4.5).
 */
import fs from "node:fs";
import path from "node:path";
import type { Block, ReviewSnapshot } from "@unvibe/shared";
import { canonicalizeTarget } from "@unvibe/shared";
import { lookupForSnapshot } from "../lookup.js";
import type { ReviewLookup } from "../../validate/index.js";

export interface TokenOutcome {
  target: string;
  status: string;
  repairedTo?: string;
}

/**
 * Rewrite block citations per the validation outcome. `canonicalize`
 * maps stored targets to canonical IDs (alias-form `diff:conn:…` → real
 * file keys); pass `aliasCanonicalizer(snapshot, fixturesDir)` so stored
 * targets match the pipeline's (the web needs no alias table).
 */
export function remapAliasTargets(
  blocks: Block[],
  tokens: TokenOutcome[],
  canonicalize?: (target: string) => string,
): Block[] {
  const repaired = new Map(
    tokens.filter((t) => t.status === "repaired" && t.repairedTo).map((t) => [t.target, t.repairedTo!]),
  );
  const unverified = new Set(tokens.filter((t) => t.status === "unverified").map((t) => t.target));
  const fix = (citations: { target: string; unverified?: boolean }[]) =>
    citations.map((c) => {
      const to = repaired.get(c.target);
      if (to) return { target: to };
      if (unverified.has(c.target)) return { target: c.target, unverified: true };
      if (canonicalize) return { target: canonicalize(c.target) };
      return { target: c.target };
    });
  const apply = (list: Block[]): Block[] =>
    list.map((b) => {
      switch (b.type) {
        case "paragraph":
          return { ...b, citations: fix(b.citations) };
        case "list":
          return {
            ...b,
            items: b.items.map((it) => ({ ...it, citations: fix(it.citations) })),
            citations: fix(b.citations),
          };
        case "aside":
          return { ...b, inner: apply(b.inner), citations: fix(b.citations) };
        default:
          return { ...b, citations: fix((b as { citations: { target: string }[] }).citations) };
      }
    });
  return apply(blocks);
}

/** Canonicalizer closing over a snapshot (+ fixture aliases for demos). */
export function aliasCanonicalizer(
  snapshot: ReviewSnapshot,
  fixturesDir?: string,
): (target: string) => string {
  const resolve = aliasResolver(snapshot, fixturesDir);
  return (target: string) => canonicalizeTarget(target, resolve);
}

/**
 * Alias-aware `ReviewLookup` over a live snapshot (mirrors the pipeline's
 * private `lookupWithAliases`): alias-form tokens (`diff:conn:…`) resolve
 * through the fixture's `keyAliases` so same-session reply validation
 * agrees with `runInFork`.
 */
export function lookupWithAliases(snapshot: ReviewSnapshot, fixturesDir?: string): ReviewLookup {
  const base = lookupForSnapshot(snapshot);
  const aliases = readAliases(snapshot, fixturesDir);
  if (Object.keys(aliases).length === 0) return base;
  const inner = base.resolveFileKey.bind(base);
  return {
    ...base,
    resolveFileKey: (key: string) => inner(key) ?? (aliases[key] ? inner(aliases[key]) : null),
  };
}

/** Demo alias table (`keyAliases` from the fixture meta), else empty. */
export function readAliases(snapshot: ReviewSnapshot, fixturesDir?: string): Record<string, string> {
  if (snapshot.review.repoId !== "demo" || !fixturesDir) return {};
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(fixturesDir, "meta.json"), "utf8")) as {
      keyAliases?: Record<string, string>;
    };
    return meta.keyAliases ?? {};
  } catch {
    return {};
  }
}

/**
 * Canonicalize thread-message citations to stored (real-ID) targets so
 * hover/jump works without an alias table on the web. Alias-form tokens
 * (`diff:conn:…`) resolve through the fixture's `keyAliases` mapping for
 * demo reviews, mirroring the pipeline's lookup.
 */
export function canonicalizeCitations(
  citations: { target: string; unverified?: boolean }[],
  snapshot: ReviewSnapshot,
  fixturesDir?: string,
): { target: string; unverified?: boolean }[] {
  const resolve = aliasResolver(snapshot, fixturesDir);
  return citations.map((c) => {
    if (c.unverified) return { ...c };
    return { target: canonicalizeTarget(c.target, resolve) };
  });
}

function aliasResolver(snapshot: ReviewSnapshot, fixturesDir?: string): (key: string) => string | null {
  const realKeys = new Set((snapshot.files ?? []).map((f) => f.fileKey));
  const aliases = readAliases(snapshot, fixturesDir);
  return (key: string) => {
    if (realKeys.has(key)) return key;
    const aliased = aliases[key];
    return aliased && realKeys.has(aliased) ? aliased : null;
  };
}
