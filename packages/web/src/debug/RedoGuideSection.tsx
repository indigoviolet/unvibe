/**
 * Re-do guide (#115): delete + create in one step from the Debug page.
 *
 * Reuses the existing delete and create paths through one service call,
 * so "same as delete + recreate" stays true by construction: the review
 * gets a new id and the page navigates to its loading state (the same
 * page a fresh open lands on). The confirmation states what delete +
 * create discards today. Never offered for the demo review; disabled
 * with a reason while the review is still opening.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, friendlyError } from "../api/client.js";

export function RedoGuideSection({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const navigate = useNavigate();
  const [repoId, setRepoId] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRepoId(null);
    setIngestStatus(null);
    setConfirming(false);
    setError(null);
    api
      .review(reviewId)
      .then((snap) => {
        if (cancelled) return;
        setRepoId(snap.review.repoId);
        setIngestStatus(snap.ingest?.status ?? "ready");
      })
      .catch(() => {
        // Offline: leave the section hidden rather than guessing.
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId]);

  if (repoId === null || ingestStatus === null) return null;
  // Never offered for the demo review; the review page's Retry owns
  // reviews that failed to open.
  if (repoId === "demo" || ingestStatus === "failed" || ingestStatus === "empty") return null;

  const redo = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const snap = await api.redoReview(reviewId);
      navigate(`/review/${encodeURIComponent(snap.review.id)}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <section aria-label="Re-do guide" style={{ marginTop: 24 }}>
      {ingestStatus === "loading" ? (
        <div className="frow" style={{ gap: 8, alignItems: "center" }}>
          <button className="btn" type="button" disabled title="The review is still opening.">
            Re-do guide
          </button>
          <span className="hint">The review is still opening.</span>
        </div>
      ) : confirming ? (
        <div className="frow" style={{ gap: 8, alignItems: "center" }}>
          <span className="hint">
            Remove the guide, comments, notes and jobs, and open this change again as a new review?
            Anything already on GitHub stays there.
          </span>
          <button className="btn" type="button" disabled={busy} onClick={() => void redo()}>
            {busy ? "Re-doing…" : "Re-do guide"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="frow" style={{ gap: 8, alignItems: "center" }}>
          <span className="hint">Start the guide over from the same change.</span>
          <button className="btn" type="button" onClick={() => setConfirming(true)}>
            Re-do guide
          </button>
        </div>
      )}
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t re-do the guide: {error}
        </p>
      ) : null}
    </section>
  );
}
