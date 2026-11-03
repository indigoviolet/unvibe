/**
 * Data (#79): reset removes every review and everything generated for it
 * from this machine. Settings and repositories stay; nothing changes on
 * GitHub. Confirmed inline, like Remove on the start page.
 */
import { useCallback, useState } from "react";
import { api, friendlyError } from "../api/client.js";
import { InlineConfirm } from "../ui/index.js";

export function DataSection(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<number | null>(null);

  const reset = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.resetData();
      setRemoved(res.reviewsRemoved);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section aria-label="Data">
      <p className="hint">
        Reset removes every review from this machine, with its guide, explanations, comments you have not
        submitted and the working copies Unvibe made for it. Settings and repos stay. Nothing changes on GitHub.
      </p>
      <div className="frow" style={{ gap: 8 }}>
        {/* #346: the shared inline confirm (was Reset/Cancel buttons). */}
        <InlineConfirm
          action="Reset data"
          confirmAction="reset data"
          runningLabel="Resetting…"
          size="md"
          danger
          disabled={busy}
          onConfirm={reset}
          formatError={friendlyError}
          detail="Remove all reviews? This cannot be undone."
          announce="Remove all reviews? This cannot be undone. Confirm reset data, or cancel."
        />
      </div>
      {removed !== null ? (
        <p className="hint" role="status">
          Removed {removed} {removed === 1 ? "review" : "reviews"}.
        </p>
      ) : null}
    </section>
  );
}
