/**
 * PATH for the updater's npm (issue #170).
 *
 * mise wraps each Node version's `npm` so a global install runs
 * `mise reshim` afterwards — a bare `mise` call that needs `mise` on PATH.
 * The service (especially login-started, where launchd/systemd give a
 * minimal PATH) and the detached helper must therefore run npm with the
 * login-shell PATH, merged exactly the way the service does for agents
 * (`diagnostics/path-probe.ts`): probed entries first, then unseen
 * inherited entries.
 *
 * Deliberately no reshim-skipping variable: the wrapper honors
 * `MISE_SKIP_RESHIM`, but skipping it would leave mise's shims stale after
 * the install. The right PATH lets the reshim run; a wrapper that still
 * fails after a completed install is classified honestly by the switch
 * core (`update/switch.ts`), which verifies the build in place.
 */
import { probeEffectivePath } from "../diagnostics/path-probe.js";

export interface UpdatePathEnvOptions {
  inheritedPath?: string;
  shell?: string;
  timeoutMs?: number;
  candidates?: string[];
  scrubEnv?: NodeJS.ProcessEnv;
}

/**
 * Login-shell-merged PATH for one npm run. Never throws: when no shell
 * answers, the inherited PATH is returned unchanged.
 */
export async function resolveUpdatePathEnv(opts: UpdatePathEnvOptions = {}): Promise<{ PATH: string }> {
  const inheritedPath = opts.inheritedPath ?? process.env.PATH ?? "";
  try {
    const found = await probeEffectivePath({
      ...(opts.shell !== undefined ? { shell: opts.shell } : {}),
      timeoutMs: opts.timeoutMs ?? 5000,
      ...(opts.candidates !== undefined ? { candidates: opts.candidates } : {}),
      ...(opts.scrubEnv !== undefined ? { scrubEnv: opts.scrubEnv } : {}),
      inheritedPath,
    });
    if (found && found.effectivePath) return { PATH: found.effectivePath };
  } catch {
    // A wedged probe must not stop the update; inherit instead.
  }
  return { PATH: inheritedPath };
}
