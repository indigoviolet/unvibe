/**
 * `unvibe doctor`: environment checks (PRD §14 install path).
 *
 * Informational: always exits 0 unless `--strict` is given (then exits 1
 * when any check is not ok), marking each check ok / warn / fail so a
 * fresh machine without agent CLIs still reports cleanly. `gh` is probed
 * with `GITHUB_TOKEN` unset (PRD §15) so a scoped token in the environment
 * can neither help nor break the check.
 *
 * One shared diagnostics module (`../diagnostics/`) is used by both
 * `unvibe doctor` and the running service (`GET /api/diagnostics`), so
 * they cannot disagree from the same environment. Doctor additionally
 * reports what the running service sees (over the local API with the
 * token) and says plainly when they differ.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { isHealthOk } from "./lock.js";
import { collectDiagnostics, formatDiagnosticsText } from "../diagnostics/report.js";
import type { DiagnosticsResponse } from "@unvibe/shared";
import {
  findOnPath as sharedFindOnPath,
  ghAuthStatus as sharedGhAuth,
  gitVersion as sharedGitVersion,
} from "../readiness/checks.js";
import { RealCommandRunner } from "../exec/runner.js";

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** Minimal `command -v` (shared with readiness; re-exported for compat). */
export function findOnPath(name: string, pathValue: string = process.env.PATH ?? ""): string | null {
  return sharedFindOnPath(name, pathValue);
}

/**
 * `gh auth status` with GITHUB_TOKEN unset (PRD §15). Shared with
 * readiness (see `../readiness/checks.js`); kept here for compat.
 */
export async function ghAuthStatus(): Promise<{ present: boolean; loggedIn: boolean; detail: string }> {
  return sharedGhAuth(new RealCommandRunner());
}

export interface DoctorOptions {
  port: number;
  dataDir: string;
}

function portTaken(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (taken: boolean): void => {
      sock.destroy();
      resolve(taken);
    };
    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false));
    sock.on("error", () => done(false));
    sock.setTimeout(timeoutMs);
  });
}

/** Full diagnostics from doctor's own environment (same module as the service). */
export async function getDoctorDiagnostics(opts: DoctorOptions): Promise<DiagnosticsResponse> {
  return collectDiagnostics({
    dataDir: opts.dataDir,
    port: opts.port,
    service: {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cwd: process.cwd(),
      dataDir: opts.dataDir,
      port: opts.port,
      startMode: "doctor",
      nodeVersion: process.version,
      serviceVersion: "doctor",
    },
  });
}

/** Ask the running service what it sees (over the local API with the token). */
export async function fetchServiceDiagnostics(port: number, token: string, timeoutMs = 8000): Promise<DiagnosticsResponse | null> {
  return new Promise((resolve) => {
    try {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/api/diagnostics",
          timeout: timeoutMs,
          headers: { authorization: `Bearer ${token}` },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            resolve(null);
            return;
          }
          let body = "";
          res.on("data", (d) => (body += d.toString()));
          res.on("end", () => {
            try {
              resolve(JSON.parse(body) as DiagnosticsResponse);
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/** Plain-words diff between doctor's view and the service's view. */
export function diffDiagnostics(local: DiagnosticsResponse, remote: DiagnosticsResponse): string[] {
  const out: string[] = [];
  if (local.path.effectivePath !== remote.path.effectivePath) {
    out.push(
      `PATH differs: doctor sees ${local.path.effectivePath.split(":").length} dirs via ${local.path.shell}, service sees ${remote.path.effectivePath.split(":").length} dirs via ${remote.path.shell}. ` +
        `Only in doctor: ${local.path.onlyInInherited.slice(0, 3).join(", ") || "(none)"}; only in service: ${remote.path.onlyInInherited.slice(0, 3).join(", ") || "(none)"}. ` +
        `Fix the machine (rc files, then restart the service) and see the Doctor page (/doctor).`,
    );
  }
  const byTool = new Map(remote.tools.map((t) => [t.tool, t]));
  for (const lt of local.tools) {
    const rt = byTool.get(lt.tool);
    if (!rt) continue;
    if (lt.chosen !== rt.chosen) {
      out.push(
        `${lt.tool} differs: doctor chose ${lt.chosen ?? "(none)"} (${lt.chosenReason}), service chose ${rt.chosen ?? "(none)"} (${rt.chosenReason}). ` +
          `The service was started with a different PATH; restart it after fixing the shell config.`,
      );
    }
  }
  return out;
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.version.replace(/^v/, "").split(".")[0]);
  checks.push({
    name: "node",
    status: nodeMajor >= 24 ? "ok" : "fail",
    detail: `${process.version} (need >= 24 for node:sqlite) at ${process.execPath}`,
  });

  const runner = new RealCommandRunner();
  const git = await sharedGitVersion(runner);
  checks.push({ name: "git", status: git ? "ok" : "fail", detail: git ?? "not on PATH" });

  const gh = await ghAuthStatus();
  checks.push({
    name: "gh",
    status: !gh.present ? "fail" : gh.loggedIn ? "ok" : "warn",
    detail: gh.detail,
  });

  // Agent CLIs + d2 + node via the shared diagnostics module (same as the
  // service): every candidate, skip-broken choice, version only from success.
  let diag: DiagnosticsResponse | null = null;
  try {
    diag = await getDoctorDiagnostics(opts);
  } catch {
    diag = null;
  }
  if (diag) {
    for (const t of diag.tools) {
      if (t.tool === "node") continue; // already reported above
      if (t.tool === "git" || t.tool === "gh") continue; // already reported above
      const status = t.chosen ? (t.warnings.length > 0 ? "ok" : "ok") : "warn";
      // A tool with warnings but a working choice is still ok (doctor is
      // informational); the detail names the choice + why + warnings.
      const warnSuffix = t.warnings.length > 0 ? ` Warnings: ${t.warnings.join(" ")}` : "";
      const candSuffix =
        t.candidates.length > 1
          ? ` (${t.candidates.length} candidates; chose ${t.chosen ?? "none"}: ${t.chosenReason})`
          : t.chosen
            ? ` at ${t.chosen} (${t.chosenReason})`
            : ` (${t.chosenReason})`;
      // Missing tool → warn (fresh machine without CLIs still reports cleanly).
      checks.push({
        name: t.tool,
        status: t.chosen ? status : "warn",
        detail: `${t.chosen ? `${t.tool} ${t.candidates.find((c) => c.path === t.chosen)?.version ?? ""}`.trim() : t.tool}${candSuffix}.${warnSuffix} See the Doctor page (/doctor) for every candidate and full error text.`,
      });
    }
    checks.push({
      name: "login-shell PATH",
      status: diag.path.shell === "(none answered)" ? "warn" : "ok",
      detail:
        diag.path.shell === "(none answered)"
          ? "no login shell answered; using inherited PATH"
          : `from ${diag.path.shell}: ${diag.path.effectivePath} (probed ${diag.path.probedPath.length > 0 ? "ok" : "empty"}; ${diag.path.onlyInProbed.length} only in shell, ${diag.path.onlyInInherited.length} only inherited)`,
    });
  } else {
    checks.push({ name: "diagnostics", status: "warn", detail: "diagnostics probe failed; using inherited PATH" });
  }

  try {
    fs.mkdirSync(opts.dataDir, { recursive: true });
    fs.accessSync(opts.dataDir, fs.constants.W_OK);
    checks.push({ name: "data dir", status: "ok", detail: `${opts.dataDir} (writable)` });
  } catch (err) {
    checks.push({ name: "data dir", status: "fail", detail: `${opts.dataDir}: ${String(err)}` });
  }

  const taken = await portTaken(opts.port);
  if (!taken) {
    checks.push({ name: "port", status: "ok", detail: `${opts.port} is free` });
  } else if (await isHealthOk(opts.port)) {
    checks.push({ name: "port", status: "ok", detail: `${opts.port} is in use by an Unvibe service (unvibe status)` });
  } else {
    checks.push({
      name: "port",
      status: "warn",
      detail: `${opts.port} is in use by something else; set UNVIBE_PORT to a free port (the installed web app is bound to its origin, so reinstall it after changing ports)`,
    });
  }

  return checks;
}

export function formatDoctor(checks: DoctorCheck[]): string {
  return checks.map((c) => `[${c.status}] ${c.name}: ${c.detail}`).join("\n");
}

export { formatDiagnosticsText };
