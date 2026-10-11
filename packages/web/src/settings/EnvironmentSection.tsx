/**
 * Environment section (Settings → Environment): the full readiness report
 * (`GET /api/readiness`) with Re-check, a link to the Doctor page
 * (`/doctor`, issue #20) and "Reload everything" (re-probe PATH,
 * re-resolve tools, restart adapters, clear caches, without restarting).
 * Front-screen callouts link here (`/settings#environment`) and to Doctor.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReadinessResponse, ReloadResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

export function EnvironmentSection(): React.JSX.Element {
  const [report, setReport] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<ReloadResponse | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);

  const load = useCallback(async (force?: boolean) => {
    setChecking(true);
    setError(null);
    try {
      setReport(await api.readiness(force));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setChecking(false);
    }
  }, []);

  const reload = useCallback(async () => {
    setReloading(true);
    setReloadError(null);
    setReloadResult(null);
    try {
      const res = await api.reload();
      setReloadResult(res);
      // Show what changed afterwards: refresh readiness too.
      try {
        setReport(await api.readiness(true));
      } catch {
        // Reload result already shows the diagnostics.
      }
    } catch (err) {
      setReloadError(friendlyError(err));
    } finally {
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="Environment" id="environment" style={{ scrollMarginTop: 12 }}>
      <div className="divider">Environment</div>
      <p className="hint">
        git, gh, d2 and the configured agent CLIs — the same checks as the front-screen callouts.{" "}
        <Link to="/doctor">Doctor page</Link> shows every candidate, full error text, PATH and service identity.
      </p>
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t check the environment: {error}
        </p>
      ) : null}
      {!report && !error ? <p className="hint">Checking environment…</p> : null}
      {report ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {report.checks.map((c) => (
            <div
              key={c.id}
              className="card"
              style={{ padding: "6px 12px" }}
              data-testid={`env-${c.id}`}
            >
              <div className="frow" style={{ gap: 8, alignItems: "baseline" }}>
                <b style={{ minWidth: 140 }}>{c.label}</b>
                <span
                  className="st"
                  data-testid={`env-${c.id}-status`}
                  data-status={c.status}
                  style={
                    c.status === "ok"
                      ? { background: "var(--sunk)", color: "var(--muted)" }
                      : c.status === "warning"
                        ? { background: "var(--note-soft)", color: "var(--note)" }
                        : { background: "var(--warn-soft)", color: "var(--warn)" }
                  }
                >
                  {c.status}
                </span>
                <span style={{ fontSize: 13 }}>{c.summary}</span>
              </div>
              {c.fix ? <div className="hint">{c.fix}</div> : null}
            </div>
          ))}
          <div className="frow" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn ghost" type="button" onClick={() => void load(true)} disabled={checking}>
              {checking ? "Checking…" : "Re-check"}
            </button>
            <button
              className="btn ghost"
              type="button"
              onClick={() => void reload()}
              disabled={reloading}
              data-testid="reload-everything"
            >
              {reloading ? "Reloading…" : "Reload everything"}
            </button>
            <Link className="tbtn" to="/doctor">
              Doctor page
            </Link>
            {report.cached ? <span className="hint">Cached · Re-check for a fresh probe.</span> : null}
          </div>
          {reloadError ? (
            <p className="err" role="alert" data-testid="reload-error">
              Couldn&apos;t reload: {reloadError}
            </p>
          ) : null}
          {reloadResult ? (
            <div className="card" style={{ padding: "6px 12px" }} data-testid="reload-result">
              <b>Reloaded without restarting the service</b>
              <div style={{ fontSize: 13 }}>Changed: {reloadResult.changed.join("; ")}</div>
              {reloadResult.detail.map((d, i) => (
                <div key={i} className="hint">
                  {d}
                </div>
              ))}
              <div className="hint">In-flight jobs fail as retryable with a clear message and retry (see Jobs).</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
