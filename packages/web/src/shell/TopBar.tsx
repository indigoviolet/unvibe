/** Top bar: home link, review identity, Tips, Settings, Submit review slot, Source toggle. */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReviewSummary } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { SubmitPanel } from "./SubmitPanel.js";
import { TipsButton } from "./Tips.js";

interface Props {
  reviewId: string;
  pendingCount: number;
  sourceOpen: boolean;
  onToggleSource: () => void;
}

export function TopBar({ reviewId, pendingCount, sourceOpen, onToggleSource }: Props) {
  void pendingCount;
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
  const num = owner && name ? (prNumber !== undefined ? `${owner}/${name}#${prNumber}` : `${owner}/${name}`) : null;
  const rootTitle = snapshot?.pages.find((p) => p.kind === "root")?.title;
  const title =
    summary?.title && summary.title !== "Guided review"
      ? summary.title
      : rootTitle && rootTitle !== "Guided review"
        ? rootTitle
        : branch || reviewId;

  return (
    <header className="top">
      <Link className="brand" to="/" title="Back to the start screen">
        Unvibe
      </Link>
      <div className="pr">
        {num ? <span className="num">{num}</span> : null}
        <b title={title}>{title}</b>
      </div>
      <TipsButton />
      <Link className="tbtn" to={`/review/${encodeURIComponent(reviewId)}/debug`}>
        Debug
      </Link>
      <Link className="tbtn" to="/settings">
        Settings
      </Link>
      <SubmitPanel reviewId={reviewId} />
      <button
        className="tbtn"
        id="toggleRight"
        type="button"
        aria-pressed={sourceOpen}
        onClick={onToggleSource}
      >
        Source
      </button>
    </header>
  );
}
