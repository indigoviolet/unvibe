/**
 * Version-manager shim resolution (issue #105).
 *
 * A review worktree holds code under review, including that repo's version-
 * manager config (`.mise.toml`, `.tool-versions`, …). When the user's
 * `claude`/`codex` is a manager shim, starting the agent there can fail —
 * mise refuses an untrusted config before the CLI runs — so every agent
 * job on the review fails. The worktree must never be trusted (`mise
 * trust` would execute unreviewed config), so instead the session bypasses
 * the manager: resolve the shim to the real executable once, from a
 * neutral directory, and hand that path to the adapter.
 *
 * - mise: `mise which <tool>` prints the real path bypassing shims
 *   (https://mise.jdx.dev/cli/which.html). Run from the user's home
 *   directory: home is never a review copy, and the lookup then follows
 *   the user's own (already trusted) config instead of the worktree's.
 * - asdf: `asdf which <command>` prints the path to the executable
 *   (https://asdf-vm.com/manage/commands.html). Same neutral-directory
 *   handling.
 * - Anything else (unknown manager, explicit `UNVIBE_*_BIN` /
 *   adapter-native overrides): no resolution, the candidate is used as-is.
 *
 * Resolution never throws (failure → null → the caller falls back to the
 * candidate and the check below reports it). Successful and failed
 * resolutions are cached per manager/tool/candidate; "Reload environment"
 * (`POST /api/reload`) clears the cache via {@link clearShimResolutionCache}.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandRunner, RunOptions, RunResult } from "./runner.js";
import { RealCommandRunner } from "./runner.js";
import { agentBinSpec, findBinOnPath, type AgentProvider } from "./agent-bins.js";

/** Managers we know how to ask for the real path, and how. */
const MANAGER_WHICH: Record<string, { cmd: string; args: (tool: string) => string[] }> = {
  mise: { cmd: "mise", args: (tool) => ["which", tool] },
  asdf: { cmd: "asdf", args: (tool) => ["which", tool] },
};

export function shimManagerResolvable(manager: string | undefined): boolean {
  return manager !== undefined && Object.hasOwn(MANAGER_WHICH, manager);
}

/**
 * True when the candidate is a version-manager shim we should resolve
 * rather than run: kind `shim (…)` from a known manager, and not an
 * explicit user override (`UNVIBE_*_BIN` / adapter-native vars win
 * unchanged — even when they point at a shim).
 */
export function isResolvableShim(candidate: { kind: string; shimManager?: string; source: string }): boolean {
  return (
    candidate.kind.startsWith("shim") && shimManagerResolvable(candidate.shimManager) && !candidate.source.startsWith("env ")
  );
}

function neutralDir(override?: string): string {
  if (override) return override;
  try {
    return os.homedir();
  } catch {
    return os.tmpdir();
  }
}

function isExecutableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

const cache = new Map<string, string | null>();
const serviceToolCache = new Map<string, string | null>();

/** Clear cached resolutions (Reload environment). Exported for the reload route. */
export function clearShimResolutionCache(): void {
  cache.clear();
  serviceToolCache.clear();
}

/**
 * Which version manager a candidate belongs to, when detectable: path
 * markers (`…/mise/shims/`, `…/.asdf/`, …), then a content sniff of small
 * wrapper scripts. Shared with the diagnostics module so doctor and the
 * service classify a candidate the same way (issues #105, #109).
 */
export function shimManagerForCandidate(absPath: string, symlinkTarget?: string): string | undefined {
  const hay = `${absPath}\n${symlinkTarget ?? ""}`.toLowerCase();
  if (hay.includes("/mise/shims/") || hay.includes(".local/share/mise")) return "mise";
  if (hay.includes("/.asdf/shims/") || hay.includes("/.asdf/")) return "asdf";
  if (hay.includes("/.nvm/versions/node/") || hay.includes("/.nvm/")) return "nvm";
  if (hay.includes("/cellar/") || hay.includes("/opt/homebrew/") || hay.includes("/usr/local/homebrew")) return "homebrew";
  if (hay.includes("node_modules/.bin") || hay.includes("/lib/node_modules/")) return "npm-global";
  try {
    const st = fs.statSync(symlinkTarget ?? absPath);
    if (st.isFile() && st.size < 32 * 1024) {
      const head = fs.readFileSync(symlinkTarget ?? absPath, "utf8").slice(0, 4000).toLowerCase();
      if (head.includes("mise")) return "mise";
      if (head.includes("asdf")) return "asdf";
      if (head.includes("nvm")) return "nvm";
    }
  } catch {
    // ignore: content sniff is best-effort
  }
  return undefined;
}

function symlinkTargetOf(p: string): string | undefined {
  try {
    if (!fs.lstatSync(p).isSymbolicLink()) return undefined;
    const next = fs.readlinkSync(p);
    return path.isAbsolute(next) ? next : path.resolve(path.dirname(p), next);
  } catch {
    return undefined;
  }
}

export interface ResolveServiceToolOptions {
  /** Effective PATH the candidate is found on. */
  pathValue: string;
  runner?: CommandRunner;
  timeoutMs?: number;
  /** Neutral directory to resolve from (tests); default: home, else tmp. */
  neutralDir?: string;
  /** Candidate already located by the caller (absolute or path-like). */
  candidatePath?: string;
}

/**
 * The executable the service itself should run for `git`/`gh` (issue
 * #109): the first candidate on `pathValue`, resolved through its version
 * manager when it is a mise/asdf shim, else the candidate as-is. Null when
 * the tool is not on the PATH at all. Never throws — an unresolvable shim
 * falls back to the candidate, exactly the pre-#109 behaviour, and doctor
 * reports the failure. Cached per tool/candidate/PATH; Reload environment
 * clears it via {@link clearShimResolutionCache}.
 */
export async function resolveServiceToolPath(
  tool: string,
  opts: ResolveServiceToolOptions,
): Promise<string | null> {
  const candidate = opts.candidatePath ?? findBinOnPath(tool, opts.pathValue);
  if (!candidate) return null;
  if (!isExecutableFile(candidate)) return candidate;
  const key = `${tool}\0${candidate}\0${opts.pathValue}`;
  const cached = serviceToolCache.get(key);
  if (cached !== undefined) return cached;
  let resolved: string | null = candidate;
  const manager = shimManagerForCandidate(candidate, symlinkTargetOf(candidate));
  if (manager && shimManagerResolvable(manager)) {
    resolved =
      (await resolveShimTarget({
        tool,
        candidatePath: candidate,
        manager,
        pathValue: opts.pathValue,
        ...(opts.runner ? { runner: opts.runner } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        ...(opts.neutralDir !== undefined ? { neutralDir: opts.neutralDir } : {}),
      })) ?? candidate;
  }
  serviceToolCache.set(key, resolved);
  return resolved;
}

/**
 * Command runner that runs the service's own `git`/`gh` through their
 * resolved real executables (issue #109), so a call made with a review
 * worktree as cwd never goes through a version-manager shim that would
 * read the reviewed repo's config. Every other command, and every
 * explicitly injected runner elsewhere, is untouched. Resolution happens
 * once per tool (cached in {@link resolveServiceToolPath}); the resolved
 * tools' directories also go first on the child's PATH, so a tool the
 * other spawns (`gh` as git's credential helper, git under `gh`) finds
 * the real binary too. Never throws for resolution: failures fall back
 * to the command as given.
 */
export class ShimResolvingCommandRunner implements CommandRunner {
  constructor(
    private readonly inner: CommandRunner,
    private readonly opts: { pathValue?: string; timeoutMs?: number; neutralDir?: string } = {},
  ) {}

  async run(cmd: string, opts: RunOptions): Promise<RunResult> {
    const tool = path.basename(cmd);
    if (tool !== "git" && tool !== "gh") return this.inner.run(cmd, opts);
    try {
      const pathValue = opts.env?.PATH ?? this.opts.pathValue ?? process.env.PATH ?? "";
      const resolveOpts = {
        pathValue,
        runner: this.inner,
        ...(this.opts.timeoutMs !== undefined ? { timeoutMs: this.opts.timeoutMs } : {}),
        ...(this.opts.neutralDir !== undefined ? { neutralDir: this.opts.neutralDir } : {}),
      };
      const isPathLike = path.isAbsolute(cmd) || cmd.includes(path.sep);
      const gitPath = await resolveServiceToolPath("git", resolveOpts);
      const ghPath = await resolveServiceToolPath("gh", resolveOpts);
      const wanted = isPathLike
        ? await resolveServiceToolPath(tool, { ...resolveOpts, candidatePath: cmd })
        : tool === "git"
          ? gitPath
          : ghPath;
      if (!wanted) return this.inner.run(cmd, opts);
      const dirs: string[] = [];
      for (const p of [gitPath, ghPath]) {
        if (!p) continue;
        const dir = path.dirname(p);
        if (!dirs.includes(dir)) dirs.push(dir);
      }
      const base = pathValue.split(path.delimiter).filter(Boolean);
      const mergedPath = [...dirs, ...base.filter((d) => !dirs.includes(d))].join(path.delimiter);
      return this.inner.run(wanted, {
        ...opts,
        env: { ...opts.env, PATH: mergedPath },
      });
    } catch {
      return this.inner.run(cmd, opts);
    }
  }
}

export interface ResolveShimOptions {
  /** Tool name as the manager knows it (`claude` / `codex`). */
  tool: string;
  /** Absolute path of the shim candidate. */
  candidatePath: string;
  /** Manager from candidate classification (`mise` / `asdf`). */
  manager: string;
  /** Effective PATH used for candidate discovery (finds the manager too). */
  pathValue: string;
  runner?: CommandRunner;
  timeoutMs?: number;
  /** Neutral directory to resolve from (tests); default: home, else tmp. */
  neutralDir?: string;
}

/**
 * Ask the manager for the real executable behind a shim, from a neutral
 * directory that is never a review worktree. Returns the absolute real
 * path, or null when the manager is unknown, missing, or has no answer.
 * Never throws. Results (including failures) are cached; Reload
 * environment clears the cache.
 */
export async function resolveShimTarget(opts: ResolveShimOptions): Promise<string | null> {
  const key = `${opts.manager}\0${opts.tool}\0${opts.candidatePath}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const resolved = await resolveUncached(opts);
  cache.set(key, resolved);
  return resolved;
}

async function resolveUncached(opts: ResolveShimOptions): Promise<string | null> {
  const which = MANAGER_WHICH[opts.manager];
  if (!which) return null;
  const runner = opts.runner ?? new RealCommandRunner();
  const timeoutMs = opts.timeoutMs ?? 8000;
  // The manager itself comes from the same effective PATH the candidate
  // was found on (it may not be on the service's inherited PATH, e.g. a
  // GUI-started service); absolute path so the spawn needs no PATH.
  const managerBin = findBinOnPath(which.cmd, opts.pathValue) ?? which.cmd;
  let out: string;
  try {
    const res = await Promise.race([
      runner.run(managerBin, {
        args: which.args(opts.tool),
        cwd: neutralDir(opts.neutralDir),
        timeoutMs,
      }),
      new Promise<{ stdout: string; stderr: string; code: number }>((resolve) =>
        setTimeout(() => resolve({ stdout: "", stderr: `timed out after ${timeoutMs}ms`, code: 124 }), timeoutMs + 500),
      ),
    ]);
    if (res.code !== 0) return null;
    out = res.stdout;
  } catch {
    return null;
  }
  const first = out
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!first || !path.isAbsolute(first)) return null;
  if (!isExecutableFile(first)) return null;
  return first;
}

/**
 * Second layer (issue #105): a stray manager invocation inside the
 * session must ignore the review copies' configs. `MISE_IGNORED_CONFIG_PATHS`
 * lists config files/directories mise never loads — a path entry also
 * covers everything under it, entries are `:`-separated (`;` on Windows),
 * and it is read before any config file, so it cannot be overridden by
 * the worktree (verified against the mise settings reference,
 * https://mise.jdx.dev/configuration/settings.html#ignored_config_paths).
 * The service's own worktrees directory is passed absolute, as the docs
 * require (relative entries would resolve from the child's cwd).
 */
export function miseIgnoreEnv(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): { MISE_IGNORED_CONFIG_PATHS: string } {
  const worktrees = path.join(dataDir, "worktrees");
  const existing = (env.MISE_IGNORED_CONFIG_PATHS ?? "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (!existing.includes(worktrees)) existing.push(worktrees);
  return { MISE_IGNORED_CONFIG_PATHS: existing.join(path.delimiter) };
}

/** A session-start failure caused by a version manager refusing the review copy. */
export function isVersionManagerTrustFailure(message: string): boolean {
  return /is not trusted|are not trusted/i.test(message) || /mise\s+ERROR/i.test(message) || /mise trust/i.test(message);
}

/**
 * Plain-words session-start error for a version-manager refusal (issue
 * #105; style per #45: `Couldn't <do the thing>: <reason>` + what to do
 * next, user's words only — no "adapter", "ACP", "probe", "worktree").
 * Anything else passes through with the established prefix unchanged.
 */
export function friendlySessionStartError(
  provider: AgentProvider,
  rawMessage: string,
  adapterBin: string | null,
): string {
  if (!isVersionManagerTrustFailure(rawMessage)) {
    return `couldn't start a ${provider} session: ${rawMessage}`;
  }
  const spec = agentBinSpec(provider);
  const tried = adapterBin ? ` (it tried ${adapterBin})` : "";
  return (
    `couldn't start a ${provider} session: ` +
    `the ${spec.cli} command would not run inside the review's working copy — ` +
    `its version manager refused the review's settings${tried}. ` +
    `Set ${spec.unvibeEnv} to the real ${spec.cli} executable and restart the service ` +
    `(\`mise which ${spec.cli}\` prints the real path).`
  );
}
