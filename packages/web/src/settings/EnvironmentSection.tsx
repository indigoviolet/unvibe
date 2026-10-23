/**
 * Environment section (Settings → Environment): the full readiness report
 * (`GET /api/readiness`) with Re-check, a link to the Doctor page
 * (`/doctor`, issue #20) and "Reload everything" (re-probe PATH,
 * re-resolve tools, restart adapters, clear caches, without restarting).
 * Front-screen callouts link here (`/settings?tab=environment`) and to Doctor.
 *
 * #225: one card with a compact list — one ListRow per check (name, a
 * status mark, a short detail). Long details ride on the row's hover
 * title and on the Doctor page. Problems sort first; OK rows stay quiet.
 * Actions sit in the card footer as shared buttons.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { ReadinessCheck, ReadinessResponse, ReloadResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Badge, Button, Card, ListRow } from "../ui/index.js";

/**
 * Row-length detail (#225): names and versions only — never paths or
 * command lines (those ride the row's hover title and the Doctor page).
 * Summaries carry them as "at <path>" tails (`d2 0.9.0 at …`) and fixes
 * embed them (`run <path> --version`); both shapes are stripped here.
 */
function shortDetail(c: ReadinessCheck): string {
  const base = c.summary.split(" (")[0].trim();
  const text = c.status === "ok" ? base : c.fix ? `${base} ${c.fix}` : base;
  const scrubbed = text
    .replace(/\s+at\s+(~\/|\/|\.[\\/]|[A-Za-z]:[\\/])\S*/g, "")
    .split(/\s+/)
    .filter((tok) => !/(^|[\s(`'"])~?\/|^[A-Za-z]:[\\/]/.test(tok))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const clean = scrubbed.length > 0 ? scrubbed : base;
  return clean.length > 90 ? `${clean.slice(0, 89).trimEnd()}…` : clean;
}

function statusRank(c: ReadinessCheck): number {
  return c.status === "error" ? 0 : c.status === "warning" ? 1 : 2;
}

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

  const checks = report ? [...report.checks].sort((a, b) => statusRank(a) - statusRank(b)) : [];

  return (
    <section aria-label="Environment" id="environment" style={{ scrollMarginTop: 12 }}>
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t check the environment: {error}
        </p>
      ) : null}
      {!report && !error ? <p className="hint">Checking environment…</p> : null}
      {report ? (
        <>
          <Card
            variant="raised"
            footer={
              <div className="frow" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Button variant="secondary" size="sm" type="button" onClick={() => void load(true)} disabled={checking}>
                  {checking ? "Checking…" : "Re-check"}
                </Button>
                <Button variant="secondary" size="sm" type="button" onClick={() => void reload()} disabled={reloading} data-testid="reload-everything">
                  {reloading ? "Reloading…" : "Reload environment"}
                </Button>
                <Link className="ui-btn" data-variant="secondary" data-size="sm" to="/doctor">
                  Doctor page
                </Link>
                {report.cached ? <span className="hint">Checked earlier. Re-check to run the checks again.</span> : null}
              </div>
            }
          >
            <div className="ui-list">
              {checks.map((c) => (
                <ListRow
                  key={c.id}
                  data-testid={`env-${c.id}`}
                  title={[c.summary, c.fix].filter(Boolean).join(" — ")}
                  primary={c.label}
                  meta={shortDetail(c)}
                  trailing={
                    <span data-testid={`env-${c.id}-status`} data-status={c.status}>
                      <Badge tone={c.status === "ok" ? "ok" : c.status === "warning" ? "warn" : "error"}>
                        {c.status === "ok" ? "OK" : c.status === "warning" ? "Problem" : "Error"}
                      </Badge>
                    </span>
                  }
                />
              ))}
            </div>
          </Card>
          {reloadError ? (
            <p className="err" role="alert" data-testid="reload-error">
              Couldn&apos;t reload: {reloadError}
            </p>
          ) : null}
          {reloadResult ? (
            <Card variant="inset" data-testid="reload-result">
              <b>Reloaded</b>
              <div style={{ fontSize: 13 }}>Changed: {reloadResult.changed.join("; ")}</div>
              {reloadResult.detail.map((d, i) => (
                <div key={i} className="hint">
                  {d}
                </div>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
