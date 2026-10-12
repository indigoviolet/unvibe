/**
 * Data (#79): reset removes every review and everything generated for it
 * from this machine. Settings and repositories stay; nothing changes on
 * GitHub. Confirmed inline, like Remove on the start page.
 */
import { useState } from "react";
import { api, friendlyError } from "../api/client.js";

export function DataSection(): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<number | null>(null);

  const reset = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetData();
      setRemoved(res.reviewsRemoved);
      setConfirming(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Data">
      <p className="hint">
        Reset removes every review from this machine, with its guide, explanations, comments you have not
        submitted and the worktrees Unvibe made for it. Settings and repositories stay. Nothing changes on GitHub.
      </p>
      <div className="frow" style={{ gap: 8 }}>
        {confirming ? (
          <>
            <span className="hint">Remove all reviews? This cannot be undone.</span>
            <button className="btn" type="button" disabled={busy} onClick={() => void reset()}>
              {busy ? "Resetting…" : "Reset"}
            </button>
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setRemoved(null);
              setError(null);
              setConfirming(true);
            }}
          >
            Reset data…
          </button>
        )}
      </div>
      {removed !== null ? (
        <p className="hint" role="status">
          Removed {removed} {removed === 1 ? "review" : "reviews"}.
        </p>
      ) : null}
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t reset: {error}
        </p>
      ) : null}
    </section>
  );
}
