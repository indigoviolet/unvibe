/**
 * `unvibe update` flows (issue #36): thin CLI composition over the shared
 * `../update/switch.ts` core. The in-app picker's `Updater` calls the same
 * core through a service route; nothing here restarts the service — a live
 * service is refused with a pointer to `unvibe stop`.
 */
import type { CommandRunner } from "../exec/index.js";
import {
  formatChannelList,
  isChannelName,
  listChannels,
  readInstalledBuild,
} from "../update/channels.js";
import { dbPlanForSwitch, runSwitchCore } from "../update/switch.js";

/** Kept here so existing imports keep working; owned by `update/switch.ts`. */
export { dbPlanForSwitch };

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
  "Each channel keeps its own database copy under <dataDir>/channel-backups/: " +
    "switching restores the target's copy when one exists, and a new preview never " +
    "inherits another preview's database (it starts from the release copy, or the " +
    "switch stops first — --keep-data keeps the live database instead).",
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

/** Install a channel: backup, npm install (verified), restore. Never runs live. */
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
  const result = await runSwitchCore({
    runner: deps.runner,
    dataDir: deps.dataDir,
    serviceScriptPath: deps.cliScriptPath,
    serviceVersion: deps.serviceVersion,
    channel,
    keepData: opts.keepData,
    log: () => {},
  });
  if (result.code === 2) {
    return {
      code: 2,
      lines: [
        `unknown channel: ${JSON.stringify(channel)}`,
        "want release, release-rc, or preview/<name> (see `unvibe update --list`)",
      ],
    };
  }
  const lines = [...result.lines];
  if (result.code === 0 && result.installed) lines.push("run `unvibe start` to launch the new build.");
  return { code: result.code, lines };
}
