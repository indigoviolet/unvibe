/**
 * Preview-build badge (issue #36, step 2): when the running build is a
 * preview, a short pill (preview · source branch · short commit) linking
 * to Settings → Version, with the full detail in its tooltip. Renders
 * nothing otherwise. Shown full-size in the Settings/Start headers; on a review
 * page (issue #141, no application top bar there) only a compact "preview"
 * marker in the review bar carries the full text as its hover title.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { UpdateBuildInfo } from "@unvibe/shared";
import { api } from "../api/client.js";
import { badgeLabel, badgeTitle } from "../settings/versionFormat.js";

export function PreviewBuildBadge({ compact, disabled }: { compact?: boolean; disabled?: boolean }): React.JSX.Element | null {
  const off = disabled ? { "aria-disabled": true as const, tabIndex: -1, onClick: (e: React.MouseEvent) => e.preventDefault() } : {};
  const [build, setBuild] = useState<UpdateBuildInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .health()
      .then((h) => {
        if (!cancelled) setBuild(h.build ?? null);
      })
      .catch(() => {
        // Offline or old build without the field: no badge.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!build?.sourceBranch) return null;
  const full = badgeTitle(build);
  if (compact) {
    return (
      <Link
        className="pill preview-mini"
        data-testid="preview-marker"
        to="/settings?tab=version"
        title={full}
        {...off}
      >
        preview
      </Link>
    );
  }
  return (
    <Link
      className="pill"
      data-testid="preview-badge"
      to="/settings?tab=version"
      title={full}
      {...off}
    >
      {badgeLabel(build)}
    </Link>
  );
}
