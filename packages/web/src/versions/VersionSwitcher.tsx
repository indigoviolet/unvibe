/**
 * Version switcher + read-only notice (PRD §8 "older versions stay
 * viewable"): a compact select of `review.versions`; picking an older one
 * navigates to `?version=n`, picking current clears it. Rendered in the
 * guide column above the page; the diff pane reads the same param.
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
    <div className="frow" style={{ gap: 8, marginBottom: 4 }} data-testid="version-switcher">
      <label className="hint" htmlFor="version-pick">
        Version
      </label>
      <select
        id="version-pick"
        aria-label="View version"
        value={value}
        onChange={(e) => pick(Number(e.target.value))}
        style={{
          border: "1px solid var(--line)",
          borderRadius: 6,
          padding: "2px 6px",
          background: "var(--surface)",
          color: "var(--ink)",
          fontSize: 12.5,
        }}
      >
        {review.versions.map((v) => (
          <option key={v.n} value={v.n}>
            v{v.n}
            {v.n === current ? " (current)" : ""} · {v.headSha.slice(0, 8)}
          </option>
        ))}
      </select>
      {readOnly ? (
        <span className="hint" role="status">
          Viewing v{viewing} · read-only ·{" "}
          <button type="button" className="x" onClick={() => pick(current)}>
            Back to current
          </button>
        </span>
      ) : null}
    </div>
  );
}
