/**
 * Data-format notice (#311): replaces the start page's content inside
 * the normal app frame — same top bar (visible but disabled), disco
 * background art, content width and styling. The only actions are
 * Export (only when there are unposted drafts), Reset, and Go back.
 * Reset moves the data dir aside (never deletes it) on the service and
 * restarts it fresh; Go back switches to the previous build through
 * the update path and leaves the data untouched.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DataFormatStatusResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { ScreenTopBar } from "../shell/ScreenTopBar.js";
import { Button, Card } from "../ui/index.js";
import { downloadOutboxMarkdown } from "./outboxDownload.js";

export function DataFormatNotice({ status }: { status: DataFormatStatusResponse }): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [goingBack, setGoingBack] = useState(false);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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

  /** Poll until the restarting service answers, then reload onto it. */
  const waitAndReload = useCallback(async (mode: "format" | "health") => {
    const deadline = Date.now() + 120_000;
    for (;;) {
      if (cancelled.current) return;
      await new Promise((r) => setTimeout(r, 1000));
      try {
        if (mode === "format") {
          const next = await api.dataFormat();
          if (next.state !== "mismatch") {
            // Fresh start: land on the start page, not the URL that
            // was open against the moved-aside data.
            window.location.href = "/";
            return;
          }
        } else {
          // The previous build may predate the data-format endpoint:
          // any healthy answer is enough, then reload onto it.
          await api.health();
          window.location.reload();
          return;
        }
      } catch {
        // Down mid-restart: keep waiting.
      }
      if (Date.now() >= deadline) {
        window.location.reload();
        return;
      }
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
    await waitAndReload("format");
  }, [waitAndReload]);

  const goBack = useCallback(async () => {
    setGoingBack(true);
    setError(null);
    try {
      await api.goBackDataFormat();
    } catch (err) {
      if (!cancelled.current) {
        setGoingBack(false);
        setError(`Couldn't go back: ${friendlyError(err)}`);
      }
      return;
    }
    await waitAndReload("health");
  }, [waitAndReload]);

  const copyCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(status.goBackCommand);
      if (!cancelled.current) setCopied(true);
    } catch {
      // The command stays visible to copy by hand.
    }
  }, [status.goBackCommand]);

  const drafts = status.outboxCount;

  return (
    <div className="app start">
      <ScreenTopBar showBadge disabled />
      {/* Start-page disco-ball art (#281): static, pointer-transparent. */}
      <div className="start-watermark" aria-hidden="true">
        <img src="/disco-ball.svg" alt="" />
      </div>
      <main className="col" style={{ padding: 24 }}>
        {/* 720px: the heading's single-line measure, so the wrapped
            intro/hint text and the cards share one right edge (#311). */}
        <div className="doc" style={{ maxWidth: 720 }} data-testid="data-format-notice">
          <h1>This version can&apos;t read your existing reviews</h1>
          <p>
            Your stored data is{" "}
            {status.stored === null ? "from before data formats were stamped" : `format ${status.stored}`}, and this
            version reads format {status.expected}. There is no conversion — reset to continue, or go back to the
            version that wrote this data.
          </p>
          {drafts > 0 ? (
            <Card variant="raised" style={{ padding: "12px 16px" }}>
              <p style={{ marginTop: 0 }}>
                <b>Export your Outbox first.</b> Unposted drafts only live in your data. Exporting saves every
                unposted draft from every review as one Markdown file.
              </p>
              <div className="frow" style={{ gap: 8, alignItems: "center" }}>
                <Button variant="secondary" type="button" onClick={() => void exportOutbox()} disabled={exporting || resetting || goingBack}>
                  {exporting ? "Exporting…" : `Export ${drafts} unposted draft${drafts === 1 ? "" : "s"}`}
                </Button>
                {exported !== null ? (
                  <span className="hint" role="status">
                    Exported {exported} draft{exported === 1 ? "" : "s"} to unvibe-outbox.md.
                  </span>
                ) : null}
              </div>
            </Card>
          ) : null}
          <Card variant="plain" style={{ padding: "12px 16px", marginTop: 12 }}>
            <p style={{ marginTop: 0 }}>
              <b>Go back instead.</b>{" "}
              {status.previousRef
                ? "Switch back to the previous version through the usual update path. Your data stays exactly as it is — nothing is moved or deleted."
                : "The previous version isn't recorded on this install, so go back from a terminal instead. Your data stays exactly as it is — nothing is moved or deleted."}
            </p>
            {status.previousRef ? (
              <div className="frow" style={{ gap: 8, alignItems: "center" }}>
                <Button variant="secondary" type="button" onClick={() => void goBack()} disabled={goingBack || resetting}>
                  {goingBack ? "Going back…" : `Go back to ${status.previousVersion ?? status.previousRef}`}
                </Button>
                {goingBack ? (
                  <span className="hint" role="status">
                    Switching back… The service is restarting on the previous version.
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="frow" style={{ gap: 8, alignItems: "center" }}>
                <code data-testid="go-back-command">{status.goBackCommand}</code>
                <Button variant="secondary" size="sm" type="button" onClick={() => void copyCommand()}>
                  {copied ? "Copied" : "Copy"}
                </Button>
                <span className="hint">Run it in a terminal, then run `unvibe start`.</span>
              </div>
            )}
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
              <Button variant="primary" type="button" onClick={() => setConfirming(true)} disabled={goingBack}>
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
