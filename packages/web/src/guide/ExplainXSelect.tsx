/**
 * X selector for Explain-since-X (issue #413): an earlier version, any
 * PR commit, or the reviewer's own last GitHub review. Choosing X never
 * stores anything and never starts a run — it only arms the Explain
 * button beside it. The end is always the head.
 */
import { useMemo } from "react";
import type { Review, ReviewSnapshot } from "@unvibe/shared";
import { shortBaselineSha } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { Select, type SelectEntry } from "../ui/index.js";
import { priorReviewDate, usePriorGithubReview } from "./usePriorGithubReview.js";

export type ExplainX = { version: number } | { sha: string };

function optionValue(x: ExplainX): string {
  return "version" in x ? `version:${x.version}` : `sha:${x.sha.toLowerCase()}`;
}

function parseOption(value: string): ExplainX | null {
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

/**
 * The X an Explain run explains from when the reviewer picks nothing:
 * the stored X, else the version last opened. Pure. Mirrors the
 * service's `resolveSinceBaseline` without the commit kind (nothing is
 * stored until the reviewer records one).
 */
export function defaultExplainX(snapshot: ReviewSnapshot): ExplainX | null {
  const stored = snapshot.sinceBaseline;
  if (stored?.kind === "version") return { version: stored.version };
  if (stored?.kind === "commit") return { sha: stored.sha };
  const status = snapshot.versionStatus;
  const cur = snapshot.review.currentVersion;
  const fallback =
    typeof status?.fromVersion === "number" && status.fromVersion >= 1 && status.fromVersion < cur
      ? status.fromVersion
      : Math.max(1, cur - 1);
  return cur > 1 ? { version: fallback } : null;
}

/** Short label for the Explain button (`v1`, `abc12345`). Pure. */
export function explainXLabel(x: ExplainX): string {
  return "version" in x ? `v${x.version}` : shortBaselineSha(x.sha);
}

function buildEntries(review: Review, commits: { sha: string; subject: string }[], priorSha: string | null, priorWhen: string | null): SelectEntry[] {
  const entries: SelectEntry[] = [];
  const current = review.currentVersion;
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
  if (priorSha) {
    const covered = commits.some((c) => c.sha.toLowerCase() === priorSha.toLowerCase());
    if (!covered) {
      entries.push({
        label: "GitHub reviews",
        options: [
          {
            value: `sha:${priorSha.toLowerCase()}`,
            label: `Your last GitHub review (${shortBaselineSha(priorSha)}${priorWhen ? `, ${priorWhen}` : ""})`,
          },
        ],
      });
    }
  }
  return entries;
}

export function ExplainXSelect({
  reviewId,
  value,
  onChange,
  id,
}: {
  reviewId: string;
  /** Null means the default X (stored, else the version last opened). */
  value: ExplainX | null;
  onChange: (x: ExplainX | null) => void;
  id?: string;
}) {
  const snapshot = useReview((s) => s.snapshot);
  const review = snapshot?.review;
  const prior = usePriorGithubReview(reviewId);
  const entries = useMemo(
    () =>
      review
        ? buildEntries(
            review,
            snapshot?.commits ?? [],
            prior ? prior.sha : null,
            prior ? priorReviewDate(prior.submittedAt) : null,
          )
        : [],
    [review, snapshot?.commits, prior],
  );
  if (!review || entries.length === 0) return null;
  const def = snapshot ? defaultExplainX(snapshot) : null;

  const pick = (picked: string): void => {
    if (picked === "") {
      onChange(null);
      return;
    }
    const parsed = parseOption(picked);
    if (!parsed) return;
    onChange(parsed);
  };

  return (
    <span className="since-pick" data-testid="explain-pick">
      <Select
        id={id ?? "explain-pick"}
        aria-label="Explain changes since: the version or commit to explain from"
        title="Explain changes since: the version or commit to explain from"
        value={value ? optionValue(value) : ""}
        placeholder={def ? `Since ${explainXLabel(def)} (default)` : "Pick what to explain since"}
        onValueChange={(v) => pick(v)}
        options={entries}
      />
    </span>
  );
}
