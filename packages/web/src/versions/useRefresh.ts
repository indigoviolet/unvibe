/**
 * Shared refresh handler (#241): the same check-and-refresh the diff
 * toolbar owned, now triggered from the review top bar. Behaviour is
 * unchanged — same `api.refresh` call, same "already up to date" vs silent
 * PR-state update (#230), same banner data for the "new commits available"
 * UI, same error notice. Document reviews never refresh (no git source,
 * like the diff toolbar before the move).
 */
import { useCallback } from "react";
import { isDocumentReview } from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { comparisonToBanner, type BannerCounts } from "./VersionBanner.js";
import { useRefreshState } from "./refreshStore.js";
import { refreshErrorNotice } from "./versionUtils.js";

export function useRefresh(reviewId: string): {
  refreshing: boolean;
  banner: BannerCounts | null;
  doRefresh: () => Promise<void>;
  clearBanner: () => void;
} {
  const banner = useRefreshState((s) => s.bannerByReview[reviewId] ?? null);
  const refreshing = useRefreshState((s) => s.refreshingByReview[reviewId] ?? false);

  const doRefresh = useCallback(async () => {
    const snapNow = useReview.getState().snapshot;
    if (snapNow && isDocumentReview(snapNow)) return;
    useRefreshState.getState().setRefreshing(reviewId, true);
    try {
      const prevDesc = useReview.getState().snapshot?.description;
      const r = await api.refresh(reviewId);
      if (r.newVersion && r.comparison) {
        const snap = useReview.getState().snapshot;
        const current = snap?.review.currentVersion ?? r.comparison.newVersion;
        useRefreshState.getState().setBanner(reviewId, comparisonToBanner(r.comparison, current));
        useReview.getState().setSnapshot(await api.review(reviewId));
      } else {
        // #230: same-head refresh still updates PR state/decision — refetch
        // so the bar changes even if the WS patch is delayed. Silent when
        // only the PR state moved; "Already up to date" only when truly
        // unchanged.
        const fresh = await api.review(reviewId);
        useReview.getState().setSnapshot(fresh);
        useRefreshState.getState().setBanner(reviewId, null);
        const nextDesc = fresh.description;
        const stateSame =
          (prevDesc?.state ?? null) === (nextDesc?.state ?? null) &&
          (prevDesc?.isDraft ?? false) === (nextDesc?.isDraft ?? false) &&
          (prevDesc?.reviewDecision ?? null) === (nextDesc?.reviewDecision ?? null);
        if (stateSame) toast("Already up to date");
      }
    } catch (err) {
      toast(refreshErrorNotice(err));
    } finally {
      useRefreshState.getState().setRefreshing(reviewId, false);
    }
  }, [reviewId]);

  const clearBanner = useCallback(() => {
    useRefreshState.getState().setBanner(reviewId, null);
  }, [reviewId]);

  return { refreshing, banner, doRefresh, clearBanner };
}
