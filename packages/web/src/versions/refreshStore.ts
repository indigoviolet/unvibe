/**
 * Refresh state shared by the review top bar button (#241) and the diff
 * pane banner (PRD §8). The button lives in `ReviewBar`; the "new commits
 * available" banner still renders in the diff pane from the same data.
 *
 * Banner + refreshing live here (per review id) so the bar can trigger the
 * same handler the diff toolbar used to own, and the diff pane can show the
 * same UI without prop-drilling through `AppShell`/`SourcePane`.
 */
import { create } from "zustand";
import type { BannerCounts } from "./VersionBanner.js";

interface RefreshState {
  bannerByReview: Record<string, BannerCounts>;
  refreshingByReview: Record<string, boolean>;
  setBanner: (reviewId: string, banner: BannerCounts | null) => void;
  setRefreshing: (reviewId: string, refreshing: boolean) => void;
  clearReview: (reviewId: string) => void;
}

export const useRefreshState = create<RefreshState>()((set) => ({
  bannerByReview: {},
  refreshingByReview: {},
  setBanner: (reviewId, banner) =>
    set((s) => {
      if (banner === null) {
        if (!(reviewId in s.bannerByReview)) return s;
        const next = { ...s.bannerByReview };
        delete next[reviewId];
        return { bannerByReview: next };
      }
      return { bannerByReview: { ...s.bannerByReview, [reviewId]: banner } };
    }),
  setRefreshing: (reviewId, refreshing) =>
    set((s) => ({
      refreshingByReview: { ...s.refreshingByReview, [reviewId]: refreshing },
    })),
  clearReview: (reviewId) =>
    set((s) => {
      const bannerByReview = { ...s.bannerByReview };
      delete bannerByReview[reviewId];
      const refreshingByReview = { ...s.refreshingByReview };
      delete refreshingByReview[reviewId];
      return { bannerByReview, refreshingByReview };
    }),
}));
