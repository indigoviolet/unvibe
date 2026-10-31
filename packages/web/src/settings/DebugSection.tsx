/**
 * Debug (issue #323): export anonymized usage statistics to a local
 * file. Explicit only: nothing is uploaded and nothing runs in the
 * background. The file holds numbers, enums and salted hashes only —
 * see `docs/stats-export.md`.
 */
import { useState } from "react";
import { api, friendlyError } from "../api/client.js";

export function DebugSection(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportStats = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body = await api.statsExport();
      const blob = new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "unvibe-stats.json";
      a.click();
      URL.revokeObjectURL(url);
      setDone(`Exported ${body.totals.reviews} reviews and ${body.totals.jobs} jobs.`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Debug">
      <p className="hint">
        Export anonymized usage statistics for debugging: counts, timings, token totals and salted hashes
        only — no text, paths, names or timestamps. The file stays on this machine; nothing is uploaded.
      </p>
      <div className="frow" style={{ gap: 8 }}>
        <button
          className="ui-btn"
          data-variant="secondary"
          type="button"
          disabled={busy}
          onClick={() => void exportStats()}
        >
          {busy ? "Exporting…" : "Export statistics"}
        </button>
      </div>
      {done ? (
        <p className="hint" role="status">
          {done}
        </p>
      ) : null}
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t export: {error}
        </p>
      ) : null}
    </section>
  );
}
