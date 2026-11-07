/**
 * Debug (issues #356, #366): the opt-in performance-trace recorder and
 * its explicit-only local export.
 *
 * - Record performance traces: OTel spans (HTTP, jobs, child processes by
 *   command name, SQLite by operation, ingest/refresh/first-card, plus
 *   browser document-load/fetch/interactions). Off by default; stored
 *   locally for as long as recording is on (no rotation); exportable at
 *   any time as OTLP JSON (Jaeger reads it natively, Perfetto converts it
 *   with `traceconv`); Clear empties the store via the inline confirm.
 *   Job spans carry the usage statistics (model, tokens, tool counts,
 *   reads, repairs, failure, timings); review spans carry the size
 *   buckets — summarize an export with `mise run stats:summary`.
 * - The lean build records nothing at all (no tracing libraries): the
 *   Debug section says so and names the matching debug install.
 * Nothing is uploaded, ever.
 */
import { useCallback, useEffect, useState } from "react";
import { debugChannelFor, type Settings, type TraceStatusResponse } from "@unvibe/shared";
import { api, friendlyError, getToken } from "../api/client.js";
import { InlineConfirm, Switch } from "../ui/index.js";
import { isTraceBuild, setTraceRecording } from "../traces/beacon.js";

/**
 * Lean-build notice (issue #356, debug flavour): tracing is unavailable
 * without the OTel dependencies. Names the matching debug install for
 * the channel this build was installed from.
 */
function DebugInstallNotice({ channel }: { channel: string | null }): React.JSX.Element {
  const ref = debugChannelFor(channel);
  return (
    <p className="hint" role="note">
      Performance traces aren&apos;t available in this build — the normal install stays lean (no
      tracing libraries). Nothing is recorded. To record traces, install the debug build:
      <br />
      <code>npm install -g github:indigoviolet/unvibe#{ref}</code>
    </p>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function spanCountOf(body: unknown): number {
  try {
    const scopes = (body as { resourceSpans?: { scopeSpans?: { spans?: unknown[] }[] }[] }).resourceSpans ?? [];
    return scopes.reduce(
      (n, r) => n + (r.scopeSpans ?? []).reduce((m, s) => m + (s.spans ?? []).length, 0),
      0,
    );
  } catch {
    return 0;
  }
}

export function DebugSection({
  settings,
  onSaved,
}: {
  settings?: Settings;
  onSaved?: (next: Settings) => void;
}): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [traceNote, setTraceNote] = useState<string | null>(null);
  const [status, setStatus] = useState<TraceStatusResponse | null>(null);
  // Unavailable builds (issue #356, debug flavour) ship no tracing:
  // the section names the matching debug install instead of recording.
  // Lean builds know at build time; anything else learns from a 501
  // on the status probe (a debug web app never pairs with lower).
  const [traceBuild] = useState(() => isTraceBuild());
  const [unsupported, setUnsupported] = useState(false);
  const [channel, setChannel] = useState<string | null | undefined>(undefined);
  const unavailable = !traceBuild || unsupported;

  const recording = settings?.recordTraces === true;

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await api.traceStatus());
    } catch (err) {
      setStatus(null);
      // A 501 means no trace routes: this is a lean build (or a
      // mismatched install) — show the install notice instead. Match
      // the raw error: friendlyError strips the status code.
      const raw = err instanceof Error ? err.message : String(err);
      if (/\b501\b/.test(raw)) setUnsupported(true);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Installed channel for the debug install command, resolved once the
  // section knows tracing is unavailable. Failures keep the null-channel
  // fallback (the release-debug command).
  useEffect(() => {
    if (!unavailable || channel !== undefined) return;
    let cancelled = false;
    api
      .updateStatus()
      .then((s) => {
        if (!cancelled) setChannel(s.build?.channel ?? null);
      })
      .catch(() => {
        if (!cancelled) setChannel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [unavailable, channel]);

  // Arm the browser SDK on arrival when the switch is already on (fresh
  // page load with recording enabled), and whenever the switch flips.
  useEffect(() => {
    if (settings === undefined) return;
    try {
      setTraceRecording(recording, getToken() ?? undefined);
    } catch {
      // Tracing never breaks settings.
    }
  }, [recording, settings]);

  const toggleRecording = async (on: boolean): Promise<void> => {
    setSaving(true);
    setTraceError(null);
    setTraceNote(null);
    try {
      const next = await api.saveSettings({ recordTraces: on });
      onSaved?.(next);
      setTraceRecording(next.recordTraces === true, getToken() ?? undefined);
      await refreshStatus();
    } catch (err) {
      setTraceError(friendlyError(err));
      try {
        setTraceRecording(false);
      } catch {
        // ignore
      }
    } finally {
      setSaving(false);
    }
  };

  const exportTraces = async (): Promise<void> => {
    setSaving(true);
    setTraceError(null);
    setTraceNote(null);
    try {
      const body = await api.traceExport();
      const blob = new Blob([`${JSON.stringify(body)}\n`], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "unvibe-traces.json";
      a.click();
      URL.revokeObjectURL(url);
      const exported = spanCountOf(body);
      setTraceNote(`Exported ${exported} ${exported === 1 ? "span" : "spans"} as OTLP JSON (opens in Jaeger or Perfetto).`);
    } catch (err) {
      setTraceError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const clearTraces = useCallback(async (): Promise<void> => {
    setTraceError(null);
    setTraceNote(null);
    setStatus(await api.traceClear());
    setTraceNote("Cleared the recorded traces.");
  }, []);

  return (
    <>
      <section aria-label="Debug">
        {unavailable ? (
          // Lean build (issue #366): no tracing libraries shipped, so no
          // usage statistics are recorded at all. Name the matching debug
          // build for this install's channel.
          // The install command itself shows once, under Performance traces.
          channel === undefined ? null : (
            <p className="hint">
              This build records no usage statistics. The debug build records them with the
              performance traces; its install command is under Performance traces below.
            </p>
          )
        ) : (
          <p className="hint">
            Usage statistics live in the performance-trace export below: every job span carries its
            model, tokens, tool counts, reads, repairs, failure and timings, and every review span
            carries its size buckets. Export traces, then summarize the file with
            <code> mise run stats:summary -- unvibe-traces.json</code>. Nothing is uploaded, ever.
          </p>
        )}
      </section>
      <section aria-label="Performance traces">
        <h2>Performance traces</h2>
        {unavailable ? (
          // Lean build (issue #356, debug flavour): no tracing libraries
          // shipped, so nothing can record. Name the matching debug
          // build for this install's channel.
          channel === undefined ? null : (
            <DebugInstallNotice channel={channel} />
          )
        ) : (
          <p className="hint">
            Record OpenTelemetry spans for this machine only: HTTP requests, jobs, child processes,
            SQLite operations, ingest, refresh and the review-open-to-first-card time, plus the
            browser&apos;s document load, fetches and interactions. The local file is raw; the
            export holds only numbers, enums and salted hashes — no code, paths, tokens or
            prompt text. Nothing is uploaded, ever.
          </p>
        )}
        {!unavailable && settings !== undefined && (
          <div className="frow" style={{ gap: 8, alignItems: "center" }}>
            <Switch
              checked={recording}
              onChange={(v) => void toggleRecording(v)}
              ariaLabel="Record performance traces"
            />
            <span data-testid="trace-state">
              {!recording ? "Off" : status?.capped ? "Paused (size limit)" : "Recording"}
            </span>
          </div>
        )}
        {!unavailable && status !== null && (status.recording || status.spans > 0 || status.capped) ? (
          <p className="hint" role="status" data-testid="trace-size">
            {status.spans} {status.spans === 1 ? "span" : "spans"} · {formatBytes(status.bytes)}
            {status.recording ? " · recording" : " · paused"}
          </p>
        ) : null}
        {!unavailable && status?.capped ? (
          <p className="err" role="alert">
            Recording stopped at the 256&nbsp;MB safety limit — older spans are kept, nothing was
            deleted. Clear to record again.
          </p>
        ) : null}
        {!unavailable ? (
        <div className="frow" style={{ gap: 8 }}>
          <button
            className="ui-btn"
            data-variant="secondary"
            type="button"
            disabled={saving || status?.spans === 0}
            onClick={() => void exportTraces()}
          >
            Export traces
          </button>
          {/* #346: the shared inline confirm. Clear is available whenever
              the store has anything (size > 0), and always when capped —
              a capped store can hold zero counted spans. Export needs
              spans to write. */}
          <InlineConfirm
            action="Clear traces"
            confirmAction="clear traces"
            runningLabel="Clearing…"
            size="md"
            placement="stack"
            disabled={
              saving ||
              ((status?.spans ?? 0) === 0 && (status?.bytes ?? 0) === 0 && status?.capped !== true)
            }
            onConfirm={clearTraces}
            formatError={friendlyError}
            detail="Delete every recorded span on this machine? This cannot be undone."
            announce="Delete every recorded span? Confirm clear traces, or cancel."
          />
        </div>
        ) : null}
        {!unavailable && traceNote ? (
          <p className="hint" role="status">
            {traceNote}
          </p>
        ) : null}
        {traceError ? (
          <p className="err" role="alert">
            Couldn&apos;t update traces: {traceError}
          </p>
        ) : null}
      </section>
    </>
  );
}
