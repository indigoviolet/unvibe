/**
 * Re-do guide (#345, moved from the Debug page where it lived as
 * `RedoGuideSection`, issue #115): delete + create in one step from an
 * icon button in the review top bar.
 *
 * Reuses the existing delete and create paths through one service call,
 * so "same as delete + create" stays true by construction: the review
 * gets a new id and the page navigates to its loading state (the same
 * page a fresh open lands on). Never offered for the demo review;
 * hidden when ingest failed or is empty; disabled with a reason while
 * the review is still opening.
 *
 * The confirm is #346's shared inline confirm with a toolbar icon
 * button as its idle control: clicking it expands in place into
 * "Confirm re-do guide" with ✓ and ✕. The what-is-lost copy lives in
 * the pill's accessible name; a rejection stays inline in the pill
 * (retry or cancel), so nothing is squeezed into the bar's row.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { STATIC_DEMO } from "../demo.js";
import { useReview } from "../state/store.js";
import { InlineConfirm } from "../ui/index.js";

const CONFIRM_COPY =
  "Remove the guide, comments, notes and jobs, and open this change again as a new review? " +
  "Anything already on GitHub stays there.";

export function RedoGuideButton({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const navigate = useNavigate();
  const snapshot = useReview((s) => s.snapshot);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [reviewId]);

  if (snapshot === null || STATIC_DEMO) return null;
  if (snapshot.review.repoId === "demo") return null;
  const ingestStatus = snapshot.ingest?.status ?? "ready";
  // The review page's Retry owns reviews that failed to open.
  if (ingestStatus === "failed" || ingestStatus === "empty") return null;

  const redo = async (): Promise<void> => {
    const snap = await api.redoReview(reviewId);
    navigate(`/review/${encodeURIComponent(snap.review.id)}`);
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

  return (
    <InlineConfirm
      action="Re-do guide"
      confirmAction="re-do guide"
      runningLabel="Re-doing…"
      danger
      size="sm"
      open={open}
      onOpenChange={setOpen}
      onConfirm={redo}
      formatError={(err) => `Couldn't re-do the guide: ${friendlyError(err)}`}
      announce={`${CONFIRM_COPY} Confirm re-do guide, or cancel.`}
      idleRender={({ ref, expanded, disabled, onOpen }) => (
        <button
          ref={ref}
          className="ib bd"
          type="button"
          data-tip="Re-do guide"
          aria-label="Re-do guide"
          aria-expanded={expanded}
          title="Re-do guide"
          disabled={disabled}
          onClick={onOpen}
        >
          <Icon name="redo" />
        </button>
      )}
    />
  );
}
