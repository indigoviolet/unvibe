/**
 * The reviewer's own latest GitHub review on this PR (issue #351 step 2).
 *
 * `undefined` while loading, `null` when there is none (not a PR review,
 * no prior review by the user, or GitHub unreachable — the endpoint is
 * best-effort and never errors), otherwise the review's `commit_id`,
 * submit time and author. The offer line and the baseline picker share
 * this hook so the endpoint is hit once per mount.
 */
import { useEffect, useState } from "react";
import type { PriorGithubReview } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";

export function usePriorGithubReview(reviewId: string): PriorGithubReview | null | undefined {
  const prNumber = useReview((s) => s.snapshot?.review.prNumber);
  const [prior, setPrior] = useState<PriorGithubReview | null | undefined>(undefined);
  useEffect(() => {
    if (prNumber === undefined) {
      setPrior(null);
      return;
    }
    let live = true;
    setPrior(undefined);
    api
      .priorGithubReview(reviewId)
      .then(
        (res) => {
          if (live) setPrior(res.review);
        },
        () => {
          if (live) setPrior(null);
        },
      )
      .catch(() => {
        if (live) setPrior(null);
      });
    return () => {
      live = false;
    };
  }, [reviewId, prNumber]);
  return prior;
}

/** `4 Nov` style date for an ISO timestamp, matching `sinceDate`. Pure. */
export function priorReviewDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })}`;
}
