/**
 * PR description tab (web-guide owner; PRD §4.11, read-only for now).
 *
 * - Description HTML with paragraph ids (`desc:` citation targets). For a
 *   branch without a PR the service renders the commit messages into the
 *   same HTML (`source: "commits"`).
 * - "Restated →" links (`button.back[data-back]`): emitted by later
 *   description generations when present in the HTML, and otherwise added
 *   here from `description.restated` (paragraph → guide block ids derived
 *   from the guide's `desc:` citations). They jump back to the guide block
 *   that restates the paragraph (scroll + highlight on the guide).
 * - Editing seam: pass `editor` (implemented by a later milestone) to
 *   enable in-place editing when `description.editable` is set. Without it
 *   the tab is strictly read-only.
 */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // "Restated →" links from the snapshot mapping (paragraph → guide block
  // ids). Appended after the matching paragraph element; the click
  // delegation below jumps to the guide block. Re-applied whenever the
  // HTML or the mapping changes (re-renders wipe manual DOM).
  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !description || editing) return;
    const restated = description.restated ?? {};
    for (const [paragraphId, blockIds] of Object.entries(restated)) {
      if (blockIds.length === 0) continue;
      let el: Element | null = null;
      try {
        el = root.querySelector(`#${CSS.escape(paragraphId)}`);
      } catch {
        continue;
      }
      if (!el || el.querySelector("button.back[data-back]")) continue;
      const btn = document.createElement("button");
      btn.className = "back";
      btn.type = "button";
      btn.setAttribute("data-back", blockIds[0]);
      btn.textContent = blockIds.length > 1 ? `Restated → (${blockIds.length})` : "Restated →";
      btn.title = "Show the guide block that restates this paragraph";
      el.appendChild(btn);
    }
  }, [description, editing]);

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

  const byline =
    description.author !== undefined || description.state !== undefined
      ? `by ${description.author ?? "unknown"}${description.state ? ` · ${description.state}` : ""}`
      : null;

  return (
    <>
      {byline ? (
        <div className="dbar">
          <span className="hint">{byline}</span>
          <span className="sp" />
        </div>
      ) : null}
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
          ref={bodyRef}
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
