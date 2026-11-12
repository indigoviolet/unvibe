/**
 * Guide copy control for the review top bar (issue #384).
 *
 * One copy icon next to the other review-level icon buttons
 * (Refresh / Debug): the whole root guide as Markdown — the review
 * title as `#`, then each main root card in guide order as `##` plus
 * its Guide-version prose at shown depth. Same icon, tooltip and toast
 * as the card copy control (#377). Read-only like every other toolbar
 * action: no job, no settings.
 *
 * Hidden wherever there is no guide to copy (document reviews,
 * loading / failed / empty opens), the way the other review-only
 * buttons hide. Copies the root guide wherever the user is in the
 * review (finding / concept pages included).
 */
import { guideToMarkdown, isDefaultGuideTitle, isDocumentReview } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { useReviewIdentity } from "../shell/reviewIdentity.js";
import { copyContextFor, copyMarkdownText, useGithubRepo } from "./copyAsMarkdown.js";

export function GuideCopyButton({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const snapshot = useReview((s) => s.snapshot);
  const githubRepo = useGithubRepo();
  const { title: identityTitle } = useReviewIdentity(reviewId);
  if (snapshot === null || isDocumentReview(snapshot)) return null;
  if ((snapshot.ingest?.status ?? "ready") !== "ready") return null;
  const root = snapshot.pages.find((p) => p.kind === "root") ?? snapshot.pages[0];
  if (!root) return null;

  const copyGuide = (): void => {
    const snap = useReview.getState().snapshot;
    if (!snap) {
      toast("The review is still loading");
      return;
    }
    const page = snap.pages.find((p) => p.kind === "root") ?? snap.pages[0];
    if (!page) {
      toast("The review is still loading");
      return;
    }
    const { ctx, findPage } = copyContextFor(snap, githubRepo);
    // The same title the guide header shows: the review title for a
    // default-stored root, else the root's own title.
    copyMarkdownText(
      guideToMarkdown(
        isDefaultGuideTitle(page.title) ? identityTitle : page.title,
        page.cards
          .filter((c) => !c.pending)
          .map((c) => ({ title: c.title, blocks: c.blocks, level: c.level })),
        ctx,
        { findPage },
      ),
    );
  };

  return (
    <button
      className="ib bd"
      type="button"
      data-tip="Copy guide as Markdown"
      aria-label="Copy guide as Markdown"
      data-copy-guide
      onClick={copyGuide}
    >
      <Icon name="copy" />
    </button>
  );
}
