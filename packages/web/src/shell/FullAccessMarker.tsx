/**
 * Full-access marker (issue #160): a quiet pill shown while the
 * full-access setting is on, so it is never on without the user knowing.
 * Renders nothing otherwise (and nothing while the setting is unreadable).
 * Used on the front-page top bar (compact, next to the preview badge,
 * issue #235) and at the top of the Debug page.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";

export function FullAccessMarker({ compact }: { compact?: boolean }): React.JSX.Element | null {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((s) => {
        if (!cancelled) setOn(s.fullAccess === true);
      })
      .catch(() => {
        if (!cancelled) setOn(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!on) return null;
  const full =
    "Full access is on: the review helper can run commands as you. Open Settings → Access to turn it off.";
  if (compact) {
    return (
      <Link className="pill warn-mini" data-testid="full-access-marker" to="/settings?tab=access" title={full}>
        full access
      </Link>
    );
  }
  return (
    <p className="warnline" data-testid="full-access-marker" title={full}>
      Full access is on — the review helper can run commands as you.{" "}
      <Link to="/settings?tab=access">Turn it off in Settings → Access</Link>.
    </p>
  );
}
