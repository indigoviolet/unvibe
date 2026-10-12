/**
 * Doctor page (`/doctor`, issue #20): the detail behind each readiness
 * check — every candidate for each tool, which was chosen and why,
 * shims/symlinks and targets, full error text untruncated and copyable,
 * shell and PATH used and the diff from inherited PATH, how the service
 * was started (helper/CLI/foreground, pid, start time, cwd), versions,
 * data dir, port — with plain-language warnings for anything odd.
 *
 * Dense, readable, in the app's existing visual language (cards, hints,
 * warn/error lines). A "Copy diagnostics" button produces a text report
 * with the home directory path and the token redacted.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { DiagnosticsResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

function redactForCopy(text: string): string {
  // Token redaction (defense in depth; the API never sends the token) +
  // home-dir redaction for pasting into issues. We don't know HOME here,
  // so redact /Users/* and /home/* prefixes to ~.
  return text
    .replace(/(token[=:]\s*)(\S+)/gi, "$1[redacted]")
    .replace(/(Bearer\s+)(\S+)/gi, "$1[redacted]")
    .replace(/\/Users\/[^/\s:]+/g, "~")
    .replace(/\/home\/[^/\s:]+/g, "~");
}

function formatTextReport(report: DiagnosticsResponse): string {
  const lines: string[] = [];
  lines.push(`Unvibe diagnostics (${new Date(report.generatedAt).toISOString()})`);
  lines.push(`service: pid ${report.service.pid} (${report.service.startMode}), node ${report.service.nodeVersion}, service ${report.service.serviceVersion}`);
  lines.push(`cwd: ${report.service.cwd} | dataDir: ${report.service.dataDir} | port: ${report.service.port}`);
  lines.push(`shell: ${report.path.shell}`);
  lines.push(`probed PATH: ${report.path.probedPath}`);
  lines.push(`inherited PATH: ${report.path.inheritedPath}`);
  lines.push(`effective PATH: ${report.path.effectivePath}`);
  if (report.path.onlyInProbed.length > 0) lines.push(`only in probed: ${report.path.onlyInProbed.join(":")}`);
  if (report.path.onlyInInherited.length > 0) lines.push(`only inherited: ${report.path.onlyInInherited.join(":")}`);
  for (const t of report.tools) {
    lines.push(`--- ${t.tool}${t.minVersion ? ` (need >= ${t.minVersion})` : ""} ---`);
    lines.push(`chosen: ${t.chosen ?? "(none)"} — ${t.chosenReason}`);
    if (t.overrideEnv) lines.push(`override: ${t.overrideEnv}=${t.overrideValue ?? ""}`);
    t.candidates.forEach((c, i) => {
      lines.push(`  [${i + 1}] ${c.path} (${c.source}; ${c.kind}) runs=${c.runs}${c.exitCode !== undefined ? ` exit=${c.exitCode}` : ""}${c.version ? ` version=${c.version}` : ""}${c.meetsMin !== undefined ? ` meetsMin=${c.meetsMin}` : ""}`);
      if (c.symlinkTarget) lines.push(`      -> ${c.symlinkTarget}`);
      if (c.stdout) lines.push(`      stdout: ${c.stdout.slice(0, 2000)}`);
      if (c.stderr) lines.push(`      stderr: ${c.stderr.slice(0, 2000)}`);
    });
    for (const w of t.warnings) lines.push(`  ! ${w}`);
  }
  if (report.models) {
    for (const [provider, models] of Object.entries(report.models)) {
      lines.push(`--- models/${provider} ---`);
      for (const m of models) lines.push(`  ${m.id}${m.name ? ` (${m.name})` : ""}${m.description ? ` — ${m.description}` : ""}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push("warnings:");
    for (const w of report.warnings) lines.push(`  ! ${w}`);
  }
  return redactForCopy(lines.join("\n"));
}

export function DoctorPage(): React.JSX.Element {
  const [report, setReport] = useState<DiagnosticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await api.diagnostics());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = useCallback(async () => {
    if (!report) return;
    const text = formatTextReport(report);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable: select fallback via prompt.
      setCopied(false);
    }
  }, [report]);

  return (
    <div className="app">
      <header className="top">
        <Link className="brand" to="/" title="Back to the start page">
          Unvibe
        </Link>
        <div className="pr">
          <h1>Doctor</h1>
        </div>
        <Link className="tbtn" to="/settings?tab=environment">
          Settings
        </Link>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc" style={{ maxWidth: 860 }}>
          <p className="hint">
            Every candidate for each tool, which was chosen and why, shims and targets, full error text, shell and
            PATH, and how the service was started. Same module as <code>unvibe doctor</code> — they cannot disagree
            from the same environment.
          </p>
          <div className="frow" style={{ gap: 8, marginBottom: 12 }}>
            <button className="btn ghost" type="button" onClick={() => void load()} disabled={loading}>
              {loading ? "Checking…" : "Re-check"}
            </button>
            <button className="btn ghost" type="button" onClick={() => void copy()} disabled={!report}>
              {copied ? "Copied" : "Copy diagnostics"}
            </button>
            <Link className="tbtn" to="/settings?tab=environment">
              Settings → Environment
            </Link>
          </div>
          {error ? (
            <p className="err" role="alert">
              Couldn&apos;t load diagnostics: {error}
            </p>
          ) : null}
          {!report && !error ? <p className="hint">Loading diagnostics…</p> : null}
          {report ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="doctor-report">
              {report.warnings.length > 0 ? (
                <div className="card" style={{ padding: "8px 14px" }} data-testid="doctor-warnings">
                  <b>Warnings</b>
                  {report.warnings.map((w, i) => (
                    <p key={i} className="warnline" role="status" style={{ margin: "4px 0" }}>
                      {w}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="card" style={{ padding: "8px 14px" }} data-testid="doctor-service">
                <div className="frow" style={{ gap: 8 }}>
                  <b style={{ minWidth: 140 }}>Service</b>
                  <span style={{ fontSize: 13 }}>
                    pid {report.service.pid} ({report.service.startMode}), node {report.service.nodeVersion}, service{" "}
                    {report.service.serviceVersion}
                  </span>
                </div>
                <div className="hint">cwd: {report.service.cwd}</div>
                <div className="hint">dataDir: {report.service.dataDir}</div>
                <div className="hint">port: {report.service.port}</div>
                <div className="hint">started: {report.service.startedAt}</div>
              </div>
              <div className="card" style={{ padding: "8px 14px" }} data-testid="doctor-path">
                <div className="frow" style={{ gap: 8 }}>
                  <b style={{ minWidth: 140 }}>PATH</b>
                  <span style={{ fontSize: 13 }}>via {report.path.shell}</span>
                </div>
                <div className="hint" style={{ wordBreak: "break-all" }}>
                  probed: {report.path.probedPath}
                </div>
                <div className="hint" style={{ wordBreak: "break-all" }}>
                  inherited: {report.path.inheritedPath}
                </div>
                <div className="hint" style={{ wordBreak: "break-all" }}>
                  effective: {report.path.effectivePath}
                </div>
                {report.path.onlyInProbed.length > 0 ? (
                  <div className="hint">only in shell: {report.path.onlyInProbed.join(", ")}</div>
                ) : null}
                {report.path.onlyInInherited.length > 0 ? (
                  <div className="hint">only inherited: {report.path.onlyInInherited.join(", ")}</div>
                ) : null}
              </div>
              {report.tools.map((t) => (
                <div key={t.tool} className="card" style={{ padding: "8px 14px" }} data-testid={`doctor-tool-${t.tool}`}>
                  <div className="frow" style={{ gap: 8, alignItems: "baseline" }}>
                    <b style={{ minWidth: 140 }}>{t.tool}</b>
                    <span className="hint">
                      chosen: {t.chosen ?? "(none)"} — {t.chosenReason}
                    </span>
                  </div>
                  {t.overrideEnv ? (
                    <div className="hint">
                      override {t.overrideEnv}={t.overrideValue}
                    </div>
                  ) : null}
                  {t.minVersion ? <div className="hint">need ≥ {t.minVersion}</div> : null}
                  {t.warnings.map((w, i) => (
                    <p key={i} className="warnline" role="status" style={{ margin: "4px 0" }}>
                      {w}
                    </p>
                  ))}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                    {t.candidates.map((c, i) => (
                      <div
                        key={`${c.path}-${i}`}
                        style={{ borderTop: "1px solid var(--line)", paddingTop: 6 }}
                        data-testid={`doctor-candidate-${t.tool}-${i}`}
                      >
                        <div style={{ fontSize: 13 }}>
                          [{i + 1}] <code>{c.path}</code> ({c.source}; {c.kind}) runs={String(c.runs)}
                          {c.exitCode !== undefined ? ` exit=${c.exitCode}` : ""}
                          {c.version ? ` version=${c.version}` : ""}
                          {c.meetsMin !== undefined ? ` meetsMin=${String(c.meetsMin)}` : ""}
                        </div>
                        {c.symlinkTarget ? <div className="hint">→ {c.symlinkTarget}</div> : null}
                        {c.shimManager ? <div className="hint">manager: {c.shimManager}</div> : null}
                        {c.stdout ? (
                          <pre className="code" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }} data-testid={`doctor-stdout-${t.tool}-${i}`}>
                            stdout: {c.stdout}
                          </pre>
                        ) : null}
                        {c.stderr ? (
                          <pre className="code" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }} data-testid={`doctor-stderr-${t.tool}-${i}`}>
                            stderr: {c.stderr}
                          </pre>
                        ) : null}
                      </div>
                    ))}
                    {t.candidates.length === 0 ? <div className="hint">No candidates found on PATH.</div> : null}
                  </div>
                </div>
              ))}
              {report.models ? (
                <div className="card" style={{ padding: "8px 14px" }} data-testid="doctor-models">
                  <b>Models</b>
                  {Object.entries(report.models).map(([provider, models]) => (
                    <div key={provider} style={{ marginTop: 6 }}>
                      <div className="hint">{provider}</div>
                      {models.map((m) => (
                        <div key={m.id} style={{ fontSize: 13 }}>
                          {m.name ? `${m.name} (${m.id})` : m.id}
                          {m.description ? <span className="hint"> — {m.description}</span> : null}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
