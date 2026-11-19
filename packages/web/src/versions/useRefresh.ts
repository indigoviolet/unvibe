/**
 * Shared refresh handler (#241, banner removed in #427): the same
 * check-and-refresh the diff toolbar owned, now triggered from the
 * review top bar button. Behaviour is unchanged — same `api.refresh`
 * call, same "already up to date" vs silent PR-state update (#230).
 * New commits land in the snapshot (and the history menu reads them
 * off it). Document reviews never refresh (no git source, like the
 * diff toolbar before the move).
 */
import { useCallback, useState } from "react";
import { isDocumentReview } from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { refreshErrorNotice } from "./versionUtils.js";

export function useRefresh(reviewId: string): {
  refreshing: boolean;
  doRefresh: () => Promise<void>;
} {
  const [refreshing, setRefreshing] = useState(false);

  const doRefresh = useCallback(async () => {
    const snapNow = useReview.getState().snapshot;
    if (snapNow && isDocumentReview(snapNow)) return;
    setRefreshing(true);
    try {
      const prevDesc = useReview.getState().snapshot?.description;
      const r = await api.refresh(reviewId);
      if (r.newVersion) {
        useReview.getState().setSnapshot(await api.review(reviewId));
      } else {
        // #230: same-head refresh still updates PR state/decision — refetch
        // so the bar changes even if the WS patch is delayed. Silent when
        // only the PR state moved; "Already up to date" only when truly
        // unchanged.
        const fresh = await api.review(reviewId);
        useReview.getState().setSnapshot(fresh);
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
      setRefreshing(false);
    }
  }, [reviewId]);

  return { refreshing, doRefresh };
}
