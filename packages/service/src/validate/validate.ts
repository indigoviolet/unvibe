/**
 * Citation validator (PRD §10). Given parsed content and a {@link ReviewLookup}
 * over a review version, every token comes back as:
 *
 * - `valid` — the ID exists and the range/host checks out;
 * - `repaired` — with `repairedTo` (a line range off by a few lines within
 *   the same hunk, a range spilling past the hunk end, or an ID mapped from
 *   an older version);
 * - `unverified` — with a `reason` for the job's debug data.
 *
 * Unknown `concept:` slugs are `valid` with `candidate: true`: they become
 * hidden concept candidates. When several citations in one reply fail,
 * `needsRepairTurn` is set so the caller can send one repair turn.
 */
import { parseId } from "@unvibe/shared";
import type { Block } from "@unvibe/shared";
import { collectTargets } from "@unvibe/shared";
import type { ReviewLookup } from "./lookup.js";

export type TokenStatus = "valid" | "repaired" | "unverified";

export interface TokenReport {
  target: string;
  status: TokenStatus;
  /** The corrected target to store/display (repaired only). */
  repairedTo?: string;
  /** Repair explanation or unverified cause (job debug data). */
  reason?: string;
  /** Unknown concept slug → hidden concept candidate. */
  candidate?: boolean;
}

export interface AnchorCheck {
  quote: string;
  host: string;
  ok: boolean;
  reason?: string;
}

export interface ValidationReport {
  tokens: TokenReport[];
  /** Unknown concept slugs encountered (hidden candidates). */
  candidates: string[];
  unverified: number;
  repaired: number;
  /**
   * True when several citations in one reply failed: the caller should
   * send one repair turn, not one per citation (PRD §10).
   */
  needsRepairTurn: boolean;
  anchor: AnchorCheck | null;
}

/** Unverified count at or above which the caller sends one repair turn. */
export const REPAIR_THRESHOLD = 2;

/** Max total line spill (both ends) still repaired by clamping to the hunk. */
const MAX_SPILL = 6;

function unverified(target: string, reason: string): TokenReport {
  return { target, status: "unverified", reason };
}

function tryRemap(target: string, lookup: ReviewLookup): string | null {
  const mapped = lookup.mapId(target);
  return mapped && mapped !== target ? mapped : null;
}

function validateDiff(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "diff") return unverified(target, `not a diff ID: ${target}`);
  const fileKey = lookup.resolveFileKey(parsed.fileKey);
  if (fileKey === null) {
    const mapped = tryRemap(target, lookup);
    if (mapped) {
      const again = validateDiff(mapped, lookup);
      if (again.status === "valid") {
        return { target, status: "repaired", repairedTo: mapped, reason: `remapped from a previous version` };
      }
    }
    return unverified(target, `unknown file: ${parsed.fileKey}`);
  }
  const { start, end } = parsed;
  const atStart = lookup.hunkAtLine(fileKey, start);
  const atEnd = lookup.hunkAtLine(fileKey, end);
  if (atStart && atEnd && atStart.hash === atEnd.hash) {
    return { target, status: "valid" };
  }
  // Repair: the range touches exactly one hunk and spills past its ends by
  // only a few lines → clamp to the hunk.
  const seen = new Map<string, { start: number; end: number }>();
  for (let line = start; line <= Math.min(end, start + 4096); line++) {
    const h = lookup.hunkAtLine(fileKey, line);
    if (h && !seen.has(h.hash)) seen.set(h.hash, { start: h.start, end: h.end });
    if (seen.size > 1) break;
  }
  if (seen.size === 1) {
    const [hash, h] = [...seen.entries()][0];
    void hash;
    const clampedStart = Math.max(start, h.start);
    const clampedEnd = Math.min(end, h.end);
    const spill = Math.max(0, h.start - start) + Math.max(0, end - h.end);
    if (clampedStart <= clampedEnd && spill > 0 && spill <= MAX_SPILL) {
      const range = clampedStart === clampedEnd ? `${clampedStart}` : `${clampedStart}-${clampedEnd}`;
      const at = target.includes("@") ? target.slice(target.lastIndexOf("@")) : "";
      const repairedTo = `diff:${fileKey}:${range}${at}`;
      return {
        target,
        status: "repaired",
        repairedTo,
        reason: `lines ${start}–${end} spill past hunk ${h.start}–${h.end}; clamped`,
      };
    }
  }
  if (seen.size > 1) {
    return unverified(target, `lines ${start}–${end} span more than one hunk (unchanged lines between)`);
  }
  return unverified(target, `lines ${start}–${end} are outside any hunk of ${fileKey}`);
}

function validateCode(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "code") return unverified(target, `not a code ID: ${target}`);
  const n = lookup.fileLineCount(parsed.path);
  if (n === null) {
    const mapped = tryRemap(target, lookup);
    if (mapped) {
      const again = validateCode(mapped, lookup);
      if (again.status === "valid") {
        return { target, status: "repaired", repairedTo: mapped, reason: `remapped from a previous version` };
      }
    }
    return unverified(target, `unknown file for code range: ${parsed.path}`);
  }
  if (parsed.start >= 1 && parsed.end <= n) return { target, status: "valid" };
  return unverified(target, `lines ${parsed.start}–${parsed.end} outside ${parsed.path} (1–${n})`);
}

function validateDesc(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "desc") return unverified(target, `not a desc ID: ${target}`);
  if (lookup.descParagraph(parsed.paragraph) !== null) return { target, status: "valid" };
  const mapped = tryRemap(target, lookup);
  if (mapped) {
    const reparsed = parseId(mapped);
    if (reparsed?.kind === "desc" && lookup.descParagraph(reparsed.paragraph) !== null) {
      return { target, status: "repaired", repairedTo: mapped, reason: `remapped from a previous version` };
    }
  }
  return unverified(target, `unknown description paragraph: ${parsed.paragraph}`);
}

function validateCard(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "card") return unverified(target, `not a card ID: ${target}`);
  if (!lookup.cardExists(parsed.cardId)) {
    const mapped = tryRemap(target, lookup);
    if (mapped) {
      const reparsed = parseId(mapped);
      if (reparsed?.kind === "card" && lookup.cardExists(reparsed.cardId)) {
        return { target, status: "repaired", repairedTo: mapped, reason: `remapped from a previous version` };
      }
    }
    return unverified(target, `unknown card: ${parsed.cardId}`);
  }
  if (parsed.blockId !== undefined && !lookup.blockExists(parsed.cardId, parsed.blockId)) {
    return unverified(target, `unknown block: card:${parsed.cardId}#${parsed.blockId}`);
  }
  return { target, status: "valid" };
}

function validatePage(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "page") return unverified(target, `not a page ID: ${target}`);
  if (lookup.pageExists(parsed.pageId)) return { target, status: "valid" };
  const mapped = tryRemap(target, lookup);
  if (mapped) {
    const reparsed = parseId(mapped);
    if (reparsed?.kind === "page" && lookup.pageExists(reparsed.pageId)) {
      return { target, status: "repaired", repairedTo: mapped, reason: `remapped from a previous version` };
    }
  }
  return unverified(target, `unknown page: ${parsed.pageId}`);
}

function validateConcept(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "concept") return unverified(target, `not a concept ID: ${target}`);
  if (lookup.conceptKnown(parsed.slug)) return { target, status: "valid" };
  return {
    target,
    status: "valid",
    candidate: true,
    reason: `unknown slug becomes a hidden concept candidate: ${parsed.slug}`,
  };
}

function validateAnn(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "ann") return unverified(target, `not an annotation ID: ${target}`);
  if (lookup.annotationExists(parsed.id)) return { target, status: "valid" };
  const mapped = tryRemap(target, lookup);
  if (mapped) {
    const reparsed = parseId(mapped);
    if (reparsed?.kind === "ann" && lookup.annotationExists(reparsed.id)) {
      return { target, status: "repaired", repairedTo: mapped, reason: `remapped from a previous version` };
    }
  }
  return unverified(target, `unknown annotation: ${parsed.id}`);
}

function validateHunk(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed?.kind !== "h") return unverified(target, `not a hunk ID: ${target}`);
  const fileKey = lookup.resolveFileKey(parsed.fileKey);
  if (fileKey !== null && lookup.hunkRange(fileKey, parsed.contentHash) !== null) {
    return { target, status: "valid" };
  }
  const mapped = tryRemap(target, lookup);
  if (mapped) {
    const reparsed = parseId(mapped);
    if (
      reparsed?.kind === "h" &&
      lookup.resolveFileKey(reparsed.fileKey) !== null &&
      lookup.hunkRange(lookup.resolveFileKey(reparsed.fileKey)!, reparsed.contentHash) !== null
    ) {
      return { target, status: "repaired", repairedTo: mapped, reason: `remapped from a previous version` };
    }
  }
  return unverified(target, `unknown hunk: ${target}`);
}

/** Validate one token target against the lookup. */
export function validateTarget(target: string, lookup: ReviewLookup): TokenReport {
  const parsed = parseId(target);
  if (parsed === null) return unverified(target, `not a known ID: ${target}`);
  switch (parsed.kind) {
    case "diff":
      return validateDiff(target, lookup);
    case "code":
      return validateCode(target, lookup);
    case "desc":
      return validateDesc(target, lookup);
    case "card":
      return validateCard(target, lookup);
    case "page":
      return validatePage(target, lookup);
    case "concept":
      return validateConcept(target, lookup);
    case "ann":
      return validateAnn(target, lookup);
    case "h":
      return validateHunk(target, lookup);
  }
}

function normalize(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** True when the host names only a card (no block): the #51 degraded case. */
function isCardOnlyHost(host: string): boolean {
  const parsed = parseId(host);
  return parsed?.kind === "card" && !parsed.blockId;
}

/** A quoted anchor must be a real substring of its host (PRD §10). */
export function validateAnchor(quote: string, host: string, lookup: ReviewLookup): AnchorCheck {
  // A host that names only the card is degraded, not anchored (issue
  // #51): the task needs the host block's ID (look it up with the review
  // tools). It can never pass by matching the whole card.
  if (isCardOnlyHost(host) && normalize(quote) !== "") {
    const parsed = parseId(host);
    return { quote, host, ok: false, reason: `anchor names only the card ${parsed?.kind === "card" ? parsed.cardId : host}; the host block's ID is required` };
  }
  const text = lookup.hostText(host);
  if (text === null) return { quote, host, ok: false, reason: `unknown anchor host: ${host}` };
  const hay = normalize(text);
  const needle = normalize(quote);
  if (!needle) return { quote, host, ok: false, reason: `empty quoted anchor` };
  if (hay.includes(needle)) return { quote, host, ok: true };
  return { quote, host, ok: false, reason: `quoted text not found in ${host}` };
}

export interface ValidateReplyOptions {
  anchor?: { quote: string; host: string };
}

/**
 * Validate every token in parsed blocks (citations + inline links) plus an
 * optional quoted anchor. Each target is reported once (first-seen order).
 */
export function validateReply(
  blocks: Block[],
  lookup: ReviewLookup,
  opts?: ValidateReplyOptions,
): ValidationReport {
  const { citations, links } = collectTargets(blocks);
  const seen = new Set<string>();
  const tokens: TokenReport[] = [];
  for (const target of [...citations, ...links]) {
    if (seen.has(target)) continue;
    seen.add(target);
    tokens.push(validateTarget(target, lookup));
  }
  const candidates = tokens.filter((t) => t.candidate).map((t) => t.target);
  const unverifiedCount = tokens.filter((t) => t.status === "unverified").length;
  const repaired = tokens.filter((t) => t.status === "repaired").length;
  let anchor: AnchorCheck | null = null;
  if (opts?.anchor) {
    anchor = validateAnchor(opts.anchor.quote, opts.anchor.host, lookup);
  }
  // A card-only anchor with a real quote is a degraded answer (issue
  // #51): retry it with the reason, like an unverifiable citation. Other
  // anchor failures (unknown host, quote mismatch, empty quote) stay
  // informational, as before.
  const anchorCardOnly =
    anchor !== null &&
    !anchor.ok &&
    normalize(opts?.anchor?.quote ?? "") !== "" &&
    isCardOnlyHost(opts?.anchor?.host ?? "");
  return {
    tokens,
    candidates,
    unverified: unverifiedCount,
    repaired,
    needsRepairTurn: unverifiedCount >= REPAIR_THRESHOLD || anchorCardOnly,
    anchor,
  };
}
