/**
 * Top bar, shared by every screen but reviews (issue #141: a review page
 * shows only its review bar): only app-wide things. The "Unvibe" home
 * link with the documents screen as a note-icon button beside it (issue
 * #222, moved left in #238), a breadcrumb after them on every screen but
 * the start page, the preview-build badge where it shows today (start
 * page, Settings) with the compact full-access marker beside it (#235:
 * both appear only on the front page), and Settings as a gear icon
 * button in the same place on every screen. The Settings screen itself
 * renders no Settings button.
 */
import { Link } from "react-router";
import { Icon } from "../components/Icon.js";
import { FullAccessMarker } from "./FullAccessMarker.js";
import { PreviewBuildBadge } from "./PreviewBuildBadge.js";
import { UpdateIcon } from "./UpdateIcon.js";
import { Wordmark } from "./Wordmark.js";

export interface Crumb {
  label: string;
  /** Absent for the current page (rendered with `aria-current="page"`). */
  to?: string;
}

export function ScreenTopBar({
  crumbs,
  showBadge,
  hideSettings,
  disabled,
}: {
  /** Breadcrumb trail after the home link; omit on the start page. */
  crumbs?: Crumb[];
  showBadge?: boolean;
  /** Set on the Settings screen (it needs no Settings button). */
  hideSettings?: boolean;
  /**
   * #311: every control stays visible but inert on the data-format
   * notice — aria-disabled, not focusable, not clickable, muted.
   */
  disabled?: boolean;
}): React.JSX.Element {
  const off = disabled
    ? {
        "aria-disabled": true as const,
        tabIndex: -1,
        onClick: (e: React.MouseEvent) => e.preventDefault(),
      }
    : {};
  return (
    <header className="top" style={disabled ? { opacity: 0.55 } : undefined}>
      <Link className="brand" to="/" title="Back to the start page" aria-label="Unvibe" {...off}>
        <Wordmark />
      </Link>
      <Link className="ib bd" to="/documents" aria-label="Documents" title="Documents" {...off}>
        <Icon name="doc" />
      </Link>
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="tcrumbs">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="tcrumb">
              <span aria-hidden="true" className="tsep">
                /
              </span>
              {c.to ? (
                <Link to={c.to} {...off}>{c.label}</Link>
              ) : (
                <h1 aria-current="page">{c.label}</h1>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <span className="sp" />
      {showBadge ? <PreviewBuildBadge disabled={disabled} /> : null}
      {showBadge ? <FullAccessMarker compact disabled={disabled} /> : null}
      <UpdateIcon disabled={disabled} />
      {hideSettings ? null : (
        <Link className="ib bd" to="/settings" aria-label="Settings" title="Settings" {...off}>
          <Icon name="gear" />
        </Link>
      )}
    </header>
  );
}
