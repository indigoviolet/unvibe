/**
 * The no-review-yet offer (issue #351 step 2): the reviewer already
 * reviewed this PR on GitHub, up to a commit B. One line plus a checkbox,
 * in the existing hint style, shown while the guide is still empty. On:
 * the reader is told the reviewer already reviewed up to B and writes
 * the normal guide plus the Since-B section in the same run. Off:
 * back to the normal whole-PR guide. Setting or clearing it never
 * starts an agent run. Toggling after the guide lands is impossible —
 * the offer only renders while no guide cards exist. A failed pick
 * leaves a persistent inline error under the offer until the baseline
 * changes.
 */
import { useState } from "react";
import type { PriorGithubReview } from "@unvibe/shared";
import { shortBaselineSha } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { Checkbox } from "../ui/index.js";
import { SinceBaselineError } from "./SinceBaselinePicker.js";
import { priorReviewDate, usePriorGithubReview } from "./usePriorGithubReview.js";

function offerText(prior: PriorGithubReview): string {
  const when = priorReviewDate(prior.submittedAt);
  return `You reviewed this at ${shortBaselineSha(prior.sha)}${when ? ` on ${when}` : ""}; focus on changes since then?`;
}

export function PriorReviewOffer({ reviewId, prior }: { reviewId: string; prior: PriorGithubReview }) {
  const snapshot = useReview((s) => s.snapshot);
  const setSnapshot = useReview((s) => s.setSnapshot);
  const [saving, setSaving] = useState(false);
  const baseline = snapshot?.sinceBaseline;
  const checked = baseline?.kind === "commit" && baseline.sha.toLowerCase() === prior.sha.toLowerCase();

  const toggle = async (on: boolean): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      if (on) {
        await api.setSinceBaseline(reviewId, { sha: prior.sha });
      } else {
        await api.clearSinceBaseline(reviewId);
      }
      setSnapshot(await api.review(reviewId));
    } catch (err) {
      // A failed commit pick records `sinceError`, shown persistently
      // inline under the offer — no toast then.
      const snap = await api.review(reviewId).catch(() => null);
      if (snap) setSnapshot(snap);
      if (!snap?.sinceError) toast(`Couldn't set the baseline: ${friendlyError(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="prior-review-offer">
      <label className="hint prior-review-offer">
        <Checkbox
          checked={checked}
          onChange={(v) => void toggle(v)}
          id="prior-review-focus"
          testId="prior-review-checkbox"
          disabled={saving}
        />
        <span>{offerText(prior)}</span>
      </label>
      <SinceBaselineError testId="prior-review-error" />
    </div>
  );
}

/**
 * The offer slot for the guide's building states: renders the offer only
 * while a prior review is known and no guide cards exist yet (once the
 * reader streams cards, the offer is gone — toggling then would miss the
 * run). Null otherwise, so the loading states read as before.
 */
export function PriorReviewOfferSlot({ reviewId }: { reviewId: string }) {
  const snapshot = useReview((s) => s.snapshot);
  const prior = usePriorGithubReview(reviewId);
  if (!prior) return null;
  const hasCards =
    (snapshot?.pages ?? []).some((p) => p.cards.length > 0) ||
    (snapshot?.sinceSection?.cards.length ?? 0) > 0;
  if (hasCards) return null;
  return <PriorReviewOffer reviewId={reviewId} prior={prior} />;
}
