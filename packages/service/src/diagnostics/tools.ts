/**
 * Tool discovery for the shared diagnostics module (issue #20).
 *
 * For each tool (`git`, `gh`, `claude`, `codex`, `d2`, `node`) we enumerate
 * EVERY candidate on the effective PATH in order and report for each:
 * - what it is (real file, symlink → target, shim + manager where
 *   detectable: mise/asdf/nvm/homebrew/npm-global),
 * - whether it runs (`--version` with a timeout: exit code + full
 *   stdout/stderr, untruncated),
 * - the parsed version ONLY from a successful run (exit 0; a failed run
 *   never yields a version, so mise's version from error text can no
 *   longer leak into the UI),
 * - the minimum-version verdict,
 * - and which candidate was CHOSEN and why (first that runs and meets
 *   the minimum; broken shims are skipped and the next entry is tried).
 *
 * Overrides (`UNVIBE_*_BIN`, plus the adapter-native `CLAUDE_CODE_EXECUTABLE`
 * / `CODEX_PATH`) are reported as such (source `env …`, kind
 * `override`/`missing-override`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandRunner } from "../exec/runner.js";
import { RealCommandRunner } from "../exec/runner.js";
import type { DiagnosticCandidate, DiagnosticTool } from "@unvibe/shared";
import { agentBinSpec, compareVersions, type AgentProvider } from "../exec/agent-bins.js";
import { PI_MIN_VERSION } from "../agent/pi/detect.js";
import { isResolvableShim, resolveShimTarget, shimManagerForCandidate } from "../exec/shim-resolve.js";
import { D2_MIN } from "../diagrams/bins.js";

export interface ToolSpec {
  tool: string;
  /** Binary name(s) to look for on PATH, in order. */
  names: string[];
  /** Env override(s) that win over PATH, in priority order. */
  overrideEnvs: string[];
  /** Minimum version, when enforced (claude/codex/d2/node). */
  minVersion?: string;
  /** Args for the version probe. */
  versionArgs: string[];
  /** Human install hint for the not-found case. */
  installHint: string;
  /**
   * Probe candidates from a directory shaped like a review worktree and
   * resolve manager shims to the real executable (issues #105, #109).
   * Set for the agent CLIs and for the service's own `git`/`gh`: sessions
   * and service calls run with a review copy as cwd, so the check must
   * exercise the candidate the way those calls will.
   */
  probeFromWorktreeLike?: boolean;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    tool: "git",
    names: ["git"],
    overrideEnvs: [],
    versionArgs: ["--version"],
    installHint: "Install git and ensure it is on your login-shell PATH.",
    probeFromWorktreeLike: true,
  },
  {
    tool: "gh",
    names: ["gh"],
    overrideEnvs: [],
    versionArgs: ["--version"],
    installHint: "Install gh (https://cli.github.com) and ensure it is on your login-shell PATH.",
    probeFromWorktreeLike: true,
  },
  {
    tool: "claude",
    names: ["claude"],
    overrideEnvs: ["UNVIBE_CLAUDE_BIN", "CLAUDE_CODE_EXECUTABLE"],
    minVersion: agentBinSpec("claude").minVersion,
    versionArgs: ["--version"],
    installHint: agentBinSpec("claude").installHint,
    probeFromWorktreeLike: true,
  },
  {
    tool: "codex",
    names: ["codex"],
    overrideEnvs: ["UNVIBE_CODEX_BIN", "CODEX_PATH"],
    minVersion: agentBinSpec("codex").minVersion,
    versionArgs: ["--version"],
    installHint: agentBinSpec("codex").installHint,
    probeFromWorktreeLike: true,
  },
  {
    // Issue #279: the pi provider. The minimum is enforced (older
    // binaries are not offered; Doctor names the running version), and
    // readiness reports the login state separately.
    tool: "pi",
    names: ["pi"],
    overrideEnvs: ["UNVIBE_PI_BIN"],
    minVersion: PI_MIN_VERSION,
    versionArgs: ["--version"],
    installHint:
      "Install Pi (https://pi.dev) and ensure `pi` is on your login-shell PATH; Unvibe does not install it for you. Without pi, OpenAI/Codex models run on the Codex CLI.",
    probeFromWorktreeLike: true,
  },
  {
    tool: "d2",
    names: ["d2"],
    overrideEnvs: ["UNVIBE_D2_BIN"],
    minVersion: D2_MIN,
    versionArgs: ["--version"],
    installHint: "Install d2 (≥ 0.9.0) and ensure it is on your login-shell PATH.",
  },
  {
    tool: "node",
    names: ["node"],
    overrideEnvs: [],
    minVersion: "24.0.0",
    versionArgs: ["--version"],
    installHint: "Install Node 24 (mise.toml) and ensure it is on your login-shell PATH.",
  },
];

function isExecutableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile() || fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function readLinkChain(p: string): { isSymlink: boolean; target?: string } {
  try {
    const st = fs.lstatSync(p);
    if (!st.isSymbolicLink()) return { isSymlink: false };
    let cur = p;
    const seen = new Set<string>([cur]);
    for (let i = 0; i < 10; i++) {
      let next: string;
      try {
        next = fs.readlinkSync(cur);
      } catch {
        break;
      }
      if (!path.isAbsolute(next)) next = path.resolve(path.dirname(cur), next);
      if (seen.has(next)) break;
      seen.add(next);
      cur = next;
      try {
        if (!fs.lstatSync(cur).isSymbolicLink()) break;
      } catch {
        break;
      }
    }
    return { isSymlink: true, target: cur };
  } catch {
    return { isSymlink: false };
  }
}

function sniffShimManager(absPath: string, symlinkTarget?: string): string | undefined {
  return shimManagerForCandidate(absPath, symlinkTarget);
}

function describeKind(absPath: string): { kind: string; symlinkTarget?: string; shimManager?: string } {
  const link = readLinkChain(absPath);
  const manager = sniffShimManager(absPath, link.target);
  if (manager === "mise" || manager === "asdf") {
    return {
      kind: `shim (${manager})`,
      ...(link.target ? { symlinkTarget: link.target } : {}),
      shimManager: manager,
    };
  }
  if (link.isSymlink) {
    return {
      kind: manager ? `symlink (${manager})` : "symlink",
      ...(link.target ? { symlinkTarget: link.target } : {}),
      ...(manager ? { shimManager: manager } : {}),
    };
  }
  if (manager) return { kind: `file (${manager})`, shimManager: manager };
  return { kind: "file" };
}

/** Every candidate for `name` on `pathValue`, in order (deduped). */
export function enumerateCandidates(name: string, pathValue: string): string[] {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const full = path.join(dir, name);
    try {
      if (isExecutableFile(full) && !seen.has(full)) {
        seen.add(full);
        out.push(full);
      }
    } catch {
      // keep looking
    }
  }
  return out;
}

export function parseVersionOnly(output: string): string | null {
  const m = output.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

async function probeVersion(
  runner: CommandRunner,
  binPath: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ runs: boolean; code: number; stdout: string; stderr: string }> {
  try {
    const r = await Promise.race([
      runner.run(binPath, { args, ...(cwd !== undefined ? { cwd } : {}), timeoutMs }),
      new Promise<{ stdout: string; stderr: string; code: number }>((resolve) =>
        setTimeout(() => resolve({ stdout: "", stderr: `timed out after ${timeoutMs}ms`, code: 124 }), timeoutMs + 500),
      ),
    ]);
    return {
      runs: r.code === 0,
      code: r.code,
      stdout: String(r.stdout ?? ""),
      stderr: String(r.stderr ?? ""),
    };
  } catch (e) {
    return { runs: false, code: 127, stdout: "", stderr: String(e instanceof Error ? e.message : e) };
  }
}

export interface DiagnoseOptions {
  pathValue: string;
  env?: NodeJS.ProcessEnv;
  runner?: CommandRunner;
  timeoutMs?: number;
  /**
   * Service data dir (issue #279): the worktree-like probe dir is
   * created under `<dataDir>/tmp/` so a SIGKILLed service's leftovers
   * live in its own data dir (removed with it in tests, swept at
   * startup in production) instead of the shared temp dir. Omitted
   * only by pure unit tests of the probe, which fall back to
   * `os.tmpdir()`; the service always passes its data dir.
   */
  dataDir?: string;
}

/**
 * Parent dir for worktree-like probe dirs (issue #279): inside the
 * service's own data dir (`<dataDir>/tmp/`) when one is given, else the
 * OS temp dir (pure unit tests of the probe only).
 */
function probeParentDir(dataDir?: string): string {
  if (dataDir) return path.join(dataDir, "tmp");
  return os.tmpdir();
}

/**
 * A directory shaped like a review worktree (issue #105): it holds the
 * kind of version-manager config a reviewed repo ships (`.mise.toml`,
 * `.tool-versions`). Created under `<dataDir>/tmp/` (issue #279), used
 * as the version-probe cwd for the agent CLIs so a shim fails here
 * exactly as it would in a review copy, and removed after. The files
 * are ours and are never trusted — they only observe shim behaviour.
 */
function makeWorktreeLikeDir(dataDir?: string): string | undefined {
  try {
    const parent = probeParentDir(dataDir);
    fs.mkdirSync(parent, { recursive: true });
    const dir = fs.mkdtempSync(path.join(parent, "unvibe-probe-"));
    fs.writeFileSync(path.join(dir, ".mise.toml"), '[tools]\nnode = "24"\n');
    fs.writeFileSync(path.join(dir, ".tool-versions"), "nodejs 24.0.0\n");
    return dir;
  } catch {
    return undefined;
  }
}

/**
 * Choice reason naming the shim and the real path sessions run (issue
 * #105), keeping the established "first that runs / skipped N" shape.
 */
function resolutionReason(
  spec: ToolSpec,
  candidates: DiagnosticCandidate[],
  good: { candidate: DiagnosticCandidate; path: string; version: string | null | undefined },
  skipped: number,
): string {
  const c = good.candidate;
  const versionPart = `(version ${good.version ?? "unknown"})`;
  if (!c.resolvedPath) {
    return skipped === 0
      ? `first on PATH runs ${versionPart}`
      : `candidate ${skipped + 1} of ${candidates.length} (${good.path}) is the first that runs and meets ≥ ${spec.minVersion}; skipped ${skipped} broken or too old`;
  }
  const manager = c.shimManager ? `${c.shimManager} ` : "";
  if (skipped === 0) {
    return `first on PATH is a ${manager}shim; the service runs what it resolves to (${good.path}) ${versionPart}`;
  }
  return (
    `candidate ${skipped + 1} of ${candidates.length} (${c.path}, ${manager}shim) ` +
    `is the first that runs from a review copy as ${good.path} ${versionPart} and meets ≥ ${spec.minVersion}; ` +
    `skipped ${skipped} broken, unresolvable or too old`
  );
}

/**
 * Diagnose one tool: every candidate + override, version probes, choice.
 * Never throws.
 */
export async function diagnoseTool(spec: ToolSpec, opts: DiagnoseOptions): Promise<DiagnosticTool> {
  const env = opts.env ?? process.env;
  const runner = opts.runner ?? new RealCommandRunner();
  const timeoutMs = opts.timeoutMs ?? 8000;
  const warnings: string[] = [];
  const candidates: DiagnosticCandidate[] = [];

  // Agent CLIs (sessions) and the service's own git/gh run with a review
  // copy as cwd, so their candidates are probed from a worktree-shaped
  // directory (unless an explicit override wins, which is honoured
  // unchanged). Other tools keep today's behaviour.
  const hasExplicitOverride = spec.overrideEnvs.some((n) => (env[n] ?? "").trim() !== "");
  const probeCwd = spec.probeFromWorktreeLike === true && !hasExplicitOverride ? makeWorktreeLikeDir(opts.dataDir) : undefined;
  // Verified versions of resolved real paths (shim path → real version),
  // for choice and display. Filled by the resolution pass below.
  const resolvedVersions = new Map<string, string>();

  try {
    let overrideEnv: string | undefined;
    let overrideValue: string | undefined;

    for (const envName of spec.overrideEnvs) {
      const raw = (env[envName] ?? "").trim();
      if (!raw) continue;
      overrideEnv = envName;
      overrideValue = raw;
      // UNVIBE_*_BIN must be absolute; adapter vars may be bare commands.
      const isPathLike = path.isAbsolute(raw) || raw.includes(path.sep) || envName.startsWith("UNVIBE_");
      if (isPathLike) {
        let exists = false;
        try {
          exists = isExecutableFile(raw);
        } catch {
          exists = false;
        }
        if (!exists) {
          candidates.push({
            path: raw,
            source: `env ${envName} (missing)`,
            kind: "missing-override",
            runs: false,
            exitCode: 127,
            stdout: "",
            stderr: `override ${envName} points at ${raw}, which does not exist or is not executable`,
            version: null,
          });
          warnings.push(`Override ${envName} points at a missing file (${raw}); fix the path or unset it.`);
          continue;
        }
        const kind = describeKind(raw);
        const probed = await probeVersion(runner, raw, spec.versionArgs, timeoutMs);
        const version = probed.runs ? parseVersionOnly(`${probed.stdout}\n${probed.stderr}`) : null;
        const meetsMin = spec.minVersion && version ? compareVersions(version, spec.minVersion) >= 0 : undefined;
        candidates.push({
          path: raw,
          source: `env ${envName}`,
          kind: `override (${kind.kind})`,
          ...(kind.symlinkTarget ? { symlinkTarget: kind.symlinkTarget } : {}),
          ...(kind.shimManager ? { shimManager: kind.shimManager } : {}),
          runs: probed.runs,
          exitCode: probed.code,
          stdout: probed.stdout,
          stderr: probed.stderr,
          version,
          ...(meetsMin !== undefined ? { meetsMin } : {}),
        });
        if (!probed.runs) warnings.push(`Override ${envName} (${raw}) does not run (exit ${probed.code}); fix it or unset it to use PATH.`);
        else if (meetsMin === false) warnings.push(`Override ${envName} (${raw}) is version ${version}, need ≥ ${spec.minVersion}.`);
      } else {
        // Bare command in an adapter var: resolve on PATH like the normal case.
        const onPath = enumerateCandidates(raw, opts.pathValue);
        if (onPath.length === 0) {
          candidates.push({
            path: raw,
            source: `env ${envName} (missing)`,
            kind: "missing-override",
            runs: false,
            exitCode: 127,
            stdout: "",
            stderr: `override ${envName}=${raw} not found on PATH`,
            version: null,
          });
          warnings.push(`Override ${envName}=${raw} not found on PATH.`);
        } else {
          for (const p of onPath) {
            const kind = describeKind(p);
            const probed = await probeVersion(runner, p, spec.versionArgs, timeoutMs);
            const version = probed.runs ? parseVersionOnly(`${probed.stdout}\n${probed.stderr}`) : null;
            const meetsMin = spec.minVersion && version ? compareVersions(version, spec.minVersion) >= 0 : undefined;
            candidates.push({
              path: p,
              source: `env ${envName}`,
              kind: kind.kind,
              ...(kind.symlinkTarget ? { symlinkTarget: kind.symlinkTarget } : {}),
              ...(kind.shimManager ? { shimManager: kind.shimManager } : {}),
              runs: probed.runs,
              exitCode: probed.code,
              stdout: probed.stdout,
              stderr: probed.stderr,
              version,
              ...(meetsMin !== undefined ? { meetsMin } : {}),
            });
          }
        }
      }
      // First set override wins; do not fall through to PATH when an
      // override is set (explicit config must be honoured, even when broken,
      // so the error names the bad override).
      break;
    }

    const hasOverride = overrideEnv !== undefined;
    if (!hasOverride) {
      for (const name of spec.names) {
        for (const p of enumerateCandidates(name, opts.pathValue)) {
          if (candidates.some((c) => c.path === p)) continue;
          const kind = describeKind(p);
          const probed = await probeVersion(runner, p, spec.versionArgs, timeoutMs, probeCwd);
          // Only parse a version from a SUCCESSFUL run (exit 0). A failed
          // `--version` (broken shim) previously leaked mise's version from
          // the error text into the UI; now version is null.
          const version = probed.runs ? parseVersionOnly(`${probed.stdout}\n${probed.stderr}`) : null;
          const meetsMin = spec.minVersion && version ? compareVersions(version, spec.minVersion) >= 0 : undefined;
          candidates.push({
            path: p,
            source: "login-shell PATH",
            kind: kind.kind,
            ...(kind.symlinkTarget ? { symlinkTarget: kind.symlinkTarget } : {}),
            ...(kind.shimManager ? { shimManager: kind.shimManager } : {}),
            runs: probed.runs,
            exitCode: probed.code,
            stdout: probed.stdout,
            stderr: probed.stderr,
            version,
            ...(meetsMin !== undefined ? { meetsMin } : {}),
          });
        }
      }

      // Shim resolution (issues #105, #109): a manager shim is never what a
      // session or a service git/gh call runs. Ask the manager for the real
      // executable from a neutral directory and verify it runs from the
      // worktree-shaped directory; the choice below uses the real path.
      if (probeCwd !== undefined) {
        for (const c of candidates) {
          if (!isResolvableShim(c) || !c.shimManager) continue;
          const real = await resolveShimTarget({
            tool: spec.tool,
            candidatePath: c.path,
            manager: c.shimManager,
            pathValue: opts.pathValue,
            runner,
            timeoutMs,
          });
          if (!real || real === c.path) continue;
          const probed = await probeVersion(runner, real, spec.versionArgs, timeoutMs, probeCwd);
          if (!probed.runs) {
            warnings.push(
              `${spec.tool} at ${c.path} is a ${c.shimManager} shim whose real executable (${real}) does not run from a review copy (exit ${probed.code}); the error text is below.`,
            );
            continue;
          }
          c.resolvedPath = real;
          const version = parseVersionOnly(`${probed.stdout}\n${probed.stderr}`);
          if (version) {
            resolvedVersions.set(real, version);
            if (spec.minVersion) c.meetsMin = compareVersions(version, spec.minVersion) >= 0;
          }
        }
      }
    }

    // Choice: first candidate that runs AND meets the minimum (skip broken
    // shims and try the next). A resolved shim counts with its real path
    // (verified to run from a review copy) at the real binary's version.
    // When none meets the minimum but some run, choose the first that runs
    // (version warning). When an explicit override is set, honour it (even
    // when broken) so the error names it.
    //
    // `effective` carries what a session would actually run: the resolved
    // real path when resolution succeeded, else the candidate itself.
    const effective = candidates.map((c) => ({
      candidate: c,
      path: c.resolvedPath ?? c.path,
      runs: c.resolvedPath ? true : c.runs,
      version: (c.resolvedPath ? resolvedVersions.get(c.resolvedPath) : undefined) ?? c.version,
      meetsMin: c.meetsMin,
    }));
    let chosen: string | null = null;
    let chosenReason = "";
    if (hasOverride) {
      const first = candidates[0];
      if (first && first.runs && (first.meetsMin ?? true)) {
        chosen = first.path;
        chosenReason = `explicit override ${overrideEnv} runs (version ${first.version ?? "unknown"})`;
      } else if (first && first.runs) {
        chosen = first.path;
        chosenReason = `explicit override ${overrideEnv} runs but is version ${first.version ?? "unknown"} (need ≥ ${spec.minVersion}); update it`;
      } else if (first) {
        chosen = null;
        chosenReason = `explicit override ${overrideEnv} (${first.path}) does not run (exit ${first.exitCode}); fix it or unset it`;
      } else {
        chosen = null;
        chosenReason = `override ${overrideEnv} set but no candidate`;
      }
    } else if (candidates.length === 0) {
      chosen = null;
      chosenReason = `not found on PATH. ${spec.installHint}`;
    } else {
      const runnable = effective.filter((e) => e.runs);
      if (runnable.length === 0) {
        chosen = null;
        const first = candidates[0];
        chosenReason = `found ${candidates.length} but none runs (first: ${first.path}, exit ${first.exitCode}); the error text is below`;
        warnings.push(`None of the ${candidates.length} copies of ${spec.tool} on PATH runs. The first error below names the problem.`);
      } else if (spec.minVersion) {
        const good = runnable.find((e) => e.meetsMin !== false);
        if (good) {
          chosen = good.path;
          const skipped = effective.indexOf(good);
          chosenReason = resolutionReason(spec, candidates, good, skipped);
          if (skipped > 0) warnings.push(`Skipped ${skipped} broken or too-old ${spec.tool} before ${good.path}.`);
        } else {
          chosen = runnable[0].path;
          chosenReason = `newest runnable is ${runnable[0].version ?? "unknown"} at ${runnable[0].path}, need ≥ ${spec.minVersion}; update it`;
          warnings.push(`${spec.tool} at ${chosen} is version ${runnable[0].version ?? "unknown"}, need ≥ ${spec.minVersion}.`);
        }
      } else {
        const good = runnable[0];
        chosen = good.path;
        const skipped = effective.indexOf(good);
        chosenReason =
          skipped === 0 ? `first on PATH runs` : `candidate ${skipped + 1} of ${candidates.length} is the first that runs; skipped ${skipped} broken`;
        if (skipped > 0) warnings.push(`Skipped ${skipped} broken ${spec.tool} before ${good.path}.`);
      }
    }

    // Plain-language warnings for anything odd.
    const runnablePaths = new Set(effective.filter((e) => e.runs).map((e) => e.path));
    if (candidates.length >= 2) {
      const managers = new Set(candidates.map((c) => c.shimManager).filter(Boolean));
      if (managers.size >= 2) warnings.push(`Two installs of ${spec.tool} (${[...managers].join(" + ")}); using ${chosen ?? "none"}.`);
      else if (candidates.length >= 2 && runnablePaths.size >= 2)
        warnings.push(`Two installs of ${spec.tool}; using ${chosen}.`);
    }
    for (const c of candidates) {
      if (c.resolvedPath) {
        warnings.push(`${spec.tool} at ${c.path} is a ${c.kind}; the service runs ${c.resolvedPath} instead.`);
      } else if (c.kind.startsWith("shim") && !c.runs) {
        warnings.push(`A ${c.kind} at ${c.path} does not run (exit ${c.exitCode}) — likely a broken manager shim; the next working entry is used.`);
      }
    }


    return {
      tool: spec.tool,
      ...(overrideEnv ? { overrideEnv, overrideValue } : {}),
      ...(spec.minVersion ? { minVersion: spec.minVersion } : {}),
      candidates,
      chosen,
      chosenReason,
      warnings,
    };
  } finally {
    // Unconditional (issue #279 follow-up): the probe dir is ours
    // and must go even when a probe above throws.
    if (probeCwd !== undefined) {
      try {
        fs.rmSync(probeCwd, { recursive: true, force: true });
      } catch {
        // best-effort cleanup of our own temp dir
      }
    }
  }
}

/**
 * Remove our own orphaned probe dirs (`<dataDir>/tmp/unvibe-probe-*`,
 * issue #279): a SIGKILLed service never runs the diagnoseTool finally,
 * so leftovers are swept here at startup instead. Any age is removed:
 * the sweep runs before this process diagnoses anything, and every
 * service owns its own data dir, so nothing concurrent is touched.
 * Best-effort, never throws; returns what was removed.
 */
export function sweepProbeTmp(dataDir: string): string[] {
  const removed: string[] = [];
  if (!dataDir) return removed;
  let dir: string;
  try {
    dir = path.join(dataDir, "tmp");
  } catch {
    return removed;
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const e of entries) {
    if (!e.startsWith("unvibe-probe-")) continue;
    const full = path.join(dir, e);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory()) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed.push(full);
    } catch {
      // best effort per entry
    }
  }
  return removed;
}

/** Diagnose every known tool from the same effective PATH. */
export async function diagnoseAllTools(opts: DiagnoseOptions): Promise<DiagnosticTool[]> {
  const out: DiagnosticTool[] = [];
  for (const spec of TOOL_SPECS) {
    try {
      out.push(await diagnoseTool(spec, opts));
    } catch (e) {
      out.push({
        tool: spec.tool,
        candidates: [],
        chosen: null,
        chosenReason: `diagnosis failed: ${String(e)}`,
        warnings: [`Diagnosis for ${spec.tool} failed: ${String(e)}`],
      });
    }
  }
  return out;
}

export type { AgentProvider };
