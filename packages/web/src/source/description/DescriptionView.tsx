/**
 * PR description tab (M2, web-guide owner; PRD §4.11, read-only for now).
 *
 * - Author line, description HTML with paragraph ids.
 * - "Restated →" links (`button.back[data-back]`) jump back to the guide
 *   block that restates the paragraph (scroll + highlight on the guide).
 * - Branch without a PR: commit messages instead, read-only.
 * - Editing seam: pass `editor` (implemented by the M4 milestone) to enable
 *   in-place editing for the PR author on an open PR. Without it the tab is
 *   strictly read-only.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { api } from "../../api/client.js";
import { toast } from "../../floating/Toast.js";
import { requestGuideBlock } from "../../guide/GuidePage.js";
import { isMockMode } from "../../mock/loadGuideFixture.js";
import { useReview } from "../../state/store.js";

/**
 * Editing seam (M4). Implementations render the in-place editor replacing
 * the read-only body; `onSave` receives edited HTML with paragraph ids
 * preserved (PRD §4.11), `onDiscard` returns to read-only.
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

  const initials = description.author.slice(0, 2).toUpperCase();
  const canEdit = editor !== undefined && description.isAuthor && !description.merged;
  const authorLine =
    `<div class="author"><span class="av ai">${initials}</span>` +
    `${description.author} opened this · ${description.merged ? "merged into main" : "open"}</div>`;

  const onSave = (html: string): void => {
    setEditing(false);
    if (isMockMode()) {
      toast("Description edits post to GitHub on Submit review (M4).");
      return;
    }
    api.updateDescription(reviewId, { html }).catch((err: unknown) => {
      toast(`Saving the description failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

  return (
    <>
      {description.isAuthor && !description.merged ? null : (
        <div className="dbar">
          <span className="hint">You{"'"}re reviewing someone else{"'"}s PR, so the description is read-only.</span>
          <span className="sp" />
        </div>
      )}
      {canEdit && !editing ? (
        <div className="dbar">
          <span className="hint">You authored this PR.</span>
          <span className="sp" />
          <button className="x" type="button" data-descedit onClick={() => setEditing(true)}>
            Edit description
          </button>
        </div>
      ) : null}
      {editing && editor ? (
        <div className="desc">{editor.render({ html: description.html, onSave, onDiscard: () => setEditing(false) })}</div>
      ) : (
        <div
          onClick={(e) => {
            const back = (e.target as HTMLElement).closest?.("button.back[data-back]");
            if (!back) return;
            const blockId = back.getAttribute("data-back") ?? "";
            const restated = description.restated.find((r) => r.blockId === blockId);
            if (restated) requestGuideBlock(restated.cardId, restated.blockId);
          }}
        >
          {description.commits ? (
            <div className="desc">
              <div className="author">
                <span className="av ai">{initials}</span>
                {description.author} opened this · {description.merged ? "merged into main" : "open"}
              </div>
              <div className="commits">
                {description.commits.map((c) => (
                  <p className="para" key={c.sha} id={`commit-${c.sha.slice(0, 8)}`}>
                    <code>{c.sha.slice(0, 8)}</code> {c.subject}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <div
              className="desc"
              dangerouslySetInnerHTML={{ __html: withAuthor(description.html, authorLine) }}
            />
          )}
        </div>
      )}
    </>
  );
}

/** Insert the author line right inside the description wrapper. */
function withAuthor(html: string, authorLine: string): string {
  if (html.includes('<div class="desc">')) {
    return html.replace('<div class="desc">', `<div class="desc">${authorLine}`);
  }
  return `${authorLine}${html}`;
}
