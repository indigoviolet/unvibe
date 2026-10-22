/**
 * Top bar, shared by every screen but reviews (issue #141: a review page
 * shows only its review bar): only app-wide things. The "Unvibe" home
 * link, a breadcrumb after it on every screen but the start page, the
 * preview-build badge where it shows today (start page, Settings), the
 * documents screen as a note-icon button (issue #222), and Settings as a
 * gear icon button in the same place on every screen. The Settings screen
 * itself renders no Settings button.
 */
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { PreviewBuildBadge } from "./PreviewBuildBadge.js";

export interface Crumb {
  label: string;
  /** Absent for the current page (rendered with `aria-current="page"`). */
  to?: string;
}

export function ScreenTopBar({
  crumbs,
  showBadge,
  hideSettings,
}: {
  /** Breadcrumb trail after the home link; omit on the start page. */
  crumbs?: Crumb[];
  showBadge?: boolean;
  /** Set on the Settings screen (it needs no Settings button). */
  hideSettings?: boolean;
}): React.JSX.Element {
  return (
    <header className="top">
      <Link className="brand" to="/" title="Back to the start page">
        Unvibe
      </Link>
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="tcrumbs">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="tcrumb">
              <span aria-hidden="true" className="tsep">
                /
              </span>
              {c.to ? (
                <Link to={c.to}>{c.label}</Link>
              ) : (
                <h1 aria-current="page">{c.label}</h1>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <span className="sp" />
      {showBadge ? <PreviewBuildBadge /> : null}
      <Link className="ib bd" to="/documents" aria-label="Documents" title="Documents">
        <Icon name="doc" />
      </Link>
      {hideSettings ? null : (
        <Link className="ib bd" to="/settings" aria-label="Settings" title="Settings">
          <Icon name="gear" />
        </Link>
      )}
    </header>
  );
}
