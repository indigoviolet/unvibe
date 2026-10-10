/**
 * Source pane: `PR description` / `Diff` tabs plus the Comments menu slot.
 * Diff and description bodies live in their own directories for parallel owners.
 */
import { CommentsMenu } from "../comments/CommentsMenu.js";
import { DescriptionView } from "./description/DescriptionView.js";
import { DiffView } from "./diff/DiffView.js";

export type SourceTab = "desc" | "diff";

interface Props {
  reviewId: string;
  tab: SourceTab;
  onTab: (tab: SourceTab) => void;
}

export function SourcePane({ reviewId, tab, onTab }: Props) {
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
