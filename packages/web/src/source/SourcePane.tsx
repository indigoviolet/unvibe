/**
 * Source pane: `PR description` / `Diff` tabs.
 * Diff and description bodies live in their own directories for parallel owners.
 *
 * `revealSource` (see `source/diff/revealSource.ts` + `source/reveal.ts`)
 * switches tabs from anywhere: this pane listens for its window event and
 * opens the description tab for `desc:` refs, the diff tab otherwise.
 */
import { Fragment, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDiffCommentBindings } from "../comments/DiffComments.js";
import { ErrorBoundary, InlineFallback } from "../components/ErrorBoundary.js";
import { performFollowUp } from "../guide/actions.js";
import { useDiffExpansionBindings } from "../guide/expansions/DiffExpansions.js";
import { showGuidePane } from "../shell/panes.js";
import { useReview } from "../state/store.js";
import { DescriptionView } from "./description/DescriptionView.js";
import { descriptionPaneName } from "./description/paneName.js";
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
  const ingestStatus = useReview((s) => s.snapshot?.ingest?.status ?? "ready");
  const pages = useReview((s) => s.snapshot?.pages);
  const lookupPage = (id: string): import("@unvibe/shared").Page | undefined =>
    pages?.find((p) => p.id === id);
  const onOpenPage = (pageId: string): void => {
    // "Open as page" from a diff expansion navigates to the guide: bring
    // the guide pane back when only the source pane is showing (#83).
    showGuidePane();
    navigate(`/review/${reviewId}/page/${encodeURIComponent(pageId)}`);
  };
  const onFollowUp = (cardId: string, blockId: string, index: number): void => {
    performFollowUp(reviewId, cardId, blockId, index);
  };
  const diffComments = useDiffCommentBindings(reviewId);
  const diffExpansions = useDiffExpansionBindings(reviewId, lookupPage, onOpenPage, onFollowUp);
  // A comment and a conversation card share a line's slot row: merge
  // the content instead of letting one map overwrite the other (the
  // card used to vanish when a comment landed on its line).
  const lineSlots = useMemo(() => {
    const merged: Record<string, React.ReactNode> = { ...diffExpansions.lineSlots };
    for (const [key, node] of Object.entries(diffComments.lineSlots)) {
      const prev = merged[key];
      merged[key] = prev ? <Fragment key={key}>{prev}{node}</Fragment> : node;
    }
    return merged;
  }, [diffExpansions.lineSlots, diffComments.lineSlots]);
  // Line-number icons mark comment threads only (expansions use the dotted
  // link); slot rows still render for both via `lineSlots`.
  const commentedLines = diffComments.commentedLines;
  // Finding 22: branch reviews (no PR) name this tab "Commits".
  const snapshot = useReview((s) => s.snapshot);
  useEffect(() => {
    const onReveal = (e: Event): void => {
      const ref = (e as CustomEvent<{ ref?: unknown }>).detail?.ref;
      onTab(typeof ref === "string" && ref.startsWith("desc:") ? "desc" : "diff");
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, [onTab]);

  // #92: no diff/description/comments while loading or failed (service also
  // 409s). After all hooks so the hook order never changes.
  if (ingestStatus === "loading" || ingestStatus === "failed") {
    return (
      <div className="doc">
        <p className="hint">
          {ingestStatus === "loading" ? "The diff appears here once the review opens." : "No diff — the review couldn't be opened."}
        </p>
      </div>
    );
  }

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
            {descriptionPaneName(snapshot)}
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
      <ErrorBoundary
        name="source-pane"
        resetKey={`${reviewId}:${tab}`}
        fallback={({ reset }) => (
          <InlineFallback message="Couldn't show the source pane: something went wrong" onRetry={reset} />
        )}
      >
        {tab === "desc" ? (
          <DescriptionView reviewId={reviewId} />
        ) : (
          <DiffView
            reviewId={reviewId}
            lineSlots={lineSlots}
            floatingExpansions={diffExpansions.floatingByHunk}
            commentedLines={commentedLines}
            onLineClick={diffComments.onLineClick}
            lookupPage={lookupPage}
            onOpenPage={onOpenPage}
            onFollowUp={onFollowUp}
          />
        )}
      </ErrorBoundary>
    </>
  );
}
