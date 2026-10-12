/**
 * Review identity shared by the review top bar, the review bar and the
 * debug page: the short `owner/name#N` (or branch) label, the full title,
 * and the GitHub PR URL when the review has a PR.
 *
 * The snapshot and summaries carry no PR URL field, so the URL is the
 * canonical `github.com` pull URL built from the owner/name/number the
 * service already reports. Branch reviews and the demo (`repoId: "demo"`)
 * have no link.
 */
import { useEffect, useState } from "react";
import type { ReviewSummary } from "@unvibe/shared";
import { isDefaultGuideTitle } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";

export interface ReviewIdentity {
  /** `owner/name#N`, `owner/name`, the branch, or the review id. */
  short: string;
  /** Full title with the same fallbacks the top bar always used. */
  title: string;
  prUrl: string | null;
}

export function useReviewIdentity(reviewId: string): ReviewIdentity {
  const snapshot = useReview((s) => s.snapshot);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);

  // Review identity (owner/repo + PR number + title) from the front-screen
  // list; falls back to the loaded snapshot while it arrives.
  useEffect(() => {
    let cancelled = false;
    api
      .reviews()
      .then((r) => {
        if (!cancelled) setSummary(r.reviews.find((s) => s.id === reviewId) ?? null);
      })
      .catch(() => {
        // Offline: the snapshot fallback below still identifies the review.
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  const repoId = snapshot?.review.repoId;
  const prNumber = summary?.prNumber ?? snapshot?.review.prNumber;
  const branch = summary?.branch ?? snapshot?.review.branch ?? "";
  const owner = summary?.repoOwner ?? (repoId === "demo" ? "demo" : null);
  const name = summary?.repoName ?? (repoId === "demo" ? "urllib3-5020" : null);
  const short =
    owner && name
      ? prNumber !== undefined
        ? `${owner}/${name}#${prNumber}`
        : `${owner}/${name}`
      : branch || reviewId;
  const rootTitle = snapshot?.pages.find((p) => p.kind === "root")?.title;
  const title =
    summary?.title && !isDefaultGuideTitle(summary.title)
      ? summary.title
      : rootTitle && !isDefaultGuideTitle(rootTitle)
        ? rootTitle
        : branch || reviewId;
  const prUrl =
    prNumber !== undefined && owner && name && repoId !== "demo"
      ? `https://github.com/${owner}/${name}/pull/${prNumber}`
      : null;
  return { short, title, prUrl };
}
