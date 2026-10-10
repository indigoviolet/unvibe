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
import { isNoneRunner, isReplayRunner } from "../agent/factory.js";
import type { AgentRunner } from "@unvibe/shared";

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

export type AgentRole = "main" | "small" | "secondOpinion";

const ROLE_LABEL: Record<AgentRole, string> = {
  main: "Agent · main",
  small: "Agent · small",
  secondOpinion: "Agent · second opinion",
};

const CLI_FOR_PROVIDER: Record<string, string> = {
  claude: "claude",
  codex: "codex",
};

/**
 * Cheapest reliable ACP probe: initialise + list models (no prompt, no
 * tokens). Returns the model ids or throws with the adapter's auth error.
 */
export async function probeAgentModels(
  agents: AgentRunner,
  provider: string,
  timeoutMs = 10000,
): Promise<string[]> {
  const list = (agents as unknown as { listModels?: (p: string) => Promise<{ id: string }[] | string[]> }).listModels;
  if (typeof list !== "function") return [];
  const res = await runWithTimeout(list.call(agents, provider) as Promise<{ id: string }[] | string[]>, timeoutMs, () => {
    throw new Error(`probe timed out after ${timeoutMs}ms`);
  });
  return (res as ({ id: string } | string)[]).map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);
}

export async function agentCheck(opts: {
  role: AgentRole;
  pick: { provider: string; model: string };
  agents: AgentRunner;
  pathValue?: string;
  timeoutMs?: number;
}): Promise<ReadinessCheck> {
  const { role, pick, agents } = opts;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const pathValue = opts.pathValue ?? process.env.PATH ?? "";
  const id = `agent:${role}`;
  const label = ROLE_LABEL[role];

  // Disabled / replay modes need no agent login.
  if (isNoneRunner(agents)) {
    return {
      id,
      label,
      status: "ok",
      summary: "Agent disabled (UNVIBE_AGENT=none) — reviews open without a guide",
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
  // Unset second opinion (no Codex yet): not an error — the guide and
  // small jobs work with one provider; only second opinions need another.
  if (role === "secondOpinion" && pick.model === "") {
    return {
      id,
      label,
      status: "warning",
      summary: "Second opinion not set — needs a second provider (Codex)",
      fix: "Pick a Codex model in Settings → Models to enable second opinions. Everything else works with one provider.",
      settingsAnchor: "#models",
    };
  }
  if (provider !== "claude" && provider !== "codex") {
    return {
      id,
      label,
      status: "error",
      summary: `Unknown provider "${provider}" for ${role}`,
      fix: "Pick claude or codex in Settings → Models, then Re-check.",
      settingsAnchor: "#models",
    };
  }
  if (!findOnPath(cli, pathValue)) {
    return {
      id,
      label,
      status: "error",
      summary: `${cli} CLI not found on PATH`,
      fix: `Install the ${cli} CLI and ensure it's on your login-shell PATH, then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  let models: string[];
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
        summary: `${provider} probe timed out`,
        fix: `The ${provider} adapter didn't answer. Re-check; ensure ${cli} is logged in.`,
        settingsAnchor: "#models",
      };
    }
    if (/auth|login|unauthenticated|401|403|not logged|sign in|oauth/.test(lower)) {
      return {
        id,
        label,
        status: "error",
        summary: `${provider} not logged in (${msg.slice(0, 120)})`,
        fix: `Log in with ${cli}, then Re-check.`,
        settingsAnchor: "#models",
      };
    }
    if (/enoent|not found|spawn|no such|not installed/.test(lower)) {
      return {
        id,
        label,
        status: "error",
        summary: `${provider} adapter not usable (${msg.slice(0, 120)})`,
        fix: `Reinstall the ${provider} adapter/CLI and ensure ${cli} is on your login-shell PATH, then Re-check.`,
        settingsAnchor: "#models",
      };
    }
    return {
      id,
      label,
      status: "error",
      summary: `${provider} unusable: ${msg.slice(0, 140)}`,
      fix: `Check ${cli} login and the adapter install, then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  if (models.length === 0) {
    return {
      id,
      label,
      status: "error",
      summary: `${provider} logged in but returned no models`,
      fix: `Check ${cli} login, then Re-check.`,
      settingsAnchor: "#models",
    };
  }
  if (!models.includes(pick.model)) {
    return {
      id,
      label,
      status: "warning",
      summary: `${provider} ready, but model "${pick.model}" not offered (has ${models.length} models)`,
      fix: "Pick one of the offered models in Settings → Models.",
      settingsAnchor: "#models",
    };
  }
  return {
    id,
    label,
    status: "ok",
    summary: `${provider}/${pick.model} ready`,
    fix: "",
    settingsAnchor: "#models",
  };
}

export function distinctCheck(settings: Settings): ReadinessCheck {
  const a = settings.main;
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
