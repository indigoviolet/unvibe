/**
 * Full diagnostics report shared by `unvibe doctor` and the running
 * service (`GET /api/diagnostics`), so they cannot disagree.
 *
 * One module builds the whole picture from the same environment:
 * - PATH probing (scrubbed interactive login shell; see `path-probe.ts`),
 * - tool discovery for git/gh/claude/codex/d2/node (see `tools.ts`),
 * - service identity (how it was started, pid, cwd, data dir, port),
 * - plain-language warnings for anything odd.
 *
 * The report never contains the per-install token (API tests assert this).
 */
import os from "node:os";
import type {
  DiagnosticPath,
  DiagnosticService,
  DiagnosticsResponse,
  DiagnosticTool,
  ModelInfo,
} from "@unvibe/shared";
import { probeEffectivePath, type ProbedPaths } from "./path-probe.js";
import { diagnoseAllTools, type DiagnoseOptions } from "./tools.js";
import type { CommandRunner } from "../exec/runner.js";
import { RealCommandRunner } from "../exec/runner.js";
import { SERVICE_VERSION } from "../server.js";

export interface CollectOptions {
  /** Inherited PATH override (tests); defaults to process.env.PATH. */
  inheritedPath?: string;
  /** Shell override for the probe. */
  shell?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  /**
   * Pre-resolved PATH picture (tests); when present (even null, meaning
   * "no shell answered") the login-shell probe is skipped, so the report
   * never spawns a shell. Omitted in production (real probe).
   */
  pathProbe?: ProbedPaths | null;
  /** Service identity (the running service fills these; doctor fills its own). */
  service?: Partial<DiagnosticService>;
  /** Extra model listings (id → display info) when the caller probed them. */
  models?: Record<string, ModelInfo[]>;
  /** Data dir / port for the service identity. */
  dataDir?: string;
  port?: number;
}

function serviceStartMode(): string {
  // Helper-started services on macOS come from the Unvibe.app applet (parent
  // is launchd, no CLI argv); CLI starts carry `start`/`--foreground`.
  try {
    const argv = process.argv.join(" ");
    if (argv.includes("start --foreground") || argv.includes("start")) {
      // Detached `start` (CLI daemon) vs foreground: foreground keeps stdio.
      return process.send === undefined && argv.includes("--foreground") ? "cli (foreground)" : "cli";
    }
    if (process.env.UNVIBE_HELPER === "1") return "helper";
    // macOS helper sets no marker today; report pid/cwd so the Doctor page
    // can still distinguish. Best-effort label.
    if (process.platform === "darwin" && process.ppid === 1) return "helper (likely)";
    return "foreground";
  } catch {
    return "unknown";
  }
}

function redactHome(p: string, home: string): string {
  if (!home || !p.includes(home)) return p;
  return p.split(home).join("~");
}

export async function collectDiagnostics(opts: CollectOptions = {}): Promise<DiagnosticsResponse> {
  const env = opts.env ?? process.env;
  const runner = opts.runner ?? new RealCommandRunner();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const inheritedPath = opts.inheritedPath ?? env.PATH ?? "";

  const probed =
    opts.pathProbe !== undefined
      ? opts.pathProbe
      : await probeEffectivePath({
          shell: opts.shell,
          timeoutMs: Math.min(timeoutMs, 5000),
          inheritedPath,
        });

  const path: DiagnosticPath = probed
    ? {
        shell: probed.shell,
        probedPath: probed.probedPath,
        inheritedPath: probed.inheritedPath,
        effectivePath: probed.effectivePath,
        onlyInProbed: probed.onlyInProbed,
        onlyInInherited: probed.onlyInInherited,
      }
    : {
        shell: "(none answered)",
        probedPath: "",
        inheritedPath,
        effectivePath: inheritedPath,
        onlyInProbed: [],
        onlyInInherited: [],
      };

  const effectivePath = path.effectivePath;
  const probeDataDir = opts.service?.dataDir ?? opts.dataDir;
  const diagOpts: DiagnoseOptions = {
    pathValue: effectivePath,
    env,
    runner,
    timeoutMs,
    ...(probeDataDir ? { dataDir: probeDataDir } : {}),
  };
  const tools: DiagnosticTool[] = await diagnoseAllTools(diagOpts);

  const home = os.homedir();
  const service: DiagnosticService = {
    pid: opts.service?.pid ?? process.pid,
    startedAt: opts.service?.startedAt ?? new Date().toISOString(),
    cwd: opts.service?.cwd ?? process.cwd(),
    dataDir: opts.service?.dataDir ?? opts.dataDir ?? "",
    port: opts.service?.port ?? opts.port ?? 0,
    startMode: opts.service?.startMode ?? serviceStartMode(),
    nodeVersion: process.version,
    serviceVersion: SERVICE_VERSION,
  };

  const warnings: string[] = [];
  if (!probed) warnings.push("No login shell answered; using the inherited PATH. Tools activated in .zshrc/.bashrc may be invisible.");
  else {
    if (path.onlyInInherited.length > 0 && path.onlyInProbed.length > 0)
      warnings.push(
        `PATH differs from the interactive shell: ${path.onlyInProbed.length} only in the shell (${path.onlyInProbed.slice(0, 3).map((d) => redactHome(d, home)).join(", ")}${path.onlyInProbed.length > 3 ? "…" : ""}) and ${path.onlyInInherited.length} only inherited.`,
      );
    else if (path.onlyInProbed.length > 0)
      warnings.push(`Your interactive shell adds ${path.onlyInProbed.length} PATH ${path.onlyInProbed.length === 1 ? "entry" : "entries"} that the service did not inherit. Unvibe reads them from the shell, so tools installed there are still found.`);
  }
  for (const t of tools) warnings.push(...t.warnings);

  return {
    generatedAt: Date.now(),
    path,
    tools,
    service,
    warnings,
    ...(opts.models ? { models: opts.models } : {}),
  };
}

/** Redacted text report for "Copy diagnostics" (token + home dir redacted). */
export function formatDiagnosticsText(
  report: DiagnosticsResponse,
  opts: { home?: string } = {},
): string {
  const home = opts.home ?? os.homedir();
  const redact = (s: string): string => {
    let out = s;
    // Redact anything looking like a token (defense in depth; the report
    // never contains the real token, but pasted output must stay safe).
    out = out.replace(/(token[=:]\s*)(\S+)/gi, "$1[redacted]");
    out = out.replace(/(Bearer\s+)(\S+)/gi, "$1[redacted]");
    if (home) out = out.split(home).join("~");
    return out;
  };
  const lines: string[] = [];
  lines.push(`Unvibe diagnostics (${new Date(report.generatedAt).toISOString()})`);
  lines.push(`service: pid ${report.service.pid} (${report.service.startMode}), node ${report.service.nodeVersion}, service ${report.service.serviceVersion}`);
  lines.push(`cwd: ${redact(report.service.cwd)} | dataDir: ${redact(report.service.dataDir)} | port: ${report.service.port}`);
  lines.push(`shell: ${report.path.shell}`);
  lines.push(`probed PATH: ${redact(report.path.probedPath)}`);
  lines.push(`inherited PATH: ${redact(report.path.inheritedPath)}`);
  lines.push(`effective PATH: ${redact(report.path.effectivePath)}`);
  if (report.path.onlyInProbed.length > 0) lines.push(`only in probed: ${redact(report.path.onlyInProbed.join(":"))}`);
  if (report.path.onlyInInherited.length > 0) lines.push(`only inherited: ${redact(report.path.onlyInInherited.join(":"))}`);
  for (const t of report.tools) {
    lines.push(`--- ${t.tool}${t.minVersion ? ` (need ≥ ${t.minVersion})` : ""} ---`);
    lines.push(`chosen: ${t.chosen ?? "(none)"} — ${t.chosenReason}`);
    if (t.overrideEnv) lines.push(`override: ${t.overrideEnv}=${redact(t.overrideValue ?? "")}`);
    t.candidates.forEach((c, i) => {
      lines.push(`  [${i + 1}] ${redact(c.path)} (${c.source}; ${c.kind}) runs=${c.runs}${c.exitCode !== undefined ? ` exit=${c.exitCode}` : ""}${c.version ? ` version=${c.version}` : ""}${c.meetsMin !== undefined ? ` meetsMin=${c.meetsMin}` : ""}`);
      if (c.symlinkTarget) lines.push(`      → ${redact(c.symlinkTarget)}`);
      if (c.resolvedPath) lines.push(`      resolves to ${redact(c.resolvedPath)} (what runs)`);
      if (c.stdout) lines.push(`      stdout: ${redact(c.stdout.slice(0, 2000))}`);
      if (c.stderr) lines.push(`      stderr: ${redact(c.stderr.slice(0, 2000))}`);
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
  return lines.join("\n");
}
