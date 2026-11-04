/**
 * Baseline picker (issue #351): choose the baseline B — any earlier
 * version, any PR commit, or your own last GitHub review — that the next
 * update pass explains from. Versions and commit diffs compare by hunk
 * content (rebase-proof); a commit that is no longer fetchable fails
 * loudly here instead of silently. Setting it recomputes the since-hunk
 * set and persists the pick with the review. A refresh that can no longer
 * fetch a commit B keeps the previous hunk set and says so next to the
 * picker (`sinceError`).
 */
import { useState } from "react";
import type { Review, SinceBaseline } from "@unvibe/shared";
import { shortBaselineSha } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { Select, type SelectEntry } from "../ui/index.js";
import { priorReviewDate, usePriorGithubReview } from "./usePriorGithubReview.js";

function optionValue(b: SinceBaseline): string {
  return b.kind === "version" ? `version:${b.version}` : `sha:${b.sha.toLowerCase()}`;
}

function parseOption(value: string): { version: number } | { sha: string } | null {
  if (value.startsWith("version:")) {
    const n = Number(value.slice("version:".length));
    return Number.isSafeInteger(n) ? { version: n } : null;
  }
  if (value.startsWith("sha:")) {
    const sha = value.slice("sha:".length).toLowerCase();
    return /^[0-9a-f]{4,64}$/i.test(sha) ? { sha } : null;
  }
  return null;
}

export function SinceBaselinePicker({ reviewId, review }: { reviewId: string; review: Review }) {
  const snapshot = useReview((s) => s.snapshot);
  const setSnapshot = useReview((s) => s.setSnapshot);
  const [saving, setSaving] = useState(false);
  const prior = usePriorGithubReview(reviewId);
  const current = review.currentVersion;
  const baseline = snapshot?.sinceBaseline;
  const commits = snapshot?.commits ?? [];

  const entries: SelectEntry[] = [];
  const versionOptions = review.versions
    .filter((v) => v.n < current)
    .map((v) => ({
      value: `version:${v.n}`,
      label: `v${v.n} · ${v.headSha.slice(0, 8)}`,
    }));
  if (versionOptions.length > 0) entries.push({ label: "Versions", options: versionOptions });
  if (commits.length > 0) {
    entries.push({
      label: "Commits",
      options: commits.map((c) => ({
        value: `sha:${c.sha.toLowerCase()}`,
        label: `${c.sha.slice(0, 8)} ${c.subject}`,
      })),
    });
  }
  if (prior) {
    const sha = prior.sha.toLowerCase();
    const covered = commits.some((c) => c.sha.toLowerCase() === sha);
    if (!covered) {
      const when = priorReviewDate(prior.submittedAt);
      entries.push({
        label: "GitHub reviews",
        options: [
          {
            value: `sha:${sha}`,
            label: `Your last GitHub review (${shortBaselineSha(sha)}${when ? `, ${when}` : ""})`,
          },
        ],
      });
    }
  }
  if (entries.length === 0) return null;

  const pick = async (value: string): Promise<void> => {
    const parsed = parseOption(value);
    if (!parsed || saving) return;
    if (baseline && optionValue(baseline) === value) return;
    setSaving(true);
    try {
      await api.setSinceBaseline(reviewId, parsed);
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
        aria-label="Baseline: the version or commit the next update explains from"
        title="Baseline: the version or commit the next update explains from"
        value={baseline ? optionValue(baseline) : ""}
        placeholder="Pick a baseline"
        disabled={saving}
        onValueChange={(v) => void pick(v)}
        options={entries}
      />
      {snapshot?.sinceError ? (
        <span className="hint" data-testid="since-error">
          {snapshot.sinceError}
        </span>
      ) : null}
    </span>
  );
}
