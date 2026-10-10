/**
 * Environment section (Settings → Environment): the full readiness report
 * (`GET /api/readiness`) with a Re-check button. Front-screen callouts link
 * here (`/settings#environment`).
 */
import { useCallback, useEffect, useState } from "react";
import type { ReadinessResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

export function EnvironmentSection(): React.JSX.Element {
  const [report, setReport] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="Environment" id="environment" style={{ scrollMarginTop: 12 }}>
      <div className="divider">Environment</div>
      <p className="hint">
        git, gh and the configured agent CLIs — the same checks as the front-screen callouts.
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
          <div className="frow" style={{ gap: 8, alignItems: "center" }}>
            <button className="btn ghost" type="button" onClick={() => void load(true)} disabled={checking}>
              {checking ? "Checking…" : "Re-check"}
            </button>
            {report.cached ? <span className="hint">Cached · Re-check for a fresh probe.</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
