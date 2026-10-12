/**
 * `unvibe update` orchestration (issue #36, step 1).
 *
 * - `update --list`: channels (`release`, `release-rc`, every `preview/*`
 *   branch on the upstream repo) via `gh` with `GITHUB_TOKEN` unset (PRD
 *   §15), marking the installed one.
 * - `update <channel>`: back up the current channel's database, install
 *   `github:<repo>#<channel>` globally with npm, then restore the target
 *   channel's backup when one exists (`--keep-data` keeps the live
 *   database instead). Reports the version before and after.
 *
 * Plain modules with injected `CommandRunner`, so the later in-app picker
 * (step 2) can reuse them through a service route; the CLI in
 * `cli/commands.ts` only parses args and prints. Refuses to run while the
 * service is live: the backup needs a quiet store, and npm must not
 * replace code under a running process.
 */
import type { CommandRunner } from "../exec/index.js";
import { runGh } from "../exec/index.js";
import { isPidAlive, readLock } from "../cli/lock.js";
import { SERVICE_VERSION } from "../server.js";
import { backupChannel, hasBackup, restoreChannel } from "./backup.js";
import {
  UNVIBE_REPO,
  formatChannelList,
  installSpec,
  isChannelName,
  parseChannelList,
  readInstalledBuild,
} from "./channels.js";

export const UPDATE_USAGE = [
  "unvibe update — switch the installed build between channels (issue #36)",
  "",
  "Usage: unvibe update --list",
  "       unvibe update <channel> [--keep-data]",
  "",
  "  --list       list release, release-rc and preview/* channels, marking the installed one",
  "  <channel>    install github:indigoviolet/unvibe#<channel> globally with npm",
  "  --keep-data  keep the live database instead of restoring the target channel's copy",
  "",
  "Each channel keeps its own database copy under <dataDir>/channel-backups/.",
  "Stop the service first (`unvibe stop`), then `unvibe start` afterwards.",
].join("\n");

export const DB_RULE =
  "DB rule: each channel keeps its own copy under channel-backups/ (migrations are " +
  "forward-only, so one channel's migrated database is wrong for another). Switching backs " +
  "up the old channel first, then restores the new channel's copy when one exists; " +
  "backups are never deleted.";

export interface UpdateDeps {
  runner: CommandRunner;
  dataDir: string;
  cliScriptPath: string | undefined;
}

export interface UpdateOutcome {
  code: number;
  lines: string[];
}

function ghFailedLines(res: { code: number; stdout: string; stderr: string }): string[] {
  const detail = (res.stderr || res.stdout).trim();
  const lines = [`could not list channels: gh exited ${res.code}`];
  if (detail) lines.push(detail);
  lines.push("fix with: gh auth login (then gh auth setup-git so git can fetch)");
  return lines;
}

/** List channels via `gh`, marking the installed one. */
export async function runUpdateList(deps: UpdateDeps): Promise<UpdateOutcome> {
  const installed = readInstalledBuild(deps.cliScriptPath, SERVICE_VERSION);
  const ghArgs = ["api", `repos/${UNVIBE_REPO}/branches`, "--paginate", "-q", ".[].name"];
  const res = await runGh(deps.runner, ghArgs, { args: ghArgs });
  if (res.code !== 0) return { code: 1, lines: ghFailedLines(res) };
  const channels = parseChannelList(res.stdout);
  return {
    code: 0,
    lines: [
      `installed: ${installed.channel ?? "(unknown channel)"} ${installed.version}`,
      ...formatChannelList(channels, installed),
    ],
  };
}

export interface UpdateChannelOptions {
  keepData: boolean;
}

/** Install a channel: backup, npm install, restore. Never runs live. */
export async function runUpdateToChannel(
  deps: UpdateDeps,
  channel: string,
  opts: UpdateChannelOptions,
): Promise<UpdateOutcome> {
  if (!isChannelName(channel)) {
    return {
      code: 2,
      lines: [
        `unknown channel: ${JSON.stringify(channel)}`,
        "want release, release-rc, or preview/<name> (see `unvibe update --list`)",
      ],
    };
  }
  const lock = readLock(deps.dataDir);
  if (lock && isPidAlive(lock.pid)) {
    const flag = opts.keepData ? " --keep-data" : "";
    return {
      code: 1,
      lines: [
        `the service is running (pid ${lock.pid} on port ${lock.port}) — stop it first:`,
        "  unvibe stop",
        `  unvibe update ${channel}${flag}`,
        "  unvibe start",
      ],
    };
  }
  const before = readInstalledBuild(deps.cliScriptPath, SERVICE_VERSION);
  if (before.channel === channel) {
    return { code: 0, lines: [`already on ${channel} (${before.version}) — nothing to do.`] };
  }
  const lines: string[] = [];
  lines.push(`current: ${before.channel ?? "(unknown channel)"} ${before.version}`);
  const backup = backupChannel(deps.dataDir, before.channel);
  if (backup.files.length > 0) {
    lines.push(`backed up ${backup.files.join(", ")} to ${backup.dir}`);
  } else {
    lines.push(`no database in ${deps.dataDir} to back up (fresh machine?)`);
  }
  const spec = installSpec(channel);
  lines.push(`installing ${spec} ...`);
  const inst = await deps.runner.run("npm", { args: ["install", "-g", spec] });
  if (inst.code !== 0) {
    const tail = `${inst.stdout}\n${inst.stderr}`.trim().split("\n").slice(-10).join("\n");
    lines.push(`npm install failed (exit ${inst.code}):`);
    if (tail) lines.push(tail);
    lines.push(
      backup.files.length > 0
        ? `the live database is untouched; the pre-switch copy is in ${backup.dir}`
        : "the live database is untouched.",
    );
    return { code: 1, lines };
  }
  const after = readInstalledBuild(deps.cliScriptPath, before.version);
  lines.push(`installed ${channel} ${after.version} (was ${before.version})`);
  if (opts.keepData) {
    lines.push(
      `--keep-data: keeping the live database (the ${before.channel ?? "previous"} copy stays in ${backup.dir})`,
    );
  } else if (hasBackup(deps.dataDir, channel)) {
    const restored = restoreChannel(deps.dataDir, channel);
    lines.push(`restored ${restored.files.join(", ")} from ${restored.dir}`);
  } else {
    lines.push(`no backup for ${channel} yet — keeping the live database`);
  }
  lines.push(DB_RULE);
  lines.push("run `unvibe start` to launch the new build.");
  return { code: 0, lines };
}
