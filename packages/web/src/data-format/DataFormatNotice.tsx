/**
 * Data-format notice (#311): the full-page gate shown instead of the
 * normal UI when the stored data's format differs from this build's.
 * Reset moves the data dir aside (never deletes it) on the service and
 * restarts it fresh; Export Outbox first saves every unposted draft as
 * one Markdown file (the #223 export, combined over all reviews).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DataFormatStatusResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Button, Card } from "../ui/index.js";
import { downloadOutboxMarkdown } from "./outboxDownload.js";

export function DataFormatNotice({ status }: { status: DataFormatStatusResponse }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const exportOutbox = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const out = await api.dataFormatOutbox();
      downloadOutboxMarkdown(out.markdown);
      if (!cancelled.current) setExported(out.count);
    } catch (err) {
      if (!cancelled.current) setError(`Couldn't export the Outbox: ${friendlyError(err)}`);
    } finally {
      if (!cancelled.current) setExporting(false);
    }
  }, []);

  const reset = useCallback(async () => {
    setResetting(true);
    setError(null);
    try {
      const res = await api.resetDataFormat();
      if (!cancelled.current) setMovedTo(res.movedTo);
    } catch (err) {
      if (!cancelled.current) {
        setResetting(false);
        setError(`Couldn't reset: ${friendlyError(err)}`);
      }
      return;
    }
    // The service restarts into a fresh generation on the same origin:
    // poll until it answers with a format this build can read, then reload.
    for (;;) {
      if (cancelled.current) return;
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const next = await api.dataFormat();
        if (next.state !== "mismatch") {
          window.location.reload();
          return;
        }
      } catch {
        // Down mid-restart: keep waiting.
      }
    }
  }, []);

  return (
    <div className="app">
      <main className="col" style={{ padding: 24 }}>
        <div className="doc" style={{ maxWidth: 720 }} data-testid="data-format-notice">
          <h1>This version can&apos;t read your existing reviews</h1>
          <p>
            Your stored data is{" "}
            {status.stored === null ? "from before data formats were stamped" : `format ${status.stored}`}, and this
            version reads format {status.expected}. There is no conversion — reset to continue.
          </p>
          <Card variant="raised" style={{ padding: "12px 16px" }}>
            <p style={{ marginTop: 0 }}>
              <b>Export your Outbox first.</b> Unposted drafts only live in your data. Exporting saves every
              unposted draft from every review as one Markdown file.
            </p>
            <div className="frow" style={{ gap: 8, alignItems: "center" }}>
              <Button variant="secondary" type="button" onClick={() => void exportOutbox()} disabled={exporting || resetting}>
                {exporting ? "Exporting…" : "Export Outbox first"}
              </Button>
              {exported !== null ? (
                <span className="hint" role="status">
                  Exported {exported} draft{exported === 1 ? "" : "s"} to unvibe-outbox.md.
                </span>
              ) : null}
            </div>
          </Card>
          <Card variant="plain" style={{ padding: "12px 16px", marginTop: 12 }}>
            <p style={{ marginTop: 0 }}>
              <b>Reset</b> moves your whole data folder aside to a dated copy next to it. Nothing is deleted —
              the copy stays on disk until you remove it by hand — and Unvibe then starts fresh and empty.
            </p>
            {movedTo ? (
              <p className="hint" role="status">
                Your data was moved to {movedTo}. Restarting…
              </p>
            ) : resetting ? (
              <p className="hint" role="status">
                Moving your data aside and restarting…
              </p>
            ) : confirming ? (
              <div className="frow" style={{ gap: 8, alignItems: "center" }}>
                <span className="warnline">Your reviews and settings in this data will no longer be shown.</span>
                <Button variant="danger" type="button" onClick={() => void reset()}>
                  Move my data aside and reset
                </Button>
                <Button variant="secondary" type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="primary" type="button" onClick={() => setConfirming(true)}>
                Reset and start fresh
              </Button>
            )}
          </Card>
          {error ? (
            <p className="err" role="alert">
              {error}
            </p>
          ) : null}
          <p className="hint">
            Prefer a terminal? Run <code>unvibe stop</code>, then <code>unvibe reset-data</code>, then{" "}
            <code>unvibe start</code> — the same move, nothing deleted.
          </p>
        </div>
      </main>
    </div>
  );
}
