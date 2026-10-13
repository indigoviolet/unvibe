/**
 * Version switcher + read-only notice (PRD §8 "older versions stay
 * viewable"): a compact select of `review.versions`; picking an older one
 * navigates to `?version=n`, picking current clears it. Rendered once in
 * the review bar next to the review identity (issue #120), so it works
 * with the guide pane hidden; the diff pane reads the same param.
 */
import { useLocation, useNavigate } from "react-router-dom";
import { useReview } from "../state/store.js";
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
      <select
        id="version-pick"
        className="tbtn"
        aria-label="View version"
        title={readOnly ? `Viewing v${viewing} · read-only` : "View version"}
        value={value}
        onChange={(e) => pick(Number(e.target.value))}
      >
        {review.versions.map((v) => (
          <option key={v.n} value={v.n}>
            v{v.n}
            {v.n === current ? " (current)" : ""} · {v.headSha.slice(0, 8)}
          </option>
        ))}
      </select>
      {readOnly ? (
        <span className="hint ro" role="status">
          <span className="words">Viewing v{viewing} · read-only · </span>
          <button type="button" className="x" onClick={() => pick(current)}>
            Back to current
          </button>
        </span>
      ) : null}
    </span>
  );
}
