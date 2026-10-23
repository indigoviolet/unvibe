/**
 * Top-bar update icon (issue #231): a small icon next to the Settings
 * icon when a newer release is out than the running build (tooltip
 * "Update available: vX.Y.Z"), linking to Settings → Version. Renders
 * nothing otherwise — up to date, or the check cannot run. Session-cached
 * (see `updateCheck.ts`): checked on app load and when Settings → Version
 * refreshes; never polls, never errors.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon.js";
import { getUpdateAvailable, subscribeUpdateCheck, type UpdateCheckState } from "./updateCheck.js";

export function UpdateIcon(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateCheckState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getUpdateAvailable().then((s) => {
      if (!cancelled) setState(s);
    });
    const unsub = subscribeUpdateCheck((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const version = state?.update?.version;
  if (!version) return null;
  const label = `Update available: v${version}`;
  return (
    <Link
      className="ib bd"
      to="/settings?tab=version"
      aria-label={label}
      title={label}
      data-testid="update-available-icon"
    >
      <Icon name="gift" />
    </Link>
  );
}
