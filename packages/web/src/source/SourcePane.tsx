/**
 * Source pane: `PR description` / `Diff` tabs.
 * Diff and description bodies live in their own directories for parallel owners.
 *
 * `revealSource` (see `source/diff/revealSource.ts` + `source/reveal.ts`)
 * switches tabs from anywhere: this pane listens for its window event and
 * opens the description tab for `desc:` refs, the diff tab otherwise.
 */
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDiffCommentBindings } from "../comments/DiffComments.js";
import { performFollowUp } from "../guide/actions.js";
import { useDiffExpansionBindings } from "../guide/expansions/DiffExpansions.js";
import { useReview } from "../state/store.js";
import { DescriptionView } from "./description/DescriptionView.js";
import { DiffView } from "./diff/DiffView.js";
import { REVEAL_EVENT } from "./diff/revealSource.js";

export type SourceTab = "desc" | "diff";

interface Props {
  reviewId: string;
  tab: SourceTab;
  onTab: (tab: SourceTab) => void;
}

export function SourcePane({ reviewId, tab, onTab }: Props) {
  const navigate = useNavigate();
  const pages = useReview((s) => s.snapshot?.pages);
  const lookupPage = (id: string): import("@unvibe/shared").Page | undefined =>
    pages?.find((p) => p.id === id);
  const onOpenPage = (pageId: string): void => {
    navigate(`/review/${reviewId}/page/${encodeURIComponent(pageId)}`);
  };
  const onFollowUp = (cardId: string, blockId: string, index: number): void => {
    performFollowUp(reviewId, cardId, blockId, index);
  };
  const diffComments = useDiffCommentBindings(reviewId);
  const diffExpansions = useDiffExpansionBindings(reviewId, lookupPage, onOpenPage, onFollowUp);
  const lineSlots = useMemo(
    () => ({ ...diffExpansions.lineSlots, ...diffComments.lineSlots }),
    [diffExpansions.lineSlots, diffComments.lineSlots],
  );
  // Line-number icons mark comment threads only (expansions use the dotted
  // link); slot rows still render for both via `lineSlots`.
  const commentedLines = diffComments.commentedLines;
  useEffect(() => {
    const onReveal = (e: Event): void => {
      const ref = (e as CustomEvent<{ ref?: unknown }>).detail?.ref;
      onTab(typeof ref === "string" && ref.startsWith("desc:") ? "desc" : "diff");
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [onTab]);

  return (
    <>
      <div className="rstick">
        <div className="tabs" role="tablist">
          <button
            className="tab"
            role="tab"
            type="button"
            aria-selected={tab === "desc"}
            onClick={() => onTab("desc")}
          >
            PR description
          </button>
          <button
            className="tab"
            role="tab"
            type="button"
            aria-selected={tab === "diff"}
            onClick={() => onTab("diff")}
          >
            Diff
          </button>
        </div>
      </div>
      {tab === "desc" ? (
        <DescriptionView reviewId={reviewId} />
      ) : (
        <DiffView
          reviewId={reviewId}
          lineSlots={lineSlots}
          commentedLines={commentedLines}
          onLineClick={diffComments.onLineClick}
        />
      )}
    </>
  );
}
