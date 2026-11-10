/**
 * Top-N hunk-summary selection (issue #376). Pure: the service and the web
 * both use it, so the auto pass, Summarize more, and the diff header agree
 * on which hunks are covered and in what order.
 *
 * Order: `source` first, then `tests`, then `config`, then `docs`.
 * `generated` files are never auto-summarised. Within a category the order
 * is the diff order (file order, then hunk order): stable and matching
 * what the diff view shows. Hunsk hidden at the review's hide level are
 * never auto-summarised either, and neither are hunks that already carry
 * a summary or have a live summary job.
 */
import type { FileCategory } from "./entities.js";

/** Category rank for summary selection: source, tests, config, docs. */
export const HUNK_SUMMARY_CATEGORY_ORDER: readonly FileCategory[] = [
  "source",
  "tests",
  "config",
  "docs",
] as const;

function categoryRank(category: FileCategory): number {
  const rank = HUNK_SUMMARY_CATEGORY_ORDER.indexOf(category);
  // `generated` never reaches the sort (filtered first); rank it last so a
  // caller that forgets the filter still never prefers it.
  return rank === -1 ? HUNK_SUMMARY_CATEGORY_ORDER.length : rank;
}

export interface HunkSummaryCandidate {
  contentHash: string;
  category: FileCategory;
  /** Hidden at the review's current hide level — never auto-selected. */
  hidden: boolean;
  /** Already carries a summary for this content hash. */
  hasSummary: boolean;
  /** A live (queued, running, backing off) summary job exists. */
  hasLiveJob: boolean;
  /** Diff order: file index first, then hunk index within the file. */
  order: number;
}

export interface SelectHunkSummaryTargetsOptions {
  /** Max hunks to select (the `hunkSummaryLimit` setting); <= 0 selects none. */
  limit: number;
  /**
   * Content hashes cited by the guide. After the reader lands, cited
   * hunks take priority within the same budget (issue #376 §4); at
   * ingest no guide exists yet, so this stays empty.
   */
  cited?: ReadonlySet<string>;
}

/**
 * Pick up to `limit` content hashes for automatic summarising: cited
 * first (when given), then category order, then diff order. Skips
 * generated files, hidden hunks, hunks with summaries, and hunks with
 * live jobs. Summarize more reuses this over the still-missing hunks,
 * which is what makes it "the next N in the same order".
 */
export function selectHunkSummaryTargets(
  candidates: HunkSummaryCandidate[],
  opts: SelectHunkSummaryTargetsOptions,
): string[] {
  if (opts.limit <= 0) return [];
  const cited = opts.cited;
  const eligible = candidates.filter(
    (c) => c.category !== "generated" && !c.hidden && !c.hasSummary && !c.hasLiveJob,
  );
  eligible.sort((a, b) => {
    if (cited) {
      const ac = cited.has(a.contentHash) ? 0 : 1;
      const bc = cited.has(b.contentHash) ? 0 : 1;
      if (ac !== bc) return ac - bc;
    }
    const rank = categoryRank(a.category) - categoryRank(b.category);
    if (rank !== 0) return rank;
    return a.order - b.order;
  });
  return eligible.slice(0, opts.limit).map((c) => c.contentHash);
}

/** Count hunks without a summary (the diff header's "of Y" remainder). */
export function countMissingSummaries(
  candidates: Pick<HunkSummaryCandidate, "hasSummary">[],
): number {
  return candidates.filter((c) => !c.hasSummary).length;
}
