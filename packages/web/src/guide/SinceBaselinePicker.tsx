/**
 * Baseline picker (issue #351 step 1): choose the baseline B — any
 * earlier version — that the next update pass explains from. A plain
 * select of existing versions; picking an arbitrary commit belongs to
 * step 2. Setting it recomputes the since-hunk set from the stored
 * version diffs (content comparison, rebase-proof) and persists the
 * pick with the review.
 */
import { useState } from "react";
import type { Review } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { Select } from "../ui/index.js";

export function SinceBaselinePicker({ reviewId, review }: { reviewId: string; review: Review }) {
  const snapshot = useReview((s) => s.snapshot);
  const setSnapshot = useReview((s) => s.setSnapshot);
  const [saving, setSaving] = useState(false);
  const current = review.currentVersion;
  if (review.versions.length < 2) return null;
  const baseline = snapshot?.sinceBaseline?.version ?? current - 1;

  const pick = async (version: number): Promise<void> => {
    if (version === baseline || saving) return;
    setSaving(true);
    try {
      await api.setSinceBaseline(reviewId, { version });
      setSnapshot(await api.review(reviewId));
    } catch (err) {
      toast(`Couldn't set the baseline: ${friendlyError(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="since-pick" data-testid="since-pick">
      <Select
        id="since-pick"
        aria-label="Baseline: the version the next update explains from"
        title="Baseline: the version the next update explains from"
        value={String(baseline)}
        disabled={saving}
        onValueChange={(v) => void pick(Number(v))}
        options={review.versions
          .filter((v) => v.n < current)
          .map((v) => ({
            value: String(v.n),
            label: `Since v${v.n} · ${v.headSha.slice(0, 8)}`,
          }))}
      />
    </span>
  );
}
