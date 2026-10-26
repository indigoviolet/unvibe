/**
 * Shared environment checks (used by `unvibe doctor` and `GET /api/readiness`).
 *
 * Moved out of `cli/doctor.ts` so both use one implementation (front-screen
 * milestone). `gh` runs with `GITHUB_TOKEN` unset (PRD §15). Agent probes
 * never send a prompt or spend tokens: they initialise the ACP adapter and
 * list models only (session/new + close).
 */
import fs from "node:fs";
import path from "node:path";
import type { ReadinessCheck, Settings } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { RealCommandRunner } from "../exec/index.js";
import { gitHubCredentialConfig } from "../exec/git.js";
import { isNoneRunner, isReplayRunner } from "../agent/factory.js";
import type { AgentRunner } from "@unvibe/shared";
import {
  agentBinSpec,
  meetsMinVersion,
  missingBinMessage,
  resolveAgentBin,
  versionTooOldMessage,
} from "../exec/agent-bins.js";
import {
  D2_ENV_OVERRIDE,
  D2_MIN,
  d2InstallHint,
  meetsD2MinVersion,
  parseD2Version,
  resolveD2Bin,
} from "../diagrams/bins.js";
import { diagnoseTool, TOOL_SPECS } from "../diagnostics/tools.js";

/** Minimal `command -v`: search PATH for an executable file. */
export function findOnPath(name: string, pathValue: string = process.env.PATH ?? ""): string | null {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  const candidates = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];
  for (const dir of dirs) {
    for (const c of candidates) {
      const full = path.join(dir, c);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        const st = fs.statSync(full);
        if (st.isFile()) return full;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

async function runWithTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `gh auth status` with GITHUB_TOKEN unset (PRD §15). Exported for tests + doctor. */
export async function ghAuthStatus(
  runner: CommandRunner,
): Promise<{ present: boolean; loggedIn: boolean; detail: string }> {
  const bin = findOnPath("gh");
  if (!bin) return { present: false, loggedIn: false, detail: "gh not on PATH" };
  let res;
  try {
    res = await runWithTimeout(
      runner.run("gh", { args: ["auth", "status"], env: { GITHUB_TOKEN: undefined } }),
      8000,
      () => ({ stdout: "", stderr: "timed out", code: 1 }),
    );
  } catch {
    return { present: true, loggedIn: false, detail: "gh present but not logged in (gh auth login)" };
  }
  if (res.code === 0) {
    const first = (res.stdout + "\n" + res.stderr).split("\n").find((l) => l.trim()) ?? "logged in";
    return { present: true, loggedIn: true, detail: first.trim() };
  }
  return { present: true, loggedIn: false, detail: "gh present but not logged in (gh auth login)" };
}

/** `git --version` via the runner (best effort). */
export async function gitVersion(runner: CommandRunner): Promise<string | null> {
  if (!findOnPath("git")) return null;
  try {
    const r = await runWithTimeout(runner.run("git", { args: ["--version"] }), 5000, () => ({
      stdout: "",
      stderr: "timeout",
      code: 1,
    }));
    if (r.code !== 0) return null;
    return r.stdout.split("\n")[0]?.trim() || "git";
  } catch {
    return null;
  }
}

export interface GhProbe {
  installed: boolean;
  authenticated: boolean;
  apiReachable: boolean;
  login?: string;
  detail: string;
}

/**
 * Full `gh` probe: installed (on the login-shell PATH when given),
 * authenticated (`gh auth status`), and able to reach the API
 * (`gh api user`, cheap). `GITHUB_TOKEN` is unset for both calls.
 */
export async function probeGh(
  runner: CommandRunner,
  opts: { pathValue?: string; timeoutMs?: number } = {},
): Promise<GhProbe> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const pathValue = opts.pathValue ?? process.env.PATH ?? "";
  const bin = findOnPath("gh", pathValue);
  if (!bin) return { installed: false, authenticated: false, apiReachable: false, detail: "gh not on PATH" };
  const env = { GITHUB_TOKEN: undefined } as Record<string, string | undefined>;
  let auth;
  try {
    auth = await runWithTimeout(runner.run("gh", { args: ["auth", "status"], env }), timeoutMs, () => ({
      stdout: "",
      stderr: "timed out",
      code: 1,
    }));
  } catch (e) {
    return { installed: true, authenticated: false, apiReachable: false, detail: `gh auth failed: ${String(e)}` };
  }
  if (auth.code !== 0) {
    return { installed: true, authenticated: false, apiReachable: false, detail: "gh present but not logged in" };
  }
  let api;
  try {
    api = await runWithTimeout(
      runner.run("gh", { args: ["api", "user", "--jq", ".login"], env }),
      timeoutMs,
      () => ({ stdout: "", stderr: "timed out", code: 1 }),
    );
  } catch (e) {
    return {
      installed: true,
      authenticated: true,
      apiReachable: false,
      detail: `gh api user failed: ${String(e)}`,
    };
  }
  if (api.code === 0) {
    const login = api.stdout.trim() || undefined;
    return {
      installed: true,
      authenticated: true,
      apiReachable: true,
      ...(login ? { login } : {}),
      detail: login ? `logged in as ${login}` : "logged in",
    };
  }
  return {
    installed: true,
    authenticated: true,
    apiReachable: false,
    detail: (api.stderr || api.stdout || "gh api user failed").split("\n")[0]?.trim() || "gh api user failed",
  };
}

export function gitCheck(version: string | null): ReadinessCheck {
  if (version) {
    return {
      id: "git",
      label: "git",
      status: "ok",
      summary: `${version} found`,
      fix: "",
      settingsAnchor: "#environment",
    };
  }
  return {
    id: "git",
    label: "git",
    status: "error",
    summary: "git not found on PATH",
    fix: "Install git and ensure it's on your login-shell PATH, then restart the service and Re-check.",
    settingsAnchor: "#environment",
  };
}

export function ghCheck(probe: GhProbe): ReadinessCheck {
  if (!probe.installed) {
    return {
      id: "gh",
      label: "gh (GitHub CLI)",
      status: "error",
      summary: "gh not installed",
      fix: "Install gh (https://cli.github.com) and ensure it's on your login-shell PATH, then Re-check. Local branches still work without gh.",
      settingsAnchor: "#environment",
    };
  }
  if (!probe.authenticated) {
    return {
      id: "gh",
      label: "gh (GitHub CLI)",
      status: "error",
      summary: "gh not logged in",
      fix: "Run gh auth login, then Re-check. Unvibe runs gh with GITHUB_TOKEN unset. Local branches still work without gh.",
      settingsAnchor: "#environment",
    };
  }
  if (!probe.apiReachable) {
    const d = probe.detail.toLowerCase();
    const offline = /timeout|timed out|network|offline|resolve|connect|econn|enotfound|eai_again/.test(d);
    const scopes = /scope|forbidden|401|403|requires authentication|missing/.test(d);
    return {
      id: "gh",
      label: "gh (GitHub CLI)",
      status: offline ? "warning" : "error",
      summary: `gh logged in but can't reach GitHub: ${probe.detail}`,
      fix: scopes
        ? "Re-run gh auth login with repo + read:org scopes, then Re-check."
        : "Check your network, then Re-check. Local branches still work offline.",
      settingsAnchor: "#environment",
    };
  }
  return {
    id: "gh",
    label: "gh (GitHub CLI)",
    status: "ok",
    summary: probe.login ? `gh logged in as ${probe.login}` : "gh logged in",
    fix: "",
    settingsAnchor: "#environment",
  };
}

export interface GitHubFetchProbe {
  ok: boolean;
  detail: string;
}

/**
 * Whether `git` can download from GitHub in the service's environment
 * (#139): `git ls-remote` against a tiny public repo with the same
 * credential handling ingest fetches use (`gh` as credential helper,
 * `GITHUB_TOKEN` unset). Warning, never error: offline use is supported —
 * this only explains ingest failures before they happen. Stub the runner
 * in tests; never hit real GitHub there.
 */
export async function probeGitHubFetch(
  runner: CommandRunner,
  opts: { timeoutMs?: number } = {},
): Promise<GitHubFetchProbe> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  if (!findOnPath("git")) return { ok: false, detail: "git not on PATH" };
  const remote = "https://github.com/github/gitignore";
  let res;
  try {
    res = await runWithTimeout(
      runner.run("git", {
        args: [...gitHubCredentialConfig(), "ls-remote", remote, "HEAD"],
        env: { GITHUB_TOKEN: undefined, GIT_TERMINAL_PROMPT: "0" },
      }),
      timeoutMs,
      () => ({ stdout: "", stderr: "timed out", code: 1 }),
    );
  } catch (e) {
    return { ok: false, detail: `git ls-remote failed: ${String(e)}` };
  }
  if (res.code !== 0) {
    const detail =
      (res.stderr.trim() || res.stdout.trim()).split("\n")[0]?.trim() || "git ls-remote failed";
    return { ok: false, detail: detail.slice(0, 200) };
  }
  return { ok: true, detail: `reached ${remote}` };
}

export function gitHubFetchCheck(probe: GitHubFetchProbe): ReadinessCheck {
  if (probe.ok) {
    return {
      id: "github-fetch",
      label: "GitHub fetch",
      status: "ok",
      summary: "git reaches GitHub",
      fix: "",
      settingsAnchor: "#environment",
    };
  }
  const d = probe.detail.toLowerCase();
  const offline = /timeout|timed out|network|offline|resolve|connect|econn|enotfound|eai_again/.test(d);
  return {
    id: "github-fetch",
    label: "GitHub fetch",
    status: "warning",
    summary: `git can't reach GitHub: ${probe.detail}`,
    fix: offline
      ? "Check the network, then Re-check. Opening branches still works offline."
      : "Make sure gh is logged in (gh auth login) so git can download through it, then Re-check. Opening branches still works without it.",
    settingsAnchor: "#environment",
  };
}

export type AgentRole = "main" | "small" | "secondOpinion";

export const ROLE_LABEL: Record<AgentRole, string> = {
  main: "Main model",
  small: "Small model",
  secondOpinion: "Second-opinion model",
};

const CLI_FOR_PROVIDER: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  pi: "pi",
};

/**
 * Cheapest reliable ACP probe: initialise + list models (no prompt, no
 * tokens). Returns the model infos (id + display name/description) or
 * throws with the adapter's auth error.
 */
export async function probeAgentModels(
  agents: AgentRunner,
  provider: string,
  timeoutMs = 10000,
): Promise<{ id: string; name?: string; description?: string }[]> {
  const list = (
    agents as unknown as {
      listModels?: (p: string) => Promise<{ id: string; name?: string; description?: string }[] | string[]>;
    }
  ).listModels;
  if (typeof list !== "function") return [];
  const res = await runWithTimeout(list.call(agents, provider) as Promise<{ id: string; name?: string; description?: string }[] | string[]>, timeoutMs, () => {
    throw new Error(`probe timed out after ${timeoutMs}ms`);
  });
  return (res as ({ id: string; name?: string; description?: string } | string)[])
    .map((m) => (typeof m === "string" ? { id: m } : { id: m.id, ...(m.name ? { name: m.name } : {}), ...(m.description ? { description: m.description } : {}) }))
    .filter((m) => Boolean(m.id));
}

/** Display label for a model id the same way pickers show it (#21). */
export function modelDisplayLabel(
  modelId: string,
  known: { id: string; name?: string; description?: string }[],
): string {
  const found = known.find((m) => m.id === modelId);
  if (found?.name) return `${found.name} (${modelId})`;
  return modelId;
}

export async function agentCheck(opts: {
  role: AgentRole;
  pick: { provider: string; model: string };
  agents: AgentRunner;
  pathValue?: string;
  timeoutMs?: number;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<ReadinessCheck> {
  const { role, pick, agents } = opts;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const pathValue = opts.pathValue ?? process.env.PATH ?? "";
  const env = opts.env ?? process.env;
  const id = `agent:${role}`;
  const label = ROLE_LABEL[role];

  // Disabled / replay modes need no agent login.
  if (isNoneRunner(agents)) {
    return {
      id,
      label,
      status: "ok",
      summary: "Agent turned off (UNVIBE_AGENT=none). Reviews open without a guide.",
      fix: "",
      settingsAnchor: "#models",
    };
  }
  if (isReplayRunner(agents)) {
    return {
      id,
      label,
      status: "ok",
      summary: "Replay mode — no agent login needed",
      fix: "",
      settingsAnchor: "#models",
    };
  }

  const provider = pick.provider;
  const cli = CLI_FOR_PROVIDER[provider] ?? provider;
  // Unset second opinion: not an error — the guide and small jobs work
  // without one; only second opinions need a different model from main.
  if (role === "secondOpinion" && pick.model === "") {
    return {
      id,
      label,
      status: "warning",
      summary: "Second opinion not set — needs a different model from main",
      fix: "Pick a model different from main in Settings → Models to enable second opinions. Everything else works without one.",
      settingsAnchor: "#models",
    };
  }
  if (provider !== "claude" && provider !== "codex" && provider !== "pi") {
    return {
      id,
      label,
      status: "error",
      summary: `Unknown provider "${provider}" for ${role}`,
      fix: "Pick claude, codex or pi in Settings → Models, then Re-check.",
      settingsAnchor: "#models",
    };
  }
  // Resolve the exact executable the adapter will run via the shared
  // diagnostics module (skips broken shims, version only from a successful
  // run, so doctor and service cannot disagree).
  const spec = TOOL_SPECS.find((s) => s.tool === provider) ?? {
    tool: provider,
    names: [cli],
    overrideEnvs: [],
    versionArgs: ["--version"],
    installHint: "",
  };
  let diag: import("@unvibe/shared").DiagnosticTool | null = null;
  try {
    diag = await diagnoseTool(spec, {
      pathValue,
      env,
      ...(opts.runner ? { runner: opts.runner } : {}),
      timeoutMs: Math.min(timeoutMs, 8000),
    });
  } catch {
    diag = null;
  }
  const binPath = diag?.chosen ?? resolveAgentBin(provider as "claude" | "codex", { env, pathValue })?.path ?? null;
  const binVersion = diag?.candidates.find((c) => c.path === binPath)?.version ?? null;
  if (!binPath) {
    // Specific diagnostic: which path was tried, what it printed, Doctor link.
    const first = diag?.candidates[0];
    const tried = first
      ? `Tried ${first.path} (via ${first.source}, ${first.kind}): exit ${first.exitCode ?? "?"}${first.stderr ? ` — ${first.stderr.slice(0, 2000)}` : first.stdout ? ` — ${first.stdout.slice(0, 2000)}` : ""}. `
      : "";
    return {
      id,
      label,
      status: "error",
      summary: `${tried}${missingBinMessage(provider as "claude" | "codex")}`,
      fix: `${agentBinSpec(provider as "claude" | "codex").installHint} Then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  const bin = { path: binPath, source: diag?.candidates.find((c) => c.path === binPath)?.source ?? "login-shell PATH" };
  // Issue #279: the pi provider. No version gate (the runner speaks the
  // documented RPC protocol); instead the login is probed explicitly,
  // because the model probe below falls back to a static list offline and
  // would otherwise report a logged-out pi as ready.
  if (provider === "pi") {
    return agentCheckPi({ id, label, pick, agents, bin, binVersion, timeoutMs, runner: opts.runner, env });
  }
  // Version gate: adapters were written against specific CLI versions; a
  // too-old CLI fails as a generic adapter crash, so report the specific
  // minimum here instead. binVersion comes only from a successful run.
  if (binVersion && !meetsMinVersion(provider as "claude" | "codex", binVersion)) {
    return {
      id,
      label,
      status: "error",
      summary: `${versionTooOldMessage(provider as "claude" | "codex", binVersion)} (running ${bin.path})`,
      fix: `${agentBinSpec(provider as "claude" | "codex").updateHint} Then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  const binSuffix = binVersion ? ` (running ${cli} ${binVersion} at ${bin.path})` : ` (running ${bin.path})`;
  let models: { id: string; name?: string; description?: string }[];
  try {
    models = await probeAgentModels(agents, provider, timeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const lower = msg.toLowerCase();
    if (/timed out|timeout/.test(lower)) {
      return {
        id,
        label,
        status: "warning",
        summary: `${provider} didn't answer${binSuffix}`,
        fix: `Re-check, and make sure ${cli} is logged in.`,
        settingsAnchor: "#models",
      };
    }
    if (/auth|login|unauthenticated|401|403|not logged|sign in|oauth/.test(lower)) {
      return {
        id,
        label,
        status: "error",
        summary: `${provider} not logged in (${msg})${binSuffix}`,
        fix: `Log in with ${cli}, then Re-check.`,
        settingsAnchor: "#models",
      };
    }
    if (/enoent|not found|spawn|no such|not installed/.test(lower)) {
      const first = diag?.candidates[0];
      const tried = first ? `Tried ${first.path} (via ${first.source}): ${first.stderr || first.stdout || `exit ${first.exitCode}`}. ` : "";
      return {
        id,
        label,
        status: "error",
        summary: `${provider} can't be started (${msg})${binSuffix}. ${tried}`,
        fix: `Reinstall ${cli} and make sure it is on your login-shell PATH, then Re-check. Unvibe does not install ${cli} for you.`,
        settingsAnchor: "#models",
      };
    }
    // Incompatible CLI surfaces as a generic adapter crash (bad app-server
    // protocol, unknown flags, etc.). Report the version constraint instead.
    if (/app-server|unknown (command|flag|option)|unrecognized|incompatible|protocol|version mismatch|not supported/.test(lower)) {
      const found = binVersion ?? "unknown version";
      return {
        id,
        label,
        status: "error",
        summary: `${provider} CLI incompatible (${msg}; running ${cli} ${found} at ${bin.path}). ${versionTooOldMessage(provider as "claude" | "codex", binVersion ?? agentBinSpec(provider as "claude" | "codex").minVersion)}`,
        fix: `${agentBinSpec(provider as "claude" | "codex").updateHint} Then Re-check.`,
        settingsAnchor: "#models",
      };
    }
    return {
      id,
      label,
      status: "error",
      summary: `${provider} unusable: ${msg}${binSuffix}`,
      fix: `Check that ${cli} is installed and logged in, then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  if (models.length === 0) {
    return {
      id,
      label,
      status: "error",
      summary: `${provider} logged in but returned no models${binSuffix}`,
      fix: `Check ${cli} login, then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  const modelIds = models.map((m) => m.id);
  if (!modelIds.includes(pick.model)) {
    return {
      id,
      label,
      status: "warning",
      summary: `${provider} ready${binSuffix}, but model "${pick.model}" not offered (has ${models.length} models)`,
      fix: "Pick one of the offered models in Settings → Models.",
      settingsAnchor: "#models",
    };
  }
  const display = modelDisplayLabel(pick.model, models);
  return {
    id,
    label,
    status: "ok",
    summary: `${provider}/${display} ready${binSuffix}`,
    fix: "",
    settingsAnchor: "#models",
  };
}

/**
 * Issue #279: pi login state in plain words. Runs pi's own status command
 * (`pi auth check --provider <p> --json`) for both subscription routes —
 * never reads pi's config or credentials (`~/.pi` is off-limits).
 */
export interface PiAuthState {
  ready: boolean;
  /** Raw status word pi reported (ready/not_ready/invalid/unknown). */
  status: string;
  /** pi's reason, when it gave one. */
  reason?: string;
}

export interface PiLogin {
  codex: PiAuthState;
  openai: PiAuthState;
}

const PI_AUTH_PROVIDERS = ["openai-codex", "openai"] as const;

function parsePiAuth(out: string): PiAuthState {
  try {
    const parsed = JSON.parse(out) as { status?: string; reason?: string };
    const status = typeof parsed.status === "string" ? parsed.status : "unknown";
    const state: PiAuthState = { ready: status === "ready", status };
    if (typeof parsed.reason === "string" && parsed.reason) state.reason = parsed.reason;
    return state;
  } catch {
    const snippet = out.trim().split("\n")[0]?.trim().slice(0, 160) ?? "";
    return { ready: /ready/i.test(snippet) && !/not[_\s-]*ready/i.test(snippet), status: snippet || "unknown" };
  }
}

export async function probePiLogin(
  runner: CommandRunner,
  piBin: string,
  timeoutMs = 15000,
): Promise<PiLogin> {
  const one = async (provider: string): Promise<PiAuthState> => {
    try {
      const res = await runWithTimeout(
        runner.run(piBin, { args: ["auth", "check", "--provider", provider, "--json"] }),
        timeoutMs,
        () => ({ stdout: "", stderr: "timed out", code: 1 }),
      );
      if (!res.stdout.trim()) {
        const snippet = (res.stderr.trim() || `exit ${res.code}`).slice(0, 160);
        return { ready: false, status: "unknown", reason: snippet };
      }
      return parsePiAuth(res.stdout);
    } catch (e) {
      return { ready: false, status: "unknown", reason: String(e instanceof Error ? e.message : e).slice(0, 160) };
    }
  };
  const [codex, openai] = await Promise.all(PI_AUTH_PROVIDERS.map((p) => one(p)));
  return { codex, openai };
}

function piReadyProviders(login: PiLogin): string[] {
  const out: string[] = [];
  if (login.codex.ready) out.push("openai-codex");
  if (login.openai.ready) out.push("openai");
  return out;
}

/** Role-level pi check (a role picked provider "pi"): bin + login + models. */
async function agentCheckPi(opts: {
  id: string;
  label: string;
  pick: { provider: string; model: string };
  agents: AgentRunner;
  bin: { path: string; source: string };
  binVersion: string | null;
  timeoutMs: number;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<ReadinessCheck> {
  const { id, label, pick, agents, bin, binVersion, timeoutMs } = opts;
  const cli = "pi";
  const binSuffix = binVersion ? ` (running ${cli} ${binVersion} at ${bin.path})` : ` (running ${bin.path})`;
  const runner = opts.runner ?? new RealCommandRunner();
  let login: PiLogin;
  try {
    login = await probePiLogin(runner, bin.path, Math.min(timeoutMs, 15000));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id,
      label,
      status: "warning",
      summary: `${cli} didn't answer${binSuffix}`,
      fix: `Re-check, and make sure ${cli} is installed and logged in (pi's /login). (${msg})`,
      settingsAnchor: "#models",
    };
  }
  const ready = piReadyProviders(login);
  if (ready.length === 0) {
    const reason = login.codex.reason ?? login.openai.reason ?? "not logged in";
    return {
      id,
      label,
      status: "error",
      summary: `${cli} not logged in (${reason})${binSuffix}`,
      fix: "Run pi's /login once to connect your ChatGPT subscription, then Re-check. Unvibe uses whatever login your pi has and never logs in for you.",
      settingsAnchor: "#models",
    };
  }
  let models: { id: string; name?: string; description?: string }[];
  try {
    models = await probeAgentModels(agents, "pi", timeoutMs);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      id,
      label,
      status: "error",
      summary: `${cli} unusable: ${msg}${binSuffix}`,
      fix: `Check that ${cli} is installed and logged in (pi's /login), then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  if (!models.map((m) => m.id).includes(pick.model)) {
    return {
      id,
      label,
      status: "warning",
      summary: `${cli} ready${binSuffix}, but model "${pick.model}" not offered (has ${models.length} models)`,
      fix: "Pick one of the offered models in Settings → Models.",
      settingsAnchor: "#models",
    };
  }
  const display = modelDisplayLabel(pick.model, models);
  return {
    id,
    label,
    status: "ok",
    summary: `${cli}/${display} ready${binSuffix}, logged in (${ready.join(", ")})`,
    fix: "",
    settingsAnchor: "#models",
  };
}

/**
 * Standalone pi check (issue #279): whether pi is installed and logged in,
 * in plain words. Informational when pi is absent (codex covers those
 * models); a warning only when pi is installed but logged out.
 */
export async function piCheck(opts: {
  agents: AgentRunner;
  pathValue?: string;
  timeoutMs?: number;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<ReadinessCheck> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const pathValue = opts.pathValue ?? process.env.PATH ?? "";
  const env = opts.env ?? process.env;
  const spec = TOOL_SPECS.find((s) => s.tool === "pi")!;
  let diag: import("@unvibe/shared").DiagnosticTool | null = null;
  try {
    diag = await diagnoseTool(spec, {
      pathValue,
      env,
      ...(opts.runner ? { runner: opts.runner } : {}),
      timeoutMs: Math.min(timeoutMs, 8000),
    });
  } catch {
    diag = null;
  }
  const binPath = diag?.chosen ?? null;
  const binVersion = diag?.candidates.find((c) => c.path === binPath)?.version ?? null;
  if (!binPath) {
    return {
      id: "pi",
      label: "Pi (ChatGPT via pi)",
      status: "ok",
      summary: "pi not installed — OpenAI/Codex models run on the Codex CLI",
      fix: "",
      settingsAnchor: "#models",
    };
  }
  const where = binVersion ? `pi ${binVersion} at ${binPath}` : `pi at ${binPath}`;
  const runner = opts.runner ?? new RealCommandRunner();
  let login: PiLogin;
  try {
    login = await probePiLogin(runner, binPath, Math.min(timeoutMs, 15000));
  } catch {
    return {
      id: "pi",
      label: "Pi (ChatGPT via pi)",
      status: "warning",
      summary: `${where} found but didn't answer the login check`,
      fix: "Re-check, and make sure pi is installed and on your login-shell PATH.",
      settingsAnchor: "#models",
    };
  }
  const ready = piReadyProviders(login);
  if (ready.length > 0) {
    return {
      id: "pi",
      label: "Pi (ChatGPT via pi)",
      status: "ok",
      summary: `${where}, logged in (${ready.join(", ")})`,
      fix: "",
      settingsAnchor: "#models",
    };
  }
  const reason = login.codex.reason ?? login.openai.reason ?? "not logged in";
  return {
    id: "pi",
    label: "Pi (ChatGPT via pi)",
    status: "warning",
    summary: `${where} installed but not logged in (${reason})`,
    fix: "To offer pi as a provider for OpenAI/Codex models, run pi's /login once. Unvibe uses whatever login your pi has and never logs in for you.",
    settingsAnchor: "#models",
  };
}

export function distinctCheck(settings: Settings): ReadinessCheck {  const a = settings.main;
  const b = settings.secondOpinion;
  const same = a.provider === b.provider && a.model === b.model;
  if (same) {
    return {
      id: "agents-distinct",
      label: "Second opinion independence",
      status: "warning",
      summary: `Second opinion uses the same model as main (${a.provider}/${a.model})`,
      fix: "Pick a different model for second opinion in Settings → Models so it stays independent.",
      settingsAnchor: "#models",
    };
  }
  return {
    id: "agents-distinct",
    label: "Second opinion independence",
    status: "ok",
    summary: "Second opinion differs from main",
    fix: "",
    settingsAnchor: "#models",
  };
}

/**
 * D2 diagram check (docs/d2-diagrams.md).
 *
 * Warning, never error: diagrams need `d2` but nothing else in a review
 * may fail because it is absent. Missing/too old → warning with install
 * hints; present → ok with path + version.
 */
export async function d2Check(opts: {
  pathValue?: string;
  timeoutMs?: number;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
}): Promise<ReadinessCheck> {
  const pathValue = opts.pathValue ?? process.env.PATH ?? "";
  const env = opts.env ?? process.env;
  // Shared diagnostics: skips broken shims, version only from success.
  const d2spec = TOOL_SPECS.find((s) => s.tool === "d2")!;
  let diag: import("@unvibe/shared").DiagnosticTool | null = null;
  try {
    diag = await diagnoseTool(d2spec, {
      pathValue,
      env,
      ...(opts.runner ? { runner: opts.runner } : {}),
      timeoutMs: Math.min(opts.timeoutMs ?? 8000, 8000),
    });
  } catch {
    diag = null;
  }
  const bin = diag?.chosen
    ? { path: diag.chosen, source: diag.candidates.find((c) => c.path === diag!.chosen)?.source ?? "login-shell PATH" }
    : resolveD2Bin({ env, pathValue });
  if (!bin) {
    return {
      id: "d2",
      label: "Diagrams · d2",
      status: "warning",
      summary: "Diagrams need d2 (not found on login-shell PATH)",
      fix: `${d2InstallHint()} Then Re-check. Reviews still work; diagrams show their source until d2 is installed.`,
      settingsAnchor: "#environment",
    };
  }
  // An explicit override pointing at a missing file must warn, not report
  // ok (issue #17): diagrams fall back to source, but the callout and
  // Settings must say so. `bins.ts` marks this case with a "(missing)"
  // source suffix.
  if (bin.source.endsWith("(missing)")) {
    return {
      id: "d2",
      label: "Diagrams · d2",
      status: "warning",
      summary: `${D2_ENV_OVERRIDE} points at a missing file (${bin.path}); diagrams show their source`,
      fix: `Point ${D2_ENV_OVERRIDE} at your d2 executable (≥ ${D2_MIN}), or unset it to use the login-shell PATH. ${d2InstallHint()} Then Re-check.`,
      settingsAnchor: "#environment",
    };
  }
  let version: string | null = diag?.candidates.find((c) => c.path === bin.path)?.version ?? null;
  if (opts.runner && version === null && !diag) {
    try {
      const r = await runWithTimeout(
        opts.runner.run(bin.path, { args: ["--version"] }),
        Math.min(opts.timeoutMs ?? 8000, 8000),
        () => ({ stdout: "", stderr: "timed out", code: 1 }),
      );
      // Only parse from a successful run (exit 0); a failed run never yields a version.
      if (r.code === 0) version = parseD2Version(`${r.stdout}\n${r.stderr}`);
      else version = null;
    } catch {
      version = null;
    }
  }
  if (version && !meetsD2MinVersion(version)) {
    return {
      id: "d2",
      label: "Diagrams · d2",
      status: "warning",
      summary: `Diagrams need d2 ≥ ${D2_MIN} (running ${version} at ${bin.path})`,
      fix: `Update d2, then Re-check. Reviews still work; diagrams show their source until d2 is updated.`,
      settingsAnchor: "#environment",
    };
  }
  // Probed but unanswerable (not executable, crashes, timed out): warn
  // rather than reporting ok for a binary that cannot render (issue #17).
  // When diagnostics found candidates but none runs, name the first error.
  if (opts.runner && version === null) {
    const firstBad = diag?.candidates[0];
    const tried = firstBad ? `Tried ${firstBad.path}: ${firstBad.stderr || firstBad.stdout || `exit ${firstBad.exitCode}`}. ` : "";
    return {
      id: "d2",
      label: "Diagrams · d2",
      status: "warning",
      summary: `d2 at ${bin.path} (via ${bin.source}) did not answer --version; diagrams show their source. ${tried}`,
      fix: `Check the binary runs (${bin.path} --version), or unset ${D2_ENV_OVERRIDE} to use the login-shell PATH. ${d2InstallHint()} Then Re-check.`,
      settingsAnchor: "#environment",
    };
  }
  return {
    id: "d2",
    label: "Diagrams · d2",
    status: "ok",
    summary: version ? `d2 ${version} at ${bin.path} (via ${bin.source})` : `d2 at ${bin.path} (via ${bin.source})`,
    fix: "",
    settingsAnchor: "#environment",
  };
}
