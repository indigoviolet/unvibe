/**
 * Native folder-picker button (#26, unmounted until #31 lands).
 *
 * A browser folder picker cannot supply an absolute path, so the dialog is
 * opened by the service on the user's own machine
 * (`POST /api/repos/pick-folder`). The button:
 * - shows a busy state while the dialog is open,
 * - calls `onPick` with the chosen absolute path,
 * - does nothing when the user dismisses the dialog,
 * - shows the reason as an inline hint on "unavailable" so the user falls
 *   back to typing the path.
 *
 * Not mounted anywhere yet: after #31 merges this moves into the Settings
 * Repositories section beside the path field. Styling reuses the prototype
 * classes (`btn`, `mini`, `hint`).
 */
import { useState } from "react";
import { api, friendlyError } from "../api/client.js";

export function BrowseFolderButton({ onPick }: { onPick: (path: string) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const browse = async (): Promise<void> => {
    setBusy(true);
    setHint(null);
    try {
      const res = await api.pickFolder();
      if (res.status === "picked") {
        onPick(res.path);
      } else if (res.status === "unavailable") {
        setHint(res.reason);
      }
      // Cancelled: do nothing.
    } catch (err) {
      setHint(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="frow" style={{ gap: 6, alignItems: "center" }}>
      <button
        className="btn mini"
        type="button"
        onClick={() => void browse()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Choosing…" : "Browse…"}
      </button>
      {hint ? (
        <span className="hint" role="status">
          {hint}
        </span>
      ) : null}
    </span>
  );
}
