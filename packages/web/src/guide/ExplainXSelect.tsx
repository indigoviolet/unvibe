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

export function optionValue(x: ExplainX): string {
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
 * True when X is the current head (a version at/after the current
 * one, or the head commit): explaining from it is an empty range and
 * the route refuses it with 409. Pure.
 */
export function isHeadX(snapshot: ReviewSnapshot, x: ExplainX): boolean {
  if ("version" in x) return x.version >= snapshot.review.currentVersion;
  const head = snapshot.version.headSha.toLowerCase();
  const sha = x.sha.toLowerCase();
  return sha === head || head.startsWith(sha) || sha.startsWith(head);
}

/**
 * The X an Explain run explains from when the reviewer picks nothing:
 * the stored X, else the version last opened — never the head itself
 * (issue #413: a head default would start a paid call on an empty
 * range). Pure. Mirrors the service's `resolveSinceBaseline`, minus
 * the head fallback.
 */
export function defaultExplainX(snapshot: ReviewSnapshot): ExplainX | null {
  const stored = snapshot.sinceBaseline;
  const raw: ExplainX | null =
    stored?.kind === "version"
      ? { version: stored.version }
      : stored?.kind === "commit"
        ? { sha: stored.sha }
        : (() => {
            const status = snapshot.versionStatus;
            const cur = snapshot.review.currentVersion;
            if (cur <= 1) return null;
            const fallback =
              typeof status?.fromVersion === "number" && status.fromVersion >= 1 && status.fromVersion < cur
                ? status.fromVersion
                : Math.max(1, cur - 1);
            return { version: fallback };
          })();
  if (!raw || isHeadX(snapshot, raw)) return null;
  return raw;
}

/** Short label for the Explain button (`v1`, `abc12345`). Pure. */
export function explainXLabel(x: ExplainX): string {
  return "version" in x ? `v${x.version}` : shortBaselineSha(x.sha);
}

function buildEntries(
  snapshot: ReviewSnapshot,
  review: Review,
  commits: { sha: string; subject: string }[],
  priorSha: string | null,
  priorWhen: string | null,
): SelectEntry[] {
  const entries: SelectEntry[] = [];
  const current = review.currentVersion;
  // The head is never an X: explaining from it is an empty range.
  const earlier = commits.filter((c) => !isHeadX(snapshot, { sha: c.sha }));
  const prior = priorSha && !isHeadX(snapshot, { sha: priorSha }) ? priorSha : null;
  const versionOptions = review.versions
    .filter((v) => v.n < current)
    .map((v) => ({
      value: `version:${v.n}`,
      label: `v${v.n} · ${v.headSha.slice(0, 8)}`,
    }));
  if (versionOptions.length > 0) entries.push({ label: "Versions", options: versionOptions });
  if (earlier.length > 0) {
    entries.push({
      label: "Commits",
      options: earlier.map((c) => ({
        value: `sha:${c.sha.toLowerCase()}`,
        label: `${c.sha.slice(0, 8)} ${c.subject}`,
      })),
    });
  }
  if (prior) {
    const covered = earlier.some((c) => c.sha.toLowerCase() === prior.toLowerCase());
    if (!covered) {
      entries.push({
        label: "GitHub reviews",
        options: [
          {
            value: `sha:${prior.toLowerCase()}`,
            label: `Your last GitHub review (${shortBaselineSha(prior)}${priorWhen ? `, ${priorWhen}` : ""})`,
          },
        ],
      });
    }
  }
  return entries;
}

/** True when `x` is one of the offered choices. Pure. */
export function entriesHave(entries: SelectEntry[], x: ExplainX): boolean {
  const v = optionValue(x);
  return entries.some((e) => ("options" in e ? e.options.some((o) => o.value === v) : (e as { value?: string }).value === v));
}

/**
 * The X choices for this review (#413): earlier versions, PR commits
 * other than the head, and the reviewer's last GitHub review when it is
 * not the head. Empty means there is nothing earlier to explain from.
 */
export function useExplainEntries(reviewId: string): SelectEntry[] {
  const snapshot = useReview((s) => s.snapshot);
  const prior = usePriorGithubReview(reviewId);
  return useMemo(
    () =>
      snapshot
        ? buildEntries(
            snapshot,
            snapshot.review,
            snapshot.commits ?? [],
            prior ? prior.sha : null,
            prior ? priorReviewDate(prior.submittedAt) : null,
          )
        : [],
    [snapshot, prior],
  );
}

export function ExplainXSelect({
  reviewId,
  value,
  onChange,
  placeholder,
  id,
}: {
  reviewId: string;
  /** The armed X (the picked one, else the default), or null. */
  value: ExplainX | null;
  onChange: (x: ExplainX | null) => void;
  /** Shown when nothing is armed; never repeated on the button. */
  placeholder: string;
  id?: string;
}) {
  const entries = useExplainEntries(reviewId);
  if (entries.length === 0) return null;

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
        placeholder={placeholder}
        onValueChange={(v) => pick(v)}
        options={entries}
      />
    </span>
  );
}
