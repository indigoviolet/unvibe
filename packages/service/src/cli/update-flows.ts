/**
 * `unvibe update` flows (issue #36, step 1): thin composition of the plain
 * `../update/` modules for the CLI. The step-2 `Updater.switchTo` will
 * compose the same modules through a service route; nothing here restarts
 * the service — a live service is refused with a pointer to `unvibe stop`.
 */
import type { CommandRunner } from "../exec/index.js";
import { isPidAlive, readLock } from "./lock.js";
import { DB_RULE, backupChannel, hasBackup, restoreChannel } from "../update/data-backup.js";
import {
  formatChannelList,
  isChannelName,
  listChannels,
  readInstalledBuild,
} from "../update/channels.js";
import { installRef, installSpec } from "../update/install.js";

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

export interface UpdateDeps {
  runner: CommandRunner;
  dataDir: string;
  cliScriptPath: string | undefined;
  serviceVersion: string;
}

export interface UpdateOutcome {
  code: number;
  lines: string[];
}

export interface UpdateChannelOptions {
  keepData: boolean;
}

/** List channels via `gh`, marking the installed one. */
export async function runUpdateListFlow(deps: UpdateDeps): Promise<UpdateOutcome> {
  const installed = readInstalledBuild(deps.cliScriptPath, deps.serviceVersion);
  try {
    const channels = await listChannels(deps.runner, installed);
    return {
      code: 0,
      lines: [
        `installed: ${installed.channel ?? "(unknown channel)"} ${installed.version}`,
        ...formatChannelList(channels, installed),
      ],
    };
  } catch (err) {
    return {
      code: 1,
      lines: [
        err instanceof Error ? err.message : String(err),
        "fix with: gh auth login (then gh auth setup-git so git can fetch)",
      ],
    };
  }
}

/** Install a channel: backup, npm install, restore. Never runs live. */
export async function runUpdateChannelFlow(
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
  const before = readInstalledBuild(deps.cliScriptPath, deps.serviceVersion);
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
  const inst = await installRef(deps.runner, channel);
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
