/**
 * Readiness report (front screen callouts + Settings → Environment).
 *
 * Probes, each with its own timeout so one slow tool never blocks the
 * report: `git` found; `gh` installed on the login-shell PATH,
 * authenticated, and able to reach the API (`gh api user`, cheap); for
 * each configured agent role: CLI found + ACP initialise/list-models
 * (no prompt, no tokens); second opinion distinct from main.
 *
 * Results are cached briefly (30s); `?force=1` bypasses the cache. The
 * page renders first and fills callouts in — this module never blocks
 * page load (the route is async and fast; probes time out individually).
 */
import type { ReadinessResponse, Settings } from "@unvibe/shared";
import type { AgentRunner } from "@unvibe/shared";
import type { CommandRunner } from "../exec/index.js";
import { resolveLoginShellPath } from "../exec/shell-path.js";
import {
  agentCheck,
  d2Check,
  distinctCheck,
  ghCheck,
  gitCheck,
  gitVersion,
  probeGh,
  type AgentRole,
} from "./checks.js";

export const READINESS_CACHE_MS = 30_000;
export const READINESS_TIMEOUT_MS = 10_000;

export interface ReadinessDeps {
  runner: CommandRunner;
  agents: AgentRunner;
  settings: { get(): Settings };
  /** Test override for the login-shell PATH (else resolved live). */
  loginPathValue?: string;
  /** Test override for the agent probe timeout. */
  timeoutMs?: number;
}

interface Cached {
  at: number;
  key: string;
  response: ReadinessResponse;
}

let cache: Cached | null = null;

export function clearReadinessCache(): void {
  cache = null;
}

async function loginPath(): Promise<string> {
  try {
    const found = await resolveLoginShellPath({ timeoutMs: 5000 });
    if (found) return found.merged;
  } catch {
    // Fall through to inherited PATH.
  }
  return process.env.PATH ?? "";
}

export async function getReadiness(deps: ReadinessDeps, opts: { force?: boolean } = {}): Promise<ReadinessResponse> {
  const settings = deps.settings.get();
  const key = JSON.stringify([settings.main, settings.small, settings.secondOpinion]);
  const now = Date.now();
  if (!opts.force && cache && now - cache.at < READINESS_CACHE_MS && cache.key === key) {
    return { ...cache.response, cached: true };
  }
  const timeoutMs = deps.timeoutMs ?? READINESS_TIMEOUT_MS;
  const pathValue = deps.loginPathValue ?? (await loginPath());

  const withTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((resolve) => {
        const t = setTimeout(() => resolve(fallback), timeoutMs);
        t.unref?.();
      }),
    ]);

  const [gitV, ghProbe] = await Promise.all([
    withTimeout(gitVersion(deps.runner), null),
    withTimeout(probeGh(deps.runner, { pathValue, timeoutMs }), {
      installed: false,
      authenticated: false,
      apiReachable: false,
      detail: "gh probe timed out",
    }),
  ]);

  const roles: AgentRole[] = ["main", "small", "secondOpinion"];
  const picks: Record<AgentRole, { provider: string; model: string }> = {
    main: settings.main,
    small: settings.small,
    secondOpinion: settings.secondOpinion,
  };
  const agentChecks = await Promise.all(
    roles.map((role) =>
      withTimeout(
        agentCheck({
          role,
          pick: picks[role],
          agents: deps.agents,
          pathValue,
          timeoutMs,
          runner: deps.runner,
          env: process.env,
        }),
        {
          id: `agent:${role}`,
          label: `Agent · ${role}`,
          status: "warning" as const,
          summary: "Agent probe timed out",
          fix: "Re-check; ensure the provider CLI is logged in.",
          settingsAnchor: "#models",
        },
      ),
    ),
  );

  const d2 = await withTimeout(
    d2Check({ pathValue, timeoutMs, runner: deps.runner, env: process.env }),
    {
      id: "d2",
      label: "Diagrams · d2",
      status: "warning" as const,
      summary: "Diagrams need d2 (probe timed out)",
      fix: "Re-check; ensure d2 is on your login-shell PATH. Reviews still work without it.",
      settingsAnchor: "#environment",
    },
  );

  const response: ReadinessResponse = {
    checks: [gitCheck(gitV), ghCheck(ghProbe), ...agentChecks, distinctCheck(settings), d2],
    generatedAt: Date.now(),
    cached: false,
  };
  cache = { at: Date.now(), key, response };
  return response;
}

export { agentCheck, distinctCheck, ghCheck, gitCheck, probeGh } from "./checks.js";
