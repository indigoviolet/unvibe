/**
 * Preview-build badge (issue #36, step 2): when the running build is a
 * preview, a small quiet pill naming the source branch + short commit,
 * linking to Settings → Version (where you switch back). Renders nothing
 * otherwise. Shown in the review top bar and the Settings/Start headers.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { UpdateBuildInfo } from "@unvibe/shared";
import { api } from "../api/client.js";
import { shortCommit } from "../settings/versionFormat.js";

export function PreviewBuildBadge(): React.JSX.Element | null {
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
  const sha = shortCommit(build.commit);
  return (
    <Link
      className="pill"
      data-testid="preview-badge"
      to="/settings#version"
      title={`Preview build ${build.version} from ${build.sourceBranch}${sha ? ` (${sha})` : ""} — open Settings → Version to switch back.`}
    >
      preview · {build.sourceBranch}
      {sha ? ` · ${sha}` : ""}
    </Link>
  );
}
