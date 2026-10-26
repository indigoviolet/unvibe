/**
 * Global npm install of an update channel ref (issue #36).
 *
 * One small step: build the `npm install -g github:<repo>#<ref>` command
 * for a validated channel and run it through the injectable command
 * runner (tests stub it; production passes the real one). No service
 * lifecycle here — callers refuse while the service runs and never
 * restart it (the step-2 branch owns any restart behaviour).
 */
import type { CommandRunner, RunResult } from "../exec/index.js";
import { UNVIBE_REPO, channelRef, isChannelName } from "./channels.js";
import os from "node:os";
import path from "node:path";

/**
 * Cwd for the npm spawn: somewhere stable that outlives the install.
 * The caller's cwd can be inside the package being replaced (the
 * service's own working directory during an in-app switch), which npm
 * deletes mid-reify; a child launched from there can then die before
 * it starts (`ENOENT uv_cwd`, issue #42 regression). The home dir is
 * not npm's to move; tmpdir is the fallback when it is unknown.
 */
export function stableNpmCwd(homeDir: string = os.homedir()): string {
  return homeDir || os.tmpdir();
}

/**
 * Test-only install-source override (`UNVIBE_UPDATE_INSTALL_SOURCE` = an
 * npm git remote, e.g. `git+file:///tmp/unvibe.git`): drills install from
 * a local repo instead of GitHub. Env-only, so the UI can never trigger
 * it; the `#<channel>` ref suffix is unchanged.
 */
export function installSource(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.UNVIBE_UPDATE_INSTALL_SOURCE;
  if (override && override.trim() !== "") return override.trim();
  return `github:${UNVIBE_REPO}`;
}

/** `npm install -g` spec for a channel. Throws on invalid names. */
export function installSpec(channel: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isChannelName(channel)) throw new Error(`unknown channel: ${JSON.stringify(channel)}`);
  return `${installSource(env)}#${channelRef(channel)}`;
}

export interface InstallOptions {
  /** `npm --prefix`: pin the install to this binary's own prefix (else npm defaults). */
  prefix?: string | null;
  /**
   * Extra env for the npm spawn (issue #170): the login-shell-merged PATH
   * so version-manager wrappers (mise's reshim step) find their binaries.
   * Undefined inherits the process env.
   */
  env?: Record<string, string | undefined>;
  /**
   * Home dir for the stable npm cwd (issue #280). Production omits it
   * (real `os.homedir()`); tests pass a scratch dir. Only the spawn cwd,
   * never a write target.
   */
  homeDir?: string;
}

/** Install the channel's ref globally. The caller reports the result. */
export async function installRef(
  runner: CommandRunner,
  channel: string,
  opts: InstallOptions = {},
): Promise<RunResult> {
  const args = ["install", "-g", installSpec(channel)];
  if (opts.prefix) args.push("--prefix", opts.prefix);
  return runner.run("npm", { args, cwd: stableNpmCwd(opts.homeDir ?? os.homedir()), env: opts.env });
}

/**
 * Derive `npm --prefix` from an installed package path, or null when the
 * layout is unknown (source checkout, custom layout — npm defaults apply).
 * npm's global layout is `<prefix>/lib/node_modules/<pkg>` on both macOS
 * and Linux, so an exact suffix match pins the install to this binary's
 * own prefix without guessing.
 */
export function installPrefixForPackage(packagePath: string | null): string | null {
  if (!packagePath) return null;
  const suffix = ["lib", "node_modules", "unvibe", "package.json"].join(path.sep);
  if (!packagePath.endsWith(suffix)) return null;
  const prefix = packagePath.slice(0, -suffix.length).replace(/[/\\]+$/, "");
  return prefix || null;
}
