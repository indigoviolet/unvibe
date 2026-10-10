/**
 * Source pane: `PR description` / `Diff` tabs plus the Comments menu slot.
 * Diff and description bodies live in their own directories for parallel owners.
 *
 * `revealSource` (see `source/diff/revealSource.ts` + `source/reveal.ts`)
 * switches tabs from anywhere: this pane listens for its window event and
 * opens the description tab for `desc:` refs, the diff tab otherwise.
 */
import { useEffect } from "react";
import { CommentsMenu } from "../comments/CommentsMenu.js";
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
          <span className="sp" />
          <CommentsMenu reviewId={reviewId} />
        </div>
      </div>
      {tab === "desc" ? <DescriptionView reviewId={reviewId} /> : <DiffView reviewId={reviewId} />}
    </>
  );
}
