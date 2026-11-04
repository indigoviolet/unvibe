/**
 * Hunk interestingness scores + change plotlines (issue #169).
 *
 * Small interface so a later source (the Decisions API) can replace the
 * agents without touching the UI or the stored shape: the agents produce
 * raw values in their trailing JSON blocks, and everything downstream
 * reads through the two normalize functions below.
 *
 * - Scoring: the hunk pass returns one ordered level per hunk. The
 *   deterministic rules still apply on top (see `resolveHunkScore`): a
 *   one-line change is never "mechanical", and hiding still follows
 *   `hiddenReason` alone — the score never hides or unhides by itself.
 * - Plotlines: the reader names a few threads of change (the unit of a
 *   separate commit or stacked PR, never a file type) in landing order,
 *   each with an optional `buildsOn`,
 *   and lists hunk IDs per thread. Unknown IDs are dropped (reported in
 *   `dropped`), a hunk in two plotlines keeps the first, and hunks the
 *   reader leaves out read as "other" without storing anything.
 */
import { parseId } from "./ids.js";
import { truncateAtWordBoundary } from "./content/hunk.js";

/** Ordered interestingness levels, least to most interesting. */
export const HUNK_SCORE_LEVELS = ["mechanical", "routine", "substantive", "needs-attention"] as const;

/** One hunk's interestingness level. */
export type HunkScoreLevel = (typeof HUNK_SCORE_LEVELS)[number];

/** Display labels for the levels (sentence case per the copy rules). */
export const HUNK_SCORE_LABELS: Record<HunkScoreLevel, string> = {
  mechanical: "Mechanical",
  routine: "Routine",
  substantive: "Substantive",
  "needs-attention": "Needs attention",
};

/** Rank for ordering (Files list shows the file's highest level). */
export function hunkScoreRank(level: HunkScoreLevel): number {
  return HUNK_SCORE_LEVELS.indexOf(level);
}

/** Fallback when the agent sends no usable score: the safe middle. */
export const DEFAULT_HUNK_SCORE: HunkScoreLevel = "routine";

/**
 * Read one raw agent value as a score level. Accepts the four levels
 * (case-insensitive, "-" or " " before "attention"); anything else —
 * missing, wrong type, invented level — comes back null so the caller
 * can fall back instead of storing garbage.
 */
export function normalizeHunkScore(value: unknown): HunkScoreLevel | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase().replace(/\s+/g, "-");
  return (HUNK_SCORE_LEVELS as readonly string[]).includes(slug) ? (slug as HunkScoreLevel) : null;
}

/**
 * How the score and the deterministic rules combine (single place, so
 * the hunk pass, on-demand summarize and tests agree):
 *
 * 1. An unusable agent value becomes "routine" (like "when unsure, it
 *    is interesting": a missing judgement reads as middle, never blank).
 * 2. A one-line change is never "mechanical" — a single changed line
 *    that does something is at least routine — so it reads as "routine".
 * 3. Everything else is stored as returned. Guide-cited hunks keep
 *    their score (the cite rule clears `hiddenReason`, never the score).
 */
export function resolveHunkScore(raw: HunkScoreLevel | null, opts: { isOneLine: boolean }): HunkScoreLevel {
  const level = raw ?? DEFAULT_HUNK_SCORE;
  if (opts.isOneLine && level === "mechanical") return "routine";
  return level;
}

/**
 * Issue #193: one PR/branch commit as plotline evidence. Ingest (#92)
 * already reads subjects and bodies; this adds the files each commit
 * touched and the PR hunks it overlaps, so the reader sees the author's
 * own threading before naming plotlines. Stored on the snapshot in
 * landing order (oldest first).
 */
export interface ReviewCommit {
  sha: string;
  subject: string;
  body: string;
  /** Changed paths (new-side), in diff order. */
  files: string[];
  /** Canonical `h:<fileKey>:<hash>` PR hunk IDs this commit touches. */
  hunks: string[];
}

// --- plotlines -------------------------------------------------------------

/** Most plotlines the reader may name (the rest are dropped, reported). */
export const MAX_PLOTLINES = 8;

/** Assignment id for hunks no plotline claims (never stored). */
export const PLOTLINE_OTHER_ID = "other";

/**
 * One thread of the change: a unit with its own purpose that could
 * land as a separate commit or stacked PR. Never a file type — tests,
 * docs and config belong to the thread they serve. Plotlines are
 * stored in landing order (foundations first).
 */
export interface Plotline {
  /** Short kebab-case id, unique within the review. */
  id: string;
  /**
   * Issue #351: true when the update pass created this plotline for a
   * genuinely new thread of work since the baseline — the row reads
   * "new since B".
   */
  newSinceBaseline?: boolean;
  /** Short display name. */
  name: string;
  /** One line: what this step adds to the progression (issue #197). */
  description: string;
  /** Id of an earlier plotline this one builds on, when it depends on one. */
  buildsOn?: string;
}

/** Raw trailing-JSON shape the reader (or the assign step) sends. */
export interface RawPlotline {
  id?: string;
  name?: string;
  description?: string;
  buildsOn?: string;
  hunks?: string[];
}

export interface NormalizedPlotlines {
  plotlines: Plotline[];
  /** `h:<fileKey>:<hash>` → plotline id (first plotline wins). */
  assignment: Record<string, string>;
  dropped: {
    /** Hunk IDs that parse as nothing known (never stored). */
    unknown: string[];
    /** Hunk IDs claimed twice (kept under the first plotline). */
    duplicates: string[];
    /** Plotlines past the cap of 8. */
    extraPlotlines: number;
  };
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "plotline" : slug;
}

function cleanLine(text: string, max: number): string {
  return truncateAtWordBoundary(text.replace(/\s+/g, " ").trim(), max);
}

/**
 * Repair a display name that is just the kebab-case id echoed back
 * (the model wrote `"id": "obs-fold-unfolding", "name":
 * "obs-fold-unfolding"`). A display name is plain words, never a slug,
 * so split the slug into words and capitalize the first. Idempotent:
 * a proper name slugifies to something else and passes through, and a
 * proper name that slugifies to the id (e.g. "Retry logic" from
 * "retry-logic") humanizes back to itself.
 */
function humanizeSlug(slug: string): string {
  const words = slug.split("-").filter((w) => w !== "");
  if (words.length === 0) return "";
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

/**
 * Validate one reader plotline payload against the review's hunk IDs.
 * `known` holds the review's canonical `h:<fileKey>:<hash>` ids. Empty
 * input (the reader named none) is valid: every hunk reads as "other".
 */
export function normalizePlotlines(input: unknown, known: ReadonlySet<string>): NormalizedPlotlines {
  const empty: NormalizedPlotlines = {
    plotlines: [],
    assignment: {},
    dropped: { unknown: [], duplicates: [] as string[], extraPlotlines: 0 },
  };
  if (!Array.isArray(input)) return empty;
  const plotlines: Plotline[] = [];
  const assignment: Record<string, string> = {};
  const unknown: string[] = [];
  const duplicates: string[] = [];
  const seenIds = new Set<string>();
  let extraPlotlines = 0;
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const name = typeof rec["name"] === "string" ? cleanLine(rec["name"], 40) : "";
    if (name === "") continue;
    if (plotlines.length >= MAX_PLOTLINES) {
      extraPlotlines += 1;
      continue;
    }
    const wantId = typeof rec["id"] === "string" && rec["id"].trim() !== "" ? slugify(rec["id"]) : slugify(name);
    // The name must not be the kebab-case id echoed back: repair it
    // into a display name rather than store (or drop) a slug.
    const displayName = slugify(name) === wantId ? humanizeSlug(wantId) : name;
    let id = wantId;
    for (let n = 2; seenIds.has(id); n++) id = `${wantId}-${n}`;
    seenIds.add(id);
    const description =
      typeof rec["description"] === "string" ? cleanLine(rec["description"], 140) : "";
    const buildsOnRaw = typeof rec["buildsOn"] === "string" && rec["buildsOn"].trim() !== "" ? slugify(rec["buildsOn"]) : undefined;
    const hunks = Array.isArray(rec["hunks"]) ? rec["hunks"] : [];
    for (const h of hunks) {
      if (typeof h !== "string") continue;
      const target = h.trim();
      const parsed = parseId(target);
      const canonical = parsed?.kind === "h" ? `h:${parsed.fileKey}:${parsed.contentHash}` : null;
      if (canonical === null || !known.has(canonical)) {
        unknown.push(target);
        continue;
      }
      if (assignment[canonical] !== undefined) {
        duplicates.push(target);
        continue;
      }
      assignment[canonical] = id;
    }
    plotlines.push({ id, name: displayName, description, ...(buildsOnRaw !== undefined ? { buildsOn: buildsOnRaw } : {}) });
  }
  // `buildsOn` must name another plotline in the same list (landing
  // order means it should be an earlier one, but any known id is kept);
  // unknown or self references are dropped, never stored dangling.
  for (const p of plotlines) {
    if (p.buildsOn !== undefined && (p.buildsOn === p.id || !seenIds.has(p.buildsOn))) delete p.buildsOn;
  }
  return { plotlines, assignment, dropped: { unknown, duplicates, extraPlotlines } };
}

// --- hide levels (issue #325) --------------------------------------------------

/**
 * The diff toolbar's level selector, replacing both the old
 * Hide-uninteresting toggle and the per-hunk score filter buttons.
 * Each level includes the ones before it:
 * - `all`: nothing hidden.
 * - `uninteresting` (default): hunks with a `hiddenReason`, as before.
 * - `routine`: also hides `mechanical` hunks.
 * - `substantive`: shows only `substantive` and `needs-attention`.
 * - `needs-attention`: shows only `needs-attention`.
 * A transient per-hunk expand (clicking a hidden row or its citation,
 * issue #342) shows that hunk until the next level change or reload;
 * choosing a level always re-applies it from scratch. A hunk with no
 * score yet is never hidden by its score. Guide-cited hunks hide like
 * any other (owner decision, #325); clicking their citation reveals
 * them through the transient expand.
 */
export const HIDE_LEVELS = ["all", "uninteresting", "routine", "substantive", "needs-attention"] as const;
export type HideLevel = (typeof HIDE_LEVELS)[number];
export const DEFAULT_HIDE_LEVEL: HideLevel = "uninteresting";
export const HIDE_LEVEL_LABELS: Record<HideLevel, string> = {
  all: "All",
  uninteresting: "Hide uninteresting",
  routine: "≥ routine",
  substantive: "≥ substantive",
  "needs-attention": "Needs attention",
};
/** Score shown beside a selector option, when the level is a score floor. */
export const HIDE_LEVEL_SCORES: Partial<Record<HideLevel, HunkScoreLevel>> = {
  routine: "routine",
  substantive: "substantive",
  "needs-attention": "needs-attention",
};
export function normalizeHideLevel(value: unknown): HideLevel | null {
  if (typeof value !== "string") return null;
  return (HIDE_LEVELS as readonly string[]).includes(value) ? (value as HideLevel) : null;
}
/** Lowest score a level shows, or undefined when it sets no score floor. */
export function hideLevelFloor(level: HideLevel): HunkScoreLevel | undefined {
  return HIDE_LEVEL_SCORES[level];
}
export interface HideHunkInput {
  hiddenReason?: string;
  score?: HunkScoreLevel;
  added: number;
  removed: number;
}

/**
 * The menu's categories (owner redesign, #325), least to most
 * important. The stored hide level is one threshold over this list:
 * it hides every category up to a point. `needs-attention` is never
 * hidden, so the threshold ranges over indexes -1 (none) to 3.
 */
export const HIDE_CATEGORIES = ["uninteresting", "mechanical", "routine", "substantive", "needs-attention"] as const;
export type HideCategory = (typeof HIDE_CATEGORIES)[number];
export const HIDE_CATEGORY_LABELS: Record<HideCategory, string> = {
  uninteresting: "Uninteresting",
  mechanical: "Mechanical",
  routine: "Routine",
  substantive: "Substantive",
  "needs-attention": "Needs attention",
};
/** Highest category index a level hides (-1 hides nothing). */
export function hideLevelHiddenUpTo(level: HideLevel): number {
  switch (level) {
    case "all": return -1;
    case "uninteresting": return 0;
    case "routine": return 1;
    case "substantive": return 2;
    case "needs-attention": return 3;
  }
}
/** The stored level hiding categories up to `upTo` (clamped to -1..3). */
export function hideLevelForHiddenUpTo(upTo: number): HideLevel {
  switch (Math.max(-1, Math.min(3, upTo))) {
    case -1: return "all";
    case 0: return "uninteresting";
    case 1: return "routine";
    case 2: return "substantive";
    default: return "needs-attention";
  }
}
/**
 * The level after clicking a menu category: clicking a shown category
 * hides it and everything less important; clicking a hidden category
 * shows it and everything more important. Needs attention is always
 * shown, so clicking it changes nothing.
 */
export function hideLevelAfterCategoryClick(level: HideLevel, category: HideCategory): HideLevel {
  const idx = HIDE_CATEGORIES.indexOf(category);
  if (idx === HIDE_CATEGORIES.length - 1) return level;
  const upTo = hideLevelHiddenUpTo(level);
  return hideLevelForHiddenUpTo(idx <= upTo ? idx - 1 : idx);
}
/**
 * Which menu category a hunk belongs to: a hide reason (past the
 * one-line exemption) wins over the score; a hunk with neither
 * belongs to no category and is never hidden.
 */
export function hunkCategory(hunk: HideHunkInput): HideCategory | null {
  if (hunk.hiddenReason && hunk.added + hunk.removed > 1) return "uninteresting";
  return hunk.score ?? null;
}
/** Why a level would hide this hunk, ignoring cited/unhidden overrides. */
export function hideCategoryForLevel(
  hunk: HideHunkInput,
  level: HideLevel,
): "uninteresting" | HunkScoreLevel | null {
  const cat = hunkCategory(hunk);
  if (cat === null) return null;
  return HIDE_CATEGORIES.indexOf(cat) <= hideLevelHiddenUpTo(level) ? cat : null;
}
export function shouldHideAtLevel(
  hunk: HideHunkInput,
  level: HideLevel,
  opts: { unhidden?: boolean } = {},
): boolean {
  // Only a transient UI expand exempts a hunk (issue #342: cleared on
  // level change, never persisted); guide citations do not exempt it
  // (owner decision, #325) — clicking a citation expands instead.
  if (opts.unhidden) return false;
  return hideCategoryForLevel(hunk, level) !== null;
}
export interface HideLevelStats {
  total: number;
  hidden: number;
  uninteresting: number;
  mechanical: number;
  routine: number;
  substantive: number;
  keptShown: number;
}
export function hideLevelStats(
  hunks: Iterable<HideHunkInput & { unhidden?: boolean }>,
  level: HideLevel,
): HideLevelStats {
  const stats: HideLevelStats = {
    total: 0, hidden: 0, uninteresting: 0, mechanical: 0, routine: 0, substantive: 0, keptShown: 0,
  };
  for (const h of hunks) {
    stats.total += 1;
    const cat = hideCategoryForLevel(h, level);
    if (cat === null) continue;
    if (h.unhidden) { stats.keptShown += 1; continue; }
    stats.hidden += 1;
    if (cat === "uninteresting") stats.uninteresting += 1;
    else if (cat === "mechanical") stats.mechanical += 1;
    else if (cat === "routine") stats.routine += 1;
    else if (cat === "substantive") stats.substantive += 1;
  }
  return stats;
}
/**
 * The toolbar button's short state (issue #325): the true hidden
 * count, or "All shown" only when nothing is hidden.
 */
export function hideButtonLabel(stats: HideLevelStats): string {
  return stats.hidden > 0 ? `Hiding ${stats.hidden}` : "All shown";
}
export function formatHideLevelStats(stats: HideLevelStats): string {
  const parts: string[] = [];
  if (stats.uninteresting > 0) parts.push(`${stats.uninteresting} uninteresting`);
  if (stats.mechanical > 0) parts.push(`${stats.mechanical} mechanical`);
  if (stats.routine > 0) parts.push(`${stats.routine} routine`);
  if (stats.substantive > 0) parts.push(`${stats.substantive} substantive`);
  let text = `Hiding ${stats.hidden} of ${stats.total} ${stats.total === 1 ? "hunk" : "hunks"}`;
  if (parts.length > 0) text += `: ${parts.join(", ")}`;
  if (stats.keptShown > 0) text += ` · ${stats.keptShown} kept because shown`;
  return text;
}

// --- diff filter -------------------------------------------------------------

/**
 * The diff's plotline filter. Absent means "all". Applies at hunk
 * level and composes with every other filter (hide level, name, type,
 * reviewed): a hunk shows only when all of them pass, and files with
 * no passing hunk drop out. Unlike the hide level it is an explicit
 * choice, so it also applies to guide-cited hunks. Score filtering
 * lives in the hide level above (issue #325), not here.
 */
export interface DiffFilter {
  /** Plotline id, or "other" for unassigned hunks. Absent = all. */
  plotline?: string;
  /**
   * Issue #351: true shows only hunks changed or added since the
   * baseline (the snapshot's `sinceHunks`); composes with the plotline
   * filter and every other filter.
   */
  sinceBaseline?: boolean;
}

/**
 * True when a hunk with this plotline passes the filter; a hunk with
 * no plotline reads as "other".
 */
export function hunkMatchesFilter(
  plotline: string | undefined,
  filter: DiffFilter | undefined,
): boolean {
  if (!filter || filter.plotline === undefined) return true;
  return (plotline ?? PLOTLINE_OTHER_ID) === filter.plotline;
}
