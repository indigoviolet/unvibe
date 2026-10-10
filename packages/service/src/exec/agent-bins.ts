/**
 * Agent CLI executables (PRD §6, §14).
 *
 * Unvibe runs the user's installed `claude` and `codex` CLIs — never a
 * bundled binary. Each ACP adapter is pointed at the user's binary through
 * the mechanism it really supports (verified against the adapter sources):
 *
 * - Claude (`@agentclientprotocol/claude-agent-acp` 0.89.0 → SDK 0.3.293):
 *   `claudeCliPath()` returns `process.env.CLAUDE_CODE_EXECUTABLE` when set,
 *   else resolves the bundled `@anthropic-ai/claude-agent-sdk-*` native
 *   binary. The resolved path is passed as `pathToClaudeCodeExecutable` to
 *   the SDK ("Path to the Claude Code executable. Uses the built-in
 *   executable if not specified." — sdk.d.ts). Setting
 *   `CLAUDE_CODE_EXECUTABLE` to the user's `claude` makes the adapter drive
 *   the user's CLI with the user's login.
 * - Codex (`@agentclientprotocol/codex-acp` 2.2.2 → `@openai/codex`
 *   0.160.1): `startAcpServer()` reads `process.env.CODEX_PATH`; when set it
 *   spawns `CODEX_PATH app-server`, else it falls back to the bundled
 *   `@openai/codex/bin/codex.js` (CodexJsonRpcConnection.ts). The README
 *   documents: "Set CODEX_PATH only when you want the adapter to run a
 *   different Codex binary". Setting `CODEX_PATH` to the user's `codex`
 *   makes the adapter drive the user's CLI (which must support `app-server`).
 *
 * Resolution order per provider:
 * 1. `UNVIBE_CLAUDE_BIN` / `UNVIBE_CODEX_BIN` (explicit Unvibe override for
 *    unusual installs),
 * 2. `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH` (adapter-native vars; respected
 *    so existing setups keep working),
 * 3. `claude` / `codex` found on the login-shell PATH (the normal case).
 *
 * Minimum versions are the CLI versions the adapters were written against:
 * - Codex ≥ 0.160.1 (adapter dep `@openai/codex ^0.160.1`; this machine:
 *   `codex-cli` 0.162.1).
 * - Claude ≥ 2.1.293 (SDK 0.3.293 bundles `claude` 2.1.293; this machine:
 *   2.1.296).
 *
 * Both adapters speak to the CLI over a versioned protocol (`app-server`
 * JSON-RPC for Codex; SDK-spawned CLI for Claude) with no explicit minimum-
 * version gate in the adapter code — a too-old CLI fails as a generic
 * adapter crash. Readiness/doctor surface the specific "needs ≥ …; update
 * with …" message instead (see `readiness/checks.ts`, `cli/doctor.ts`).
 */

import fs from "node:fs";
import path from "node:path";

export type AgentProvider = "claude" | "codex";

interface AgentBinSpec {
  cli: string;
  unvibeEnv: string;
  adapterEnv: string;
  minVersion: string;
  installHint: string;
  updateHint: string;
}

const SPECS: Record<AgentProvider, AgentBinSpec> = {
  claude: {
    cli: "claude",
    unvibeEnv: "UNVIBE_CLAUDE_BIN",
    adapterEnv: "CLAUDE_CODE_EXECUTABLE",
    // SDK 0.3.293 bundles claude 2.1.293 (verified: bundled binary --version).
    minVersion: "2.1.293",
    installHint:
      "Install Claude Code (https://code.claude.com/docs/setup) and ensure `claude` is on your login-shell PATH; Unvibe does not install it for you.",
    updateHint: "Update with your usual Claude Code update (e.g. the installer or `claude update`, if your install supports it).",
  },
  codex: {
    cli: "codex",
    unvibeEnv: "UNVIBE_CODEX_BIN",
    adapterEnv: "CODEX_PATH",
    // Adapter dep `@openai/codex ^0.160.1`.
    minVersion: "0.160.1",
    installHint:
      "Install the Codex CLI (https://developers.openai.com/codex/cli/) and ensure `codex` is on your login-shell PATH; Unvibe does not install it for you.",
    updateHint: "Update with your usual Codex CLI update (e.g. `codex update` or reinstall from the docs above).",
  },
};

export function agentBinSpec(provider: AgentProvider): AgentBinSpec {
  return SPECS[provider];
}

/** True when the path exists and is executable (file). */
function isExecutableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Minimal `command -v` over a PATH value (mirrors readiness/checks.ts). */
export function findBinOnPath(name: string, pathValue: string): string | null {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, name);
    try {
      if (isExecutableFile(full)) return full;
    } catch {
      // keep looking
    }
  }
  return null;
}

export interface ResolvedAgentBin {
  /** Absolute path to the executable to run. */
  path: string;
  /** Where it came from (for doctor/readiness display). */
  source: string;
}

/**
 * Resolve the executable for a provider. Returns null when not found (caller
 * reports the install hint). Never throws. `env` and `pathValue` are
 * injectable for tests.
 */
export function resolveAgentBin(
  provider: AgentProvider,
  opts: { env?: NodeJS.ProcessEnv; pathValue?: string } = {},
): ResolvedAgentBin | null {
  const spec = SPECS[provider];
  const env = opts.env ?? process.env;
  const pathValue = opts.pathValue ?? env.PATH ?? "";

  const unvibeOverride = (env[spec.unvibeEnv] ?? "").trim();
  if (unvibeOverride) {
    if (isExecutableFile(unvibeOverride)) {
      return { path: unvibeOverride, source: `env ${spec.unvibeEnv}` };
    }
    // Explicit override pointing nowhere: report it anyway so the error
    // names the bad override instead of silently falling through.
    return { path: unvibeOverride, source: `env ${spec.unvibeEnv} (missing)` };
  }

  const adapterOverride = (env[spec.adapterEnv] ?? "").trim();
  if (adapterOverride) {
    // CODEX_PATH may be a bare command on PATH ("codex"); accept it when it
    // resolves, else pass through (the adapter spawns it and reports ENOENT).
    if (path.isAbsolute(adapterOverride) || adapterOverride.includes(path.sep)) {
      return { path: adapterOverride, source: `env ${spec.adapterEnv}` };
    }
    const onPath = findBinOnPath(adapterOverride, pathValue);
    if (onPath) return { path: onPath, source: `env ${spec.adapterEnv}` };
    return { path: adapterOverride, source: `env ${spec.adapterEnv}` };
  }

  const found = findBinOnPath(spec.cli, pathValue);
  if (found) return { path: found, source: "login-shell PATH" };
  return null;
}

/**
 * Env vars to set on the adapter subprocess so it drives the user's CLI.
 * Respects pre-set adapter vars (explicit overrides win); otherwise points
 * each adapter at the resolved user binary. Callers merge this over the
 * subprocess env. Returns the resolved bins for logging/readiness.
 */
export function agentBinEnv(
  resolved: { claude: ResolvedAgentBin | null; codex: ResolvedAgentBin | null },
  env: NodeJS.ProcessEnv = process.env,
): { env: Record<string, string>; resolved: { claude: ResolvedAgentBin | null; codex: ResolvedAgentBin | null } } {
  const out: Record<string, string> = {};
  if (!env.CLAUDE_CODE_EXECUTABLE && resolved.claude && isExecutableFile(resolved.claude.path)) {
    out.CLAUDE_CODE_EXECUTABLE = resolved.claude.path;
  }
  if (!env.CODEX_PATH && resolved.codex && isExecutableFile(resolved.codex.path)) {
    out.CODEX_PATH = resolved.codex.path;
  }
  return { env: out, resolved };
}

/** Extract the first `x.y.z` from `cmd --version` output. */
export function parseVersion(output: string): string | null {
  const m = output.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Compare dotted versions: -1 / 0 / 1. Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => Number(s) || 0);
  const pb = b.split(".").map((s) => Number(s) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** True when `found` meets the provider's minimum version. */
export function meetsMinVersion(provider: AgentProvider, found: string): boolean {
  return compareVersions(found, SPECS[provider].minVersion) >= 0;
}

/** Specific version failure message (readiness/doctor surface this). */
export function versionTooOldMessage(provider: AgentProvider, found: string): string {
  const spec = SPECS[provider];
  return (
    `${spec.cli} ${found} found; Unvibe needs ≥ ${spec.minVersion} ` +
    `(the version the adapter was written against). ${spec.updateHint}`
  );
}

/** Missing-CLI message (readiness/doctor surface this). */
export function missingBinMessage(provider: AgentProvider): string {
  const spec = SPECS[provider];
  return `${spec.cli} CLI not found on your login-shell PATH. ${spec.installHint}`;
}
