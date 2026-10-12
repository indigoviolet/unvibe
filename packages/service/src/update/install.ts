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
import path from "node:path";

/** `npm install -g` spec for a channel. Throws on invalid names. */
export function installSpec(channel: string): string {
  if (!isChannelName(channel)) throw new Error(`unknown channel: ${JSON.stringify(channel)}`);
  return `github:${UNVIBE_REPO}#${channelRef(channel)}`;
}

export interface InstallOptions {
  /** `npm --prefix`: pin the install to this binary's own prefix (else npm defaults). */
  prefix?: string | null;
}

/** Install the channel's ref globally. The caller reports the result. */
export async function installRef(
  runner: CommandRunner,
  channel: string,
  opts: InstallOptions = {},
): Promise<RunResult> {
  const args = ["install", "-g", installSpec(channel)];
  if (opts.prefix) args.push("--prefix", opts.prefix);
  return runner.run("npm", { args });
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
