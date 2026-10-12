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
import { mergedProvenance, shortCommit } from "../settings/versionFormat.js";

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
  // Prefer the branch-side commit (the merge result in `commit` names no
  // branch); fall back to it for older builds without the field.
  const sha = shortCommit(build.sourceCommit ?? build.commit);
  const merged = mergedProvenance(build);
  return (
    <Link
      className="pill"
      data-testid="preview-badge"
      to="/settings?tab=version"
      title={`Preview build ${build.version} from ${merged ?? build.sourceBranch}${sha && !merged ? ` (${sha})` : ""} — open Settings → Version to switch back.`}
    >
      preview · {merged ?? build.sourceBranch}
      {sha ? ` · ${sha}` : ""}
    </Link>
  );
}
