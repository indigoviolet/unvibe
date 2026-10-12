/**
 * Update channels (issue #36, step 1): `release`, `release-rc`, `preview/*`.
 *
 * Pure listing logic with no local effects, so the later in-app picker
 * (step 2) can reuse it through a service route. The global install and
 * the database rule live in `install.ts` / `data-backup.ts`; the CLI in
 * `cli/commands.ts` composes the three. All `gh` use goes through the
 * injectable command runner with `GITHUB_TOKEN` unset (PRD §15).
 *
 * `UpdateChannel` below mirrors the shared type the step-2 branch will
 * land in `packages/shared/src/api.ts` — keep the shape identical and do
 * not move it there from this branch.
 */
import fs from "node:fs";
import path from "node:path";
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";

/**
 * The single place the upstream repo slug lives for update logic. The rest
 * of the tree still carries scattered literals; new code must use this.
 */
export const UNVIBE_REPO = "indigoviolet/unvibe";

export interface UpdateChannel {
  /** "release" | "release-rc" | "preview/<slug>" (the git ref to install). */
  ref: string;
  kind: "release" | "release-rc" | "preview";
  /** Installed package version on that ref; null when unreadable. */
  version: string | null;
  /** Source commit sha recorded in the release tree; null when absent. */
  commit: string | null;
  sourceBranch: string | null;
  /** ISO build time recorded in the release tree; null when absent. */
  builtAt: string | null;
  current: boolean;
}

export interface InstalledBuild {
  version: string;
  /** Null when the install carries no channel record (source checkout, old build). */
  channel: string | null;
  sourceBranch: string | null;
  commit: string | null;
  builtAt: string | null;
  packagePath: string | null;
}

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

export function channelKind(ref: string): UpdateChannel["kind"] {
  return ref === "release" ? "release" : ref === "release-rc" ? "release-rc" : "preview";
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
  unvibe?: {
    channel?: unknown;
    sourceBranch?: unknown;
    commit?: unknown;
    builtAt?: unknown;
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * What this `unvibe` binary is: version + channel + provenance from its
 * own package.json (`unvibe` field, written by `scripts/release.mjs`).
 * Falls back to `fallbackVersion` (the bundled `SERVICE_VERSION`) when the
 * package cannot be found or read.
 */
export function readInstalledBuild(
  scriptPath: string | undefined,
  fallbackVersion: string,
): InstalledBuild {
  const empty = {
    version: fallbackVersion,
    channel: null,
    sourceBranch: null,
    commit: null,
    builtAt: null,
    packagePath: null,
  };
  if (!scriptPath) return { ...empty };
  const packagePath = findInstalledPackagePath(scriptPath);
  if (!packagePath) return { ...empty };
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as ReleasePackageJson;
    const version = typeof pkg.version === "string" ? pkg.version : fallbackVersion;
    const rawChannel = pkg.unvibe?.channel;
    const channel =
      typeof rawChannel === "string" && isChannelName(rawChannel) ? rawChannel : null;
    return {
      version,
      channel,
      sourceBranch: asStringOrNull(pkg.unvibe?.sourceBranch),
      commit: asStringOrNull(pkg.unvibe?.commit),
      builtAt: asStringOrNull(pkg.unvibe?.builtAt),
      packagePath,
    };
  } catch {
    return { ...empty };
  }
}

/**
 * Decode a `gh api .../contents/package.json?ref=<ref>` response
 * (`{ content: <base64> }`) into version + provenance. Returns nulls when
 * the response is not a readable package.json (a channel is still listed —
 * only its metadata is blank).
 */
export function decodeRefPackage(stdout: string): {
  version: string | null;
  commit: string | null;
  sourceBranch: string | null;
  builtAt: string | null;
} {
  const blank = { version: null, commit: null, sourceBranch: null, builtAt: null };
  try {
    const body = JSON.parse(stdout) as { content?: unknown; encoding?: unknown };
    if (typeof body.content !== "string") return { ...blank };
    const text = Buffer.from(body.content.replace(/\s/g, ""), "base64").toString("utf8");
    const pkg = JSON.parse(text) as ReleasePackageJson;
    return {
      version: typeof pkg.version === "string" ? pkg.version : null,
      commit: asStringOrNull(pkg.unvibe?.commit),
      sourceBranch: asStringOrNull(pkg.unvibe?.sourceBranch),
      builtAt: asStringOrNull(pkg.unvibe?.builtAt),
    };
  } catch {
    return { ...blank };
  }
}

/** Fetch one ref's package.json over `gh api` (no clone). Nulls on failure. */
export async function fetchRefPackage(
  runner: CommandRunner,
  ref: string,
): Promise<{ version: string | null; commit: string | null; sourceBranch: string | null; builtAt: string | null }> {
  const args = ["api", `repos/${UNVIBE_REPO}/contents/package.json?ref=${ref}`];
  try {
    const res = await runGh(runner, args, { args });
    if (res.code !== 0) return { version: null, commit: null, sourceBranch: null, builtAt: null };
    return decodeRefPackage(res.stdout);
  } catch {
    return { version: null, commit: null, sourceBranch: null, builtAt: null };
  }
}

/**
 * List every channel with its per-ref metadata. Throws when the branch
 * list itself cannot be read (the CLI turns this into the `gh auth login`
 * hint); a single unreadable ref only blanks that row.
 */
export async function listChannels(
  runner: CommandRunner,
  installed: InstalledBuild,
): Promise<UpdateChannel[]> {
  const branchArgs = ["api", `repos/${UNVIBE_REPO}/branches`, "--paginate", "-q", ".[].name"];
  const branches = await runGh(runner, branchArgs, { args: branchArgs });
  if (branches.code !== 0) {
    const detail = (branches.stderr || branches.stdout).trim();
    throw new Error(
      `could not list channels: gh exited ${branches.code}${detail ? `: ${detail}` : ""}`,
    );
  }
  const out: UpdateChannel[] = [];
  for (const ref of parseChannelList(branches.stdout)) {
    const meta = await fetchRefPackage(runner, ref);
    out.push({
      ref,
      kind: channelKind(ref),
      version: meta.version,
      commit: meta.commit,
      sourceBranch: meta.sourceBranch,
      builtAt: meta.builtAt,
      current: ref === installed.channel,
    });
  }
  return out;
}

/** Render `update --list` output, marking the installed channel. */
export function formatChannelList(channels: UpdateChannel[], installed: InstalledBuild): string[] {
  const lines = ["Available channels:"];
  for (const c of channels) {
    const head = `${c.current ? "* " : "  "}${c.ref}${c.current ? ` (installed, ${installed.version})` : c.version ? ` (${c.version})` : " (metadata unavailable)"}`;
    lines.push(head);
    if (!c.current && (c.sourceBranch || c.commit || c.builtAt)) {
      const at = c.commit ? ` @ ${c.commit.slice(0, 7)}` : "";
      const built = c.builtAt ? `, built ${c.builtAt.slice(0, 10)}` : "";
      lines.push(`    from ${c.sourceBranch ?? "(unknown branch)"}${at}${built}`);
    }
  }
  if (channels.length === 0) lines.push("(none published yet)");
  if (installed.channel && !channels.some((c) => c.ref === installed.channel)) {
    lines.push(`(installed channel ${installed.channel} is not published on the remote)`);
  }
  lines.push("switch with: unvibe update <channel>");
  return lines;
}
