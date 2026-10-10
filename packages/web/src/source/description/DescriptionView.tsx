/**
 * PR description tab (web-guide owner; PRD §4.11, read-only for now).
 *
 * - Description HTML with paragraph ids (`desc:` citation targets). For a
 *   branch without a PR the service renders the commit messages into the
 *   same HTML (`source: "commits"`).
 * - "Restated →" links (`button.back[data-back]`, emitted by later
 *   description generations) jump back to the guide block that restates
 *   the paragraph (scroll + highlight on the guide).
 * - Editing seam: pass `editor` (implemented by a later milestone) to
 *   enable in-place editing when `description.editable` is set. Without it
 *   the tab is strictly read-only.
 *
 * Gaps vs the snapshot (integration report): no PR author / merged state
 * (no author line) and no paragraph→block restated mapping (links render
 * only when the HTML carries them).
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { api } from "../../api/client.js";
import { toast } from "../../floating/Toast.js";
import { requestGuideBlock } from "../../guide/actions.js";
import { useReview } from "../../state/store.js";

/**
 * Editing seam (later milestone). Implementations render the in-place
 * editor replacing the read-only body; `onSave` receives edited HTML with
 * paragraph ids preserved (PRD §4.11), `onDiscard` returns to read-only.
 */
export interface DescriptionEditor {
  render(params: { html: string; onSave: (html: string) => void; onDiscard: () => void }): ReactNode;
}

interface Props {
  reviewId: string;
  editor?: DescriptionEditor;
}

export function DescriptionView({ reviewId, editor }: Props) {
  const description = useReview((s) => s.snapshot?.description);
  const [editing, setEditing] = useState(false);

  if (!description) {
    return (
      <div className="desc">
        <p className="hint">No description yet for review {reviewId}.</p>
      </div>
    );
  }

  const canEdit = editor !== undefined && description.editable;
  const html = description.pendingHtml ?? description.html;

  const onSave = (next: string): void => {
    setEditing(false);
    api.updateDescription(reviewId, { html: next }).catch((err: unknown) => {
      toast(`Saving the description failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  return (
    <>
      {description.pendingHtml ? (
        <div className="dbar">
          <span className="hint">Edited · goes to GitHub when you submit the review</span>
          <span className="sp" />
        </div>
      ) : null}
      {canEdit && !editing ? (
        <div className="dbar">
          <span className="sp" />
          <button className="x" type="button" data-descedit onClick={() => setEditing(true)}>
            Edit description
          </button>
        </div>
      ) : null}
      {editing && editor ? (
        <div className="desc">
          {editor.render({ html, onSave, onDiscard: () => setEditing(false) })}
        </div>
      ) : (
        <div
          className="desc"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(e) => {
            const back = (e.target as HTMLElement).closest?.("button.back[data-back]");
            if (!back) return;
            const blockId = back.getAttribute("data-back") ?? "";
            const snap = useReview.getState().snapshot;
            const page = snap?.pages.find((p) => p.cards.some((c) => c.id === blockId || c.blocks.some((b) => b.id === blockId)));
            const card = page?.cards.find(
              (c) => c.id === blockId || c.blocks.some((b) => b.id === blockId),
            );
            if (card) requestGuideBlock(card.id, blockId);
          }}
        />
      )}
    </>
  );
}
