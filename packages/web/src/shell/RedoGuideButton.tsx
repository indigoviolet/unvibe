/**
 * Re-do guide (#345, moved from the Debug page where it lived as
 * `RedoGuideSection`, issue #115): delete + create in one step from an
 * icon button in the review top bar.
 *
 * Reuses the existing delete and create paths through one service call,
 * so "same as delete + create" stays true by construction: the review
 * gets a new id and the page navigates to its loading state (the same
 * page a fresh open lands on). The confirmation states what delete +
 * create discards today. Never offered for the demo review; hidden when
 * ingest failed or is empty; disabled with a reason while the review is
 * still opening.
 *
 * The confirm is deliberately minimal — a confirming state with Re-do /
 * Cancel (the old section's logic, inline in the bar) — so issue #346's
 * shared inline-confirm component can swap it out. Escape and
 * outside-click cancel; while re-doing the primary button reads
 * "Re-doing…" and service errors render inline.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { STATIC_DEMO } from "../demo.js";
import { useReview } from "../state/store.js";
import { Button } from "../ui/index.js";

const CONFIRM_COPY =
  "Remove the guide, comments, notes and jobs, and open this change again as a new review? " +
  "Anything already on GitHub stays there.";

export function RedoGuideButton({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const navigate = useNavigate();
  const snapshot = useReview((s) => s.snapshot);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const redoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setConfirming(false);
    setBusy(false);
    setError(null);
  }, [reviewId]);

  useEffect(() => {
    if (!confirming) return;
    redoRef.current?.focus();
    const onPointer = (e: PointerEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setConfirming(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setConfirming(false);
        redoRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [confirming]);

  if (snapshot === null || STATIC_DEMO) return null;
  if (snapshot.review.repoId === "demo") return null;
  const ingestStatus = snapshot.ingest?.status ?? "ready";
  // The review page's Retry owns reviews that failed to open.
  if (ingestStatus === "failed" || ingestStatus === "empty") return null;

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

  if (ingestStatus === "loading") {
    return (
      <button
        className="ib bd"
        type="button"
        data-tip="The review is still opening."
        aria-label="Re-do guide"
        title="The review is still opening."
        disabled
      >
        <Icon name="redo" />
      </button>
    );
  }

  if (confirming) {
    // Two small buttons only, so the bar holds its row at any width
    // (exactly the shape #346's shared inline-confirm will take over).
    // The copy and any error stay in the accessibility tree plus the
    // Re-do tooltip, rather than a sentence squeezed into the row.
    const notice = error ? `Couldn't re-do the guide: ${error}` : CONFIRM_COPY;
    return (
      <span ref={wrapRef} className="frow" style={{ gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
        <span className="sr-only" role={error ? "alert" : undefined}>
          {notice}
        </span>
        <Button
          ref={redoRef}
          variant="primary"
          size="sm"
          type="button"
          data-tip={notice}
          title={notice}
          disabled={busy}
          onClick={() => void redo()}
        >
          {busy ? "Re-doing…" : "Re-do"}
        </Button>
        <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </span>
    );
  }

  return (
    <button
      className="ib bd"
      type="button"
      data-tip="Re-do guide"
      aria-label="Re-do guide"
      title="Re-do guide"
      onClick={() => {
        setError(null);
        setConfirming(true);
      }}
    >
      <Icon name="redo" />
    </button>
  );
}
