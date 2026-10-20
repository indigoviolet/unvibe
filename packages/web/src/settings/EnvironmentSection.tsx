/**
 * Environment section (Settings → Environment): the full readiness report
 * (`GET /api/readiness`) with Re-check, a link to the Doctor page
 * (`/doctor`, issue #20) and "Reload everything" (re-probe PATH,
 * re-resolve tools, restart adapters, clear caches, without restarting).
 * Front-screen callouts link here (`/settings?tab=environment`) and to Doctor.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ReadinessResponse, ReloadResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Badge } from "../ui/index.js";

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
      <p className="hint">
        The tools Unvibe needs: git, gh, d2 and the agent CLIs.
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
            <div key={c.id} className="ui-card" data-testid={`env-${c.id}`}>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,180px) 72px minmax(0,1fr)", gap: 12, alignItems: "center" }}>
                <b>{c.label}</b>
                <span data-testid={`env-${c.id}-status`} data-status={c.status}><Badge tone={c.status === "ok" ? "ok" : c.status === "warning" ? "warn" : "error"}>{c.status === "ok" ? "OK" : c.status}</Badge></span>
                <span className="ui-row-meta" title={c.summary}>{c.summary}</span>
              </div>
              {c.fix ? <div className="hint">{c.fix}</div> : null}
            </div>
          ))}
          <div className="frow" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button className="ui-btn" data-variant="secondary" type="button" onClick={() => void load(true)} disabled={checking}>
              {checking ? "Checking…" : "Re-check"}
            </button>
            <button
              className="ui-btn" data-variant="secondary"
              type="button"
              onClick={() => void reload()}
              disabled={reloading}
              data-testid="reload-everything"
            >
              {reloading ? "Reloading…" : "Reload environment"}
            </button>
            <Link className="ui-btn" data-variant="secondary" to="/doctor">
              Doctor page
            </Link>
            {report.cached ? <span className="hint">Checked earlier. Re-check to run the checks again.</span> : null}
          </div>
          {reloadError ? (
            <p className="err" role="alert" data-testid="reload-error">
              Couldn&apos;t reload: {reloadError}
            </p>
          ) : null}
          {reloadResult ? (
            <div className="ui-card" data-testid="reload-result">
              <b>Reloaded</b>
              <div style={{ fontSize: 13 }}>Changed: {reloadResult.changed.join("; ")}</div>
              {reloadResult.detail.map((d, i) => (
                <div key={i} className="hint">
                  {d}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
