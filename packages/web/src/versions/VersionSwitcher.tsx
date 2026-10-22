/**
 * Version switcher (PRD §8 "older versions stay viewable"): a compact
 * select of `review.versions`; picking an older one navigates to
 * `?version=n`, picking the current one clears it. Rendered once in the
 * review bar next to the review identity (issue #120), so it works with
 * the guide pane hidden; the diff pane reads the same param. The current
 * version's option is annotated; an older shown version flags the select
 * with the warning border (the page's other read-only signs stay as they
 * are).
 */
import { useLocation, useNavigate } from "react-router-dom";
import { useReview } from "../state/store.js";
import { Select } from "../ui/index.js";
import { useReviewVersion } from "./useReviewVersion.js";

export function VersionSwitcher(): React.JSX.Element | null {
  const navigate = useNavigate();
  const location = useLocation();
  const viewing = useReviewVersion();
  const snapshot = useReview((s) => s.snapshot);
  const review = snapshot?.review;
  if (!review || review.versions.length < 2) return null;
  const current = review.currentVersion;
  const value = viewing ?? current;
  const readOnly = viewing !== undefined && viewing !== current;

  const pick = (n: number): void => {
    const params = new URLSearchParams(location.search);
    if (n === current) params.delete("version");
    else params.set("version", String(n));
    const search = params.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ""}`);
  };

  return (
    <span className="vs" data-testid="version-switcher" data-ro={readOnly ? "1" : undefined}>
      <Select
        id="version-pick"
        aria-label="View version"
        title="View version"
        value={String(value)}
        onValueChange={(v) => pick(Number(v))}
        options={review.versions.map((v) => ({
          value: String(v.n),
          label: `v${v.n} · ${v.headSha.slice(0, 8)}${v.n === current ? " · current" : ""}`,
        }))}
      />
    </span>
  );
}
