/**
 * Guide column slot (`/review/:id` left pane).
 * Owner: guide agent. Renders the review snapshot once the service fills it in.
 */
import { useEffect } from "react";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";

export function GuidePage({ reviewId }: { reviewId: string }) {
  const snapshot = useReview((s) => s.snapshot);
  const setSnapshot = useReview((s) => s.setSnapshot);

  useEffect(() => {
    let cancelled = false;
    api
      .review(reviewId)
      .then((snap) => {
        if (!cancelled) setSnapshot(snap);
      })
      .catch(() => {
        // Scaffold: service stubs return 501; the shell still renders.
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, setSnapshot]);

  return (
    <div className="doc">
      <div className="eyebrow">Guided review</div>
      <h1 className="title">Review {reviewId}</h1>
      <p className="hint">
        Scaffold placeholder. The guide agent owns this directory: pages, cards, depth stepper,
        examples/diagrams, expansions, findings, hover previews.
      </p>
      {snapshot && (
        <p className="prov">
          snapshot rev {snapshot.rev} · {snapshot.pages.length} pages
        </p>
      )}
    </div>
  );
}
