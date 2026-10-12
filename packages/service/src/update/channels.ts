/**
 * Update channels (issue #36, step 1): `release`, `release-rc`, `preview/*`.
 *
 * Pure logic with no subprocess use, so the later in-app picker (step 2)
 * can reuse it through a service route. Subprocess and filesystem effects
 * live in `update.ts` / `backup.ts`; the CLI in `cli/commands.ts` is thin.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * The single place the upstream repo slug lives for update logic. The rest
 * of the tree still carries scattered literals; new code must use this.
 */
export const UNVIBE_REPO = "indigoviolet/unvibe";

/** Valid channel names: `release`, `release-rc`, or `preview/<slug>`. */
export function isChannelName(name: string): boolean {
  return name === "release" || name === "release-rc" || /^preview\/[A-Za-z0-9._-]+$/.test(name);
}

export function isPreviewChannel(channel: string): boolean {
  return channel.startsWith("preview/");
}

/** Git ref to install for a channel: the ref is the channel name. */
export function channelRef(channel: string): string {
  return channel;
}

/** `npm install -g` spec for a channel. Throws on invalid names. */
export function installSpec(channel: string): string {
  if (!isChannelName(channel)) throw new Error(`unknown channel: ${JSON.stringify(channel)}`);
  return `github:${UNVIBE_REPO}#${channel}`;
}

/**
 * Parse `gh api repos/<slug>/branches --paginate -q '.[].name'` output
 * (one branch name per line) into sorted channel names. Unknown branches
 * are dropped; `release` and `release-rc` sort first.
 */
export function parseChannelList(stdout: string): string[] {
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const name = line.trim();
    if (name && isChannelName(name)) seen.add(name);
  }
  const out = [...seen];
  const rank = (c: string): number => (c === "release" ? 0 : c === "release-rc" ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return out;
}

export interface InstalledBuild {
  version: string;
  /** Null when the install carries no channel record (source checkout, old build). */
  channel: string | null;
  packagePath: string | null;
}

/** Walk up from the CLI script to the `unvibe` package.json, if any. */
export function findInstalledPackagePath(scriptPath: string): string | null {
  let dir = path.dirname(path.resolve(scriptPath));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: unknown };
      if (pkg.name === "unvibe") return candidate;
    } catch {
      // Missing or unparsable: keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface ReleasePackageJson {
  version?: unknown;
  unvibe?: { channel?: unknown };
}

/**
 * What this `unvibe` binary is: version + channel from its own
 * package.json (`unvibe.channel`, written by `scripts/release.mjs`).
 * Falls back to `fallbackVersion` (the bundled `SERVICE_VERSION`) when the
 * package cannot be found or read.
 */
export function readInstalledBuild(
  scriptPath: string | undefined,
  fallbackVersion: string,
): InstalledBuild {
  if (!scriptPath) return { version: fallbackVersion, channel: null, packagePath: null };
  const packagePath = findInstalledPackagePath(scriptPath);
  if (!packagePath) return { version: fallbackVersion, channel: null, packagePath: null };
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as ReleasePackageJson;
    const version = typeof pkg.version === "string" ? pkg.version : fallbackVersion;
    const rawChannel = pkg.unvibe?.channel;
    const channel =
      typeof rawChannel === "string" && isChannelName(rawChannel) ? rawChannel : null;
    return { version, channel, packagePath };
  } catch {
    return { version: fallbackVersion, channel: null, packagePath: null };
  }
}

/** Render `update --list` output, marking the installed channel. */
export function formatChannelList(channels: string[], installed: InstalledBuild): string[] {
  const lines = ["Available channels:"];
  for (const c of channels) {
    const current = c === installed.channel;
    lines.push(`${current ? "* " : "  "}${c}${current ? ` (installed, ${installed.version})` : ""}`);
  }
  if (channels.length === 0) lines.push("(none published yet)");
  if (installed.channel && !channels.includes(installed.channel)) {
    lines.push(`(installed channel ${installed.channel} is not published on the remote)`);
  }
  lines.push("switch with: unvibe update <channel>");
  return lines;
}
